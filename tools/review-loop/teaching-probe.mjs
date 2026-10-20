// Teaching-clarity probe (score loop r1, 10/11/2026): reads the copy a reader actually sees at the spots the
// teaching review flagged, and screenshots each one. Writes <out>/probe.json and <out>/*.png.
//   P2P_URL=http://127.0.0.1:47803/ node tools/review-loop/teaching-probe.mjs shots/r1-teaching/after
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const url = process.env.P2P_URL || 'http://127.0.0.1:47803/';
const out = process.argv[2] || 'shots/r1-teaching/probe';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const result = {};
const ready = async (page, piece) => {
  await page.waitForFunction((p) => window.p2p?.pieces?.[p], piece, { timeout: 60000 });
  await page.evaluate((p) => window.p2p.pieces[p].ready?.(), piece);
  await page.waitForTimeout(1500);
};
// every element whose rendered (text-transformed) text has a micro sign followed by a capital M
const microCheck = (page) => page.evaluate(() => {
  const bad = [];
  for (const node of document.querySelectorAll('body *')) {
    if (node.children.length || !node.textContent.includes('µ')) continue;
    const shown = node.innerText ?? '';
    if (/[µΜ]M/.test(shown) || /Μ/.test(shown)) bad.push({ cls: node.className, text: node.textContent.trim().slice(0, 80), shown: shown.slice(0, 80) });
  }
  return bad;
});
try {
  for (const [w, h] of [[1440, 900], [390, 844], [360, 740]]) {
    const phone = w < 760;
    const page = await browser.newPage({ viewport: { width: w, height: h }, reducedMotion: 'reduce', isMobile: phone, hasTouch: phone });
    const r = result[w] = {};
    // 1. Focus level inset note
    await page.goto(new URL('?piece=cone', url).href); await ready(page, 'cone');
    r.coneNote = await page.evaluate(() => { const n = document.querySelector('.lv-inset-note'); return n && { text: n.textContent, shown: n.innerText, transform: getComputedStyle(n).textTransform }; });
    r.microBadCone = await microCheck(page);
    r.levelWhyCone = await page.evaluate(() => document.querySelector('#level-why')?.textContent);
    await page.screenshot({ path: join(out, `cone-${w}.png`) });
    // 2. Optics level: inset caption vs the inset card, the playback note
    await page.goto(new URL('?piece=lens', url).href); await ready(page, 'lens');
    r.lens = await page.evaluate(() => ({
      insetCaption: document.querySelector('.inset-frame')?.dataset.label,
      insetNote: document.querySelector('.piece-overlay[data-piece="lens"] .lv-inset-note')?.innerText,
      levelWhy: document.querySelector('#level-why')?.textContent,
      playback: [...document.querySelectorAll('.light-playback')].filter((b) => !b.hidden).map((b) => [...b.querySelectorAll('span, small')].map((s) => ({ text: s.innerText.replace(/\n/g, ' / '), visible: s.checkVisibility() && s.getBoundingClientRect().width > 0, font: getComputedStyle(s).fontSize }))),
    }));
    await page.screenshot({ path: join(out, `lens-${w}.png`) });
    // the inset card
    const pin = page.locator('.pin', { hasText: /Edge of frame/i }).first();
    if (await pin.count()) { await pin.click({ force: true }).catch(() => {}); await page.waitForTimeout(800); }
    r.lensInsetCard = await page.evaluate(() => document.querySelector('#part-card, .part-card, .card')?.innerText?.slice(0, 600));
    r.microBadLens = await microCheck(page);
    // 3. Pixel level playback note
    await page.goto(new URL('?piece=loupe', url).href); await ready(page, 'loupe');
    r.loupePlayback = await page.evaluate(() => [...document.querySelectorAll('.light-playback')].filter((b) => !b.hidden).map((b) => [...b.querySelectorAll('span, small')].map((s) => ({ text: s.innerText.replace(/\n/g, ' / '), visible: s.checkVisibility() && s.getBoundingClientRect().width > 0, font: getComputedStyle(s).fontSize, box: [Math.round(s.getBoundingClientRect().width), Math.round(s.getBoundingClientRect().height)] }))));
    await page.screenshot({ path: join(out, `loupe-${w}.png`) });
    // 4. The tour, every stop
    await page.goto(new URL('?piece=camera', url).href); await ready(page, 'camera');
    await page.locator('#learn-launch').click();
    const n = await page.locator('#journey-stop option').count();
    r.tour = [];
    for (let i = 0; i < n; i++) {
      await page.locator('#journey-stop').selectOption(String(i)); await page.waitForTimeout(500);
      const stop = await page.evaluate(() => {
        const vis = (e) => !!e && e.checkVisibility() && e.getBoundingClientRect().width > 2;
        const shownText = [...document.querySelectorAll('#journey-text, #journey-caption')].find(vis);
        return {
          title: document.querySelector('#journey-stop').selectedOptions[0].textContent,
          text: document.querySelector('#journey-text').textContent,
          more: document.querySelector('#journey-more-text')?.textContent,
          liveRegions: document.querySelectorAll('#journey [role=status], #journey [aria-live]').length,
          clipped: shownText ? shownText.scrollHeight > shownText.clientHeight + 1 : null,
          sh: shownText?.scrollHeight, ch: shownText?.clientHeight,
          levelWhyVisible: vis(document.querySelector('#level-why')),
          lessonShot: document.querySelector('#sensor-lesson:not([hidden]) #lesson-shot')?.textContent,
          adc: document.querySelector('#sensor-lesson:not([hidden]) #adc-value')?.textContent,
        };
      });
      r.tour.push(stop);
      await page.screenshot({ path: join(out, `tour-${w}-${i + 1}.png`) });
    }
    r.microBadTour = await microCheck(page);
    if (!phone) {
      // every part card on every level, as a reader sees it
      r.cards = {};
      for (const piece of ['camera', 'lens', 'cone', 'loupe']) {
        await page.goto(new URL(`?piece=${piece}`, url).href); await ready(page, piece);
        r.cards[piece] = { hud: await page.evaluate(() => document.querySelector('.hud.tl')?.innerText) };
        const ids = (await page.locator('#parts button').evaluateAll((els) => els.map((e) => e.dataset.partId))).filter((id) => id && id !== 'overview');
        for (const id of ids) {
          await page.evaluate((i) => document.querySelector(`#parts [data-part-id="${i}"]`).click(), id); await page.waitForTimeout(700);
          r.cards[piece][id] = await page.evaluate(() => ({ card: document.querySelector('#card')?.innerText, inset: document.querySelector('.inset-frame')?.dataset.label }));
          if (id === 'detail-inset') await page.screenshot({ path: join(out, 'lens-inset-card.png') });
        }
        r.microBad = (r.microBad || []).concat(await microCheck(page));
      }
    }
    await page.close();
  }
} finally {
  await browser.close();
}
writeFileSync(join(out, 'probe.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 1).slice(0, 12000));
