# div-smash Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local, single-user prototype that captures a URL's first-screen screenshot + DOM element bounding boxes, then lets the user click page fragments to break them off with matter.js physics (fall, tumble, stack) — to validate the core "smash the page" hand-feel before investing in Phase 2's shared/persistent gallery.

**Architecture:** A small Node backend (`server/`) using only `http` + `playwright` exposes `POST /capture`, which loads the target URL in headless Chromium, walks the DOM to find viewport-sized element candidates, and returns one screenshot plus their bounding boxes. A static frontend (`public/`) loads matter.js from a CDN, builds one rigid body per shard (initially pinned in place to reconstruct the page's look), and on click releases the clicked shard into gravity/collision. No database, no framework, no build step.

**Tech Stack:** Node.js (built-in `http`, `node:test`, `node:assert/strict`), `playwright` (headless Chromium), vanilla HTML/CSS/JS, matter.js via CDN `<script>` tag.

## Global Constraints

- No new dependency beyond `playwright` on the backend; no Express, no test framework beyond Node's built-in `node:test`.
- Viewport for capture: `1280x800`.
- Shard candidate thresholds: min area `1600` px² (40×40), max area ratio `0.8` of viewport area (`819200` px²), cap at `80` shards (sorted by area descending, largest kept).
- SSRF guard must reject: non-`http`/`https` schemes, and resolved IPs in `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8`, `169.254.0.0/16`, `::1`, `fc00::/7`, `fe80::/10`.
- Page load timeout: 15000ms.
- Per-IP rate limit: default 5 requests / 60000ms window.
- Frontend: no framework, no bundler — plain `<script>` tags.
- Phase 1 has no persistence layer — no DB, no files written per-request.

---

## File Structure

```
div-smash/
├── .gitignore
├── README.md
├── server/
│   ├── package.json
│   ├── ssrf-guard.js          # URL scheme + private-IP validation
│   ├── ssrf-guard.test.js
│   ├── rate-limit.js          # per-key token bucket factory
│   ├── rate-limit.test.js
│   ├── extract-shards.js      # Playwright capture + DOM-walk shard extraction
│   ├── extract-shards.test.js
│   ├── test-fixtures/
│   │   └── sample.html        # deterministic fixture page for extract-shards tests
│   └── index.js               # http server wiring the three modules into POST /capture
└── public/
    ├── index.html              # URL input + canvas
    └── app.js                  # fetch + matter.js world + render loop + click handling
```

---

### Task 1: Project scaffold + SSRF guard

**Files:**
- Create: `.gitignore`
- Create: `server/package.json`
- Create: `server/ssrf-guard.js`
- Test: `server/ssrf-guard.test.js`

**Interfaces:**
- Produces: `assertUrlSafe(urlString: string): Promise<URL>` — throws `Error` if unsafe, resolves to a parsed `URL` if safe. `isPrivateOrLocal(address: string, family: 4 | 6): boolean` — pure helper, exported for direct testing.

- [ ] **Step 1: Create the project scaffold**

```bash
mkdir -p /home/ct/div-smash/server /home/ct/div-smash/public
cd /home/ct/div-smash
cat > .gitignore <<'EOF'
node_modules/
EOF
```

- [ ] **Step 2: Create `server/package.json`**

```json
{
  "name": "div-smash-server",
  "version": "0.1.0",
  "private": true,
  "type": "commonjs",
  "scripts": {
    "test": "node --test"
  },
  "dependencies": {
    "playwright": "^1.47.0"
  }
}
```

- [ ] **Step 3: Install dependencies**

```bash
cd /home/ct/div-smash/server && npm install
```
Expected: `playwright` installed into `server/node_modules`, `package-lock.json` created.

- [ ] **Step 4: Write the failing test** — `server/ssrf-guard.test.js`

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { isPrivateOrLocal, assertUrlSafe } = require('./ssrf-guard');

test('isPrivateOrLocal blocks loopback 127.x', () => {
  assert.equal(isPrivateOrLocal('127.0.0.1', 4), true);
});

test('isPrivateOrLocal blocks private 10.x', () => {
  assert.equal(isPrivateOrLocal('10.1.2.3', 4), true);
});

test('isPrivateOrLocal blocks private 172.16-31.x', () => {
  assert.equal(isPrivateOrLocal('172.16.0.5', 4), true);
  assert.equal(isPrivateOrLocal('172.31.255.255', 4), true);
  assert.equal(isPrivateOrLocal('172.32.0.1', 4), false);
});

test('isPrivateOrLocal blocks private 192.168.x', () => {
  assert.equal(isPrivateOrLocal('192.168.1.1', 4), true);
});

test('isPrivateOrLocal blocks link-local 169.254.x', () => {
  assert.equal(isPrivateOrLocal('169.254.1.1', 4), true);
});

test('isPrivateOrLocal allows a public IPv4', () => {
  assert.equal(isPrivateOrLocal('93.184.216.34', 4), false);
});

test('isPrivateOrLocal blocks IPv6 loopback and unique-local', () => {
  assert.equal(isPrivateOrLocal('::1', 6), true);
  assert.equal(isPrivateOrLocal('fc00::1', 6), true);
  assert.equal(isPrivateOrLocal('fe80::1', 6), true);
  assert.equal(isPrivateOrLocal('2001:4860:4860::8888', 6), false);
});

test('assertUrlSafe rejects non-http schemes', async () => {
  await assert.rejects(() => assertUrlSafe('file:///etc/passwd'));
  await assert.rejects(() => assertUrlSafe('ftp://example.com'));
});

test('assertUrlSafe rejects localhost (resolves to loopback)', async () => {
  await assert.rejects(() => assertUrlSafe('http://localhost/'));
});

test('assertUrlSafe resolves a public URL', async () => {
  const result = await assertUrlSafe('https://example.com/');
  assert.equal(result instanceof URL, true);
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `cd /home/ct/div-smash/server && node --test ssrf-guard.test.js`
Expected: FAIL — `Cannot find module './ssrf-guard'`

- [ ] **Step 6: Write the implementation** — `server/ssrf-guard.js`

```js
const dns = require('node:dns').promises;

function isPrivateOrLocal(address, family) {
  if (family === 4) {
    const parts = address.split('.').map(Number);
    if (parts[0] === 10) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 0) return true;
    return false;
  }
  const normalized = address.toLowerCase();
  if (normalized === '::1') return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  if (normalized.startsWith('fe80')) return true;
  return false;
}

async function assertUrlSafe(urlString) {
  const parsed = new URL(urlString);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`scheme not allowed: ${parsed.protocol}`);
  }
  const addresses = await dns.lookup(parsed.hostname, { all: true });
  for (const { address, family } of addresses) {
    if (isPrivateOrLocal(address, family)) {
      throw new Error(`blocked private/local address: ${address}`);
    }
  }
  return parsed;
}

module.exports = { assertUrlSafe, isPrivateOrLocal };
```

- [ ] **Step 7: Run test to verify it passes**

Run: `cd /home/ct/div-smash/server && node --test ssrf-guard.test.js`
Expected: PASS, all `test(...)` blocks green.

- [ ] **Step 8: Commit**

```bash
cd /home/ct/div-smash
git add .gitignore server/package.json server/package-lock.json server/ssrf-guard.js server/ssrf-guard.test.js
git commit -m "feat(server): SSRF guard for capture URLs"
```

---

### Task 2: Rate limiter

**Files:**
- Create: `server/rate-limit.js`
- Test: `server/rate-limit.test.js`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `createLimiter({ windowMs?: number, maxRequests?: number }): (key: string) => boolean` — returns `true` if the request is allowed, `false` if the key is over its limit for the current window.

- [ ] **Step 1: Write the failing test** — `server/rate-limit.test.js`

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createLimiter } = require('./rate-limit');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

test('allows requests under the limit', () => {
  const allow = createLimiter({ windowMs: 10_000, maxRequests: 2 });
  assert.equal(allow('1.2.3.4'), true);
  assert.equal(allow('1.2.3.4'), true);
});

test('blocks requests over the limit within the window', () => {
  const allow = createLimiter({ windowMs: 10_000, maxRequests: 2 });
  allow('1.2.3.4');
  allow('1.2.3.4');
  assert.equal(allow('1.2.3.4'), false);
});

test('tracks separate keys independently', () => {
  const allow = createLimiter({ windowMs: 10_000, maxRequests: 1 });
  assert.equal(allow('1.1.1.1'), true);
  assert.equal(allow('2.2.2.2'), true);
});

test('resets after the window passes', async () => {
  const allow = createLimiter({ windowMs: 50, maxRequests: 1 });
  assert.equal(allow('1.2.3.4'), true);
  assert.equal(allow('1.2.3.4'), false);
  await sleep(70);
  assert.equal(allow('1.2.3.4'), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/ct/div-smash/server && node --test rate-limit.test.js`
Expected: FAIL — `Cannot find module './rate-limit'`

- [ ] **Step 3: Write the implementation** — `server/rate-limit.js`

```js
function createLimiter({ windowMs = 60_000, maxRequests = 5 } = {}) {
  const buckets = new Map();
  return function allow(key) {
    const now = Date.now();
    const bucket = buckets.get(key);
    if (!bucket || now > bucket.resetAt) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    if (bucket.count >= maxRequests) return false;
    bucket.count += 1;
    return true;
  };
}

module.exports = { createLimiter };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/ct/div-smash/server && node --test rate-limit.test.js`
Expected: PASS, all 4 tests green.

- [ ] **Step 5: Commit**

```bash
cd /home/ct/div-smash
git add server/rate-limit.js server/rate-limit.test.js
git commit -m "feat(server): per-key rate limiter"
```

---

### Task 3: Shard extraction (Playwright capture + DOM walk)

**Files:**
- Create: `server/extract-shards.js`
- Create: `server/test-fixtures/sample.html`
- Test: `server/extract-shards.test.js`

**Interfaces:**
- Consumes: nothing from Tasks 1–2.
- Produces: `captureShards(url: string): Promise<{ screenshot: string, shards: Array<{x:number,y:number,w:number,h:number}> }>` — `screenshot` is a `data:image/png;base64,...` string. Later tasks (index.js, frontend) rely on this exact shape.

- [ ] **Step 1: Install the Chromium browser binary**

```bash
cd /home/ct/div-smash/server && npx playwright install chromium
```
Expected: downloads and installs a Chromium build for Playwright (only needs doing once).

- [ ] **Step 2: Create the deterministic test fixture** — `server/test-fixtures/sample.html`

```html
<!doctype html>
<html>
<head>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; position: relative; width: 1280px; height: 800px; background: #fff; }
  #header { position: absolute; top: 0; left: 0; width: 1280px; height: 60px; background: red; }
  #content { position: absolute; top: 60px; left: 0; width: 1280px; height: 680px; background: #eee; }
  .card { position: absolute; width: 300px; height: 200px; background: blue; }
  #card1 { top: 0; left: 0; }
  #card2 { top: 0; left: 320px; }
  #card3 { top: 0; left: 640px; }
  #tiny { position: absolute; top: 220px; left: 0; width: 5px; height: 5px; background: green; }
  #footer { position: absolute; top: 740px; left: 0; width: 1280px; height: 40px; background: black; }
</style>
</head>
<body>
  <div id="header"></div>
  <div id="content">
    <div id="card1" class="card"></div>
    <div id="card2" class="card"></div>
    <div id="card3" class="card"></div>
    <div id="tiny"></div>
  </div>
  <div id="footer"></div>
</body>
</html>
```

This fixture is designed so the expected extraction result is exactly deterministic: `#content` (1280×680 = 870,400 px²) exceeds the 819,200 px² max-area threshold, so it is *not* taken as a shard itself — instead the walk recurses into its children. `#tiny` (5×5 = 25 px²) is below the 1,600 px² min-area threshold and is skipped. That leaves exactly 5 candidate shards: `#header`, `#card1`, `#card2`, `#card3`, `#footer`.

- [ ] **Step 3: Write the failing test** — `server/extract-shards.test.js`

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { captureShards } = require('./extract-shards');

function startFixtureServer() {
  const html = fs.readFileSync(path.join(__dirname, 'test-fixtures', 'sample.html'));
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

test('captureShards extracts the expected shards from the fixture page', async () => {
  const server = await startFixtureServer();
  const port = server.address().port;
  try {
    const result = await captureShards(`http://127.0.0.1:${port}/`);

    assert.equal(typeof result.screenshot, 'string');
    assert.equal(result.screenshot.startsWith('data:image/png;base64,'), true);

    assert.equal(result.shards.length, 5);
    for (const shard of result.shards) {
      const area = shard.w * shard.h;
      assert.equal(area >= 1600, true, `shard too small: ${JSON.stringify(shard)}`);
      assert.equal(area <= 819200, true, `shard too large: ${JSON.stringify(shard)}`);
    }
  } finally {
    server.close();
  }
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd /home/ct/div-smash/server && node --test extract-shards.test.js`
Expected: FAIL — `Cannot find module './extract-shards'`

- [ ] **Step 5: Write the implementation** — `server/extract-shards.js`

```js
const { chromium } = require('playwright');

const VIEWPORT = { width: 1280, height: 800 };
const MIN_AREA = 40 * 40;
const MAX_AREA_RATIO = 0.8;
const MAX_SHARDS = 80;

async function captureShards(url) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: VIEWPORT });
    await page.goto(url, { waitUntil: 'load', timeout: 15000 });

    const shards = await page.evaluate(({ width, height, minArea, maxAreaRatio }) => {
      const maxArea = width * height * maxAreaRatio;
      const results = [];

      function walk(el) {
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) {
          return;
        }
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;

        const fullyInViewport = rect.left >= 0 && rect.top >= 0 && rect.right <= width && rect.bottom <= height;
        if (!fullyInViewport) {
          for (const child of el.children) walk(child);
          return;
        }

        const area = rect.width * rect.height;
        if (area < minArea) return;
        if (area > maxArea) {
          for (const child of el.children) walk(child);
          return;
        }

        results.push({
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
        });
      }

      walk(document.body);
      return results;
    }, { width: VIEWPORT.width, height: VIEWPORT.height, minArea: MIN_AREA, maxAreaRatio: MAX_AREA_RATIO });

    const trimmed = shards
      .sort((a, b) => (b.w * b.h) - (a.w * a.h))
      .slice(0, MAX_SHARDS);

    const screenshotBuffer = await page.screenshot({
      clip: { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height },
    });

    return {
      screenshot: `data:image/png;base64,${screenshotBuffer.toString('base64')}`,
      shards: trimmed,
    };
  } finally {
    await browser.close();
  }
}

module.exports = { captureShards };
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd /home/ct/div-smash/server && node --test extract-shards.test.js`
Expected: PASS. (First run may take a few seconds while Chromium launches.)

- [ ] **Step 7: Commit**

```bash
cd /home/ct/div-smash
git add server/extract-shards.js server/extract-shards.test.js server/test-fixtures/sample.html
git commit -m "feat(server): capture screenshot + DOM-walk shard extraction"
```

---

### Task 4: HTTP server wiring (`POST /capture`)

**Files:**
- Create: `server/index.js`

**Interfaces:**
- Consumes: `assertUrlSafe` from `./ssrf-guard`, `createLimiter` from `./rate-limit`, `captureShards` from `./extract-shards`.
- Produces: an HTTP server on `process.env.PORT || 3000` exposing `POST /capture` with JSON body `{ "url": string }`, responding `200 { screenshot, shards }` on success or `4xx { error: string }` on failure. This is what `public/app.js` (Task 5) calls.

- [ ] **Step 1: Write `server/index.js`**

```js
const http = require('node:http');
const { assertUrlSafe } = require('./ssrf-guard');
const { captureShards } = require('./extract-shards');
const { createLimiter } = require('./rate-limit');

const PORT = process.env.PORT || 3000;
const allow = createLimiter({ windowMs: 60_000, maxRequests: 5 });

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== 'POST' || req.url !== '/capture') {
    sendJson(res, 404, { error: 'not found' });
    return;
  }

  const ip = req.socket.remoteAddress || 'unknown';
  if (!allow(ip)) {
    sendJson(res, 429, { error: 'rate limit exceeded, try again in a minute' });
    return;
  }

  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', async () => {
    try {
      const { url } = JSON.parse(body);
      const safeUrl = await assertUrlSafe(url);
      const result = await captureShards(safeUrl.toString());
      sendJson(res, 200, result);
    } catch (err) {
      sendJson(res, 400, { error: err.message });
    }
  });
});

