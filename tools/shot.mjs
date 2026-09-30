// Builds+serves the app (tools/preview.mjs), drives it with Playwright's system Chrome and WebGPU, asserts a
// real WebGPU backend (p2p.backend()) and zero console errors, and saves desktop 1600x900 / phone 390x844
// screenshots of each set piece to shots/shell/ (gitignored). node tools/shot.mjs
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { startPreview } from './preview.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const OUT = fileURLToPath(new URL('../shots/shell/', import.meta.url));
mkdirSync(OUT, { recursive: true });

const PIECES = ['lens', 'cone', 'loupe'];

async function main() {
  const { url, close } = await startPreview();
  let browser;
  let failed = false;
  try {
    browser = await chromium.launch({
      headless: true,
      channel: 'chrome',
      args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--hide-scrollbars'],
    });

    for (const [name, ctxOpts] of [
      ['desktop', { viewport: { width: 1600, height: 900 } }],
      ['phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
    ]) {
      const ctx = await browser.newContext({ ...ctxOpts, colorScheme: 'dark' });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (err) => errors.push(String(err)));
      page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });

      await page.goto(url, { waitUntil: 'load' });
      await page.waitForFunction(() => Boolean(window.p2p), { timeout: 20000 });

      const backend = await page.evaluate(() => window.p2p.backend());
      if (backend !== 'webgpu') {
        failed = true;
        console.error(`shot.mjs: FAIL -- ${name}: expected backend "webgpu", got "${backend}"`);
      } else {
        console.log(`shot.mjs: ${name}: backend webgpu, ok`);
      }

      for (const piece of PIECES) {
        await page.evaluate((p) => window.p2p.piece(p), piece);
        await page.evaluate(() => window.p2p.settle());
        await page.evaluate(() => window.p2p.gpuIdle());
        await page.waitForTimeout(150); // one more paint after gpuIdle, for the label/pin overlay's own rAF
        await page.screenshot({ path: `${OUT}${name}-${piece}.png` });
        console.log(`shot.mjs: saved ${name}-${piece}.png`);
      }

      if (errors.length) {
        failed = true;
        console.error(`shot.mjs: FAIL -- ${name}: ${errors.length} console error(s):\n  ${errors.join('\n  ')}`);
      } else {
        console.log(`shot.mjs: ${name}: zero console errors, ok`);
      }
      await ctx.close();
    }
  } finally {
    await browser?.close();
    await close();
  }

  if (failed) {
    console.error('shot.mjs: FAILED');
    process.exitCode = 1;
  } else {
    console.log(`shot.mjs: all checks passed, screenshots in ${OUT}`);
  }
}

await main();
