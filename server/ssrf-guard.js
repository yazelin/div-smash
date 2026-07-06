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
