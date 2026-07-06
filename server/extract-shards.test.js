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
