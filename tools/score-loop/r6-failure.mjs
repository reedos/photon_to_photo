// Score loop r6: the GLB load-failure veil: role=alert, the 2D reference link, inert controls behind it; then Retry restores them.
//   P2P_URL=http://127.0.0.1:47831/ node tools/score-loop/r6-failure.mjs out-dir [width=390] [height=844]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
const base = (process.env.P2P_URL || 'http://127.0.0.1:47831/').replace(/\/?$/, '/');
const out = process.argv[2] || 'shots/r6-failure';
const width = Number(process.argv[3] || 390), height = Number(process.argv[4] || 844);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const phone = width < 700;
const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: phone, hasTouch: phone, reducedMotion: 'reduce' });
const page = await context.newPage();
page.setDefaultTimeout(60000);
let blocked = true;
await page.route('**/models/**/*.glb', (route) => (blocked && route.request().url().endsWith('/dslr.glb') ? route.fulfill({ status: 404, body: 'nf' }) : route.continue()));
await page.goto(base + '?piece=camera&lens=n50');
await page.locator('#veil.err #veil-reload').waitFor({ state: 'visible' });
await page.waitForTimeout(800);
const probe = () => page.evaluate(() => {
  const v = document.getElementById('veil'); const ref = document.getElementById('veil-reference');
  const inert = (s) => { const e = document.querySelector(s); return e ? e.inert : null; };
  return { role: v.getAttribute('role'), msg: document.getElementById('veil-msg').textContent, button: document.getElementById('veil-reload').textContent,
    reference: ref ? { hidden: ref.hidden, shown: ref.offsetWidth > 0, href: ref.getAttribute('href') } : null,
    inert: { rail: inert('#hud-rail'), strip: inert('#view-strip'), phoneBar: inert('#hud-btns-phone'), play: inert('.shot-launch') } };
});
console.log('failed ', JSON.stringify(await probe()));
await page.screenshot({ path: `${out}/failed-${width}.png` });
blocked = false;
await page.locator('#veil-reload').click();
await page.waitForFunction(() => document.getElementById('veil').classList.contains('off') && window.p2p?.pieces.camera.state().loaded);
await page.waitForTimeout(500);
console.log('retried', JSON.stringify(await probe()));
await browser.close();
