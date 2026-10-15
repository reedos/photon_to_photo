// Score loop round 3, visual category: the models page and a few app states the round-3 reviewers cited that
// visual-capture.mjs does not cover (models page outside and cutaway, the DSLR mirror close-up, the Pixel view card).
//   OUT=docs/score-loop/r3-visual/before node tools/score-loop/r3-visual-extra.mjs [filter]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

let dev = null;
if (!process.env.P2P_URL) {
  const { createServer } = await import('vite');
  dev = await createServer({ root: process.cwd(), logLevel: 'warn', server: { host: '127.0.0.1', port: 47802, strictPort: true, open: false } });
  await dev.listen();
}
const base = process.env.P2P_URL || 'http://127.0.0.1:47802/';
const OUT = process.env.OUT || 'shots/score-loop';
const filter = process.argv[2] || '';
mkdirSync(OUT, { recursive: true });

const CTX = {
  desk: { viewport: { width: 1440, height: 900 } },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  land: { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};
const VIEWS = [
  ['models-dslr', 'desk', 'models.html?body=dslr&lens=n50&view=outside'],
  ['models-dslr-cut', 'desk', 'models.html?body=dslr&lens=n50&view=cutaway'],
  ['models-ml', 'desk', 'models.html?body=mirrorless&lens=m50&view=outside'],
  ['models-dslr-top', 'desk', 'models.html?body=dslr&lens=n50&view=outside', 'top'],
  ['models-dslr-back', 'desk', 'models.html?body=dslr&lens=n50&view=outside', 'back'],
  ['camera-top', 'desk', '?piece=camera&lens=n50', 'top'],
  ['desk-cut', 'desk', '?piece=camera&lens=n50', 'cutaway'],
  ['phone-camera-cut', 'phone', '?piece=camera&lens=n50', 'cutaway'],
].filter(([n]) => !filter || filter.split(',').some((f) => n.includes(f)));

// orbit by a mouse drag on the canvas: 'top' looks down from above, 'back' swings round to the rear three-quarter
async function drag(page, setup) {
  if (setup !== 'top' && setup !== 'back') return;
  const b = await page.locator('canvas').first().boundingBox();
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  if (setup === 'top') await page.mouse.move(x, y + 160, { steps: 16 });
  else await page.mouse.move(x + 260, y + 40, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(1500);
}

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--hide-scrollbars'] });
try {
  for (const [name, kind, query, setup] of VIEWS) {
    const ctx = await browser.newContext({ ...CTX[kind], colorScheme: 'dark', reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    if (process.env.INIT) await page.addInitScript(process.env.INIT);
    await page.goto(new URL(query, base).href);
    if (query.startsWith('models')) {
      await page.waitForFunction(() => window.p2pModels?.ready, null, { timeout: 60000 });
      await page.waitForTimeout(2000);
      await drag(page, setup);
    } else {
      await page.waitForFunction(() => window.p2p && document.querySelector('#veil')?.classList.contains('off'), null, { timeout: 90000 }).catch(() => {});
      await page.evaluate(() => window.p2p.settle()).catch(() => {});
      if (setup === 'cutaway') await page.evaluate(() => window.p2p.pieces.camera.setView('cutaway'));
      await drag(page, setup);
      await page.evaluate(() => window.p2p.settle()).catch(() => {});
      await page.waitForFunction(() => !window.p2p.framing?.().moving, null, { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(2000);
    }
    await page.screenshot({ path: `${OUT}/${name}.png` });
    console.log(name, errors.length ? errors.slice(0, 3) : 'ok');
    await ctx.close();
  }
} finally { await browser.close(); await dev?.close(); }
