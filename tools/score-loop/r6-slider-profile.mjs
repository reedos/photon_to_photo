// Score loop r6: a CPU profile of one slider drag in the Focus or Pixel level (dev server, so function names survive), summarized
// as the call tree under the drag and the top self-time functions.
//   P2P_URL=http://127.0.0.1:47832/ node tools/score-loop/r6-slider-profile.mjs cone sc-fno [rate=4]   (WARM=1 drags once first)
import { chromium } from 'playwright';
const url = (process.env.P2P_URL || 'http://127.0.0.1:47832/').replace(/\/?$/, '/');
const level = process.argv[2] || 'cone', id = process.argv[3] || 'sc-fno', rate = Number(process.argv[4] || 4);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
const page = await context.newPage();
page.setDefaultTimeout(120000);
await page.goto(url + '?piece=camera&lens=n50');
await page.waitForFunction(() => window.p2p?.pieces.camera.state().loaded && document.getElementById('veil').classList.contains('off'));
await page.evaluate(() => window.p2p.settle());
await page.locator(`.step[data-piece="${level}"]`).first().click();
await page.waitForFunction((l) => window.p2p.framing().piece === l && document.getElementById('veil').classList.contains('off'), level, { timeout: 60000 });
await page.evaluate(() => window.p2p.settle());
await page.waitForTimeout(2500);
const drag = (n) => page.evaluate(async ({ id, n }) => {
  const el = document.getElementById(id); const lo = Number(el.min), hi = Number(el.max), start = Number(el.value);
  const span = Math.max(2, Math.round((hi - lo) * 0.6)), dir = start + span <= hi ? 1 : -1;
  for (let i = 0; i < n; i++) { el.value = String(Math.round(start + dir * span * (i + 1) / n)); el.dispatchEvent(new Event('input', { bubbles: true })); await new Promise((r) => setTimeout(r, 16)); }
  await new Promise((r) => setTimeout(r, 1500));
}, { id, n });
const cdp = await context.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate });
if (process.env.WARM) await drag(20);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
await cdp.send('Profiler.start');
await drag(30);
const { profile } = await cdp.send('Profiler.stop');
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map();
profile.samples.forEach((sid, i) => self.set(sid, (self.get(sid) ?? 0) + (profile.timeDeltas[i] ?? 0)));
const total = new Map();
const sum = (nid) => { const n = byId.get(nid); let t = self.get(nid) ?? 0; for (const c of n.children ?? []) t += sum(c); total.set(nid, t); return t; };
sum(profile.nodes[0].id);
const min = Number(process.env.MIN_MS || 60) * 1000;
const label = (n) => `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber}`;
const show = (nid, depth) => {
  const n = byId.get(nid);
  const kids = (n.children ?? []).filter((c) => total.get(c) >= min).sort((a, b) => total.get(b) - total.get(a));
  const only = depth > 0 && kids.length === 1 && (total.get(nid) - total.get(kids[0])) < min / 2;
  if (!only) console.log(' '.repeat(Math.min(depth, 40)) + String(Math.round(total.get(nid) / 1000)).padStart(6) + ' ' + label(n));
  for (const c of kids) show(c, only ? depth : depth + 1);
};
show(profile.nodes[0].id, 0);
const bySelf = new Map();
for (const [nid, t] of self) { const k = label(byId.get(nid)); bySelf.set(k, (bySelf.get(k) ?? 0) + t); }
console.log('--- self time');
for (const [k, t] of [...bySelf].sort((a, b) => b[1] - a[1]).slice(0, 14)) console.log(String(Math.round(t / 1000)).padStart(6), k);
await browser.close();
