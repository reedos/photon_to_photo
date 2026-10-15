// Score loop r4 (teaching): the story page's diagram text as rendered, per chapter and viewport, plus a screenshot of
// each figure. Rendered size = font-size in viewBox units x the SVG's screen scale.
//   P2P_URL=http://127.0.0.1:47803/ node tools/score-loop/r4-story-probe.mjs shots/r4-teaching/after
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const url = process.env.P2P_URL || 'http://127.0.0.1:47803/';
const out = process.argv[2] || 'shots/r4-teaching/story';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const result = {};
for (const [w, h] of [[1440, 900], [390, 844], [360, 740]]) {
  const phone = w < 760;
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, reducedMotion: 'reduce', isMobile: phone, hasTouch: phone });
  await page.goto(new URL('reference.html?page=story', url).href);
  await page.waitForSelector('#story-illustration svg, #story-illustration video');
  const rows = {};
  for (const id of ['photo', 'light', 'lens', 'focus', 'exposure', 'pixel', 'readout', 'final']) {
    await page.locator(`[data-story-chapter="${id}"]`).click();
    await page.waitForTimeout(500);
    rows[id] = await page.evaluate(() => {
      const svg = document.querySelector('#story-illustration svg');
      if (!svg) return { texts: [] };
      const texts = [...svg.querySelectorAll('text')].map((t) => {
        const fs = parseFloat(getComputedStyle(t).fontSize), scale = t.getScreenCTM().a;
        const b = t.getBoundingClientRect();
        return { text: t.textContent, px: +(fs * scale).toFixed(1), l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top), b: Math.round(b.bottom), hidden: !t.checkVisibility() };
      });
      const sb = svg.getBoundingClientRect();
      return { svg: [Math.round(sb.left), Math.round(sb.top), Math.round(sb.right), Math.round(sb.bottom)], texts, caption: document.querySelector('.story-svg-key')?.innerText ?? null };
    });
    await page.locator('#story-illustration').screenshot({ path: join(out, `story-${id}-${w}.png`) });
  }
  result[w] = rows;
  const min = Math.min(...Object.values(rows).flatMap((r) => r.texts.filter((t) => !t.hidden).map((t) => t.px)));
  console.log(w, 'smallest visible SVG text', min, 'px');
  await page.close();
}
writeFileSync(join(out, 'story.json'), JSON.stringify(result, null, 1));
await browser.close();
