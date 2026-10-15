// Presentation review captures (docs/review-loop-2026-10-10/presentation.md): every body+lens in the main app's
// camera level, outside / cutaway / selected parts, at desktop 1440x900 and phone 390x844, plus a measured frame
// time per tier. Needs a running dev server (npx vite --port 47640).
//   node tools/presentation-shots.mjs <outDir> [baseUrl=http://127.0.0.1:47640] [lens,lens...] [view,view...]
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const out = process.argv[2] || 'shots/presentation/run';
const base = process.argv[3] || 'http://127.0.0.1:47640';
const LENSES = (process.argv[4] || 's35,n50,n500,n500fl,z35,m50,z800').split(',');
const ALL_VIEWS = [
  ['outside', null, 'outside'],
  ['cutaway', null, 'cutaway'],
  ['mount', 'mount', 'outside'],
  ['glass', 'glass', 'outside'],
  ['focus', 'focusRing', 'outside'],
  ['sensor', 'sensor', 'outside'],
];
const pick = process.argv[5] ? process.argv[5].split(',') : null;
const VIEWS = pick ? ALL_VIEWS.filter(([n]) => pick.includes(n)) : ALL_VIEWS;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome',
  args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--hide-scrollbars'] });
const report = { base, when: new Date().toISOString(), frames: {}, info: {}, errors: {} };
// P2P_SHOT_STRESS=1: one 2560x1440 at 2x context only, so the GPU, not the display's refresh, bounds the frame
const TIERS = process.env.P2P_SHOT_STRESS ? [['stress', { viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 2 }]] : [
  ['desktop', { viewport: { width: 1440, height: 900 } }],
  ['phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }],
];
for (const [tier, opts] of TIERS) {
  const ctx = await browser.newContext({ ...opts, colorScheme: 'dark', reducedMotion: 'reduce' });
  await ctx.addInitScript(() => { try { sessionStorage.setItem('p2p.entered', '1'); } catch { /* optional */ } });
  for (const lens of LENSES) {
    for (const [name, part, view] of VIEWS) {
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      const q = `?piece=camera&lens=${lens}${part ? `&part=${part}` : ''}`;
      await page.goto(`${base}/${q}`, { waitUntil: 'load' });
      await page.waitForFunction(() => Boolean(window.p2p), null, { timeout: 30000 });
      await page.evaluate(() => window.p2p.pieces.camera.ready());
      if (view === 'cutaway') await page.evaluate(() => window.p2p.pieces.camera.setView('cutaway'));
      await page.evaluate(() => window.p2p.settle());
      await page.waitForTimeout(2200); // dives and fades finish
      await page.evaluate(() => window.p2p.gpuIdle());
      await page.waitForTimeout(200);
      const file = `${out}/${tier}-${lens}-${name}.png`;
      await page.screenshot({ path: file });
      {
        report.frames[`${tier}-${lens}-${name}`] = await page.evaluate(() => new Promise((res) => {
          const t = []; let last = performance.now(); const end = last + 2500;
          const step = (now) => {
            t.push(now - last); last = now;
            if (now < end) { requestAnimationFrame(step); return; }
            t.sort((a, b) => a - b);
            res({ n: t.length, median: +t[t.length >> 1].toFixed(2), p95: +t[Math.floor(t.length * 0.95)].toFixed(2) });
          };
          requestAnimationFrame(step);
        }));
        if (name === 'outside') report.info[`${tier}-${lens}`] = await page.evaluate(() => {
          const c = document.querySelector('#gl');
          return { backend: window.p2p.backend(), canvas: [c.width, c.height], css: [c.clientWidth, c.clientHeight], dpr: devicePixelRatio };
        });
      }
      if (errors.length) report.errors[`${tier}-${lens}-${name}`] = errors;
      console.log('saved', file, errors.length ? `errors ${errors.length}` : '');
      await page.close();
    }
  }
  await ctx.close();
}
await browser.close();
writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.frames));
console.log(JSON.stringify(report.info));
console.log('errors', JSON.stringify(report.errors));
