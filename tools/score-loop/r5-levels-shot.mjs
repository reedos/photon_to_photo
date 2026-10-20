// Score loop r5: one screenshot of each level on a desktop and a phone viewport, for a before/after pixel comparison
// (a level compiled ahead must look exactly as a level compiled on entry). Compare two output folders with r5-compare.py.
//   P2P_URL=http://127.0.0.1:47807/ OUT=shots/r5-after WAIT=22000 node tools/score-loop/r5-levels-shot.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const url = (process.env.P2P_URL || 'http://127.0.0.1:47807/').replace(/\/?$/, '/');
const OUT = process.env.OUT || 'shots/r5-levels';
const wait = Number(process.env.WAIT || 22000);
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
for (const [name, viewport, mobile] of [['desktop', { width: 1366, height: 900 }, false], ['phone', { width: 390, height: 844 }, true], ['landscape', { width: 844, height: 390 }, true], ['tablet', { width: 820, height: 1180 }, true]]) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.setDefaultTimeout(120000);
  page.on('console', (m) => { if (m.type() === 'warning' || m.type() === 'error') console.log(name, 'console', m.type(), m.text().slice(0, 160)); });
  await page.goto(url + '?piece=camera&lens=n50' + (process.env.EXTRA || ''));
  await page.waitForFunction(() => window.p2p?.pieces.camera.state().loaded && document.getElementById('veil').classList.contains('off'));
  await page.evaluate(() => window.p2p.settle());
  await page.waitForTimeout(wait); // the idle precompile (when this build has one) runs in this time
  for (const piece of ['camera', 'cone', 'lens', 'loupe', 'camera']) {
    await page.evaluate((id) => window.p2p.piece(id), piece);
    await page.waitForFunction(() => document.getElementById('veil').classList.contains('off'), null, { timeout: 60000 });
    await page.evaluate(() => window.p2p.settle());
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/${name}-${piece}${piece === 'camera' && page.__again ? '-again' : ''}.png` });
    if (piece === 'camera') page.__again = true;
  }
  await context.close();
}
await browser.close();
