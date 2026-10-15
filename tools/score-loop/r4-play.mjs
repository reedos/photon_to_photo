// Score loop r4: the opening's "Play the shot" on a phone at 4x CPU, against a production build: bytes after the tap,
// time from the tap to the open player, the longest tasks, and the player's frame times for 8 s.
//   P2P_URL=http://127.0.0.1:47807/ node tools/score-loop/r4-play.mjs [rate=4] [wait=6000]
import { chromium } from 'playwright';
const profile = process.env.PROFILE === '1';
const dev = profile ? await (await import('vite')).createServer({ root: process.cwd(), logLevel: 'error', server: { host: '127.0.0.1', port: 47819, strictPort: true, open: false } }) : null;
if (dev) await dev.listen();
const url = dev ? 'http://127.0.0.1:47819/' : process.env.P2P_URL || 'http://127.0.0.1:47807/';
const rate = Number(process.argv[2] || 4);
const wait = Number(process.argv[3] || 6000);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, reducedMotion: 'no-preference' });
const page = await context.newPage();
page.setDefaultTimeout(120000);
await page.addInitScript(() => {
  window.__lt = [];
  new PerformanceObserver((l) => window.__lt.push(...l.getEntries().map((e) => ({ s: Math.round(e.startTime), d: Math.round(e.duration) })))).observe({ type: 'longtask', buffered: true });
});
await page.goto(url);
await page.locator('#opening-follow').waitFor({ state: 'visible' });
if (process.env.SIGNAL !== '0') await page.mouse.move(120, 300);
await page.waitForTimeout(wait);
const cdp = await context.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate });
const before = await page.evaluate(() => ({ t: performance.now(), res: performance.getEntriesByType('resource').length, bytes: performance.getEntriesByType('resource').reduce((a, e) => a + e.encodedBodySize, 0) }));
await page.evaluate(() => { window.__fr = []; let last = performance.now(); const f = (t) => { window.__fr.push(t - last); last = t; requestAnimationFrame(f); }; requestAnimationFrame(f); });
if (profile) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 }); await cdp.send('Profiler.start'); }
await page.locator('#opening-follow').tap();
const t0 = before.t;
await page.waitForFunction(() => document.querySelector('#shot-dialog')?.open === true, null, { timeout: 120000 });
const opened = await page.evaluate(() => performance.now());
await page.waitForTimeout(Number(process.env.SETTLE || 8000));
await page.evaluate(() => { window.__fr = []; });
await page.waitForTimeout(6000);
if (profile) {
  const { profile: pr } = await cdp.send('Profiler.stop');
  const byId = new Map(pr.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of pr.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const dt = new Map();
  pr.samples.forEach((sm, i) => dt.set(sm, (dt.get(sm) ?? 0) + (pr.timeDeltas[i] ?? 0) / 1000));
  const self = new Map(), incl = new Map();
  const nm = (n) => `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').slice(-2).join('/')}:${n.callFrame.lineNumber + 1}`;
  for (const [id, ms] of dt) {
    const n = byId.get(id);
    self.set(nm(n), (self.get(nm(n)) ?? 0) + ms);
    const seen = new Set();
    for (let k = id; k !== undefined; k = parent.get(k)) { const x = nm(byId.get(k)); if (seen.has(x)) continue; seen.add(x); incl.set(x, (incl.get(x) ?? 0) + ms); }
  }
  const top = (m, f = () => true, n = 25) => [...m].filter(([k]) => f(k)).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${v.toFixed(0).padStart(6)} ms  ${k}`).join(String.fromCharCode(10));
  console.log('SELF' + String.fromCharCode(10) + top(self) + String.fromCharCode(10) + 'INCLUSIVE shot' + String.fromCharCode(10) + top(incl, (k) => /shot-/.test(k), 30));
}
const r = await page.evaluate(([t0]) => {
  const res = performance.getEntriesByType('resource');
  const fr = window.__fr.filter((_, i) => i > 2);
  const sorted = [...fr].sort((a, b) => a - b);
  return {
    bytesTotal: res.reduce((a, e) => a + e.encodedBodySize, 0),
    afterTap: res.filter((e) => e.startTime >= t0).map((e) => `${e.name.split('/').slice(-1)[0]} ${Math.round(e.encodedBodySize / 1024)}KB`),
    longtasks: window.__lt.filter((t) => t.s + t.d >= t0 && t.d >= 100).map((t) => `${Math.round(t.s - t0)}+${t.d}`),
    marks: performance.getEntriesByType('mark').filter((m) => m.name.startsWith('p2p:')).map((m) => `${m.name.replace('p2p:', '')}@${Math.round(m.startTime - t0)}`),
    frames: fr.length, mean: +(fr.reduce((a, b) => a + b, 0) / fr.length).toFixed(1), p95: +sorted[Math.floor(sorted.length * 0.95)].toFixed(1), over50: fr.filter((f) => f > 50).length, max: Math.round(Math.max(...fr)),
  };
}, [t0]);
console.log(JSON.stringify({ tapToOpenMs: Math.round(opened - t0), bytesBeforeTap: before.bytes, ...r }, null, 1));
await page.screenshot({ path: `shots/r4/play-phone.png` });
await browser.close();
await dev?.close();
