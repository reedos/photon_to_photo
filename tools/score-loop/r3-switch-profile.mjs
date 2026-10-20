// Score loop r3 (visual): a CPU profile of the first switch from the camera to one level, summarized by self time and
// by the app's own call frames, to see whether a first-switch stall is JavaScript (a piece's update) or the renderer.
//   node tools/score-loop/r3-switch-profile.mjs lens
import { chromium } from 'playwright';
const target = process.argv[2] || 'lens';
const { createServer } = await import('vite');
const dev = await createServer({ root: process.cwd(), logLevel: 'error', server: { host: '127.0.0.1', port: 47819, strictPort: true, open: false } });
await dev.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--hide-scrollbars'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto('http://127.0.0.1:47819/?piece=camera&lens=n50');
  await page.waitForFunction(() => window.p2p && document.querySelector('#veil')?.classList.contains('off'), null, { timeout: 90000 });
  await page.evaluate(() => window.p2p.pieces.camera.ready());
  await page.waitForTimeout(5000);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  await cdp.send('Profiler.start');
  if (process.env.VIA) { await page.evaluate((id) => window.p2p.piece(id), process.env.VIA); await page.waitForTimeout(4000); }
  await page.evaluate((id) => window.p2p.piece(id), target);
  await page.waitForTimeout(3000);
  const { profile } = await cdp.send('Profiler.stop');
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const dt = new Map();
  profile.samples.forEach((s, i) => dt.set(s, (dt.get(s) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000));
  const self = new Map(), incl = new Map();
  const name = (n) => `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').slice(-2).join('/')}:${n.callFrame.lineNumber + 1}`;
  for (const [id, ms] of dt) {
    const n = byId.get(id);
    self.set(name(n), (self.get(name(n)) ?? 0) + ms);
    const seen = new Set();
    for (let k = id; k !== undefined; k = parent.get(k)) { const nm = name(byId.get(k)); if (seen.has(nm)) continue; seen.add(nm); incl.set(nm, (incl.get(nm) ?? 0) + ms); }
  }
  const top = (m, f = () => true) => [...m].filter(([k]) => f(k)).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `${v.toFixed(0).padStart(6)} ms  ${k}`).join('\n');
  console.log('SELF\n' + top(self));
  console.log('\nINCLUSIVE (app src)\n' + top(incl, (k) => /src\//.test(k)));
} finally { await browser.close(); await dev.close(); }
