// Score loop r4: the opening, then Explore the camera, on a 4x phone: tap to a usable camera, and the longest task.
//   P2P_URL=http://127.0.0.1:47807/ node tools/score-loop/r4-enter.mjs [wait=6000] [signal=1]
import { chromium } from 'playwright';
const url = process.env.P2P_URL || 'http://127.0.0.1:47807/';
const wait = Number(process.argv[2] || 6000);
const signal = process.argv[3] !== '0';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
const page = await context.newPage();
page.setDefaultTimeout(120000);
await page.addInitScript(() => {
  window.__lt = [];
  new PerformanceObserver((l) => window.__lt.push(...l.getEntries().map((e) => ({ s: e.startTime, d: Math.round(e.duration) })))).observe({ type: 'longtask', buffered: true });
  const f = () => { if (!window.__usable && window.p2p?.pieces.camera.state().loaded && document.getElementById('veil')?.classList.contains('off')) window.__usable = performance.now(); else requestAnimationFrame(f); };
  requestAnimationFrame(f);
});
await page.goto(url);
await page.locator('#opening-explore').waitFor({ state: 'visible' });
if (signal) await page.mouse.move(120, 300);
await page.waitForTimeout(wait);
await (await context.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: 4 });
const tap = await page.evaluate(() => performance.now());
const bytes0 = await page.evaluate(() => performance.getEntriesByType('resource').reduce((a, e) => a + e.encodedBodySize, 0));
await page.locator('#opening-explore').tap();
await page.waitForFunction(() => window.__usable);
const r = await page.evaluate((tap) => ({ usable: Math.round(window.__usable - tap), longest: Math.max(0, ...window.__lt.filter((t) => t.s + t.d >= tap).map((t) => t.d)), bytes: performance.getEntriesByType('resource').reduce((a, e) => a + e.encodedBodySize, 0) }), tap);
console.log(JSON.stringify({ ...r, bytesBeforeTap: bytes0 }));
await browser.close();
