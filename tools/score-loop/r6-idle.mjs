// Score loop r6: the main-thread tasks the camera runs by itself after the veil lifts (the idle precompile of the other levels starts about
// 6 s after the camera is usable), at 4x CPU on a phone, and the long frames around them.
//   P2P_URL=http://127.0.0.1:47831/ node tools/score-loop/r6-idle.mjs [rate=4] [seconds=24]
import { chromium } from 'playwright';
const url = (process.env.P2P_URL || 'http://127.0.0.1:47831/').replace(/\/?$/, '/');
const rate = Number(process.argv[2] || 4), seconds = Number(process.argv[3] || 24);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
const page = await context.newPage();
page.setDefaultTimeout(180000);
await page.addInitScript(() => {
  window.__lt = []; window.__fr = [];
  new PerformanceObserver((l) => window.__lt.push(...l.getEntries().map((e) => ({ s: Math.round(e.startTime), d: Math.round(e.duration) })))).observe({ type: 'longtask', buffered: true });
  let last = performance.now();
  const f = (t) => { window.__fr.push([Math.round(t), Math.round(t - last)]); last = t; requestAnimationFrame(f); };
  requestAnimationFrame(f);
});
const cdp = await context.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate });
await page.goto(url + '?piece=camera&lens=n50');
await page.waitForFunction(() => window.p2p?.pieces.camera.state().loaded && document.getElementById('veil').classList.contains('off'), null, { timeout: 180000 });
const off = await page.evaluate(() => Math.round(performance.now()));
await page.mouse.move(2, 2);
await page.waitForTimeout(seconds * 1000);
const r = await page.evaluate((off) => ({
  marks: performance.getEntriesByType('mark').filter((m) => /prewarm/.test(m.name)).map((m) => `${m.name.slice(4)}@${Math.round(m.startTime - off)}`),
  tasks: window.__lt.filter((t) => t.s > off).map((t) => `${t.s - off}:${t.d}`),
  slowFrames: window.__fr.filter(([t, d]) => t > off && d > 50).length, frames: window.__fr.filter(([t]) => t > off).length,
}), off);
const durs = r.tasks.map((t) => Number(t.split(':')[1]));
console.log(JSON.stringify({ rate, veilOffAt: off, marks: r.marks, longTasks: r.tasks.length, longest: Math.max(0, ...durs), over300: durs.filter((d) => d > 300).length, over150: durs.filter((d) => d > 150).length, slowFramesOver50: r.slowFrames, frames: r.frames }));
console.log('tasks (ms after veil off : duration)', r.tasks.join(' '));
await browser.close();
