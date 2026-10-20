// Score loop r3 (visual): the longest gap between animation frames on each first switch between levels (camera ->
// lens -> cone -> camera), at 1440x900 on the WebGPU tier. The reviewer measured 0.7 to 1.1 s on first switches.
//   node tools/score-loop/r3-switch-stall.mjs [waitBeforeSwitchMs=6000]
import { chromium } from 'playwright';
const wait = Number(process.argv[2] || 6000);
const { createServer } = await import('vite');
const dev = await createServer({ root: process.cwd(), logLevel: 'error', server: { host: '127.0.0.1', port: 47818, strictPort: true, open: false } });
await dev.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--hide-scrollbars'] });
const out = {};
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto('http://127.0.0.1:47818/?piece=camera&lens=n50');
  await page.waitForFunction(() => window.p2p && document.querySelector('#veil')?.classList.contains('off'), null, { timeout: 90000 });
  await page.evaluate(() => window.p2p.pieces.camera.ready());
  out.backend = await page.evaluate(() => window.p2p.backend());
  // the reader looks at the camera for a while before diving
  await page.waitForTimeout(wait);
  if (process.env.PREBUILD) out.prebuild = await page.evaluate(() => ['lens', 'cone', 'loupe'].map((id) => { const t = performance.now(); void window.p2p.pieces[id].state; return [id, Math.round(performance.now() - t)]; }));
  await page.waitForTimeout(1000);
  for (const piece of ['lens', 'cone', 'camera', 'loupe']) {
    out[piece] = await page.evaluate(async (id) => {
      let last = performance.now(), max = 0, n = 0;
      let on = true;
      const loop = (t) => { max = Math.max(max, t - last); last = t; n++; if (on) requestAnimationFrame(loop); };
      requestAnimationFrame((t) => { last = t; requestAnimationFrame(loop); });
      await new Promise((r) => setTimeout(r, 50));
      const t0 = performance.now();
      window.p2p.piece(id);
      await new Promise((r) => setTimeout(r, 3000));
      on = false;
      return { maxFrameGapMs: Math.round(max), frames: n, switchMs: Math.round(performance.now() - t0) };
    }, piece);
    await page.waitForTimeout(1500);
  }
  console.log(JSON.stringify(out));
} finally { await browser.close(); await dev.close(); }
