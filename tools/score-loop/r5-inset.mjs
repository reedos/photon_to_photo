// Score loop r5 (teaching): the Optics inset's caption and legend at phone widths. For each size: the inset frame's rectangle,
// the caption pseudo-element's text and how far it runs past the frame, every legend span's right edge against the view's,
// and a screenshot. Exit code 1 when any legend span or the caption leaves the view.
//   P2P_URL=http://127.0.0.1:47803/ node tools/score-loop/r5-inset.mjs shots/r5-teaching/after
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const url = process.env.P2P_URL || 'http://127.0.0.1:47803/';
const out = process.argv[2] || 'shots/r5-teaching/inset';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const result = {};
let bad = 0;
try {
  for (const [w, h] of [[320, 640], [360, 740], [390, 844], [430, 932], [844, 390]]) {
    const phone = true;
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, reducedMotion: 'reduce', isMobile: phone, hasTouch: phone });
    await page.goto(new URL('?piece=lens', url).href);
    await page.waitForFunction(() => window.p2p?.pieces?.lens, null, { timeout: 90000 });
    await page.evaluate(() => window.p2p.pieces.lens.ready?.());
    await page.waitForTimeout(3000);
    const r = await page.evaluate(() => {
      const view = document.querySelector('.view')?.getBoundingClientRect();
      const frame = document.querySelector('.inset-frame');
      const fr = frame?.getBoundingClientRect();
      const label = frame?.dataset.label;
      // measure the caption (::after) by cloning its text into a probe with the same computed style
      let caption = null;
      if (frame) {
        const cs = getComputedStyle(frame, '::after');
        const probe = document.createElement('span');
        probe.textContent = label; probe.style.cssText = `position:fixed;left:-9999px;top:0;white-space:nowrap;font:${cs.font};letter-spacing:${cs.letterSpacing};text-transform:${cs.textTransform}`;
        document.body.append(probe);
        const pr = probe.getBoundingClientRect();
        // the caption starts 8 px inside the frame; it wraps at spaces inside the frame's width, so its widest line is the
        // whole text unless it has a break: the widest unbreakable run is what can leave the frame
        const runs = label.split(/ /).map((t) => { probe.textContent = t; return probe.getBoundingClientRect().width; });
        const widest = Math.max(...runs);
        caption = { text: label, fontSize: cs.fontSize, whole: Math.round(pr.width), widestRun: Math.round(widest), right: Math.round(fr.left + 8 + widest), frameRight: Math.round(fr.right) };
        probe.remove();
      }
      const note = document.querySelector('.piece-overlay[data-piece="lens"] .lv-inset-note');
      const spans = [...(note?.querySelectorAll('span') ?? [])].map((s) => { const q = s.getBoundingClientRect(); return { text: s.textContent, left: Math.round(q.left), right: Math.round(q.right), top: Math.round(q.top) }; });
      const nr = note?.getBoundingClientRect();
      return { view: view && { left: Math.round(view.left), right: Math.round(view.right), width: Math.round(view.width) }, frame: fr && { left: Math.round(fr.left), right: Math.round(fr.right), top: Math.round(fr.top), bottom: Math.round(fr.bottom), width: Math.round(fr.width) },
        caption, legend: note?.textContent, legendBox: nr && { left: Math.round(nr.left), right: Math.round(nr.right), top: Math.round(nr.top), bottom: Math.round(nr.bottom) }, spans, vw: innerWidth };
    });
    const overs = [...r.spans.filter((s) => s.right > r.vw - 4 || s.left < 0), ...(r.legendBox && (r.legendBox.right > r.vw - 4 || r.legendBox.left < 0) ? [r.legendBox] : [])];
    r.overflow = overs.length;
    if (r.caption && (r.caption.right > r.vw - 4 || r.caption.right > r.caption.frameRight)) { r.captionTall = true; bad++; }
    if (overs.length) bad++;
    result[`${w}x${h}`] = r;
    await page.screenshot({ path: join(out, `inset-${w}x${h}.png`) });
    await page.close();
  }
} finally { await browser.close(); }
writeFileSync(join(out, 'inset.json'), JSON.stringify(result, null, 1));
for (const [k, v] of Object.entries(result)) console.log(k, 'vw', v.vw, 'frame', JSON.stringify(v.frame), 'caption', JSON.stringify(v.caption), 'legend', JSON.stringify(v.legend), 'legendBox', JSON.stringify(v.legendBox), 'overflow', v.overflow, v.captionTall ? 'CAPTION TALL' : '');
process.exit(bad ? 1 : 0);
