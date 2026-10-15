// Score loop r5 (teaching): Play the shot at 1440, 390, 360 and 320 px. For every chapter: heading, caption, chapter chip
// text, the label-bounds counters the canvas exposes (data-labels-*), and a screenshot of the whole dialog.
//   P2P_URL=http://127.0.0.1:47803/ node tools/score-loop/r5-shot-probe.mjs shots/r5-teaching/after [photoId]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const url = process.env.P2P_URL || 'http://127.0.0.1:47803/';
const out = process.argv[2] || 'shots/r5-teaching/shot';
const photo = process.argv[3] || '';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const result = {};
try {
  for (const [w, h] of [[1440, 900], [390, 844], [360, 780], [320, 568]]) {
    const phone = w < 760;
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, reducedMotion: 'reduce', isMobile: phone, hasTouch: phone });
    await page.goto(new URL('?piece=camera', url).href); await page.waitForFunction(() => window.p2p?.pieces?.camera);
    if (photo) await page.evaluate((id) => document.querySelector('.shot-launch')?.click(), photo);
    else await page.locator('.shot-launch').first().click();
    await page.waitForSelector('#shot-dialog[data-ready="true"]', { timeout: 120000 });
    if (photo) { await page.locator('#shot-source').selectOption(`photo:${photo}`); await page.waitForSelector('#shot-dialog[data-ready="true"]', { timeout: 120000 }); await page.waitForTimeout(800); }
    result[w] = [];
    for (let i = 0; i < 6; i++) {
      await page.locator(`[data-shot-chapter="${i}"]`).click(); await page.waitForTimeout(500);
      const text = await page.evaluate(() => {
        const c = document.getElementById('shot-canvas');
        return { heading: document.getElementById('shot-heading')?.textContent, caption: document.getElementById('shot-caption')?.textContent,
          chips: [...document.querySelectorAll('[data-shot-chapter]')].map((b) => b.innerText.replace(/\s+/g, ' ')),
          labels: { total: c.dataset.labelsTotal, outside: c.dataset.labelsOutside, adjusted: c.dataset.labelsAdjusted } };
      });
      result[w].push({ chapter: i + 1, ...text });
      await page.locator('#shot-dialog').screenshot({ path: join(out, `shot-${w}-ch${i + 1}.png`) });
    }
    await page.close();
  }
} finally { await browser.close(); }
writeFileSync(join(out, 'shot-probe.json'), JSON.stringify(result, null, 1));
console.log(JSON.stringify(Object.fromEntries(Object.entries(result).map(([w, r]) => [w, r.map((x) => x.labels)])), null, 0));
