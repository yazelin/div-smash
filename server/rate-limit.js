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
