// Score loop r4: a full-page or clipped screenshot of any path at a chosen size, optionally after clicking selectors.
//   P2P_URL=http://127.0.0.1:47803/ node tools/score-loop/r4-shot.mjs "<path>" out.png [width=1440] [height=900] [click selector ...]
import { chromium } from 'playwright';
const [path, out, w = '1440', h = '900', ...clicks] = process.argv.slice(2);
const url = process.env.P2P_URL || 'http://127.0.0.1:47803/';
const width = Number(w), height = Number(h), phone = width < 760;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2, reducedMotion: 'reduce', isMobile: phone, hasTouch: phone });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(new URL(path, url).href);
  await page.waitForTimeout(2500);
  for (const c of clicks) { await page.locator(c).first().click({ force: true }); await page.waitForTimeout(700); }
  await page.screenshot({ path: out, fullPage: process.env.FULL === '1' });
  console.log(out, errors.length ? `errors: ${errors.join(' | ')}` : 'no page errors');
} finally { await browser.close(); }
