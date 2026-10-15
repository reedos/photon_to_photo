// Score loop r5: what the HUD says while a level compiles on its first visit. Starts on the camera, clicks a level, and
// polls the HUD title, the veil words and the veil's state every 150 ms until the veil lifts; prints the timeline.
//   node tools/score-loop/r5-switch-hud.mjs [lens|cone|loupe]   (own dev server on 47852, P2P_PORT to change; exits 1 when the title ran ahead of the scene)
import { chromium } from 'playwright';
const level = process.argv[2] || 'lens';
let dev = null;
if (!process.env.P2P_URL) {
  const { createServer } = await import('vite');
  dev = await createServer({ root: process.cwd(), logLevel: 'error', server: { host: '127.0.0.1', port: Number(process.env.P2P_PORT || 47852), strictPort: true, open: false } });
  await dev.listen();
}
const base = process.env.P2P_URL || `http://127.0.0.1:${process.env.P2P_PORT || 47852}/`;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--hide-scrollbars'] });
let ahead = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await page.goto(new URL('?piece=camera&lens=n50', base).href);
  await page.waitForFunction(() => window.p2p && document.querySelector('#veil')?.classList.contains('off'), null, { timeout: 90000 }).catch(() => {});
  await page.evaluate(() => window.p2p.settle()).catch(() => {});
  await page.waitForTimeout(1500);
  const before = await page.evaluate(() => document.querySelector('#hud-title, .hud-title, #stage-title')?.textContent ?? null);
  await page.locator(`#steps [data-piece="${level}"]`).click();
  const t0 = Date.now();
  const rows = [];
  for (let i = 0; i < 60; i++) {
    const r = await page.evaluate(() => {
      const t = document.querySelector('#hud-title, .hud-title, #stage-title');
      const v = document.getElementById('veil');
      return { title: t?.textContent ?? null, veil: v.classList.contains('off') ? 'off' : v.classList.contains('busy') ? 'busy' : 'on', msg: document.getElementById('veil-msg')?.textContent ?? '' };
    });
    rows.push({ ms: Date.now() - t0, ...r });
    if (r.veil === 'off' && i > 3) break;
    await page.waitForTimeout(150);
  }
  console.log('title before:', before);
  let last = '';
  for (const r of rows) { const k = `${r.title}|${r.veil}|${r.msg}`; if (k !== last) { console.log(`${r.ms} ms`, JSON.stringify(r)); last = k; } }
  const finalTitle = rows[rows.length - 1].title;
  for (const r of rows) if (r.veil !== 'off' && r.title === finalTitle && finalTitle !== before) ahead++;
  console.log(ahead ? `HUD ran ahead of the scene in ${ahead} polls` : 'HUD kept the outgoing title until the veil lifted');
} finally { await browser.close(); await dev?.close(); }
process.exit(ahead ? 1 : 0);
