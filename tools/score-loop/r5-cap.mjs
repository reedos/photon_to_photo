// Score loop round 5: capture one or more views against a running dev server.
//   P2P_URL=http://127.0.0.1:47802/ OUT=dir node tools/score-loop/r5-cap.mjs "name|query|viewport|setupJS|waitMs" [...]
// viewport: desk, desk2x, phone (390x844 @2x), phone360, phone320, land (844x390 @2x), or WxH. setupJS runs after settle.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
let dev = null;
if (!process.env.P2P_URL) {
  const { createServer } = await import('vite');
  dev = await createServer({ root: process.cwd(), logLevel: 'error', server: { host: '127.0.0.1', port: Number(process.env.P2P_PORT || 47852), strictPort: true, open: false } });
  await dev.listen();
}
const base = process.env.P2P_URL || `http://127.0.0.1:${process.env.P2P_PORT || 47852}/`;
const OUT = process.env.OUT || 'shots/r5';
mkdirSync(OUT, { recursive: true });
const phone = (w, h) => ({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const VP = {
  desk: { viewport: { width: 1440, height: 900 } },
  desk2x: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
  phone: phone(390, 844), phone360: phone(360, 740), phone320: phone(320, 640), land: phone(844, 390),
};
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--hide-scrollbars'] });
try {
  for (const spec of process.argv.slice(2)) {
    const [name, query, vp = 'desk', setup = '', waitMs = '2500'] = spec.split('|');
    const opts = VP[vp] || { viewport: { width: Number(vp.split('x')[0]), height: Number(vp.split('x')[1]) } };
    const ctx = await browser.newContext({ ...opts, colorScheme: 'dark', reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(new URL(query, base).href);
    await page.waitForFunction(() => window.p2p && document.querySelector('#veil')?.classList.contains('off'), null, { timeout: 90000 }).catch(() => {});
    await page.evaluate(() => window.p2p.settle()).catch(() => {});
    if (setup) await page.evaluate(setup);
    await page.evaluate(() => window.p2p.settle()).catch(() => {});
    await page.waitForFunction(() => !window.p2p.framing?.().moving, null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(Number(waitMs));
    await page.screenshot({ path: `${OUT}/${name}.png` });
    console.log(name, errors.length ? 'ERR ' + errors.join(' | ') : 'ok');
    await ctx.close();
  }
} finally { await browser.close(); await dev?.close(); process.exit(0); }
