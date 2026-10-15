// First visits stay responsive (score loop r3, visual): after the reader has looked at the camera for a few seconds,
// the first switch to each level (Optics, Focus, back to the Camera, Pixel) must never leave more than LIMIT_MS between
// two animation frames. Before stage.ts compiled each first visit ahead (warmPiece), these gaps were 0.7 to 1.65 s:
// the first frame of a level built its GPU pipelines synchronously in the middle of the dive.
//   node tools/test-first-switch.mjs            (P2P_URL to use a running server)
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { gateServer } from './preview.mjs';

const LIMIT_MS = 200;
const server = await gateServer();
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--hide-scrollbars'] });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(new URL('?piece=camera&lens=n50', server.url).href);
  await page.waitForFunction(() => window.p2p && document.querySelector('#veil')?.classList.contains('off'), null, { timeout: 90000 });
  await page.evaluate(() => window.p2p.pieces.camera.ready());
  const backend = await page.evaluate(() => window.p2p.backend());
  await page.waitForTimeout(6000);
  const results = {};
  for (const piece of ['lens', 'cone', 'camera', 'loupe']) {
    results[piece] = await page.evaluate(async (id) => {
      let last = 0, max = 0, on = true;
      const loop = (t) => { if (last) max = Math.max(max, t - last); last = t; if (on) requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
      await new Promise((r) => setTimeout(r, 100));
      window.p2p.piece(id);
      await new Promise((r) => setTimeout(r, 3000));
      on = false;
      const veilOff = document.querySelector('#veil')?.classList.contains('off');
      return { maxGapMs: Math.round(max), veilOff };
    }, piece);
    await page.waitForTimeout(1500);
  }
  console.log(backend, JSON.stringify(results));
  for (const [piece, r] of Object.entries(results)) {
    assert.ok(r.maxGapMs <= LIMIT_MS, `${backend}: first switch to ${piece} left ${r.maxGapMs} ms between frames (limit ${LIMIT_MS})`);
    assert.ok(r.veilOff, `${backend}: the veil is still up 3 s after the first switch to ${piece}`);
  }
  assert.deepEqual(errors, [], errors.join('\n'));
  console.log(`PASS first switches keep every frame gap under ${LIMIT_MS} ms (${backend})`);
} finally { await browser.close(); await server.close(); }
