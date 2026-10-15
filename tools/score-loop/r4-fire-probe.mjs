// Score loop r4 (teaching): the DSLR exposure timeline and the Well / signal-to-noise row after Fire shutter, at 1440 px
// (the segments' labels were clipped to "RROR DO"). Writes <out>/fire.json and fired-<w>.png.
//   P2P_URL=http://127.0.0.1:47803/ node tools/score-loop/r4-fire-probe.mjs shots/r4-teaching/after
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const url = process.env.P2P_URL || 'http://127.0.0.1:47803/';
const out = process.argv[2] || 'shots/r4-teaching/fire';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const result = {};
for (const [w, h] of [[1440, 900], [390, 844]]) {
  const phone = w < 760;
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: phone, hasTouch: phone });
  await page.goto(new URL('?piece=camera&lens=n50&shutter=0.004', url).href);
  await page.waitForFunction(() => window.p2p?.pieces?.camera && !document.querySelector('.rx-fire')?.disabled, null, { timeout: 90000 });
  await page.evaluate(() => window.p2p.pieces.camera.ready());
  await page.waitForTimeout(1500);
  await page.locator('#gl').click({ position: { x: 5, y: 5 }, force: true }).catch(() => {}); await page.keyboard.press('f');
  await page.waitForFunction(() => { const s = [...document.querySelectorAll('.rx-tl span')]; return s.length >= 3 && s.some((x) => x.classList.contains('on')); }, null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.evaluate(() => document.querySelectorAll('.rig-exposure details').forEach((d) => { d.open = true; }));
  await page.waitForTimeout(400);
  result[w] = await page.evaluate(() => ({
    segments: [...document.querySelectorAll('.rx-tl span')].map((s) => ({ text: s.textContent, title: s.title, w: Math.round(s.getBoundingClientRect().width), clipped: s.scrollWidth > s.clientWidth + 1 })),
    well: document.querySelector('.rx-wellk')?.textContent, snr: document.querySelector('.rx-snr')?.textContent,
  }));
  await page.screenshot({ path: join(out, `fired-${w}.png`) });
  await page.close();
}
writeFileSync(join(out, 'fire.json'), JSON.stringify(result, null, 1));
console.log(JSON.stringify(result, null, 1));
await browser.close();
