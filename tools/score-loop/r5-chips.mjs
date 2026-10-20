// Score loop r5 (teaching): Play the shot's chapter chips at phone widths: a screenshot of the nav and whether any chip's
// content overflows it.
//   P2P_URL=http://127.0.0.1:47803/ node tools/score-loop/r5-chips.mjs shots/r5-teaching/after
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const url = process.env.P2P_URL || 'http://127.0.0.1:47803/';
const out = process.argv[2] || 'shots/r5-teaching/chips';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
try {
  for (const [w, h] of [[320, 568], [360, 780], [390, 844], [430, 900]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, reducedMotion: 'reduce', isMobile: true, hasTouch: true });
    await page.goto(new URL('?piece=camera', url).href); await page.waitForFunction(() => window.p2p?.pieces?.camera);
    await page.locator('.shot-launch').first().click();
    await page.waitForSelector('#shot-dialog[data-ready="true"]', { timeout: 120000 });
    await page.locator('[data-shot-chapter="3"]').click(); await page.waitForTimeout(300);
    const info = await page.evaluate(() => [...document.querySelectorAll('[data-shot-chapter]')].map((b) => {
      const r = b.getBoundingClientRect(); const kids = [...b.children].filter((k) => getComputedStyle(k).display !== 'none');
      const overflow = kids.some((k) => { const q = document.createRange(); q.selectNodeContents(k); const t = q.getBoundingClientRect(); return t.right > r.right - 1 || t.left < r.left + 1; });
      return { text: b.innerText.replace(/\s+/g, ' '), w: Math.round(r.width), h: Math.round(r.height), overflow, fs: kids.map((k) => getComputedStyle(k).fontSize) };
    }));
    console.log(w, JSON.stringify(info.map((i) => `${i.text}|${i.w}x${i.h}|${i.overflow ? 'OVERFLOW' : 'ok'}|${i.fs}`)));
    await page.locator('.shot-chapters').screenshot({ path: join(out, `chips-${w}.png`) });
    await page.close();
  }
} finally { await browser.close(); }
