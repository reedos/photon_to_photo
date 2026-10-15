// Score loop r5 (teaching): "Use these settings" says what it did. From the Real photos view and from Play the shot: the toast
// and the screen-reader live region carry the camera's new settings, and both buttons read "Use these settings".
//   P2P_URL=http://127.0.0.1:47803/ node tools/score-loop/r5-use.mjs
import { chromium } from 'playwright';
const url = process.env.P2P_URL || 'http://127.0.0.1:47803/';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
let bad = 0;
const check = (ok, msg) => { console.log(ok ? 'PASS' : 'FAIL', msg); if (!ok) bad++; };
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await page.goto(new URL('?view=photos&photo=flycatcher', url).href);
  await page.waitForSelector('#rp-match', { timeout: 90000 });
  await page.waitForTimeout(1500);
  check((await page.locator('#rp-match').innerText()).toLowerCase() === 'use these settings', `static label: ${await page.locator('#rp-match').innerText()}`);
  await page.locator('#rp-match').click();
  await page.waitForTimeout(400);
  const t = await page.evaluate(() => ({ toast: document.getElementById('toast').textContent, hidden: document.getElementById('toast').hidden, sr: document.getElementById('sr-announce').textContent }));
  console.log(JSON.stringify(t));
  check(!t.hidden && /Camera set to the settings recorded for Vermilion flycatcher: 500.mm, f\/5\.6, 1\/4000.s, ISO 1400/.test(t.toast), 'toast names the photo and the settings');
  check(t.sr === t.toast, 'live region says the same');
  // Play the shot
  await page.goto(new URL('?piece=camera', url).href); await page.waitForFunction(() => window.p2p?.pieces?.camera);
  await page.locator('.shot-launch').first().click();
  await page.waitForSelector('#shot-dialog[data-ready="true"]', { timeout: 120000 });
  check((await page.locator('#shot-use').innerText()).toLowerCase() === 'use these settings →', `shot label: ${await page.locator('#shot-use').innerText()}`);
  await page.locator('#shot-use').click(); await page.waitForTimeout(400);
  const u = await page.evaluate(() => ({ toast: document.getElementById('toast').textContent, hidden: document.getElementById('toast').hidden, sr: document.getElementById('sr-announce').textContent }));
  console.log(JSON.stringify(u));
  check(!u.hidden && /Camera set to the settings recorded for/.test(u.toast) && u.sr === u.toast, 'Play the shot: toast and live region');
} finally { await browser.close(); }
process.exit(bad ? 1 : 0);
