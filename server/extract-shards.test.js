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

test('captureShards fully tiles the viewport with reasonably-sized, breakable shards', async () => {
  const server = await startFixtureServer();
  const port = server.address().port;
  try {
    const result = await captureShards(`http://127.0.0.1:${port}/`);

    assert.equal(typeof result.screenshot, 'string');
    assert.equal(result.screenshot.startsWith('data:image/png;base64,'), true);

    // enough pieces to feel "fine", not just a handful of giant chunks
    assert.equal(result.shards.length > 20, true, `expected many shards, got ${result.shards.length}`);

    for (const shard of result.shards) {
      const area = shard.w * shard.h;
      assert.equal(area > 0, true, `zero-area shard: ${JSON.stringify(shard)}`);
      assert.equal(area <= 1280 * 800, true, `shard bigger than the viewport: ${JSON.stringify(shard)}`);
    }

    // every sampled point across the viewport must be covered by some shard -
    // otherwise that spot would show a permanently unbreakable background.
    for (let y = 20; y < 800; y += 40) {
      for (let x = 20; x < 1280; x += 40) {
        const covered = result.shards.some(s => x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h);
        assert.equal(covered, true, `gap at (${x},${y}) - not covered by any shard`);
      }
    }
  } finally {
    server.close();
  }
});
