// Score loop r5: the Play the shot canvas at chosen times, from its own dev server on 47852, P2P_PORT to change.
//   node tools/score-loop/r5-shot.mjs outDir 13 14 20 [WxH]    (the last argument may be a size such as 390x844)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const args = process.argv.slice(2);
const out = args.shift();
const size = args.find((a) => /^\d+x\d+$/.test(a));
const times = args.filter((a) => a !== size).map(Number);
const [w, h] = (size || '1366x768').split('x').map(Number);
mkdirSync(out, { recursive: true });
let dev = null;
if (!process.env.P2P_URL) {
  const { createServer } = await import('vite');
  dev = await createServer({ root: process.cwd(), logLevel: 'error', server: { host: '127.0.0.1', port: Number(process.env.P2P_PORT || 47852), strictPort: true, open: false } });
  await dev.listen();
}
const base = process.env.P2P_URL || `http://127.0.0.1:${process.env.P2P_PORT || 47852}/`;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
try {
  const phone = w < 760;
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, reducedMotion: 'reduce', isMobile: phone, hasTouch: phone });
  await page.goto(new URL('?lens=n50&part=sensor&lux=7300&cct=4200', base).href);
  await page.waitForFunction(() => window.p2p?.pieces.camera);
  await page.evaluate(() => window.p2p.pieces.camera.ready());
  await page.locator('.shot-launch').click();
  await page.waitForSelector('#shot-dialog[data-ready="true"]', { timeout: 120000 });
  for (const t of times) {
    await page.locator('#shot-time').evaluate((el, t) => { el.value = String(t); el.dispatchEvent(new Event('input', { bubbles: true })); }, t);
    await page.waitForTimeout(400);
    await page.locator('#shot-canvas').screenshot({ path: `${out}/shot-${String(t).replace('.', '_')}.png` });
    console.log('shot', t);
  }
} finally { await browser.close(); await dev?.close(); }
process.exit(0);
