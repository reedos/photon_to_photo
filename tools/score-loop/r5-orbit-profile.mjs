// Score loop r5: where a phone orbit's main-thread time goes. A CPU profile of a 3 s drag at 4x CPU, as self time per function and
// inclusive time for the stage's own functions.
//   P2P_URL=http://127.0.0.1:47807/ node tools/score-loop/r5-orbit-profile.mjs [rate=4] [gl=]
import { chromium } from 'playwright';
const url = (process.env.P2P_URL || 'http://127.0.0.1:47807/').replace(/\/?$/, '/');
const rate = Number(process.argv[2] || 4);
const gl = process.argv[3] ? `&gl=${process.argv[3]}` : '';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
const page = await context.newPage();
page.setDefaultTimeout(120000);
await page.goto(url + '?piece=camera&lens=n50' + gl);
await page.waitForFunction(() => window.p2p?.pieces.camera.state().loaded && document.getElementById('veil').classList.contains('off'));
await page.evaluate(() => window.p2p.settle());
await page.locator('#view').scrollIntoViewIfNeeded();
await page.waitForTimeout(Number(process.env.WAIT || 3000));
const cdp = await context.newCDPSession(page);
await cdp.send('Performance.enable');
await cdp.send('Emulation.setCPUThrottlingRate', { rate });
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 300 });
const box = await page.locator('#gl').boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height * 0.45;
await page.evaluate(() => { window.__frames = []; let last = performance.now(); window.__run = true; const f = (t) => { window.__frames.push(t - last); last = t; if (window.__run) requestAnimationFrame(f); }; requestAnimationFrame(f); });
await page.mouse.move(cx, cy); await page.mouse.down();
await cdp.send('Profiler.start');
const task0 = (await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === 'TaskDuration').value;
const t0 = Date.now(); let i = 0;
while (Date.now() - t0 < 3000) { i++; await page.mouse.move(cx + Math.sin(i / 6) * box.width * 0.3, cy + Math.cos(i / 9) * 20, { steps: 1 }); }
const task1 = (await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === 'TaskDuration').value;
const { profile } = await cdp.send('Profiler.stop');
await page.mouse.up();
const frames = await page.evaluate(() => { window.__run = false; return window.__frames.slice(2); });
console.log('renderer', JSON.stringify(await page.evaluate(() => window.p2p.pipelineStats())));
console.log(`frames ${frames.length}, task ms per frame ${((task1 - task0) * 1000 / frames.length).toFixed(1)}, mean frame ${(frames.reduce((a, b) => a + b, 0) / frames.length).toFixed(1)} ms`);
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const self = new Map();
profile.samples.forEach((id, k) => self.set(id, (self.get(id) ?? 0) + (profile.timeDeltas[k] ?? 0)));
const flat = new Map();
for (const [id, t] of self) {
  const n = byId.get(id); const key = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber}`;
  flat.set(key, (flat.get(key) ?? 0) + t);
}
const total = [...flat.values()].reduce((a, b) => a + b, 0);
console.log('self time, % of the profile:');
for (const [k, t] of [...flat].sort((a, b) => b[1] - a[1]).slice(0, 28)) console.log(String((100 * t / total).toFixed(1)).padStart(6), '%', String(Math.round(t / 1000)).padStart(6), 'ms', k);
await browser.close();
