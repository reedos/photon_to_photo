// Score loop r5: a CPU profile of one level tap on a 4x phone, summarized as inclusive time per function name under the click.
//   P2P_URL=http://127.0.0.1:47806/ node tools/score-loop/r5-profile.mjs cone [rate=4]
import { chromium } from 'playwright';
const url = (process.env.P2P_URL || 'http://127.0.0.1:47806/').replace(/\/?$/, '/');
const piece = process.argv[2] || 'cone';
const rate = Number(process.argv[3] || 4);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
const page = await context.newPage();
page.setDefaultTimeout(120000);
await page.goto(url + '?piece=camera&lens=n50');
await page.waitForFunction(() => window.p2p?.pieces.camera.state().loaded && document.getElementById('veil').classList.contains('off'));
await page.evaluate(() => window.p2p.settle());
await page.waitForTimeout(Number(process.env.WAIT || 4000));
const cdp = await context.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate });
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
await cdp.send('Profiler.start');
await page.locator(`.step[data-piece="${piece}"]`).first().tap();
await page.waitForFunction(() => document.getElementById('veil').classList.contains('off'), null, { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(800);
const { profile } = await cdp.send('Profiler.stop');
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const parent = new Map();
for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
const self = new Map();
profile.samples.forEach((id, i) => self.set(id, (self.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0)));
const incl = new Map();
for (const [id, t] of self) {
  const seen = new Set();
  for (let cur = id; cur !== undefined; cur = parent.get(cur)) {
    const n = byId.get(cur); const key = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber}`;
    if (seen.has(key)) continue; seen.add(key);
    incl.set(key, (incl.get(key) ?? 0) + t);
  }
}
const total = new Map();
const sum = (id) => { const n = byId.get(id); let t = self.get(id) ?? 0; for (const c of n.children ?? []) t += sum(c); total.set(id, t); return t; };
sum(profile.nodes[0].id);
const min = Number(process.env.MIN_MS || 40) * 1000;
const show = (id, depth) => {
  const n = byId.get(id);
  const kids = (n.children ?? []).filter((c) => total.get(c) >= min).sort((a, b) => total.get(b) - total.get(a));
  const only = depth > 0 && kids.length === 1 && (total.get(id) - total.get(kids[0])) < min / 2;
  if (!only) console.log(' '.repeat(Math.min(depth, 40)) + String(Math.round(total.get(id) / 1000)).padStart(5) + ' ' + (n.callFrame.functionName || '(anon)') + ' ' + n.callFrame.url.split('/').pop() + ':' + n.callFrame.lineNumber + ':' + n.callFrame.columnNumber);
  for (const c of kids) show(c, only ? depth : depth + 1);
};
show(profile.nodes[0].id, 0);
await browser.close();
