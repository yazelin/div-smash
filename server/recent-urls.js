const fs = require('node:fs');
const path = require('node:path');

const MAX_ENTRIES = 20;

function createRecentUrls(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  function read() {
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      return [];
    }
  }

  function add(url) {
    const urls = read().filter(u => u !== url);
    urls.unshift(url);
    const trimmed = urls.slice(0, MAX_ENTRIES);
    fs.writeFileSync(filePath, JSON.stringify(trimmed));
    return trimmed;
  }

  return { read, add };
}

module.exports = { createRecentUrls };
