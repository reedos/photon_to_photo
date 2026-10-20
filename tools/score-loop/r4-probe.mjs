// Score loop round 4: a small probe. Loads the camera at a lens and body, opens the cutaway, and runs an expression in the page.
//   node tools/score-loop/r4-probe.mjs "?piece=camera&lens=m50" "window.p2p.pieces.camera.hooks..." [cutaway]
import { chromium } from 'playwright';
const [query, expr, cut] = process.argv.slice(2);
const { createServer } = await import('vite');
const dev = await createServer({ root: process.cwd(), logLevel: 'error', server: { host: '127.0.0.1', port: 47802, strictPort: true, open: false } });
await dev.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await page.goto(new URL(query, 'http://127.0.0.1:47802/').href);
  await page.waitForFunction(() => window.p2p && document.querySelector('#veil')?.classList.contains('off'), null, { timeout: 90000 }).catch(() => {});
  await page.waitForFunction(() => window.p2p?.pieces.camera.state().loaded, null, { timeout: 60000 }).catch(() => {});
  await page.evaluate(() => window.p2p.settle()).catch(() => {});
  if (cut) await page.evaluate(() => window.p2p.pieces.camera.setView('cutaway'));
  await page.evaluate(() => window.p2p.settle()).catch(() => {});
  const out = await page.evaluate(expr);
  if (process.env.SHOT) { await page.waitForTimeout(Number(process.env.WAIT || 600)); await page.screenshot({ path: process.env.SHOT }); }
  console.log(typeof out === 'string' ? out : JSON.stringify(out));
} finally { await browser.close(); await dev.close(); }
