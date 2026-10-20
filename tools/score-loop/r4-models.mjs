// Score loop r4: the Models page on a 4x phone: long tasks and the page's own marks, against a production build.
//   P2P_URL=http://127.0.0.1:47807/ node tools/score-loop/r4-models.mjs [page=models.html] [rate=4] [gl=]
import { chromium } from 'playwright';
const url = process.env.P2P_URL || 'http://127.0.0.1:47807/';
const page0 = process.argv[2] || 'models.html';
const rate = Number(process.argv[3] || 4);
const gl = process.argv[4] ? `${page0.includes('?') ? '&' : '?'}gl=${process.argv[4]}` : '';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
const page = await context.newPage();
page.setDefaultTimeout(120000);
await page.addInitScript(() => {
  window.__lt = [];
  new PerformanceObserver((l) => window.__lt.push(...l.getEntries().map((e) => ({ s: Math.round(e.startTime), d: Math.round(e.duration) })))).observe({ type: 'longtask', buffered: true });
  const f = () => { if (!window.__veilOff && document.getElementById('veil')?.classList.contains('off')) window.__veilOff = Math.round(performance.now()); else requestAnimationFrame(f); };
  requestAnimationFrame(f);
});
await (await context.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate });
await page.goto(url + page0 + gl);
await page.waitForFunction(() => window.__veilOff, null, { timeout: 120000 });
await page.waitForTimeout(3000);
const r = await page.evaluate(() => ({
  veilOff: window.__veilOff,
  marks: performance.getEntriesByType('mark').filter((m) => m.name.startsWith('p2p:')).map((m) => `${m.name.replace('p2p:', '')}@${Math.round(m.startTime)}`),
  tasks: window.__lt.filter((t) => t.d >= 100).map((t) => `${t.s}+${t.d}`),
  longest: Math.max(0, ...window.__lt.map((t) => t.d)),
  cls: 0,
}));
console.log(page0, 'rate', rate, JSON.stringify(r));
await browser.close();
