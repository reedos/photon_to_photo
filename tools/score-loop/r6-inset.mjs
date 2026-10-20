// Score loop r6 (teaching): the Optics inset's legend, caption and bar labels at a desktop and a phone width.
//   P2P_URL=http://127.0.0.1:47803/ node tools/score-loop/r6-inset.mjs shots/r6-teaching/after [width] [lens]
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const base = process.env.P2P_URL || 'http://127.0.0.1:47803/';
const out = process.argv[2] || 'shots/r6-teaching/inset';
const width = Number(process.argv[3]) || 1440;
const lens = process.argv[4] || 'n50';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
try {
  const phone = width < 760;
  const page = await browser.newPage({ viewport: { width, height: phone ? 844 : 900 }, deviceScaleFactor: 2, reducedMotion: 'reduce', isMobile: phone, hasTouch: phone });
  await page.goto(new URL(`?piece=lens&lens=${lens}`, base).href);
  await page.waitForFunction(() => window.p2p?.pieces?.lens, null, { timeout: 120000 });
  await page.evaluate(() => window.p2p.pieces.lens.ready?.());
  await page.waitForTimeout(4000);
  const info = await page.evaluate(() => {
    const note = document.querySelector('.lv-inset-note');
    const r = note?.getBoundingClientRect();
    return { legend: note?.textContent, legendBox: r && [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], vw: innerWidth, vh: innerHeight,
      probe: window.p2p.pieces.lens.probe?.().inset };
  });
  console.log(JSON.stringify(info));
  await page.screenshot({ path: join(out, `inset-${width}.png`) });
  await page.close();
} finally { await browser.close(); }
