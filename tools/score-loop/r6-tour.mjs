// Score loop r6 (teaching): the guided tour at 1440x900, every stop: its text, glossary notes, and where the
// "Focal length & perspective" launcher sits against the zoom bar.
//   P2P_URL=http://127.0.0.1:47803/ node tools/score-loop/r6-tour.mjs shots/r6-teaching/after [width] [stops]
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const base = process.env.P2P_URL || 'http://127.0.0.1:47803/';
const out = process.argv[2] || 'shots/r6-teaching/tour';
const width = Number(process.argv[3]) || 1440;
const stops = (process.argv[4] || '1,2,3,4,8').split(',').map(Number);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const result = [];
try {
  const phone = width < 760;
  for (const n of stops) {
    const page = await browser.newPage({ viewport: { width, height: phone ? 844 : 900 }, reducedMotion: 'reduce', isMobile: phone, hasTouch: phone });
    await page.goto(new URL(`?piece=camera&tour=${n}`, base).href);
    await page.waitForFunction(() => window.p2p?.pieces?.camera, null, { timeout: 120000 });
    await page.waitForSelector('#journey:not([hidden])', { timeout: 60000 });
    await page.waitForTimeout(3000);
    const info = await page.evaluate(() => {
      const r = (e) => { const b = e?.getBoundingClientRect(); return b && [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; };
      const p = document.querySelector('.perspective-launch');
      return { stop: document.getElementById('journey-stop')?.value, text: document.getElementById('journey-text')?.textContent,
        gloss: [...document.querySelectorAll('#journey-text button.gloss')].map((b) => b.textContent),
        perspective: r(p), perspectiveVisible: !!p?.checkVisibility(), zoom: r(document.querySelector('.zoom-controls')), vh: innerHeight };
    });
    result.push({ n, ...info });
    await page.screenshot({ path: join(out, `tour-${width}-${n}.png`) });
    await page.close();
  }
} finally { await browser.close(); }
writeFileSync(join(out, `tour-${width}.json`), JSON.stringify(result, null, 1));
for (const r of result) console.log(JSON.stringify(r));
