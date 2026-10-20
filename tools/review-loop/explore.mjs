// Scratch exploration for the 10/10/2026 correctness loop: list each piece's hooks and take a screenshot.
import { chromium } from 'playwright';
const base = process.env.P2P_URL || 'http://127.0.0.1:47630/';
const out = 'docs/review-loop-2026-10-10/correctness';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const p = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
for (const piece of (process.argv[2] || 'camera,lens,cone,loupe').split(',')) {
  await p.goto(new URL(`?piece=${piece}`, base).href);
  await p.waitForFunction(() => window.p2p && document.querySelector('#veil')?.classList.contains('off'), null, { timeout: 60000 }).catch(() => {});
  await p.evaluate(() => window.p2p.settle());
  await p.waitForTimeout(1500);
  const info = await p.evaluate((piece) => ({ backend: window.p2p.backend(), scenario: window.p2p.scenario(), hooks: Object.keys(window.p2p.pieces[piece] || {}) }), piece);
  console.log(piece, JSON.stringify(info));
  await p.screenshot({ path: `${out}/explore-${piece}.png` });
}
console.log('errors', errors);
await browser.close();
