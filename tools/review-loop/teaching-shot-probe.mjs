// Play-the-shot teaching probe (score loop r1, 10/11/2026): for each chapter button, the time it lands on, the
// heading and caption, whether it landed on a handoff cross-fade, and a screenshot; then the heading at t = 6 s
// reached by scrubbing, to show one title per chapter. Also screenshots the glossary.
//   P2P_URL=http://127.0.0.1:47803/ node tools/review-loop/teaching-shot-probe.mjs shots/r1-teaching/after
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const url = process.env.P2P_URL || 'http://127.0.0.1:47803/';
const out = process.argv[2] || 'shots/r1-teaching/probe';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const result = { chapters: [], scrub: [] };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(new URL('?piece=camera', url).href); await page.waitForFunction(() => window.p2p?.pieces?.camera);
  await page.locator('.shot-launch').first().click();
  await page.waitForSelector('#shot-dialog[data-ready="true"]', { timeout: 120000 });
  const read = () => page.evaluate(() => ({ time: Number(document.getElementById('shot-time').value), heading: document.getElementById('shot-heading').textContent,
    caption: document.getElementById('shot-caption').textContent, handoff: document.getElementById('shot-canvas').dataset.handoff || '' }));
  for (let i = 0; i < 6; i++) {
    await page.locator(`[data-shot-chapter="${i}"]`).click(); await page.waitForTimeout(300);
    result.chapters.push({ chapter: i + 1, ...(await read()) });
    await page.locator('#shot-dialog').screenshot({ path: join(out, `shot-ch${i + 1}.png`) });
  }
  for (const t of [4, 6, 8.1, 12, 16]) {
    await page.locator('#shot-time').evaluate((el, v) => { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); }, t);
    await page.waitForTimeout(150);
    result.scrub.push(await read());
  }
  await page.goto(new URL('reference.html?page=glossary', url).href); await page.waitForTimeout(800);
  result.glossary = await page.locator('dl dt').allTextContents();
  await page.screenshot({ path: join(out, 'glossary.png'), fullPage: false });
} finally { await browser.close(); }
writeFileSync(join(out, 'shot-probe.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 1));
