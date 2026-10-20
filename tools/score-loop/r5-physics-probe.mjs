// Score loop r5 (physics): reads and photographs what the r5 fixes change, so the same script runs against the old build (before)
// and the new one (after).
//   P2P_URL=http://127.0.0.1:47801/ node tools/score-loop/r5-physics-probe.mjs docs/score-loop/r5-physics/after
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const url = process.env.P2P_URL || 'http://127.0.0.1:47801/';
const out = process.argv[2] || 'docs/score-loop/r5-physics/after';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const result = {};

async function open(page, piece, scenario) {
  await page.goto(new URL(`?piece=${piece}`, url).href);
  await page.waitForFunction(() => window.p2p && document.querySelector('#veil')?.classList.contains('off'), null, { timeout: 120000 });
  if (scenario) await page.evaluate((s) => window.p2p.set(s), scenario);
  await page.evaluate(() => window.p2p.settle());
  await page.waitForFunction(() => !window.p2p.framing().moving, null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(700);
}
async function part(page, id) {
  await page.evaluate((i) => document.querySelector(`#parts [data-part-id="${i}"]`)?.click(), id);
  await page.waitForTimeout(900);
  return page.evaluate(() => ({ body: document.querySelector('#card-b')?.textContent ?? '', specs: [...document.querySelectorAll('#card .spec, #card-specs > *, #card dl > div')].map((e) => e.textContent.replace(/\s+/g, ' ').trim()) }));
}

const desk = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
// 1. Focus level: the in-focus disk at f/8, f/22 with the inset note and the bokeh-disk card
for (const fno of [8, 22]) {
  await open(desk, 'cone', { lens: 'n50', fno, focusM: 3 });
  await desk.evaluate(() => window.p2p.pieces.cone.setPoint(3000, 0));
  await desk.waitForTimeout(500);
  const r = result[`cone-f${fno}`] = {};
  r.note = await desk.evaluate(() => document.querySelector('.piece-overlay[data-piece="cone"] .lv-inset-note')?.innerText);
  r.probe = await desk.evaluate(() => { const p = window.p2p.pieces.cone.probe(); return { recordedUm: p.recordedDiameterMm * 1000, airyUm: p.airyDiameterMm !== undefined ? p.airyDiameterMm * 1000 : null, pitchUm: p.pitchUm }; });
  await desk.screenshot({ path: join(out, `cone-f${fno}.png`) });
  r.card = await part(desk, 'bokeh-disk');
  await desk.screenshot({ path: join(out, `cone-f${fno}-card.png`) });
}
// 2. DOF card at f/22, 0.45 m
await open(desk, 'camera', { lens: 'n50', fno: 22, focusM: 0.45 });
result.dof = await part(desk, 'focusRing');
await desk.screenshot({ path: join(out, 'dof-f22.png') });
// 3. clipped exposure readouts
for (const [name, sc] of [['iso1600', { lens: 'n50', fno: 4, shutter: 1 / 60, iso: 1600 }], ['long30s', { lens: 'n50', fno: 1.86, shutter: 30, iso: 64 }], ['ok', { lens: 'n50', fno: 8, shutter: 1 / 250, iso: 100 }]]) {
  await open(desk, 'camera', sc);
  await desk.waitForTimeout(1200);
  result[`exposure-${name}`] = await desk.evaluate(() => ({ well: document.querySelector('.rx-wellk')?.textContent, snr: document.querySelector('.rx-snr')?.textContent, kpis: [...document.querySelectorAll('.kpi')].map((k) => k.textContent.replace(/\s+/g, ' ').trim()) }));
  result[`sensorcard-${name}`] = await part(desk, 'sensor');
  await desk.screenshot({ path: join(out, `exposure-${name}.png`) });
}
// 4. loupe pixel card at ISO 1600, 1/60 s
await open(desk, 'loupe', { lens: 'n50', fno: 4, shutter: 1 / 60, iso: 1600 });
await desk.waitForTimeout(1500);
result.loupe = await part(desk, 'pixel');
result.loupeOverlay = await desk.evaluate(() => document.body.innerText.match(/ADC max[^\n]*/)?.[0] ?? null);
await desk.screenshot({ path: join(out, 'loupe-pixel-card.png') });
result.loupeWell = await part(desk, 'well');
// 5. Optics inset caption, desktop and phone landscape
await open(desk, 'lens', { lens: 'n50', fno: 4, focusM: 3 });
await desk.waitForTimeout(1500);
result.opticsDesktop = await desk.evaluate(() => document.querySelector('.inset-frame')?.dataset.label);
await desk.screenshot({ path: join(out, 'optics-1440.png') });
const ph = await browser.newPage({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, reducedMotion: 'reduce', isMobile: true, hasTouch: true });
await open(ph, 'lens', { lens: 'n50', fno: 4, focusM: 3 });
await ph.waitForTimeout(1500);
result.opticsPhone = await ph.evaluate(() => document.querySelector('.inset-frame')?.dataset.label);
await ph.screenshot({ path: join(out, 'optics-844x390.png') });
// 6. Models page: the filter stack text
const mp = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
try { await mp.goto(new URL('models.html?body=dslr&part=filterStack', url).href);
await mp.waitForTimeout(6000);
result.models = await mp.evaluate(() => ({ title: document.getElementById('sel-t')?.textContent, desc: document.getElementById('sel-d')?.textContent, list: [...document.querySelectorAll('.parts button .pt')].map((e) => e.textContent).filter((t) => /filter/i.test(t)) }));
await mp.screenshot({ path: join(out, 'models-filter-stack.png') }); } catch (e) { result.modelsError = String(e).slice(0, 200); }

writeFileSync(join(out, 'probe.json'), JSON.stringify(result, null, 1));
console.log(JSON.stringify(result, null, 1));
await browser.close();
