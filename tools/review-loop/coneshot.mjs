// Score loop r6: screenshots the Focus view (cone piece) for the given f-numbers, n50 focused at 3 m, point at 3 m.
//   P2P_URL=http://127.0.0.1:47801/ OUT=docs/score-loop/r6-physics/after node tools/review-loop/coneshot.mjs 8 22
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const out = process.env.OUT || 'docs/score-loop/r6-physics/after';
const base = process.env.P2P_URL || 'http://127.0.0.1:47801/';
const lens = process.env.CONE_LENS || 'n50';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: Number(process.env.W) || 1440, height: Number(process.env.H) || 900 }, reducedMotion: 'reduce' });
page.on('pageerror', (e) => console.log('ERR', String(e)));
await page.goto(new URL('?piece=cone', base).href);
await page.waitForFunction(() => window.p2p && document.querySelector('#veil')?.classList.contains('off'), null, { timeout: 90000 });
for (const f of process.argv.slice(2)) {
  await page.evaluate(([l, f]) => window.p2p.set({ lens: l, fno: Number(f), focusM: 3 }), [lens, f]);
  await page.evaluate(() => window.p2p.settle());
  await page.waitForTimeout(2500);
  await page.evaluate(() => window.p2p.pieces.cone.setPoint(3000, 0));
  await page.waitForTimeout(800);
  const probe = await page.evaluate(() => { const p = window.p2p.pieces.cone.probe(); return { recordedMm: p.recordedDiameterMm, tracedMm: p.diameterMeasuredMm, airyMm: p.airyDiameterMm, pitchUm: p.pitchUm, inset: p.inset }; });
  console.log(f, JSON.stringify(probe));
  await page.screenshot({ path: `${out}/cone-f${f}.png` });
  const r = probe.inset.rect;
  const note = await page.evaluate(() => [...document.querySelectorAll('.lv-inset-note')].map((e) => e.textContent));
  console.log(note);
  void r;
}
await browser.close();
