// Score loop r5: what the first paint after a level tap shows (the veil's classes, the tab's state), and a screenshot of it.
//   P2P_URL=http://127.0.0.1:47807/ OUT=docs/score-loop/r5-perf node tools/score-loop/r5-tap-paint.mjs [piece=cone]
import { chromium } from 'playwright';
const url = (process.env.P2P_URL || 'http://127.0.0.1:47807/').replace(/\/?$/, '/');
const piece = process.argv[2] || 'cone';
const OUT = process.env.OUT || 'shots/r5';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
const page = await context.newPage();
page.setDefaultTimeout(120000);
await page.goto(url + '?piece=camera&lens=n50');
await page.waitForFunction(() => window.p2p?.pieces.camera.state().loaded && document.getElementById('veil').classList.contains('off'));
await page.evaluate(() => window.p2p.settle());
await page.waitForTimeout(3000);
await page.evaluate(() => {
  window.__paints = [];
  const veil = document.getElementById('veil');
  const snap = (what) => window.__paints.push({ what, t: Math.round(performance.now()), veil: veil.className, entering: [...document.querySelectorAll('.step.entering')].map((e) => e.dataset.piece).join(), current: document.querySelector('.step[aria-current=step]')?.dataset.piece });
  document.addEventListener('click', () => { requestAnimationFrame(() => snap('first frame after the click')); }, true);
  setInterval(() => snap('tick'), 100);
});
await (await context.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: 4 });
await page.locator(`.step[data-piece="${piece}"]`).first().tap();
await page.screenshot({ path: `${OUT}/tap-${piece}-first-paint.png` });
await page.waitForFunction(() => document.getElementById('veil').classList.contains('off'), null, { timeout: 60000 });
await page.waitForTimeout(500);
const seen = await page.evaluate(() => window.__paints);
let last = '';
for (const p of seen) { const k = `${p.what === 'tick' ? '' : p.what}|${p.veil}|${p.entering}|${p.current}`; if (k !== last) { console.log(JSON.stringify(p)); last = k; } }
await page.screenshot({ path: `${OUT}/tap-${piece}-settled.png` });
await browser.close();
