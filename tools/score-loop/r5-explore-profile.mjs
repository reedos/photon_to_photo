// Score loop r5: where the time goes from tapping Explore on the opening to a usable camera, on a 4x phone with the opening's warm-up done.
// A CPU profile of that stretch, as inclusive time for the first few levels of the call tree, and the timeline of the start's performance marks.
//   P2P_URL=http://127.0.0.1:47807/ MIN_MS=120 node tools/score-loop/r5-explore-profile.mjs [rate=4]
import { chromium } from 'playwright';
const url = (process.env.P2P_URL || 'http://127.0.0.1:47807/').replace(/\/?$/, '/');
const rate = Number(process.argv[2] || 4);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
const page = await context.newPage();
page.setDefaultTimeout(120000);
await page.goto(url);
await page.locator('#opening-explore').waitFor({ state: 'visible' });
await page.mouse.move(120, 300);
await page.waitForTimeout(Number(process.env.WAIT || 7000));
const cdp = await context.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate });
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
await cdp.send('Profiler.start');
const t0 = await page.evaluate(() => performance.now());
await page.locator('#opening-explore').tap();
await page.waitForFunction(() => window.p2p?.pieces.camera.state().loaded && document.getElementById('veil').classList.contains('off'));
const usable = Math.round(await page.evaluate((t0) => performance.now() - t0, t0));
const { profile } = await cdp.send('Profiler.stop');
const marks = await page.evaluate((t0) => performance.getEntriesByType('mark').filter((m) => m.startTime >= t0 - 5).map((m) => `${m.name.replace('p2p:', '')}@${Math.round(m.startTime - t0)}`), t0);
console.log('usable after', usable, 'ms; marks:', marks.join('  '));
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map();
profile.samples.forEach((id, k) => self.set(id, (self.get(id) ?? 0) + (profile.timeDeltas[k] ?? 0)));
const total = new Map();
const sum = (id) => { const n = byId.get(id); let t = self.get(id) ?? 0; for (const c of n.children ?? []) t += sum(c); total.set(id, t); return t; };
sum(profile.nodes[0].id);
const min = Number(process.env.MIN_MS || 120) * 1000;
const show = (id, depth) => {
  const n = byId.get(id);
  const kids = (n.children ?? []).filter((c) => total.get(c) >= min).sort((a, b) => total.get(b) - total.get(a));
  const only = depth > 0 && kids.length === 1 && (total.get(id) - total.get(kids[0])) < min / 2;
  if (!only) console.log(' '.repeat(Math.min(depth, 30)) + String(Math.round(total.get(id) / 1000)).padStart(5) + ' ' + (n.callFrame.functionName || '(anon)') + ' ' + n.callFrame.url.split('/').pop() + ':' + n.callFrame.lineNumber);
  for (const c of kids) show(c, only ? depth : depth + 1);
};
show(profile.nodes[0].id, 0);
await browser.close();
