const { chromium } = require('playwright');

const VIEWPORT = { width: 1280, height: 800 };
const MIN_AREA = 40 * 40;
const MAX_AREA_RATIO = 0.08;
const MAX_SHARDS = 200;
const FILLER_CELL_SIZE = 80;

// The DOM walk only finds shards where real elements exist. Big background
// sections with no finer child markup, or padding around centered content,
// leave gaps with nothing tracking them - which means they can never be
// broken (there's no shard body there to click). Tile whatever's left
// uncovered with a plain grid so every pixel is eventually breakable.
//
// A cell is skipped only if some single natural shard fully contains it -
// checking just the cell's center is not enough (a shard can cover a cell's
// midpoint while leaving part of that same cell outside its bounds, e.g. a
// 200px-tall element inside a 160px-aligned grid cell).
function fillGaps(shards, width, height) {
  const filler = [];
  for (let y = 0; y < height; y += FILLER_CELL_SIZE) {
    for (let x = 0; x < width; x += FILLER_CELL_SIZE) {
      const w = Math.min(FILLER_CELL_SIZE, width - x);
      const h = Math.min(FILLER_CELL_SIZE, height - y);
      const fullyContained = shards.some(s => x >= s.x && x + w <= s.x + s.w && y >= s.y && y + h <= s.y + s.h);
      if (!fullyContained) {
        filler.push({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });
      }
    }
  }
  return filler;
}

async function captureShards(url) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: VIEWPORT });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });

    const domShards = await page.evaluate(({ width, height, minArea, maxAreaRatio }) => {
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

    const shards = domShards
      .concat(fillGaps(domShards, VIEWPORT.width, VIEWPORT.height))
      .sort((a, b) => (b.w * b.h) - (a.w * a.h))
      .slice(0, MAX_SHARDS);

    const screenshotBuffer = await page.screenshot({
      clip: { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height },
    });

    return {
      screenshot: `data:image/png;base64,${screenshotBuffer.toString('base64')}`,
      shards,
    };
  } finally {
    await browser.close();
  }
}

module.exports = { captureShards };
