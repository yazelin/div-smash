const CAPTURE_ENDPOINT = 'http://localhost:3000/capture';
const VIEWPORT = { width: 1280, height: 800 };
const WORLD_HEIGHT = 1200;

const canvas = document.getElementById('stage');
const ctx = canvas.getContext('2d');
const urlInput = document.getElementById('url-input');
const loadBtn = document.getElementById('load-btn');
const statusEl = document.getElementById('status');

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

canvas.addEventListener('click', (evt) => {
  if (!engine) return;
  const rect = canvas.getBoundingClientRect();
  const point = { x: evt.clientX - rect.left, y: evt.clientY - rect.top };

  let hitAny = false;
  for (const body of shardBodies) {
    const dx = body.position.x - point.x;
    const dy = body.position.y - point.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > EXPLOSION_RADIUS) continue;

    hitAny = true;
    const falloff = 1 - dist / EXPLOSION_RADIUS;
    const dirX = dist > 1 ? dx / dist : Math.random() - 0.5;
    const dirY = dist > 1 ? dy / dist : -1;

    Matter.Body.setStatic(body, false);
    Matter.Body.setVelocity(body, {
      x: dirX * EXPLOSION_STRENGTH * falloff + (Math.random() - 0.5) * 2,
      y: dirY * EXPLOSION_STRENGTH * falloff - 2,
    });
    Matter.Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.3);
  }
  if (hitAny) playBreakSound();
});

loadBtn.addEventListener('click', () => loadUrl(urlInput.value.trim()));

setupWorld();
render();
