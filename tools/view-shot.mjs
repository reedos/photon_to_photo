// Full-size screenshots of just the 3D view for each piece (the lead's own look check).
// node tools/view-shot.mjs [query]  ->  shots/view/<piece>.png
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { startPreview } from './preview.mjs';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const extra = process.argv[2] || '';
const OUT = fileURLToPath(new URL('../shots/view/', import.meta.url));
mkdirSync(OUT, { recursive: true });
const { url, close } = await startPreview();
const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
try {
  for (const piece of ['lens', 'cone', 'loupe']) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.goto(`${url}?piece=${piece}${extra ? '&' + extra : ''}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.p2p && window.p2p.backend && window.p2p.backend(), null, { timeout: 30000 });
    await page.locator('#view').scrollIntoViewIfNeeded();
    await page.waitForTimeout(piece === 'loupe' ? 9000 : 4000);
    await page.locator('#view').screenshot({ path: `${OUT}${piece}.png` });
    console.log('saved', piece, await page.evaluate(() => window.p2p.backend()));
    await page.close();
  }
} finally { await browser.close(); await close(); }
