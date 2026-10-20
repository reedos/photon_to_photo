// Score loop r4: where a lens swap and a body swap spend their time on a 4x phone (marks and long tasks), against a
// production build.  P2P_URL=http://127.0.0.1:47807/ node tools/score-loop/r4-swap.mjs [rate=4] [gl=]
import { chromium } from 'playwright';
const profile = process.env.PROFILE === '1';
const dev = profile ? await (await import('vite')).createServer({ root: process.cwd(), logLevel: 'error', server: { host: '127.0.0.1', port: 47819, strictPort: true, open: false } }) : null;
if (dev) await dev.listen();
const url = dev ? 'http://127.0.0.1:47819/' : process.env.P2P_URL || 'http://127.0.0.1:47807/';
const rate = Number(process.argv[2] || 4);
const gl = process.argv[3] ? `&gl=${process.argv[3]}` : '';
const wide = process.env.WIDE === '1';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: wide ? { width: 1440, height: 900 } : { width: 390, height: 844 }, reducedMotion: 'reduce' });
const page = await context.newPage();
page.setDefaultTimeout(120000);
await page.addInitScript(() => {
  window.__lt = [];
  new PerformanceObserver((l) => window.__lt.push(...l.getEntries().map((e) => ({ s: Math.round(e.startTime), d: Math.round(e.duration) })))).observe({ type: 'longtask', buffered: true });
});
await page.goto(url + '?piece=camera&lens=n50' + gl);
await page.waitForFunction(() => window.p2p?.pieces.camera.state().loaded && document.getElementById('veil').classList.contains('off'));
await page.evaluate(() => window.p2p.settle());
await page.waitForTimeout(2500);
await (await context.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate });
if (process.env.TOUR !== '0') for (const id of ['lens', 'cone', 'loupe', 'camera']) {
  await page.evaluate((id) => window.p2p.piece(id), id);
  await page.waitForFunction(() => document.getElementById('veil').classList.contains('off') && !document.getElementById('veil').classList.contains('err'));
  await page.evaluate(() => window.p2p.settle()).catch(() => {});
  await page.waitForTimeout(1500);
}
for (const [name, lens] of [['lens swap s35', 's35'], ['lens swap n500', 'n500'], ['body swap z35', 'z35'], ['back to n50', 'n50']]) {
  const cdp2 = profile ? await context.newCDPSession(page) : null;
  if (cdp2) { await cdp2.send('Profiler.enable'); await cdp2.send('Profiler.setSamplingInterval', { interval: 300 }); await cdp2.send('Profiler.start'); }
  const t0 = await page.evaluate((lens) => { const t = performance.now(); performance.clearMarks(); window.p2p.set({ lens }); return t; }, lens);
  await page.waitForFunction(() => document.getElementById('veil').classList.contains('off') && !document.getElementById('veil').classList.contains('err'));
  await page.evaluate(() => window.p2p.settle()).catch(() => {});
  await page.waitForTimeout(1200);
  const r = await page.evaluate(([t0]) => ({
    marks: performance.getEntriesByType('mark').filter((m) => m.name.startsWith('p2p:') && m.startTime >= t0).map((m) => `${m.name.replace('p2p:', '')}@${Math.round(m.startTime - t0)}`),
    tasks: window.__lt.filter((t) => t.s + t.d >= t0).map((t) => `${Math.round(t.s - t0)}+${t.d}`),
  }), [t0]);
  console.log(name, JSON.stringify(r));
  if (cdp2) { const { profile: pr } = await cdp2.send('Profiler.stop'); report(pr, name); }
}
await browser.close();
await dev?.close();

function report(pr, name) {
  const byId = new Map(pr.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of pr.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const dt = new Map();
  pr.samples.forEach((s, i) => dt.set(s, (dt.get(s) ?? 0) + (pr.timeDeltas[i] ?? 0) / 1000));
  const self = new Map(), incl = new Map();
  const nm = (n) => `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').slice(-2).join('/')}:${n.callFrame.lineNumber + 1}`;
  for (const [id, ms] of dt) {
    const n = byId.get(id);
    self.set(nm(n), (self.get(nm(n)) ?? 0) + ms);
    const seen = new Set();
    for (let k = id; k !== undefined; k = parent.get(k)) { const x = nm(byId.get(k)); if (seen.has(x)) continue; seen.add(x); incl.set(x, (incl.get(x) ?? 0) + ms); }
  }
  const top = (m, f = () => true, n = 22) => [...m].filter(([k]) => f(k)).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${v.toFixed(0).padStart(6)} ms  ${k}`).join(String.fromCharCode(10));
  console.log(`--- ${name}: SELF` + String.fromCharCode(10) + top(self) + String.fromCharCode(10) + 'INCLUSIVE' + String.fromCharCode(10) + top(incl, (k) => !k.startsWith('('), 40));
}
