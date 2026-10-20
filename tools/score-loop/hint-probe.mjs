// Score loop r2: the gesture hint vs. the equipment row (Share this view) at several desktop widths.
//   node tools/score-loop/hint-probe.mjs   (starts its own dev server on 47802)
import { chromium } from 'playwright';
const { createServer } = await import('vite');
const dev = await createServer({ root: process.cwd(), logLevel: 'error', server: { host: '127.0.0.1', port: 47802, strictPort: true } });
await dev.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let bad = 0;
try {
  for (const [w, h] of [[1366, 768], [1440, 900], [1600, 900], [1920, 1080], [1280, 800]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, reducedMotion: 'reduce' });
    await page.goto('http://127.0.0.1:47802/?piece=camera&lens=n50');
    await page.waitForFunction(() => document.querySelector('#veil')?.classList.contains('off'), null, { timeout: 90000 }).catch(() => {});
    const r = await page.evaluate(() => {
      const box = (el) => { const b = el?.getBoundingClientRect(); return b && b.width ? [Math.round(b.left), Math.round(b.right)] : null; };
      const kit = document.querySelector('.studio-kit');
      const span = document.querySelector('.workspace-views > span');
      return { share: box(document.getElementById('share-btn')), hint: box(span), hintText: span?.textContent, hintTruncated: span ? span.scrollWidth > span.clientWidth + 1 : null,
        expand: box(document.getElementById('expand-model')), kit: box(kit), kitOverflow: kit.scrollWidth > kit.clientWidth + 1 };
    });
    const ov = (a, b) => (a && b ? Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0])) : 0);
    const overlap = ov(r.share, r.hint), overlapExpand = ov(r.expand, r.hint);
    if (overlap || overlapExpand || r.kitOverflow) bad++;
    console.log(`${w}x${h}`, JSON.stringify({ ...r, overlap, overlapExpand }));
    if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}/hint-${w}.png`, clip: { x: Math.max(0, w - 640), y: 48, width: 640, height: 48 } });
    await page.close();
  }
} finally { await browser.close(); await dev.close(); }
console.log(bad ? `FAIL ${bad} widths` : 'PASS no overlap');
process.exit(bad ? 1 : 0);
