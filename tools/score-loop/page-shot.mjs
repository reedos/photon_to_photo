// Score loop r2: one screenshot of a page path at 1440x900 (reduced motion), from its own dev server on 47802.
//   node tools/score-loop/page-shot.mjs "lens-preview.html?lens=n50" out.png [waitMs]
import { chromium } from 'playwright';
const [path, out, wait = '4000'] = process.argv.slice(2);
const { createServer } = await import('vite');
const dev = await createServer({ root: process.cwd(), logLevel: 'error', server: { host: '127.0.0.1', port: 47802, strictPort: true } });
await dev.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--hide-scrollbars'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:47802/${path}`);
  await page.waitForTimeout(Number(wait));
  await page.screenshot({ path: out });
  console.log(out, errors.length ? `errors: ${errors.join(' | ')}` : 'no page errors');
} finally { await browser.close(); await dev.close(); }
