// Score loop r2: the Play-the-shot opening chapter (scene and optics panels) at 1440x900, for before/after evidence.
//   node tools/score-loop/shot-panel.mjs out.png [seconds]   (starts its own dev server on 47802)
import { chromium } from 'playwright';
const [out, t = '3'] = process.argv.slice(2);
const { createServer } = await import('vite');
const dev = await createServer({ root: process.cwd(), logLevel: 'error', server: { host: '127.0.0.1', port: 47802, strictPort: true } });
await dev.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--hide-scrollbars'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await page.goto('http://127.0.0.1:47802/?lens=n50');
  await page.waitForFunction(() => window.p2p?.pieces.camera, null, { timeout: 90000 });
  await page.locator('.shot-launch').click();
  await page.waitForFunction(() => document.querySelector('#shot-dialog')?.open, null, { timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.locator('#shot-time').evaluate((el, v) => { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); }, Number(t));
  await page.waitForTimeout(1500);
  await page.screenshot({ path: out });
  console.log(out);
} finally { await browser.close(); await dev.close(); }
