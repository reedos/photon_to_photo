// Score loop r5: every inset's caption and legend sits inside its frame and inside the view, on the phone sizes the
// reviewers measured (320, 360, 390 and 430 px wide, a phone on its side at 740x360 and 844x390) and on a desktop.
// The Optics caption carries the magnification, the inset's scale statement, so a clipped "690×" is a failure.
//   node tools/test-inset-labels.mjs            (P2P_URL to use a running server)
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { gateServer } from './preview.mjs';

const SIZES = [[320, 568], [360, 780], [390, 844], [430, 932], [740, 360], [844, 390], [1440, 900]];
const server = await gateServer();
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const failures = [];
try {
  for (const [w, h] of SIZES) {
    const phone = w < 760 || h < 500;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: 'reduce', isMobile: phone, hasTouch: phone });
    const page = await ctx.newPage();
    for (const level of ['lens', 'cone', 'loupe']) {
      await page.goto(new URL(`?piece=${level}&lens=n50`, server.url).href);
      await page.waitForFunction(() => window.p2p && document.querySelector('#veil')?.classList.contains('off'), null, { timeout: 90000 });
      await page.evaluate(() => window.p2p.settle());
      await page.waitForTimeout(level === 'loupe' ? 2500 : 1200);
      const found = await page.evaluate(() => {
        const vw = innerWidth, vh = innerHeight;
        const box = (el) => { const rg = document.createRange(); rg.selectNodeContents(el); const q = [...rg.getClientRects()].filter((x) => x.width > 0); return q.length ? { l: Math.min(...q.map((x) => x.left)), r: Math.max(...q.map((x) => x.right)), t: Math.min(...q.map((x) => x.top)), b: Math.max(...q.map((x) => x.bottom)) } : null; };
        const out = [];
        for (const f of document.querySelectorAll('.inset-frame')) {
          if (!f.checkVisibility() || f.getBoundingClientRect().width < 2) continue;
          const fr = f.getBoundingClientRect(), lab = f.querySelector('.inset-label');
          const b = lab && box(lab);
          out.push({ what: 'caption', text: f.dataset.label, frame: { l: fr.left, r: fr.right, t: fr.top, b: fr.bottom }, text_: b, vw, vh });
        }
        for (const n of document.querySelectorAll('.piece-overlay:not([hidden]) .lv-inset-note')) {
          if (!n.checkVisibility()) continue;
          const g = n.parentElement.getBoundingClientRect(), b = box(n);
          out.push({ what: 'note', text: n.textContent, frame: { l: g.left, r: g.right, t: g.top, b: g.bottom }, text_: b, vw, vh });
        }
        return out;
      });
      for (const e of found) {
        const where = `${w}x${h} ${level} ${e.what} "${(e.text ?? '').slice(0, 40)}"`;
        if (!e.text_) { failures.push(`${where}: no measurable text`); continue; }
        const t = e.text_;
        if (t.r > e.vw + 0.5 || t.l < -0.5) failures.push(`${where}: text ${Math.round(t.l)}-${Math.round(t.r)} leaves the ${e.vw} px view`);
        if (e.what === 'caption') {
          if (t.r > e.frame.r - 8 + 0.5) failures.push(`${where}: text ends ${Math.round(t.r)} past the frame's inner edge ${Math.round(e.frame.r - 8)}`);
          if (t.l < e.frame.l - 0.5) failures.push(`${where}: text starts left of the frame`);
          if (level === 'lens' && !/\d[\d,.]*×/.test(e.text)) failures.push(`${where}: the magnification is missing`);
          if (t.b > e.frame.b) failures.push(`${where}: text runs below the frame`);
        } else if (t.r > e.frame.r + 0.5) failures.push(`${where}: legend runs ${Math.round(t.r - e.frame.r)} px past the inset's right edge`);
      }
    }
    await ctx.close();
  }
} finally { await browser.close(); await server.close(); }
if (failures.length) { console.error(`test-inset-labels: FAIL\n  ${failures.join('\n  ')}`); process.exit(1); }
console.log('test-inset-labels: PASS (captions and legends inside their frames and the view at 320, 360, 390, 430, 740x360, 844x390 and 1440)');
