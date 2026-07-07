const API_BASE = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
  ? 'http://localhost:3000'
  : 'https://ching-tech.ddns.net/div-smash-api';
const CAPTURE_ENDPOINT = `${API_BASE}/capture`;
const RECENT_ENDPOINT = `${API_BASE}/recent`;
const VIEWPORT = { width: 1280, height: 800 };
const WORLD_HEIGHT = 1200;

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
const urlInput = document.getElementById('url-input');
const loadBtn = document.getElementById('load-btn');
const statusEl = document.getElementById('status');
const recentEl = document.getElementById('recent');

async function refreshRecentUrls() {
  try {
    const res = await fetch(RECENT_ENDPOINT);
    const data = await res.json();
    recentEl.innerHTML = '';
    if (!data.urls || data.urls.length === 0) return;
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = '最近有人打過:';
    recentEl.appendChild(label);
    for (const url of data.urls) {
      const btn = document.createElement('button');
      btn.textContent = url;
      btn.addEventListener('click', () => { urlInput.value = url; });
      recentEl.appendChild(btn);
    }
  } catch {
    // best-effort - no recent list is not worth surfacing as an error
  }
}

let engine = null;
let runner = null;
let shardBodies = [];
let screenshotImg = null;
let audioCtx = null;

function playBreakSound() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const now = audioCtx.currentTime;

  // noise burst for the "crash"
  const bufferSize = Math.floor(audioCtx.sampleRate * 0.3);
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
  }
  const noise = audioCtx.createBufferSource();
  noise.buffer = buffer;
  const noiseFilter = audioCtx.createBiquadFilter();
  noiseFilter.type = 'highpass';
  noiseFilter.frequency.value = 2000;
  const noiseGain = audioCtx.createGain();
  noiseGain.gain.setValueAtTime(0.4, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
  noise.connect(noiseFilter).connect(noiseGain).connect(audioCtx.destination);
  noise.start(now);

  // a handful of high-pitched "tinkling shard" tones
  [3200, 4200, 5300, 6100].forEach((freq, i) => {
    const osc = audioCtx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq * (0.9 + Math.random() * 0.2);
    const gain = audioCtx.createGain();
    const start = now + i * 0.02;
    gain.gain.setValueAtTime(0.15, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.25);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(start);
    osc.stop(start + 0.3);
  });
}

function setupWorld() {
  if (runner) Matter.Runner.stop(runner);
  engine = Matter.Engine.create();
  engine.world.gravity.y = 1;

  const ground = Matter.Bodies.rectangle(VIEWPORT.width / 2, WORLD_HEIGHT + 25, VIEWPORT.width * 2, 50, { isStatic: true });
  const leftWall = Matter.Bodies.rectangle(-25, WORLD_HEIGHT / 2, 50, WORLD_HEIGHT * 2, { isStatic: true });
  const rightWall = Matter.Bodies.rectangle(VIEWPORT.width + 25, WORLD_HEIGHT / 2, 50, WORLD_HEIGHT * 2, { isStatic: true });
  Matter.World.add(engine.world, [ground, leftWall, rightWall]);

  runner = Matter.Runner.create();
  Matter.Runner.run(runner, engine);
}

async function loadUrl(url) {
  statusEl.textContent = '載入中...';
  loadBtn.disabled = true;
  try {
    const res = await fetch(CAPTURE_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '載入失敗');

    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('screenshot image failed to decode'));
      img.src = data.screenshot;
    });
    screenshotImg = img;

    setupWorld();
    shardBodies = data.shards.map(shard => {
      const cx = shard.x + shard.w / 2;
      const cy = shard.y + shard.h / 2;
      const body = Matter.Bodies.rectangle(cx, cy, shard.w, shard.h, { isStatic: true });
      body.shardRect = shard;
      Matter.World.add(engine.world, body);
      return body;
    });
    statusEl.textContent = `已載入,${shardBodies.length} 塊碎片,點擊打爛它們`;
    refreshRecentUrls();
  } catch (err) {
    statusEl.textContent = `錯誤: ${err.message}`;
  } finally {
    loadBtn.disabled = false;
  }
}

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (screenshotImg) {
    // draw the intact page first so anything not covered by a shard
    // (background colour, padding, content the DOM walk skipped) still
    // shows the real screenshot instead of the canvas's own background.
    ctx.drawImage(screenshotImg, 0, 0);

    // punch a hole where a shard has actually broken loose, so its
    // original spot looks removed instead of duplicated.
    for (const body of shardBodies) {
      if (!body.isStatic) {
        const { x, y, w, h } = body.shardRect;
        ctx.clearRect(x, y, w, h);
      }
    }

    for (const body of shardBodies) {
      const { x, y, w, h } = body.shardRect;
      ctx.save();
      ctx.translate(body.position.x, body.position.y);
      ctx.rotate(body.angle);
      ctx.drawImage(screenshotImg, x, y, w, h, -w / 2, -h / 2, w, h);
      ctx.restore();
    }
  }
  requestAnimationFrame(render);
}

