// Score loop r6: the camera rig's materials, grouped by their parameters: how many distinct material objects, and how many of those are
// copies of each other (one shader build each, though they would draw the same).
//   P2P_URL=http://127.0.0.1:47831/ node tools/score-loop/r6-materials.mjs
import { chromium } from 'playwright';
const base = (process.env.P2P_URL || 'http://127.0.0.1:47831/').replace(/\/?$/, '/');
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
page.setDefaultTimeout(90000);
await page.goto(base + '?piece=camera&lens=n50');
await page.waitForFunction(() => window.p2p?.pieces.camera.state().loaded && document.getElementById('veil').classList.contains('off'));
await page.evaluate(() => window.p2p.settle());
const r = await page.evaluate(() => {
  const scene = window.p2p.scene ? window.p2p.scene() : null;
  return scene ? 'scene' : Object.keys(window.p2p);
});
console.log(JSON.stringify(r));
await browser.close();
