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
