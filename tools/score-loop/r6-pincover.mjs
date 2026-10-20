// Score loop r6: reproduce test-phone-navigation's pin-cover check and say what covers the pin.
import { chromium } from 'playwright';
const url = process.env.P2P_URL || 'http://127.0.0.1:47804/';
const [w = 390, h = 844, ...levels] = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, hasTouch: true, reducedMotion: 'no-preference' });
await page.goto(`${url}?lens=m50&piece=camera`);
await page.waitForFunction(() => window.p2p?.pieces.camera.state().loaded);
for (const level of (levels.length ? levels : ['camera', 'lens', 'cone', 'loupe'])) {
  await page.locator(`#steps [data-piece="${level}"]`).click();
  await page.waitForFunction(() => document.querySelector('#veil').classList.contains('off') && !window.p2p.framing().moving);
  await page.waitForTimeout(500);
  const pins = await page.evaluate(() => [...document.querySelectorAll('#pins .pin')].map(pin => {
    const n = pin.querySelector('.num').getBoundingClientRect();
    const top = n.width ? document.elementFromPoint(n.x + n.width / 2, n.y + n.height / 2) : null;
    return { id: pin.dataset.pinId, n: [Math.round(n.x), Math.round(n.y), Math.round(n.width)], ok: !!top && pin.contains(top), top: top && !pin.contains(top) ? (top.id || String(top.className) || top.tagName) : null, disp: pin.style.display };
  }));
  console.log(level, JSON.stringify(pins.filter((p) => !p.ok)), JSON.stringify(await page.evaluate(() => ({ v: [document.querySelector('#view').clientWidth, document.querySelector('#view').clientHeight], pins: window.p2p.pins().map(p => [p.id, Math.round(p.x), Math.round(p.y), Math.round(p.anchorX), Math.round(p.anchorY)]) }))));
  await page.screenshot({ path: `docs/score-loop/r6-ux/tmp-pincover-${w}-${level}.png` });
}
await browser.close();
