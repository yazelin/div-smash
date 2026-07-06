const { chromium } = require('playwright');

const VIEWPORT = { width: 1280, height: 800 };
const MIN_AREA = 40 * 40;
const MAX_AREA_RATIO = 0.15;
const MAX_SHARDS = 80;

async function captureShards(url) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: VIEWPORT });
    await page.goto(url, { waitUntil: 'load', timeout: 15000 });

    const shards = await page.evaluate(({ width, height, minArea, maxAreaRatio }) => {
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

    const trimmed = shards
      .sort((a, b) => (b.w * b.h) - (a.w * a.h))
      .slice(0, MAX_SHARDS);

    const screenshotBuffer = await page.screenshot({
      clip: { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height },
    });

    return {
      screenshot: `data:image/png;base64,${screenshotBuffer.toString('base64')}`,
      shards: trimmed,
    };
  } finally {
    await browser.close();
  }
}

module.exports = { captureShards };
