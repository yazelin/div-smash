const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRecentUrls } = require('./recent-urls');

function tempFilePath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'recent-urls-')), 'recent-urls.json');
}

test('starts empty when no file exists yet', () => {
  const { read } = createRecentUrls(tempFilePath());
  assert.deepEqual(read(), []);
});

test('adding a url puts it first', () => {
  const { add, read } = createRecentUrls(tempFilePath());
  add('https://a.example');
  add('https://b.example');
  assert.deepEqual(read(), ['https://b.example', 'https://a.example']);
});

test('re-adding an existing url moves it to front instead of duplicating', () => {
  const { add, read } = createRecentUrls(tempFilePath());
  add('https://a.example');
  add('https://b.example');
  add('https://a.example');
  assert.deepEqual(read(), ['https://a.example', 'https://b.example']);
});

test('caps at 20 entries, dropping the oldest', () => {
  const { add, read } = createRecentUrls(tempFilePath());
  for (let i = 0; i < 25; i++) add(`https://example.com/${i}`);
  const urls = read();
  assert.equal(urls.length, 20);
  assert.equal(urls[0], 'https://example.com/24');
  assert.equal(urls.includes('https://example.com/4'), false);
});

test('persists across separate instances pointed at the same file', () => {
  const filePath = tempFilePath();
  createRecentUrls(filePath).add('https://a.example');
  const { read } = createRecentUrls(filePath);
  assert.deepEqual(read(), ['https://a.example']);
});
