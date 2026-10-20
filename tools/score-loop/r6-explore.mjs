// Score loop r6: the opening, then Explore the camera: tap to a usable camera (veil off, main thread free), after waiting WAIT ms on the opening.
// Repeats RUNS times per wait. The reviewers saw Explore take longer after 8 s on the opening than when tapped at once (2.1 s against 2.7 s on a desktop).
//   P2P_URL=http://127.0.0.1:47831/ WAITS=0,8000 RUNS=3 node tools/score-loop/r6-explore.mjs [rate=1] [width=1366] [height=900]
import { chromium } from 'playwright';
const base = (process.env.P2P_URL || 'http://127.0.0.1:47831/').replace(/\/?$/, '/');
const rate = Number(process.argv[2] || 1), width = Number(process.argv[3] || 1366), height = Number(process.argv[4] || 900);
const waits = (process.env.WAITS || '0,8000').split(',').map(Number), runs = Number(process.env.RUNS || 3);
const phone = width < 700;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
for (const wait of waits) {
  const times = [];
  for (let i = 0; i < runs; i++) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: phone ? 2 : 1, isMobile: phone, hasTouch: phone, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.setDefaultTimeout(120000);
    await page.addInitScript(() => {
      window.__lt = [];
      new PerformanceObserver((l) => window.__lt.push(...l.getEntries().map((e) => ({ s: e.startTime, d: e.duration })))).observe({ type: 'longtask', buffered: true });
    });
    await page.goto(base);
    await page.locator('#opening-explore').waitFor({ state: 'visible' });
    await page.mouse.move(120, 300);
    await page.waitForTimeout(wait);
    if (rate > 1) await (await context.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate });
    const tap = await page.evaluate(() => performance.now());
    await page.locator('#opening-explore').click();
    await page.waitForFunction(() => window.p2p?.pieces.camera.state().loaded && document.getElementById('veil').classList.contains('off'));
    const off = await page.evaluate(() => performance.now());
    await page.waitForTimeout(1200);
    const usable = await page.evaluate(([tap]) => Math.max(...window.__lt.filter((t) => t.s + t.d > tap).map((t) => t.s + t.d), 0), [tap]);
    times.push({ toVeilOff: Math.round(off - tap), longest: Math.round(await page.evaluate(([tap]) => Math.max(0, ...window.__lt.filter((t) => t.s + t.d > tap).map((t) => t.d)), [tap])), mainThreadFreeAfterTap: Math.round(Math.max(off, usable) - tap) });
    await context.close();
  }
  console.log(`wait ${wait} ms on the opening, x${rate}:`, JSON.stringify(times));
}
await browser.close();
