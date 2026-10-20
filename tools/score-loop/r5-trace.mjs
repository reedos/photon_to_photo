// Score loop r5: a Chrome trace of one level tap on a 4x phone, summarized as self time per event name on the renderer's main thread.
//   P2P_URL=http://127.0.0.1:47807/ node tools/score-loop/r5-trace.mjs lens [rate=4]
import { chromium } from 'playwright';
const url = (process.env.P2P_URL || 'http://127.0.0.1:47807/').replace(/\/?$/, '/');
const piece = process.argv[2] || 'lens';
const rate = Number(process.argv[3] || 4);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
const page = await context.newPage();
page.setDefaultTimeout(120000);
await page.goto(url + '?piece=camera&lens=n50');
await page.waitForFunction(() => window.p2p?.pieces.camera.state().loaded && document.getElementById('veil').classList.contains('off'));
await page.evaluate(() => window.p2p.settle());
await page.waitForTimeout(4000);
const cdp = await context.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate });
const events = [];
cdp.on('Tracing.dataCollected', (d) => events.push(...d.value));
const done = new Promise((r) => cdp.once('Tracing.tracingComplete', r));
await cdp.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline,v8,blink,gpu,disabled-by-default-gpu.service', transferMode: 'ReportEvents' });
await page.locator(`.step[data-piece="${piece}"]`).first().tap();
await page.waitForFunction(() => document.getElementById('veil').classList.contains('off'), null, { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(500);
await cdp.send('Tracing.end');
await done;
const meta = events.find((e) => e.name === 'thread_name' && e.args?.name === 'CrRendererMain');
const pid = meta?.pid, tid = meta?.tid;
const main = events.filter((e) => e.pid === pid && e.tid === tid && e.ph === 'X');
// self time = duration minus the durations of direct children (events nest by time on one thread)
main.sort((a, b) => a.ts - b.ts || b.dur - a.dur);
const stack = []; const self = new Map(); const count = new Map();
for (const e of main) {
  while (stack.length && stack.at(-1).ts + stack.at(-1).dur <= e.ts) stack.pop();
  if (stack.length) { const p = stack.at(-1); p.child = (p.child ?? 0) + e.dur; }
  e.child = 0; stack.push(e);
}
for (const e of main) { self.set(e.name, (self.get(e.name) ?? 0) + e.dur - e.child); count.set(e.name, (count.get(e.name) ?? 0) + 1); }
const rows = [...self].sort((a, b) => b[1] - a[1]).slice(0, 25);
for (const [k, t] of rows) console.log(String(Math.round(t / 1000)).padStart(6), 'ms', String(count.get(k)).padStart(6), 'x', k);
await browser.close();
