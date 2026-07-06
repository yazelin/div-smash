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
