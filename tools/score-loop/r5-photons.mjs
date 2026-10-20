// Score loop r5 (teaching): the Pixel level's "Play photons" button against the bottom dock on a phone (the review found an 8 px
// overlap at 390x844). Measures the button's and the dock's rectangles at several phone sizes, at the Pixel level and on the
// guided tour's Pixel stop. Exit code 1 when the button overlaps the dock.
//   P2P_URL=http://127.0.0.1:47803/ node tools/score-loop/r5-photons.mjs shots/r5-teaching/after
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const url = process.env.P2P_URL || 'http://127.0.0.1:47803/';
const out = process.argv[2] || 'shots/r5-teaching/photons';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
let bad = 0;
try {
  for (const [w, h] of [[390, 844], [360, 740], [375, 667], [430, 932], [320, 568]]) {
    for (const mode of ['level', 'tour']) {
      const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, reducedMotion: 'reduce', isMobile: true, hasTouch: true });
      await page.goto(new URL(mode === 'tour' ? '?tour=7' : '?piece=loupe', url).href);
      await page.waitForFunction(() => window.p2p?.pieces?.loupe, null, { timeout: 120000 });
      await page.evaluate(() => window.p2p.pieces.loupe.ready?.());
      await page.waitForTimeout(3500);
      const r = await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find((b) => /play photons/i.test(b.textContent || '') && b.getClientRects().length);
        const tabs = [...document.querySelectorAll('.studio-tabs')].filter((d) => d.getClientRects().length).map((d) => d.getBoundingClientRect().top);
        const viewer = document.getElementById('viewer')?.getBoundingClientRect();
        const b = btn?.getBoundingClientRect();
        return { btn: b && { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right) }, tabsTop: tabs.length ? Math.round(Math.min(...tabs)) : null, viewerBottom: viewer && Math.round(viewer.bottom), vh: innerHeight };
      });
      // "Play photons" sits wholly above the dock's tab row and inside the viewer (the viewer clips what runs past it)
      const clipped = r.btn && ((r.tabsTop !== null && r.btn.bottom > r.tabsTop + 0.5) || (r.viewerBottom && r.btn.bottom > r.viewerBottom + 0.5));
      if (!r.btn || clipped) bad++;
      console.log(`${w}x${h} ${mode}`, JSON.stringify(r), !r.btn ? 'BUTTON MISSING' : clipped ? 'OVERLAP' : 'ok');
      await page.screenshot({ path: join(out, `photons-${mode}-${w}x${h}.png`) });
      await page.close();
    }
  }
} finally { await browser.close(); }
process.exit(bad ? 1 : 0);
