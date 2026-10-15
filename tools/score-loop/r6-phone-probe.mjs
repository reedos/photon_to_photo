// Score loop r6 (UX): how much of a phone screen the 3D view gets at each level, and what takes the rest.
//   P2P_URL=http://127.0.0.1:47804/ node tools/score-loop/r6-phone-probe.mjs before
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
const url = process.env.P2P_URL || 'http://127.0.0.1:47804/';
const [label = 'probe'] = process.argv.slice(2);
const out = 'docs/score-loop/r6-ux';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const results = {};
const sizes = (process.env.SIZES || '360x740,360x640,375x667,390x844,320x568,844x390').split(',').map((s) => s.split('x').map(Number));
const levels = (process.env.LEVELS || 'camera,lens,cone,loupe').split(',');
for (const [w, h] of sizes) {
  for (const level of levels) {
    const context = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce', isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const page = await context.newPage();
    await page.goto(`${url}?piece=${level}&lens=n50&focus=1.5&iso=400`);
    await page.waitForFunction(() => window.p2p && document.querySelector('#veil')?.classList.contains('off'), null, { timeout: 90000 });
    await page.evaluate(() => window.p2p.settle?.());
    await page.waitForTimeout(1500);
    const m = await page.evaluate(() => {
      const r = (sel) => { const e = document.querySelector(sel); if (!e || !e.checkVisibility?.()) return null; const b = e.getBoundingClientRect(); return b.height > 0 ? { t: Math.round(b.top), h: Math.round(b.height) } : null; };
      const sels = { topbar: '.topbar', views: '.workspace-views', kit: '.studio-kit', steps: '#steps', crumb: '.inspection-context', why: '#level-why', modelTools: '#model-tools', view: '#view', partNav: '.hud-btns-phone', playback: '.light-playback', experiments: '#model-experiments', sidebar: '.studio-sidebar' };
      const o = {}; for (const [k, s] of Object.entries(sels)) o[k] = r(s);
      const canvas = document.querySelector('#gl'); const cb = canvas?.getBoundingClientRect();
      return { vh: innerHeight, canvas: cb ? { t: Math.round(cb.top), h: Math.round(cb.height) } : null, rows: o };
    });
    results[`${w}x${h} ${level}`] = m;
    await page.screenshot({ path: `${out}/${label}-phone-${w}x${h}-${level}.png` });
    await context.close();
  }
}
await browser.close();
writeFileSync(`${out}/${label}-phone.json`, JSON.stringify(results, null, 1));
console.log(JSON.stringify(results));
