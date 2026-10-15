// Score loop round 1, visual category: before/after captures of the views the reviewers cited, plus the
// measurements that close each issue (canvas size, hotspot rings, text under the type floor, the photon note).
//   P2P_URL=http://127.0.0.1:47802/ OUT=docs/score-loop/r1-visual/before node tools/score-loop/visual-capture.mjs [filter]
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

// without P2P_URL a fresh dev server starts on 47802 (vite ignores file changes under .claude/, so a long-lived one
// in a worktree serves stale modules)
let dev = null;
if (!process.env.P2P_URL) {
  const { createServer } = await import('vite');
  dev = await createServer({ root: process.cwd(), logLevel: 'warn', server: { host: '127.0.0.1', port: 47802, strictPort: true, open: false } });
  await dev.listen();
}
const base = process.env.P2P_URL || 'http://127.0.0.1:47802/';
const OUT = process.env.OUT || 'shots/score-loop';
const filter = process.argv[2] || '';
mkdirSync(OUT, { recursive: true });
const report = {};

const VIEWS = [
  // name, viewport, query, setup
  ['desk-camera', 'desk', 'piece=camera&lens=n50', null],
  ['desk-dslr-cut', 'desk', 'piece=camera&lens=n50', 'cutaway'],
  ['desk-n500', 'desk', 'piece=camera&lens=n500', null],
  ['desk-z800', 'desk', 'piece=camera&lens=z800', null],
  ['desk-m50', 'desk', 'piece=camera&lens=m50', null],
  ['desk-lens', 'desk', 'piece=lens&lens=n50', null],
  ['desk-loupe', 'desk', 'piece=loupe&lens=n50', null],
  ['phone-camera', 'phone', 'piece=camera&lens=n50', null],
  ['phone-lens', 'phone', 'piece=lens&lens=n50', null],
  ['phone-loupe', 'phone', 'piece=loupe&lens=n50', null],
  ['land-camera', 'land', 'piece=camera&lens=n50', null],
  ['land-lens', 'land', 'piece=lens&lens=n50', null],
  ['land-loupe', 'land', 'piece=loupe&lens=n50', null],
  ['desk-cone', 'desk', 'piece=cone&lens=n50', null],
  ['mid-camera', 'mid', 'piece=camera&lens=n50', null],
  ['small-lens', 'small', 'piece=lens&lens=n50', null],
  ['phone-cone', 'phone', 'piece=cone&lens=n50', null],
  ['land-cone', 'land', 'piece=cone&lens=n50', null],
  // round 2
  ['desk-n500-cut', 'desk', 'piece=camera&lens=n500', 'cutaway'],
  ['desk-z35-cut', 'desk', 'piece=camera&lens=z35', 'cutaway'],
  ['desk-lens-n500', 'desk', 'piece=lens&lens=n500', null],
  ['desk-loupe-orbit', 'desk', 'piece=loupe&lens=n50', 'orbit'],
].filter(([n]) => !filter || filter.split(',').some((f) => n === f || n.includes(f)));

const CTX = {
  desk: { viewport: { width: 1440, height: 900 } },
  mid: { viewport: { width: 1280, height: 800 } },
  small: { viewport: { width: 1024, height: 768 } },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  land: { viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--hide-scrollbars'] });
try {
  for (const [name, kind, query, setup] of VIEWS) {
    const ctx = await browser.newContext({ ...CTX[kind], colorScheme: 'dark', reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(new URL(`?${query}`, base).href);
    await page.waitForFunction(() => window.p2p && document.querySelector('#veil')?.classList.contains('off'), null, { timeout: 90000 }).catch(() => {});
    await page.evaluate(() => window.p2p.settle()).catch(() => {});
    if (setup === 'cutaway') await page.evaluate(() => window.p2p.pieces.camera.setView('cutaway'));
    if (setup === 'orbit') {
      const b = await page.locator('#gl').boundingBox();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2 + 70, b.y + b.height / 2, { steps: 12 });
      await page.mouse.up();
    }
    await page.evaluate(() => window.p2p.settle()).catch(() => {});
    await page.waitForFunction(() => !window.p2p.framing?.().moving, null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(query.includes('loupe') ? 5000 : 2000);
    await page.screenshot({ path: `${OUT}/${name}.png` });
    const info = await page.evaluate(() => {
      const gl = document.querySelector('#gl');
      const r = gl?.getBoundingClientRect();
      const small = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const t = n.textContent.trim();
        if (!t) continue;
        const el = n.parentElement;
        if (!el || el.closest('[hidden],[aria-hidden="true"]') || el.closest('svg')) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
        const b = el.getBoundingClientRect();
        if (!b.width || !b.height || b.bottom < 0 || b.top > innerHeight || b.right < 0 || b.left > innerWidth) continue;
        const fs = parseFloat(cs.fontSize);
        if (fs > 0 && fs < 10.5) small.push(`${fs}px ${el.tagName.toLowerCase()}.${el.className} ${t.slice(0, 40)}`);
      }
      const rings = [...document.querySelectorAll('.rig-teach')].filter((e) => e.style.display !== 'none').map((e) => {
        const i = e.querySelector('i').getBoundingClientRect();
        return { text: e.querySelector('span')?.textContent, ring: [Math.round(i.left), Math.round(i.top), Math.round(i.right), Math.round(i.bottom)] };
      });
      const note = [...document.querySelectorAll('body *')].find((e) => /not individual/i.test(e.textContent || '') && [...e.children].every((c) => c.tagName === 'BR'));
      const nb = note?.getBoundingClientRect();
      const box = (el) => { const b = el?.getBoundingClientRect(); return b && b.width ? [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)] : null; };
      const share = [...document.querySelectorAll('button,a')].find((e) => /share this view/i.test(e.textContent || '') && e.getBoundingClientRect().width);
      const hintEl = [...document.querySelectorAll('body *')].find((e) => /drag to orbit/i.test(e.textContent || '') && !e.children.length && e.getBoundingClientRect().width);
      const overlap = (a, c) => a && c ? Math.max(0, Math.min(a[2], c[2]) - Math.max(a[0], c[0])) * (Math.min(a[3], c[3]) > Math.max(a[1], c[1]) ? 1 : 0) : 0;
      const hint = { share: box(share), hint: box(hintEl), clipped: hintEl ? hintEl.scrollWidth > hintEl.clientWidth + 1 : null };
      hint.overlapPx = overlap(hint.share, hint.hint);
      const noteEl = document.querySelector('.lv-inset-note-wrap');
      const inset = { note: box(noteEl), canvasTop: r ? Math.round(r.top) : null };
      return { hint, inset, canvas: r ? [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] : null,
        small: [...new Set(small)], rings,
        photonNote: note ? { visible: !!(nb && nb.width), size: getComputedStyle(note).fontSize, text: note.textContent.trim().slice(0, 80) } : null };
    });
    report[name] = { ...info, errors: errors.slice(0, 5) };
    console.log(name, JSON.stringify({ hint: info.hint, inset: info.inset, canvas: info.canvas, smallCount: info.small.length, rings: info.rings, note: info.photonNote, errors: errors.length }));
    await ctx.close();
  }
} finally { await browser.close(); await dev?.close(); }
writeFileSync(`${OUT}/report${filter ? '-' + filter.replace(/[^a-z0-9]+/gi, '_') : ''}.json`, JSON.stringify(report, null, 1));
