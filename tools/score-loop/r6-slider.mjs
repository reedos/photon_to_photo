// Score loop r6: frame times while a reader drags the aperture, focus or shutter slider in the Focus (cone) and Pixel (loupe)
// levels. Input events arrive every 16 ms across the slider's range (as a pointer drag fires them), under CPU throttling.
// Reports, per level and slider: frame-gap p50/p95/max over the drag, the longest task, the longest input handler, and the
// time from the last input until the page is idle (the full-quality result is drawn).
//   P2P_URL=http://127.0.0.1:47830/ node tools/score-loop/r6-slider.mjs [rate=4] [width=390] [height=844]
//   LEVELS=cone,loupe  SLIDERS=sc-fno,sc-focus,sc-shutter  EVENTS=40  JSON=out.json
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
const url = (process.env.P2P_URL || 'http://127.0.0.1:47830/').replace(/\/?$/, '/');
const rate = Number(process.argv[2] || 4);
const width = Number(process.argv[3] || 390), height = Number(process.argv[4] || 844);
const levels = (process.env.LEVELS || 'cone,loupe').split(',');
const sliders = (process.env.SLIDERS || 'sc-fno,sc-focus,sc-shutter').split(',');
const events = Number(process.env.EVENTS || 40);
const phone = width < 700;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: phone ? 2 : 1, isMobile: phone, hasTouch: phone, reducedMotion: 'reduce' });
const page = await context.newPage();
page.setDefaultTimeout(120000);
await page.addInitScript(() => {
  window.__lt = [];
  new PerformanceObserver((l) => window.__lt.push(...l.getEntries().map((e) => ({ s: e.startTime, d: e.duration })))).observe({ type: 'longtask', buffered: true });
});
page.on('console', (m) => { if (m.type() === 'error') console.log('console error', m.text().slice(0, 200)); });
await page.goto(url + '?piece=camera&lens=n50' + (process.env.EXTRA || ''));
await page.waitForFunction(() => window.p2p?.pieces.camera.state().loaded && document.getElementById('veil').classList.contains('off'));
await page.evaluate(() => window.p2p.settle());
const cdp = await context.newCDPSession(page);
const out = [];
for (const level of levels) {
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await page.locator(`.step[data-piece="${level}"]`).first().click();
  await page.waitForFunction((id) => window.p2p.framing().piece === id && document.getElementById('veil').classList.contains('off'), level, { timeout: 60000 });
  await page.evaluate(() => window.p2p.settle());
  await page.waitForTimeout(1500);
  if (phone) { // the controls live in a sheet on a phone: open it so the sliders are real, visible inputs
    const open = page.locator('#phone-settings-open, [data-open-settings], #sc-open').first();
    if (await open.count()) await open.click().catch(() => {});
  }
  for (const id of sliders) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await page.evaluate(() => window.p2p.settle());
    await page.waitForTimeout(400);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    const r = await page.evaluate(async ({ id, events }) => {
      const el = document.getElementById(id);
      const lo = Number(el.min), hi = Number(el.max), start = Number(el.value);
      const frames = []; let running = true, last = performance.now();
      const raf = (t) => { frames.push(t); if (running) requestAnimationFrame(raf); };
      requestAnimationFrame(raf);
      window.__lt.length = 0;
      const t0 = performance.now();
      const handler = [];
      // sweep from the current value to the far end and back a third of the range, one event per 16 ms tick
      const span = Math.max(2, Math.round((hi - lo) * 0.6));
      const dir = start + span <= hi ? 1 : -1;
      await new Promise((resolve) => {
        let i = 0;
        const tick = () => {
          const v = Math.round(start + dir * (span * (i + 1)) / events);
          el.value = String(v);
          const a = performance.now();
          el.dispatchEvent(new Event('input', { bubbles: true }));
          handler.push(performance.now() - a);
          if (++i < events) setTimeout(tick, 16); else resolve();
        };
        tick();
      });
      const tLast = performance.now();
      // until the page is quiet: no frame or task for 400 ms
      await new Promise((resolve) => {
        const check = () => { const lt = window.__lt[window.__lt.length - 1]; const quiet = performance.now() - (lt ? lt.s + lt.d : tLast); if (quiet > 400) resolve(); else setTimeout(check, 100); };
        setTimeout(check, 400);
      });
      running = false;
      const tEnd = performance.now();
      const gaps = []; for (let i = 1; i < frames.length; i++) if (frames[i] >= t0 && frames[i] <= tLast + 50) gaps.push(frames[i] - frames[i - 1]);
      gaps.sort((a, b) => a - b);
      const q = (p) => gaps.length ? gaps[Math.min(gaps.length - 1, Math.floor(p * gaps.length))] : 0;
      const tasks = window.__lt.filter((t) => t.s >= t0 - 5);
      const lastTaskEnd = tasks.length ? Math.max(...tasks.map((t) => t.s + t.d)) : tLast;
      el.value = String(start); el.dispatchEvent(new Event('input', { bubbles: true }));
      return {
        frames: gaps.length, p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), max: +(gaps[gaps.length - 1] ?? 0).toFixed(1),
        handlerMax: +Math.max(...handler).toFixed(1), handlerMean: +(handler.reduce((a, b) => a + b, 0) / handler.length).toFixed(1),
        longestTask: Math.round(Math.max(0, ...tasks.map((t) => t.d))), fullQualityAfterMs: Math.round(Math.max(0, lastTaskEnd - tLast)), dragMs: Math.round(tLast - t0),
      };
    }, { id, events });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await page.waitForTimeout(800);
    const row = { level, slider: id, rate, viewport: `${width}x${height}`, ...r };
    out.push(row);
    console.log(JSON.stringify(row));
  }
}
if (process.env.JSON) writeFileSync(process.env.JSON, JSON.stringify(out, null, 1));
await browser.close();
