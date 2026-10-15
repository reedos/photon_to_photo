// Score loop r6 (UX): the Models page on phones. Is the pinned part card covered by the pinned model?
//   P2P_URL=http://127.0.0.1:47804/ node tools/score-loop/r6-models-probe.mjs before
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
const url = process.env.P2P_URL || 'http://127.0.0.1:47804/';
const [label = 'probe'] = process.argv.slice(2);
const out = 'docs/score-loop/r6-ux';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const results = {};
for (const [w, h] of [[390, 844], [320, 568], [375, 667], [1440, 900]]) {
  const phone = w < 760;
  const context = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce', isMobile: phone, hasTouch: phone, deviceScaleFactor: phone ? 2 : 1 });
  const page = await context.newPage();
  await page.goto(`${url}models.html?body=dslr&lens=n50`);
  await page.waitForFunction(() => window.p2pModels?.ready && document.querySelector('#veil')?.classList.contains('off'), null, { timeout: 120000 });
  await page.waitForTimeout(1500);
  const covered = () => page.evaluate(() => {
    const view = document.querySelector('#view').getBoundingClientRect();
    const sel = document.querySelector('#sel').getBoundingClientRect();
    const t = document.querySelector('#sel-t').getBoundingClientRect();
    const d = document.querySelector('#sel-d').getBoundingClientRect();
    const hit = (r) => { const x = r.left + Math.min(20, r.width / 2), y = r.top + Math.min(r.height / 2, 8); const e = document.elementFromPoint(x, y); return { y: Math.round(y), onCard: !!e && !!e.closest('#sel'), by: e ? (e.id || String(e.className) || e.tagName) : null }; };
    return { viewTop: Math.round(view.top), viewBottom: Math.round(view.bottom), cardTop: Math.round(sel.top), cardBottom: Math.round(sel.bottom), title: hit(t), desc: hit(d), titleText: document.querySelector('#sel-t').textContent, scrollY: Math.round(scrollY) };
  });
  const r = {};
  for (const part of ['releaseModeDial', 'prism', 'contacts', 'afOn', 'shutterButton']) {
    const b = page.locator(`.parts button[data-part="${part}"]`);
    if (!(await b.count())) { r[part] = 'no row'; continue; }
    await b.scrollIntoViewIfNeeded(); await b.click(); await page.waitForTimeout(1000);
    r[part] = await covered();
    if (part === 'releaseModeDial' || part === 'prism') await page.screenshot({ path: `${out}/${label}-models-${w}x${h}-${part}.png` });
  }
  results[`${w}x${h}`] = r;
  await context.close();
}
await browser.close();
writeFileSync(`${out}/${label}-models.json`, JSON.stringify(results, null, 1));
console.log(JSON.stringify(results));
