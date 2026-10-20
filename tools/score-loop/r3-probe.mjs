// Score loop r3 (visual): evaluate one expression in the app after load.
//   node tools/score-loop/r3-probe.mjs '<query>' '<js>' [desk|phone|land]
import { chromium } from 'playwright';
const { createServer } = await import('vite');
const dev = await createServer({ root: process.cwd(), logLevel: 'error', server: { host: '127.0.0.1', port: 47817, strictPort: true, open: false } });
await dev.listen();
const [query, js, kind] = process.argv.slice(2);
const CTX = {
  desk: { viewport: { width: 1440, height: 900 } },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  land: { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--hide-scrollbars'] });
try {
  const ctx = await browser.newContext({ ...CTX[kind || 'desk'], colorScheme: 'dark', reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:47817/?${query}`);
  await page.waitForFunction(() => window.p2p && document.querySelector('#veil')?.classList.contains('off'), null, { timeout: 90000 }).catch(() => {});
  await page.evaluate(() => window.p2p.settle()).catch(() => {});
  await page.waitForTimeout(2500);
  console.log(JSON.stringify(await page.evaluate(js), null, 1));
} finally { await browser.close(); await dev.close(); }
