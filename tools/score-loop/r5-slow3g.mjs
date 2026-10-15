// Score loop r5: what the veil says while the camera downloads on fast 3G (1.6 Mbit/s down, 150 ms round trip), sampled every 500 ms.
//   P2P_URL=http://127.0.0.1:47807/ OUT=docs/score-loop/r5-perf node tools/score-loop/r5-slow3g.mjs [seconds=18] [direct]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const url = (process.env.P2P_URL || 'http://127.0.0.1:47807/').replace(/\/?$/, '/');
const OUT = process.env.OUT || 'shots/r5-3g';
const seconds = Number(process.argv[2] || 18);
const direct = process.argv[3] === 'direct';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
const page = await context.newPage();
page.setDefaultTimeout(120000);
const cdp = await context.newCDPSession(page);
await cdp.send('Network.enable');
await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1e6) / 8, uploadThroughput: (0.75 * 1e6) / 8 });
await page.goto(url + (direct ? '?piece=camera&lens=n50' : ''), { waitUntil: 'commit' });
if (!direct) { await page.locator('#opening-explore').waitFor({ state: 'visible', timeout: 60000 }); await page.locator('#opening-explore').tap(); }
const t0 = Date.now();
let last = '';
let shot = false;
while (Date.now() - t0 < seconds * 1000) {
  const s = await page.evaluate(() => ({ msg: document.getElementById('veil-msg')?.textContent ?? '', bar: document.getElementById('veil-bar')?.style.width ?? '', off: document.getElementById('veil')?.classList.contains('off') ?? false })).catch(() => null);
  if (s) { const k = `${s.msg}|${s.bar}|${s.off}`; if (k !== last) { console.log(`${String(Date.now() - t0).padStart(6)} ms  ${s.off ? '(veil off)' : s.msg}  ${s.bar}`); last = k; } }
  if (!shot && Date.now() - t0 > 6000) { shot = true; await page.screenshot({ path: `${OUT}/slow3g-${direct ? 'direct' : 'explore'}-6s.png` }); }
  await page.waitForTimeout(500);
}
await browser.close();
