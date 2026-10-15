// Score loop round 4, visual category: the views the reviewers cited that visual-capture.mjs does not cover (the camera from
// below, the Viewfinder and Aperture detail views, the cutaway of each body, a portrait phone on the 800 mm lens) plus the
// numbers that close each issue (luma of boxes, so before and after are compared on pixels and not on a look).
//   OUT=shots/r4/before node tools/score-loop/r4-visual-extra.mjs [filter]
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

let dev = null;
if (!process.env.P2P_URL) {
  const { createServer } = await import('vite');
  dev = await createServer({ root: process.cwd(), logLevel: 'error', server: { host: '127.0.0.1', port: 47802, strictPort: true, open: false } });
  await dev.listen();
}
const base = process.env.P2P_URL || 'http://127.0.0.1:47802/';
const OUT = process.env.OUT || 'shots/r4';
const filter = process.argv[2] || '';
mkdirSync(OUT, { recursive: true });

const CTX = {
  desk: { viewport: { width: 1440, height: 900 } },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};
// name, context, query, setup
const VIEWS = [
  ['under', 'desk', '?piece=camera&lens=n50', 'under'],
  ['under-m50', 'desk', '?piece=camera&lens=m50', 'under'],
  ['cut-dslr', 'desk', '?piece=camera&lens=n50', 'cutaway'],
  ['cut-ml', 'desk', '?piece=camera&lens=m50', 'cutaway'],
  ['cut-n500', 'desk', '?piece=camera&lens=n500', 'cutaway'],
  ['detail-viewfinder', 'desk', '?piece=camera&lens=n50', 'part:viewfinder', { x: 380, y: 480, width: 340, height: 340 }],
  ['detail-iris', 'desk', '?piece=camera&lens=s35', 'part:iris', { x: 400, y: 300, width: 420, height: 420 }],
  ['phone-z800', 'phone', '?piece=camera&lens=z800', null],
  ['phone-n500', 'phone', '?piece=camera&lens=n500', null],
  ['desk-camera-top', 'desk', '?piece=camera&lens=n50', 'top'],
].filter(([n]) => !filter || filter.split(',').some((f) => n === f || n.includes(f)));

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--hide-scrollbars'] });
const report = {};
try {
  for (const [name, kind, query, setup, clip] of VIEWS) {
    const ctx = await browser.newContext({ ...CTX[kind], ...(clip ? { deviceScaleFactor: 2 } : {}), colorScheme: 'dark', reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(new URL(query, base).href);
    await page.waitForFunction(() => window.p2p && document.querySelector('#veil')?.classList.contains('off'), null, { timeout: 90000 }).catch(() => {});
    await page.waitForFunction(() => window.p2p?.pieces.camera.state().loaded, null, { timeout: 60000 }).catch(() => {});
    await page.evaluate(() => window.p2p.settle()).catch(() => {});
    if (setup === 'cutaway') await page.evaluate(() => window.p2p.pieces.camera.setView('cutaway'));
    if (setup?.startsWith('part:')) {
      await page.locator('#tab-explain').click().catch(() => {});
      await page.locator(`#parts [data-part-id="${setup.slice(5)}"]`).click();
    }
    if (setup === 'under' || setup === 'top') {
      const b = await page.locator('#gl').boundingBox();
      const x = b.x + b.width / 2, y = b.y + b.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x, y + (setup === 'top' ? 160 : -170), { steps: 16 });
      await page.mouse.up();
    }
    await page.evaluate(() => window.p2p.settle()).catch(() => {});
    await page.waitForFunction(() => !window.p2p.framing?.().moving, null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${OUT}/${name}.png` });
    if (clip) await page.screenshot({ path: `${OUT}/${name}-crop.png`, clip });
    report[name] = { errors: errors.slice(0, 3) };
    console.log(name, errors.length ? errors.slice(0, 3) : 'ok');
    await ctx.close();
  }
} finally { await browser.close(); await dev?.close(); }
writeFileSync(`${OUT}/report${filter ? '-' + filter.replace(/[^a-z0-9]+/gi, '_') : ''}.json`, JSON.stringify(report, null, 1));
