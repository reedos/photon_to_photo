// Score loop r6 (UX): a browser with no 3D. What Explore the camera does and what the failed workspace shows.
//   P2P_URL=http://127.0.0.1:47804/ node tools/score-loop/r6-nogl.mjs before
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
const url = process.env.P2P_URL || 'http://127.0.0.1:47804/';
const [label = 'probe'] = process.argv.slice(2);
const out = 'docs/score-loop/r6-ux';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-gpu', '--disable-3d-apis'] });
const result = {};
for (const [w, h] of [[1440, 900], [390, 844]]) {
  const context = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.goto(url);
  await page.waitForSelector('#opening-explore', { timeout: 30000 });
  await page.waitForTimeout(1500);
  const opening = await page.evaluate(() => ({
    note: !document.querySelector('#opening-no3d').hidden ? document.querySelector('#opening-no3d').textContent : null,
    explore: document.querySelector('#opening-explore').textContent.trim().replace(/\s+/g, ' '),
    exploreTag: document.querySelector('#opening-explore').tagName,
  }));
  await page.screenshot({ path: `${out}/${label}-nogl-opening-${w}.png` });
  await page.locator(process.env.ENTRY || '#opening-explore').click();
  await page.waitForTimeout(3500);
  const after = await page.evaluate(() => {
    const visible = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return e.checkVisibility() && b.width > 4 && b.height > 4 ? [Math.round(b.width), Math.round(b.height)] : false; };
    return { url: location.pathname + location.search.slice(0, 40), sidebar: visible('.studio-sidebar'), panel: visible('#studio-explain'), veil: document.querySelector('#veil-msg')?.textContent ?? null, failed: document.body.classList.contains('startup-failed') };
  });
  await page.screenshot({ path: `${out}/${label}-nogl-after-explore-${w}.png` });
  result[`${w}x${h}`] = { opening, after };
  await context.close();
}
await browser.close();
writeFileSync(`${out}/${label}-nogl.json`, JSON.stringify(result, null, 1));
console.log(JSON.stringify(result));
