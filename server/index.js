const path = require('node:path');
const http = require('node:http');
const { assertUrlSafe } = require('./ssrf-guard');
const { captureShards } = require('./extract-shards');
const { createLimiter } = require('./rate-limit');
const { createRecentUrls } = require('./recent-urls');

const PORT = process.env.PORT || 3000;
const allow = createLimiter({ windowMs: 60_000, maxRequests: 5 });
const recentUrls = createRecentUrls(path.join(__dirname, 'data', 'recent-urls.json'));

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

  if (req.method === 'GET' && req.url === '/recent') {
    sendJson(res, 200, { urls: recentUrls.read() });
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
      recentUrls.add(safeUrl.toString());
      sendJson(res, 200, result);
    } catch (err) {
      sendJson(res, 400, { error: err.message });
    }
  });
});

server.listen(PORT, () => {
  console.log(`div-smash capture service listening on :${PORT}`);
});
