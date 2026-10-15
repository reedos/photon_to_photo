// Score loop r2: does a camera-level teach label ("Drag to focus") move after load with nothing changed? Records the
// labels' boxes and the camera position every 250 ms for 9 s at 1440x900 with reduced motion.
//   node tools/score-loop/hint-jitter.mjs   (starts its own dev server on 47802)
import { chromium } from 'playwright';
const { createServer } = await import('vite');
const dev = await createServer({ root: process.cwd(), logLevel: 'error', server: { host: '127.0.0.1', port: 47802, strictPort: true } });
await dev.listen();
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
let moves = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await page.goto('http://127.0.0.1:47802/?piece=camera&lens=n50');
  await page.waitForFunction(() => [...document.querySelectorAll('.rig-teach span')].some((e) => e.offsetWidth > 0 && getComputedStyle(e).visibility === 'visible'), null, { timeout: 90000 });
  let last = null;
  for (let i = 0; i < 36; i++) {
    const s = await page.evaluate(() => ({
      t: Math.round(performance.now()),
      labels: [...document.querySelectorAll('.rig-teach')].filter((e) => e.style.display !== 'none' && !e.querySelector('span').hidden && getComputedStyle(e.querySelector('span')).visibility === 'visible').map((e) => {
        const b = e.querySelector('span').getBoundingClientRect(); const r = e.querySelector('i').getBoundingClientRect();
        return `${e.querySelector('span').textContent}@${Math.round(b.left)},${Math.round(b.top)} ring ${Math.round(r.left)},${Math.round(r.top)}`;
      }).join(' | '),
      cam: window.p2p.framing?.().moving,
      pins: [...document.querySelectorAll('.pin, .hud.tl, .hud.tr, .hud.br, .hud.bl')].filter((e) => e.offsetWidth && getComputedStyle(e).visibility !== 'hidden').map((e) => { const b = e.getBoundingClientRect(); return `${e.className.split(' ')[0]}${e.dataset.pinId ? ':' + e.dataset.pinId : ''}@${Math.round(b.left)},${Math.round(b.top)},${Math.round(b.width)}x${Math.round(b.height)}`; }).join(' '),
    }));
    // a move is a label that was showing and now shows somewhere else; appearing late is not a move
    const at = (str) => new Map((str || '').split(' | ').filter(Boolean).map((x) => [x.split('@')[0], x]));
    const before = at(last), now = at(s.labels);
    const moved = [...now].filter(([k, v]) => before.has(k) && before.get(k) !== v);
    if (last !== null && moved.length) { moves++; console.log('MOVE', s.t, s.labels); if (process.env.DEBUG) console.log('   ', s.pins); }
    else if (last !== null && s.labels !== last) console.log('shown', s.t, s.labels);
    else if (last === null) { console.log('start', s.t, s.labels); if (process.env.DEBUG) console.log('   ', s.pins); }
    last = s.labels;
    await page.waitForTimeout(250);
  }
} finally { await browser.close(); await dev.close(); }
console.log(moves ? `FAIL ${moves} moves after the labels appeared` : 'PASS labels held still');
