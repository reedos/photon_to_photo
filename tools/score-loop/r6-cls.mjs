// Score loop r6: layout shifts while a page loads (CLS, with the elements that moved).
//   P2P_URL=http://127.0.0.1:47831/ node tools/score-loop/r6-cls.mjs [models.html] [rate=4] [width=390] [height=844]
import { chromium } from 'playwright';
const base = (process.env.P2P_URL || 'http://127.0.0.1:47831/').replace(/\/?$/, '/');
const path = process.argv[2] || 'models.html', rate = Number(process.argv[3] || 4), width = Number(process.argv[4] || 390), height = Number(process.argv[5] || 844);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const phone = width < 700;
const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: phone ? 2 : 1, isMobile: phone, hasTouch: phone, reducedMotion: 'reduce' });
const page = await context.newPage();
page.setDefaultTimeout(120000);
await page.addInitScript(() => {
  window.__ls = [];
  new PerformanceObserver((l) => window.__ls.push(...l.getEntries().map((e) => ({ t: Math.round(e.startTime), v: +e.value.toFixed(4), input: e.hadRecentInput,
    src: (e.sources ?? []).map((s) => `${s.node?.nodeName?.toLowerCase() ?? '?'}${s.node?.id ? '#' + s.node.id : ''}${s.node?.className && typeof s.node.className === 'string' ? '.' + s.node.className.split(' ')[0] : ''} ${Math.round(s.previousRect.y)}->${Math.round(s.currentRect.y)} h ${Math.round(s.previousRect.height)}->${Math.round(s.currentRect.height)}`) })))).observe({ type: 'layout-shift', buffered: true });
});
const cdp = await context.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate });
await page.goto(base + path);
await page.waitForFunction(() => document.getElementById('veil')?.classList.contains('off'), null, { timeout: 120000 }).catch(() => {});
await page.waitForTimeout(4000);
const ls = await page.evaluate(() => window.__ls.filter((e) => !e.input));
console.log(JSON.stringify({ path, rate, width, cls: +ls.reduce((a, e) => a + e.v, 0).toFixed(4), shifts: ls }, null, 1));
await browser.close();