server.listen(PORT, () => {
  console.log(`div-smash capture service listening on :${PORT}`);
});
```

- [ ] **Step 2: Manual smoke test — start the server and curl it**

```bash
cd /home/ct/div-smash/server && node index.js &
sleep 1
curl -s -X POST http://localhost:3000/capture -H 'Content-Type: application/json' -d '{"url":"https://example.com"}' | head -c 300
echo
curl -s -X POST http://localhost:3000/capture -H 'Content-Type: application/json' -d '{"url":"http://192.168.1.1"}'
kill %1
```
Expected: first curl returns JSON starting with `{"screenshot":"data:image/png;base64,...` and a non-empty `shards` array; second curl returns `{"error":"blocked private/local address: 192.168.1.1"}`.

- [ ] **Step 3: Commit**

```bash
cd /home/ct/div-smash
git add server/index.js
git commit -m "feat(server): wire SSRF guard, rate limiter and shard extraction into POST /capture"
```

---

### Task 5: Frontend — canvas + matter.js physics

**Files:**
- Create: `public/index.html`
- Create: `public/app.js`

**Interfaces:**
- Consumes: `POST http://localhost:3000/capture` from Task 4, response shape `{ screenshot: string, shards: Array<{x,y,w,h}> }`.
- Produces: nothing consumed elsewhere — this is the top of the stack.

- [ ] **Step 1: Write `public/index.html`**

```html
<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<title>div-smash — 網頁解壓小遊戲</title>
<script src="https://cdn.jsdelivr.net/npm/matter-js@0.19.0/build/matter.min.js"></script>
<style>
  body { margin: 0; font-family: system-ui, sans-serif; background: #222; color: #eee; }
  #controls { padding: 12px; display: flex; gap: 8px; }
  #url-input { flex: 1; padding: 8px; font-size: 14px; }
  #load-btn { padding: 8px 16px; }
  #stage { display: block; background: #333; margin: 0 auto; }
  #status { padding: 0 12px 12px; font-size: 13px; color: #aaa; }
</style>
</head>
<body>
  <div id="controls">
    <input id="url-input" placeholder="貼上要破壞的網址,例如 https://example.com" value="https://example.com">
    <button id="load-btn">載入</button>
  </div>
  <div id="status"></div>
  <canvas id="stage" width="1280" height="1200"></canvas>
  <script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `public/app.js`**

```js
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

canvas.addEventListener('click', (evt) => {
  if (!engine) return;
  const rect = canvas.getBoundingClientRect();
  const point = { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
  for (let i = shardBodies.length - 1; i >= 0; i--) {
    const body = shardBodies[i];
    if (Matter.Vertices.contains(body.vertices, point)) {
      Matter.Body.setStatic(body, false);
      Matter.Body.applyForce(body, body.position, {
        x: (Math.random() - 0.5) * 0.05,
        y: -0.02,
      });
      break;
    }
  }
});

loadBtn.addEventListener('click', () => loadUrl(urlInput.value.trim()));

setupWorld();
render();
```

- [ ] **Step 3: Commit**

```bash
cd /home/ct/div-smash
git add public/index.html public/app.js
git commit -m "feat(frontend): matter.js physics shatter page"
```

---

### Task 6: End-to-end local verification

**Files:** none (verification only).

- [ ] **Step 1: Start the backend**

```bash
cd /home/ct/div-smash/server && node index.js &
```

- [ ] **Step 2: Serve the frontend statically**

```bash
cd /home/ct/div-smash/public && python3 -m http.server 8000 &
```

- [ ] **Step 3: Drive the page in a real browser and confirm the full loop works**

Open `http://localhost:8000`, confirm:
1. The default URL loads and the canvas renders the target page's first screen made of shard tiles (should look identical to the real page at a glance).
2. Clicking a shard (e.g. a header or card block) detaches it — it falls, rotates, and lands/stacks on the invisible floor, colliding with previously-dropped shards.
3. The status line updates with shard count on load and with errors when given a bad URL.
4. Loading `http://127.0.0.1` or another private address shows the SSRF-guard error message instead of a screenshot.

- [ ] **Step 4: Stop background processes**

```bash
kill %1 %2
```

---

### Task 7: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

```markdown
# div-smash

貼一個網址,把它的首屏切成一塊塊碎片,用滑鼠/手指打爛它——碎片會依真實物理掉落、翻滾、堆疊。

**目前狀態:Phase 1(單人原型,驗證核心手感,無持久化)。**

## 執行方式

```bash
# 1. 啟動截圖/切塊後端
cd server && npm install && npx playwright install chromium && node index.js

# 2. 另開一個 terminal,啟動前端靜態伺服
cd public && python3 -m http.server 8000
```

開瀏覽器到 `http://localhost:8000`,貼上網址、按載入,點擊畫面上的碎片。

## 架構

- `server/`:Node + Playwright,`POST /capture` 收 URL,回傳截圖(base64)+ 首屏內顯著 DOM 元素的座標。有 SSRF 防護(擋私網/loopback IP)與簡單 per-IP rate limit。
- `public/`:純靜態頁面,`matter.js`(CDN 載入)做碎片物理破壞,截圖當作 sprite sheet 用,不需要後端裁圖。

## 尚未做(Phase 2 方向)

- 共享累積損傷(多人一起打爛同一份頁面)、破壞過的頁面畫廊
- 部署到 .11 / 正式上線

詳見 `docs/superpowers/specs/2026-07-07-div-smash-design.md`。
```

- [ ] **Step 2: Commit**

```bash
cd /home/ct/div-smash
git add README.md
git commit -m "docs: add README"
```
