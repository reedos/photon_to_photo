// Score loop r5: measures the Optics inset's caption and legend against the inset frame and the viewport at phone sizes.
//   node tools/score-loop/r5-inset-measure.mjs   (own dev server on 47852, P2P_PORT to change; prints one row per viewport and exits 1 on overflow)
import { chromium } from 'playwright';
let dev = null;
if (!process.env.P2P_URL) {
  const { createServer } = await import('vite');
  dev = await createServer({ root: process.cwd(), logLevel: 'error', server: { host: '127.0.0.1', port: Number(process.env.P2P_PORT || 47852), strictPort: true, open: false } });
  await dev.listen();
}
const base = process.env.P2P_URL || `http://127.0.0.1:${process.env.P2P_PORT || 47852}/`;
const SIZES = [[320, 640], [360, 740], [375, 812], [390, 844], [844, 390], [740, 360]];
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--hide-scrollbars'] });
let bad = 0;
try {
  for (const [w, h] of SIZES) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: 'dark', reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto(new URL('?piece=lens&lens=n50', base).href);
    await page.waitForFunction(() => window.p2p && document.querySelector('#veil')?.classList.contains('off'), null, { timeout: 90000 }).catch(() => {});
    await page.evaluate(() => window.p2p.settle()).catch(() => {});
    await page.waitForTimeout(1800);
    const r = await page.evaluate(() => {
      const out = {};
      const frame = document.querySelector('.inset-frame');
      if (!frame) return { error: 'no inset frame' };
      const fr = frame.getBoundingClientRect();
      out.frame = [fr.left, fr.right, fr.top, fr.bottom].map(Math.round);
      const cs = getComputedStyle(frame, '::after');
      const probe = document.createElement('span');
      probe.style.cssText = `position:absolute;visibility:hidden;white-space:nowrap;font:${cs.font};letter-spacing:${cs.letterSpacing};text-transform:${cs.textTransform}`;
      document.body.appendChild(probe);
      const label = frame.dataset.label || '';
      // the caption wraps at breakable spaces only; the widest unbreakable run is what must fit the frame's inner width
      const words = label.split(/ /);
      let widest = 0;
      for (const wd of words) { probe.textContent = wd; widest = Math.max(widest, probe.getBoundingClientRect().width); }
      probe.remove();
      out.caption = { text: label, widestRun: Math.round(widest), room: Math.round(fr.width - 16 - 2) };
      const note = document.querySelector('.lv-inset-note');
      if (note && !note.hidden) {
        const nr = note.getBoundingClientRect();
        const spans = [...note.querySelectorAll('span')].map((s) => s.getBoundingClientRect());
        out.note = { text: note.textContent, left: Math.round(nr.left), right: Math.round(nr.right), top: Math.round(nr.top), spanMaxRight: Math.round(Math.max(nr.right, ...spans.map((s) => s.right))), spanMinLeft: Math.round(Math.min(nr.left, ...spans.map((s) => s.left))), scrollW: note.scrollWidth, clientW: note.clientWidth };
      }
      out.vw = innerWidth;
      return out;
    });
    const noteOver = r.note ? (r.note.spanMaxRight > w - 8 || r.note.spanMinLeft < 0 || r.note.scrollW > r.note.clientW + 1) : false;
    const capOver = r.caption ? r.caption.widestRun > r.caption.room : false;
    if (noteOver || capOver || r.error) bad++;
    console.log(`${w}x${h}`, JSON.stringify(r), noteOver || capOver ? 'OVERFLOW' : 'fits');
    await ctx.close();
  }
} finally { await browser.close(); await dev?.close(); }
process.exit(bad ? 1 : 0);
