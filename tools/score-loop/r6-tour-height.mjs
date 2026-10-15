// Score loop round 6: the 3D view's height at every stop of the guided tour (it must not change between stops, and the
// "Focal length & perspective" button must stay in the side column, not in a bar under the view).
//   P2P_PORT=47802 node tools/score-loop/r6-tour-height.mjs [WxH]
import { chromium } from 'playwright';
const { createServer } = await import('vite');
const port = Number(process.env.P2P_PORT || 47802);
const dev = await createServer({ root: process.cwd(), logLevel: 'error', server: { host: '127.0.0.1', port, strictPort: true, open: false } });
await dev.listen();
const [w, h] = (process.argv[2] || '1440x900').split('x').map(Number);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
try {
  const page = await (await browser.newContext({ viewport: { width: w, height: h }, colorScheme: 'dark', reducedMotion: 'reduce' })).newPage();
  await page.goto(`http://127.0.0.1:${port}/?piece=camera&lens=n50`);
  await page.waitForFunction(() => window.p2p && document.querySelector('#veil')?.classList.contains('off'), null, { timeout: 90000 });
  await page.evaluate(() => window.p2p.settle());
  const measure = () => page.evaluate(() => {
    const c = document.querySelector('#view canvas, canvas');
    const r = c.getBoundingClientRect();
    const b = document.querySelector('.perspective-launch')?.getBoundingClientRect();
    const where = document.querySelector('.perspective-launch-row')?.parentElement?.id || '?';
    const ex = document.getElementById('model-experiments');
    const kids = ex ? [...ex.children].filter((k) => k.getBoundingClientRect().height > 0).map((k) => `${k.className || k.id || k.tagName}:${Math.round(k.getBoundingClientRect().height)}`) : [];
    return { exh: ex ? Math.round(ex.getBoundingClientRect().height) : -1, kids, canvas: [Math.round(r.width), Math.round(r.height)], launch: b ? [Math.round(b.left), Math.round(b.top), Math.round(b.width)] : null, in: where, step: document.querySelector('#journey select, #journey-step')?.value ?? '' };
  });
  console.log('before tour', JSON.stringify(await measure()));
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /guided tour/i.test(b.textContent.trim()))?.click());
  await page.waitForTimeout(1500);
  for (let i = 1; i <= 10; i++) {
    console.log('stop', i, JSON.stringify(await measure()));
    const next = await page.evaluate(() => { const b = [...document.querySelectorAll('#journey button')].find((x) => /^next/i.test(x.textContent.trim())); if (b && !b.disabled) { b.click(); return true; } return false; });
    if (!next) break;
    await page.waitForTimeout(900);
  }
} finally { await browser.close(); await dev.close(); process.exit(0); }
