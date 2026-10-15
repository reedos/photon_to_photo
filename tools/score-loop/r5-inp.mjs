// Score loop r5: tap-to-next-paint (the interaction's own duration, as INP counts it) for each level tab on a 4x phone, how long
// the view stays veiled, the main-thread time until it lifts, and how many node builds and pipelines the entry added.
// Event Timing's `duration` runs from the input to the next paint after the handlers.
//   P2P_URL=http://127.0.0.1:47806/ node tools/score-loop/r5-inp.mjs [rate=4] [camera-wait-ms=4000]
//   IDLE=1   waits for the idle precompile (the p2p:prewarmed-* marks) before the first tap
//   EXTRA="&gl=webgl2"   appended to the page's query
import { chromium } from 'playwright';
const url = (process.env.P2P_URL || 'http://127.0.0.1:47806/').replace(/\/?$/, '/');
const rate = Number(process.argv[2] || 4);
const wait = Number(process.argv[3] || 4000);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
const page = await context.newPage();
page.setDefaultTimeout(120000);
await page.addInitScript(() => {
  window.__ev = []; window.__lt = [];
  new PerformanceObserver((l) => window.__ev.push(...l.getEntries().filter((e) => e.interactionId || e.name === 'click').map((e) => ({ n: e.name, s: Math.round(e.startTime), d: e.duration, delay: Math.round(e.processingStart - e.startTime), proc: Math.round(e.processingEnd - e.processingStart) })))).observe({ type: 'event', durationThreshold: 16, buffered: true });
  new PerformanceObserver((l) => window.__lt.push(...l.getEntries().map((e) => ({ s: Math.round(e.startTime), d: Math.round(e.duration) })))).observe({ type: 'longtask', buffered: true });
});
page.on('console', (m) => { if (m.type() === 'warning' || m.type() === 'error') console.log('console', m.type(), m.text().slice(0, 200)); });
await page.goto(url + '?piece=camera&lens=n50' + (process.env.EXTRA || ''));
await page.waitForFunction(() => window.p2p?.pieces.camera.state().loaded && document.getElementById('veil').classList.contains('off'));
await page.evaluate(() => window.p2p.settle());
await page.waitForTimeout(wait);
if (process.env.IDLE) await page.waitForFunction(() => performance.getEntriesByName('p2p:prewarmed-loupe').length > 0, null, { timeout: 120000 }).catch(() => console.log('the idle precompile did not finish'));
console.log('idle marks', JSON.stringify(await page.evaluate(() => performance.getEntriesByType('mark').filter((m) => /prewarm/.test(m.name)).map((m) => `${m.name.slice(4)}@${Math.round(m.startTime)}`))));
const cdp = await context.newCDPSession(page);
await cdp.send('Performance.enable');
await cdp.send('Emulation.setCPUThrottlingRate', { rate });
const metric = async (name) => (await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === name).value;
const stats = () => page.evaluate(() => { const s = window.p2p.pipelineStats?.(); return s ? [s.builders, s.pipelines] : [0, 0]; });
for (const piece of ['cone', 'lens', 'loupe', 'camera', 'cone', 'lens']) {
  await page.evaluate(() => { window.__ev.length = 0; window.__lt.length = 0; });
  const before = await stats();
  const t0 = await page.evaluate(() => performance.now());
  const task0 = await metric('TaskDuration'), script0 = await metric('ScriptDuration');
  await page.locator(`.step[data-piece="${piece}"]`).first().tap();
  await page.waitForFunction(() => document.getElementById('veil').classList.contains('off') && !document.getElementById('veil').classList.contains('err'), null, { timeout: 60000 }).catch(() => {});
  const veilMs = Math.round(await page.evaluate((t0) => performance.now() - t0, t0));
  const taskMs = Math.round(((await metric('TaskDuration')) - task0) * 1000), scriptMs = Math.round(((await metric('ScriptDuration')) - script0) * 1000);
  await page.waitForTimeout(1500);
  const r = await page.evaluate((t0) => ({
    interaction: window.__ev.filter((e) => e.s >= t0 - 5 && e.d > 16).map((e) => `${e.n}:${Math.round(e.d)}ms`),
    longest: Math.max(0, ...window.__lt.filter((t) => t.s >= t0 - 5).map((t) => t.d)),
    marks: performance.getEntriesByType('mark').filter((m) => m.startTime >= t0 - 5 && /^p2p:(build|built|warm|warmed|compile|compiled)-/.test(m.name)).map((m) => `${m.name.slice(4)}@${Math.round(m.startTime - t0)}`),
  }), t0);
  const after = await stats();
  console.log(JSON.stringify({ piece, veilOffMs: veilMs, taskMsUntilVeilOff: taskMs, scriptMs, ...r, addedBuildersAndPipelines: after.map((v, i) => v - before[i]) }));
}
await browser.close();
