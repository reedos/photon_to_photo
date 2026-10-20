// Score loop r4 (teaching): the Optics level's inset caption, legend, level line, the tour's lens stop and the inset and
// ray-fan cards (lead paragraph and the More detail disclosure), at 1440 and 390 px. Writes <out>/optics.json and PNGs.
//   P2P_URL=http://127.0.0.1:47803/ node tools/score-loop/r4-optics-probe.mjs shots/r4-teaching/after
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const url = process.env.P2P_URL || 'http://127.0.0.1:47803/';
const out = process.argv[2] || 'shots/r4-teaching/optics';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const result = {};
const words = (t) => (t || '').trim().split(/\s+/).filter(Boolean).length;
for (const [w, h] of [[1440, 900], [390, 844]]) {
  const phone = w < 760;
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, reducedMotion: 'reduce', isMobile: phone, hasTouch: phone });
  const r = result[w] = {};
  await page.goto(new URL('?piece=lens', url).href);
  await page.waitForFunction(() => window.p2p?.pieces?.lens, null, { timeout: 90000 });
  await page.evaluate(() => window.p2p.pieces.lens.ready?.());
  await page.waitForTimeout(2500);
  r.levelWhy = await page.evaluate(() => document.querySelector('#level-why')?.textContent);
  r.caption = await page.evaluate(() => document.querySelector('.inset-frame')?.dataset.label);
  r.legend = await page.evaluate(() => document.querySelector('.piece-overlay[data-piece="lens"] .lv-inset-note')?.innerText);
  await page.screenshot({ path: join(out, `optics-${w}.png`) });
  for (const id of ['detail-inset', 'ray-fan']) {
    await page.evaluate((i) => document.querySelector(`#parts [data-part-id="${i}"]`)?.click(), id);
    await page.waitForTimeout(1200);
    r[id] = await page.evaluate(() => ({ body: document.querySelector('#card-b')?.textContent, more: document.querySelector('#card-more:not([hidden]) #card-more-b')?.textContent ?? null }));
    r[id].bodyWords = words(r[id].body); r[id].moreWords = words(r[id].more);
    await page.screenshot({ path: join(out, `card-${id}-${w}.png`) });
    if (r[id].more) { await page.evaluate(() => { document.querySelector('#card-more').open = true; }); await page.waitForTimeout(300); await page.screenshot({ path: join(out, `card-${id}-open-${w}.png`) }); }
  }
  await page.close();
}
writeFileSync(join(out, 'optics.json'), JSON.stringify(result, null, 1));
console.log(JSON.stringify(result, null, 1));
await browser.close();
