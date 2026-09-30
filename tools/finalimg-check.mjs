// Checks the final-image panel end to end in the built app: the worker renders, the canvas paints, no errors.
// node tools/finalimg-check.mjs  ->  shots/finalimg.png
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { startPreview } from './preview.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const { url, close } = await startPreview();
const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url + '?lens=p85&fno=1.4&focus=3', { waitUntil: 'load' });
  await page.waitForFunction(() => Boolean(window.p2p), null, { timeout: 20000 });
  const t0 = Date.now();
  await page.waitForFunction(() => {
    const card = document.querySelector('.finalimg-card');
    const cap = document.getElementById('finalimg-cap')?.textContent || '';
    return card && !card.classList.contains('rendering') && /Rendered by the engine/.test(cap);
  }, null, { timeout: 60000 });
  const ms = Date.now() - t0;
  await page.locator('.finalimg').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.locator('.finalimg').screenshot({ path: fileURLToPath(new URL('../shots/finalimg.png', import.meta.url)) });
  const stats = await page.evaluate(() => {
    const c = document.getElementById('finalimg-canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let sum = 0, nonBlack = 0;
    for (let i = 0; i < d.length; i += 4) { const v = d[i] + d[i + 1] + d[i + 2]; sum += v; if (v > 30) nonBlack++; }
    return { meanRGB: sum / (d.length / 4) / 3, nonBlackFrac: nonBlack / (d.length / 4), cap: document.getElementById('finalimg-cap').textContent };
  });
  console.log(JSON.stringify({ ms, ...stats, errors }));
} finally {
  await browser.close();
  await close();
}
