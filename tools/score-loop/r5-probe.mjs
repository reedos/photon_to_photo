// Score loop r5: open a query on the running dev server (47802), run an expression in the page, optional SHOT=path.
//   node tools/score-loop/r5-probe.mjs "?piece=cone&lens=z800" "expr" [vp]
import { chromium } from 'playwright';
const [query, expr, vp = '1440x900'] = process.argv.slice(2);
const [w, h] = vp.split('x').map(Number);
let dev = null;
if (!process.env.P2P_URL) {
  const { createServer } = await import('vite');
  dev = await createServer({ root: process.cwd(), logLevel: 'error', server: { host: '127.0.0.1', port: Number(process.env.P2P_PORT || 47852), strictPort: true, open: false } });
  await dev.listen();
}
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: w, height: h }, reducedMotion: 'reduce' });
  await page.goto(new URL(query, process.env.P2P_URL || `http://127.0.0.1:${process.env.P2P_PORT || 47852}/`).href);
  await page.waitForFunction(() => window.p2p && document.querySelector('#veil')?.classList.contains('off'), null, { timeout: 90000 }).catch(() => {});
  await page.evaluate(() => window.p2p.settle()).catch(() => {});
  await page.waitForTimeout(1500);
  const out = await page.evaluate(expr);
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
  console.log(typeof out === 'string' ? out : JSON.stringify(out));
} finally { await browser.close(); await dev?.close(); process.exit(0); }
