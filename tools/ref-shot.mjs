// Screenshots of Reed's own Intelligence Factory page (the style this site shares), desktop and phone, GPU.
// node tools/ref-shot.mjs [url]  ->  design/if-style/{desktop,phone}.png
import { createRequire } from 'module';
import { mkdirSync } from 'fs';
const require = createRequire(new URL('../package.json', import.meta.url));
const { chromium } = require('playwright');
const url = process.argv[2] || 'https://reedos.github.io/intelligence_factory/?view=0.power';
const out = new URL('../design/if-style/', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--hide-scrollbars'] });
for (const [name, ctxOpts] of [
  ['desktop', { viewport: { width: 1600, height: 1000 } }],
  ['phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
]) {
  const ctx = await browser.newContext({ ...ctxOpts, colorScheme: 'dark' });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(9000);
  await page.screenshot({ path: `${out}${name}.png` });
  // the visualizer section (the stage, story panel, cards, pins and transport)
  await page.evaluate(() => (document.querySelector('#explore') || document.querySelector('.stage'))?.scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(6000);
  await page.screenshot({ path: `${out}${name}-visualizer.png` });
  await page.evaluate(() => window.scrollBy(0, innerHeight * 0.9));
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${out}${name}-visualizer-2.png` });
  await ctx.close();
}
await browser.close();
console.log('saved to', out);
