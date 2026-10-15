// models.html captures for the presentation review: each body with its default lens and a long lens, outside,
// cutaway and a selected part, at desktop 1440x900 and phone 390x844. Needs a running dev server.
//   node tools/presentation-models-shots.mjs <outDir> [baseUrl=http://127.0.0.1:47640]
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const out = process.argv[2] || 'shots/presentation/models';
const base = process.argv[3] || 'http://127.0.0.1:47640';
const CASES = [
  ['dslr', 'n50', 'outside', null], ['dslr', 'n50', 'cutaway', null], ['dslr', 'n50', 'cutaway', 'mirror'],
  ['dslr', 'n500', 'cutaway', null],
  ['mirrorless', 'm50', 'outside', null], ['mirrorless', 'm50', 'cutaway', null], ['mirrorless', 'm50', 'outside', 'mount'],
  ['mirrorless', 'z800', 'cutaway', null],
];
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome',
  args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--hide-scrollbars'] });
for (const [tier, opts] of [
  ['desktop', { viewport: { width: 1440, height: 900 } }],
  ['phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }],
]) {
  const ctx = await browser.newContext({ ...opts, colorScheme: 'dark', reducedMotion: 'reduce' });
  for (const [body, lens, view, part] of CASES) {
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(`${base}/models.html?body=${body}&lens=${lens}&view=${view}${part ? `&part=${part}` : ''}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.p2pModels?.ready, null, { timeout: 45000 });
    await page.waitForTimeout(1500);
    const file = `${out}/${tier}-${body}-${lens}-${view}${part ? `-${part}` : ''}.png`;
    await page.screenshot({ path: file });
    console.log('saved', file, errors.length ? JSON.stringify(errors) : '');
    await page.close();
  }
  await ctx.close();
}
await browser.close();
