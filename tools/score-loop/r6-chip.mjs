// Score loop r6 (teaching): the Pixel reading's glosses and the evidence chip's tap-to-explain note.
//   P2P_URL=http://127.0.0.1:47803/ node tools/score-loop/r6-chip.mjs shots/r6-teaching/after [width]
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const base = process.env.P2P_URL || 'http://127.0.0.1:47803/';
const out = process.argv[2] || 'shots/r6-teaching/chip';
const width = Number(process.argv[3]) || 1440;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
try {
  const phone = width < 760;
  const page = await browser.newPage({ viewport: { width, height: phone ? 844 : 900 }, reducedMotion: 'reduce', isMobile: phone, hasTouch: phone });
  await page.goto(new URL('?piece=loupe', base).href);
  await page.waitForFunction(() => window.p2p?.pieces?.loupe, null, { timeout: 120000 });
  await page.waitForSelector('.lv-read:not([hidden]):not(.lv-status)', { timeout: 90000 });
  await page.waitForTimeout(1500);
  console.log(JSON.stringify(await page.evaluate(() => ({ read: document.querySelector('.lv-read:not(.lv-status)')?.innerText, why: !!document.querySelector('.lv-read-why')?.checkVisibility() }))));
  await page.screenshot({ path: join(out, `pixel-${width}.png`) });
  // a part card's evidence chip: pick a part, then tap its first chip
  await page.evaluate(() => document.querySelector('#parts [data-part-id="well"]')?.click());
  await page.waitForTimeout(800);
  const chip = page.locator('#card .chip[data-evidence-note], #card-s .chip').first();
  console.log('chips on card:', await page.locator('#card .chip[data-evidence-note]').count());
  await chip.click();
  await page.waitForTimeout(300);
  console.log(JSON.stringify(await page.evaluate(() => { const n = document.querySelector('.evidence-note'); return { open: n?.matches(':popover-open'), text: n?.textContent }; })));
  await page.screenshot({ path: join(out, `chip-${width}.png`) });
  await chip.click();
  console.log('after second tap open:', await page.evaluate(() => document.querySelector('.evidence-note')?.matches(':popover-open')));
  await page.close();
} finally { await browser.close(); }
