// Score loop r6: what the drag preview looks like against the full trace. Changes the aperture in the Focus or Pixel level and
// captures the view two frames later (the coarse bundle) and again once it has settled (the full bundle).
//   P2P_URL=http://127.0.0.1:47831/ node tools/score-loop/r6-coarse-shot.mjs out-dir [width=1280] [height=800]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
const url = (process.env.P2P_URL || 'http://127.0.0.1:47831/').replace(/\/?$/, '/');
const out = process.argv[2] || 'shots/r6';
const width = Number(process.argv[3] || 1280), height = Number(process.argv[4] || 800);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const phone = width < 700;
const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: phone ? 2 : 1, isMobile: phone, hasTouch: phone, reducedMotion: 'reduce' });
const page = await context.newPage();
page.setDefaultTimeout(120000);
await page.goto(url + '?piece=camera&lens=n50');
await page.waitForFunction(() => window.p2p?.pieces.camera.state().loaded && document.getElementById('veil').classList.contains('off'));
await page.evaluate(() => window.p2p.settle());
for (const level of (process.env.LEVELS || 'cone,loupe').split(',')) {
  await page.locator(`.step[data-piece="${level}"]`).first().click();
  await page.waitForFunction((l) => window.p2p.framing().piece === l && document.getElementById('veil').classList.contains('off'), level, { timeout: 60000 });
  await page.evaluate(() => window.p2p.settle());
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.p2p.set({ fno: 2.8 }));
  await page.evaluate(() => window.p2p.settle());
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/${level}-f2.8-full.png` });
  // a change, then the view two frames later: the coarse preview
  await page.evaluate(() => { window.p2p.set({ fno: 8 }); });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 0)))));
  await page.screenshot({ path: `${out}/${level}-f8-preview.png` });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/${level}-f8-full.png` });
}
await browser.close();
