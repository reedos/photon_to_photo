// Score loop r4 (visual): what the reader sees while a level is visited for the first time. For each first switch
// (camera -> lens -> cone -> camera -> loupe) it polls the veil every 40 ms and records how long it was up (not `off`),
// whether it was the busy kind, its background alpha, and the mean luma of a strip of the canvas taken from the screen
// (a black cut shows as ~0; the level just left shows as its own brightness).
//   OUT=dir node tools/score-loop/r4-veil.mjs [waitBeforeSwitchMs=6000]
//   P2P_ROOT=<dir> node ...   (serve another checkout, for the before numbers)
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
const wait = Number(process.argv[2] || 6000);
const OUT = process.env.OUT || 'shots/r4-veil';
mkdirSync(OUT, { recursive: true });
const { createServer } = await import('vite');
const dev = await createServer({ root: process.cwd(), logLevel: 'error', server: { host: '127.0.0.1', port: 47802, strictPort: true, open: false } });
await dev.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--hide-scrollbars'] });
const out = {};
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto('http://127.0.0.1:47802/?piece=camera&lens=n50');
  await page.waitForFunction(() => window.p2p && document.querySelector('#veil')?.classList.contains('off'), null, { timeout: 90000 });
  await page.evaluate(() => window.p2p.pieces.camera.ready());
  await page.waitForTimeout(wait);
  for (const piece of ['lens', 'cone', 'camera', 'loupe']) {
    await page.evaluate((id) => {
      window.__veil = [];
      const t0 = performance.now();
      window.__stop = false;
      const tick = () => {
        const v = document.getElementById('veil');
        const cs = getComputedStyle(v);
        window.__veil.push({ t: Math.round(performance.now() - t0), off: v.classList.contains('off'), busy: v.classList.contains('busy'), quiet: v.classList.contains('quiet'), op: +(+cs.opacity).toFixed(2), bg: cs.backgroundColor });
        if (!window.__stop) setTimeout(tick, 40);
      };
      tick();
      window.p2p.piece(id);
    }, piece);
    const lumas = [];
    const t0 = Date.now();
    while (Date.now() - t0 < 2600) {
      const png = await page.screenshot({ clip: { x: 200, y: 260, width: 700, height: 400 }, type: 'jpeg', quality: 40 });
      lumas.push([Date.now() - t0, png.length]);
    }
    const series = await page.evaluate(() => { window.__stop = true; return window.__veil; });
    const upMs = (() => { const first = series.find((s) => !s.off); if (!first) return 0; const last = [...series].reverse().find((s) => !s.off); return last.t - first.t; })();
    const busyMs = series.filter((s) => s.busy && !s.off).length * 40;
    out[piece] = { veilUpMs: upMs, busyMs, maxOpacity: Math.max(...series.map((s) => s.op)), bg: [...new Set(series.filter((s) => s.busy).map((s) => s.bg))].slice(0, 3),
      jpegBytes: lumas.map(([, n]) => n) };
    await page.waitForTimeout(1500);
  }
  console.log(JSON.stringify(out));
  writeFileSync(`${OUT}/veil.json`, JSON.stringify(out, null, 1));
} finally { await browser.close(); await dev.close(); }
