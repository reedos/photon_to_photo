// Score loop r4 (teaching): Play the shot's six chapters at 1440 and 390 px: heading, caption, notes (to read the copy)
// and a screenshot of each chapter's canvas.
//   P2P_URL=http://127.0.0.1:47803/ node tools/score-loop/r4-shot-probe.mjs shots/r4-teaching/after
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const url = process.env.P2P_URL || 'http://127.0.0.1:47803/';
const out = process.argv[2] || 'shots/r4-teaching/shot';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const result = {};
try {
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    const phone = w < 760;
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, reducedMotion: 'reduce', isMobile: phone, hasTouch: phone });
    await page.goto(new URL('?piece=camera', url).href); await page.waitForFunction(() => window.p2p?.pieces?.camera);
    await page.locator('.shot-launch').first().click();
    await page.waitForSelector('#shot-dialog[data-ready="true"]', { timeout: 120000 });
    result[w] = [];
    for (let i = 0; i < 6; i++) {
      await page.locator(`[data-shot-chapter="${i}"]`).click(); await page.waitForTimeout(500);
      const text = await page.evaluate(() => ({ heading: document.getElementById('shot-heading')?.textContent, caption: document.getElementById('shot-caption')?.textContent,
        dialogText: document.getElementById('shot-dialog').innerText.replace(/\s+/g, ' ').slice(0, 900) }));
      result[w].push({ chapter: i + 1, ...text });
      await page.locator('#shot-canvas').screenshot({ path: join(out, `shot-ch${i + 1}-${w}.png`) });
    }
    await page.close();
  }
} finally { await browser.close(); }
writeFileSync(join(out, 'shot-probe.json'), JSON.stringify(result, null, 1));
console.log(JSON.stringify(result[1440], null, 1));
