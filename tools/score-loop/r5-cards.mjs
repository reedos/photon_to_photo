// Score loop r5 (teaching): every part of every level (DSLR, 50 mm f/1.8): the part list's name against the card's title and
// subline, the lead paragraph's word count, the number of spec rows and the More detail text. Writes cards.json.
//   P2P_URL=http://127.0.0.1:47803/ node tools/score-loop/r5-cards.mjs shots/r5-teaching/after [piece ...]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const url = process.env.P2P_URL || 'http://127.0.0.1:47803/';
const out = process.argv[2] || 'shots/r5-teaching/cards';
const only = process.argv.slice(3);
mkdirSync(out, { recursive: true });
const words = (t) => (t || '').trim().split(/\s+/).filter(Boolean).length;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const result = {};
try {
  for (const piece of ['camera', 'lens', 'cone', 'loupe'].filter((p) => !only.length || only.includes(p))) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    await page.goto(new URL(`?piece=${piece}&lens=n50`, url).href);
    await page.waitForFunction((p) => window.p2p?.pieces?.[p], piece, { timeout: 120000 });
    await page.evaluate((p) => window.p2p.pieces[p].ready?.(), piece);
    await page.waitForTimeout(3000);
    const ids = await page.evaluate(() => [...document.querySelectorAll('#parts [data-part-id]')].map((b) => ({ id: b.dataset.partId, label: b.innerText.replace(/\s+/g, ' ').trim() })));
    result[piece] = [];
    for (const { id, label } of ids) {
      await page.evaluate((i) => document.querySelector(`#parts [data-part-id="${i}"]`)?.click(), id);
      await page.waitForTimeout(500);
      const card = await page.evaluate(() => ({ title: document.querySelector('#card-t')?.textContent ?? '', sub: document.querySelector('#card-sub')?.textContent ?? '',
        body: document.querySelector('#card-b')?.textContent ?? '', more: document.querySelector('#card-more:not([hidden]) #card-more-b')?.textContent ?? '',
        specs: document.querySelectorAll('#card-s > *').length }));
      result[piece].push({ id, label, ...card, bodyWords: words(card.body), moreWords: words(card.more) });
    }
    await page.close();
  }
} finally { await browser.close(); }
writeFileSync(join(out, 'cards.json'), JSON.stringify(result, null, 1));
for (const [piece, rows] of Object.entries(result)) for (const r of rows) console.log(piece.padEnd(6), r.id.padEnd(18), `[${r.label.slice(0, 28)}]`.padEnd(32), `T: ${r.title.slice(0, 40)}`.padEnd(46), `S: ${r.sub.slice(0, 40)}`.padEnd(46), `body ${r.bodyWords}w, more ${r.moreWords}w, specs ${r.specs}`);