const EXPLOSION_RADIUS = 140;
const EXPLOSION_STRENGTH = 14;
const SHATTER_CHANCE = 0.5;
const SHATTER_MIN_PIECE = 24;
const SHATTER_MAX_GRID = 5;

// Splits an already-loose shard into a grid of smaller fragments, each
// getting its own outward kick from the hit point - a second hit on the
// same piece has a chance to pulverize it further instead of staying one
// solid rectangle forever. Pieces already near SHATTER_MIN_PIECE just fall
// through to a normal re-kick (see the shatterable check below).
function shatterIntoPowder(body, origin) {
  const { x, y, w, h } = body.shardRect;
  Matter.World.remove(engine.world, body);
  shardBodies.splice(shardBodies.indexOf(body), 1);

  const cols = Math.max(1, Math.min(SHATTER_MAX_GRID, Math.floor(w / SHATTER_MIN_PIECE)));
  const rows = Math.max(1, Math.min(SHATTER_MAX_GRID, Math.floor(h / SHATTER_MIN_PIECE)));
  const pieceW = w / cols;
  const pieceH = h / rows;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const px = x + c * pieceW;
      const py = y + r * pieceH;
      const cx = px + pieceW / 2;
      const cy = py + pieceH / 2;
      const piece = Matter.Bodies.rectangle(cx, cy, pieceW, pieceH, { isStatic: false });
      piece.shardRect = { x: px, y: py, w: pieceW, h: pieceH };

      const dx = cx - origin.x;
      const dy = cy - origin.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      Matter.Body.setVelocity(piece, {
        x: (dx / dist) * 10 + (Math.random() - 0.5) * 4,
        y: (dy / dist) * 10 - 3 + (Math.random() - 0.5) * 4,
      });
      Matter.Body.setAngularVelocity(piece, (Math.random() - 0.5) * 0.5);

      Matter.World.add(engine.world, piece);
      shardBodies.push(piece);
    }
  }
}

canvas.addEventListener('click', (evt) => {
  if (!engine) return;
  const rect = canvas.getBoundingClientRect();
  const point = { x: evt.clientX - rect.left, y: evt.clientY - rect.top };

  const hits = shardBodies.filter(body => {
    const dx = body.position.x - point.x;
    const dy = body.position.y - point.y;
    return Math.sqrt(dx * dx + dy * dy) <= EXPLOSION_RADIUS;
  });
  if (hits.length === 0) return;

  const toShatter = [];
  for (const body of hits) {
    const dx = body.position.x - point.x;
    const dy = body.position.y - point.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const falloff = 1 - dist / EXPLOSION_RADIUS;
    const dirX = dist > 1 ? dx / dist : Math.random() - 0.5;
    const dirY = dist > 1 ? dy / dist : -1;

    const shatterable = body.shardRect.w > SHATTER_MIN_PIECE * 1.5 && body.shardRect.h > SHATTER_MIN_PIECE * 1.5;
    if (!body.isStatic && shatterable && Math.random() < SHATTER_CHANCE) {
      toShatter.push(body);
      continue;
    }

    Matter.Body.setStatic(body, false);
    Matter.Body.setVelocity(body, {
      x: dirX * EXPLOSION_STRENGTH * falloff + (Math.random() - 0.5) * 2,
      y: dirY * EXPLOSION_STRENGTH * falloff - 2,
    });
    Matter.Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.3);
  }
  for (const body of toShatter) shatterIntoPowder(body, point);

  playBreakSound();
});

loadBtn.addEventListener('click', () => loadUrl(urlInput.value.trim()));

setupWorld();
render();
refreshRecentUrls();
