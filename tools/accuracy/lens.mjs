// Visual accuracy gate for set piece 2, the lens cutaway (see docs/pieces/lens.md, "Accuracy gate").
//
//   P2P_PREVIEW_PORT=47511 node tools/accuracy/lens.mjs
//
// Runs the built app in system Chrome with WebGPU forced on, asserts window.p2p.backend() === 'webgpu', and
// checks the four things the task's own gate asks for. Every number comes from the LIVE page: `probe()` and the
// other src/pieces/lens.ts hooks (window.p2p.pieces.lens.*) recompute the engine's own marginalAwareFans()/
// wavelengthColor fresh and project points through the real camera; the color check reads an actual screenshot
// PNG (decoded by tools/accuracy/png.mjs -- see its header for why, not an in-page canvas readback). This
// script only compares those numbers and prints PASS/FAIL, it does not re-derive any physics of its own.
import { createRequire } from 'node:module';
import { startPreview } from '../preview.mjs';
import { decodePng, pngPixel } from './png.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'} -- ${name}: ${detail}`);
}

async function main() {
  const { url, close } = await startPreview();
  const browser = await chromium.launch({
    headless: true,
    channel: 'chrome',
    args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'],
  });
  try {
    // Pixel samples and projected coordinates must describe the same camera pose, not successive dive frames.
    const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, colorScheme: 'dark', reducedMotion: 'reduce' });
    const consoleErrors = [];
    page.on('pageerror', (e) => consoleErrors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean(window.p2p), null, { timeout: 20000 });

    const backend = await page.evaluate(() => window.p2p.backend());
    check('backend is webgpu', backend === 'webgpu', `got "${backend}"`);
    if (backend !== 'webgpu') throw new Error('accuracy gate requires the real WebGPU backend; see the console-fallback gotcha in docs/rendering-spike.md');

    await page.evaluate(() => window.p2p.set({ lens: 'p50', fno: 4, focusM: 3, format: 'ff' }));
    await page.evaluate(() => window.p2p.piece('lens'));
    await page.evaluate(() => window.p2p.settle());
    await page.evaluate(() => window.p2p.gpuIdle());
    await page.locator('#stage-section').scrollIntoViewIfNeeded();
    await page.evaluate(() => window.p2p.settle());
    await page.evaluate(() => window.p2p.gpuIdle());
    await page.waitForTimeout(150);

    // ---- (1) drawn ray vertices == fresh lensFans() points, world and screen -------------------------------
    const probe = await page.evaluate(() => window.p2p.pieces.lens.probe());
    let maxWorldErr = 0;
    let maxScreenErr = 0;
    let worldChecked = 0;
    for (const r of probe.rays) {
      const n = Math.min(r.world.length, r.engine.length);
      for (let i = 0; i < n; i++) {
        const w = r.world[i], e = r.engine[i];
        const d = Math.hypot(w[0] - e[0], w[1] - e[1], w[2] - e[2]);
        if (d > maxWorldErr) maxWorldErr = d;
        worldChecked++;
      }
      const ns = Math.min(r.screenFromWorld.length, r.screenFromEngine.length);
      for (let i = 0; i < ns; i++) {
        const a = r.screenFromWorld[i], b = r.screenFromEngine[i];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (d > maxScreenErr) maxScreenErr = d;
      }
    }
    check('ray vertices: world position vs engine trace', maxWorldErr < 1e-6, `max |world - engine| = ${maxWorldErr.toExponential(3)} mm over ${worldChecked} vertices (tolerance 1e-6 mm)`);
    check('ray vertices: screen projection agreement', maxScreenErr < 1, `max screen error = ${maxScreenErr.toFixed(4)} px (tolerance 1 px)`);

    // ---- (2) exact physics color: sample a known ray's pixel, compare to wavelengthToThreeColor(nm) ----------
    // A page.screenshot() PNG, decoded by hand (tools/accuracy/png.mjs) -- an in-page canvas readback via
    // drawImage()+getImageData() reads back fully transparent everywhere for this WebGPU canvas in this
    // environment (tried first; every sample came back [0,0,0,0] regardless of position), so this follows the
    // task brief's own "read pixels from screenshots" instruction literally instead.
    const canvasBox = await page.locator('#gl').boundingBox();
    const shot = await page.screenshot();
    const img = decodePng(shot);
    // Many points along many rays are depth-occluded by glass/barrel from the camera's own viewpoint (only a
    // ray segment actually in front of everything else along the view ray reads as the ray's own color); rather
    // than guess which one is unoccluded, sample every point of every candidate ray and keep the one whose pixel
    // is actually closest to that ray's own expected color, checked against a per-wavelength 3x3 neighborhood so
    // a projected point landing a hair off the fat line's antialiased core still finds it.
    // Prefer mid-spectrum wavelengths first: they're the brightest under the engine's own (un-normalized-yet;
    // see src/engine/spectrum.ts's own module doc) CIE-CMF color, so a match there is a more informative check
    // than one that happens to land on a wavelength this build renders as near-black. |nm-555| alone isn't
    // enough of a proxy for "bright" though (spectrum.ts's own stub isn't symmetric around 555nm -- this build's
    // deep-red ~718nm bin renders close to black), and settling for the first candidate within tolerance was
    // found to lock onto exactly such a near-black bin, where "expected [0,0,0], found [0,0,0]" passes on
    // matching backdrop rather than on a drawn line actually being there (accuracy-review finding
    // gate-check2-near-vacuous-on-color). Rank by actual expected luminance (computed, not guessed) first, so a
    // near-black bin is only ever tried after every visibly bright one has failed.
    let candidates = probe.rays.filter((r) => r.status === 'ok' && r.screenFromWorld.length > 0);
    const expectedByNm = new Map();
    for (const r of candidates) {
      if (!expectedByNm.has(r.nm)) expectedByNm.set(r.nm, await page.evaluate((nm) => window.p2p.pieces.lens.wavelengthSrgb255(nm), r.nm));
    }
    const luminance = (nm) => expectedByNm.get(nm).reduce((a, b) => a + b, 0);
    const MIN_LUMINANCE = 150; // out of 765 (255*3) -- excludes near-black bins like the ~718nm one from this build
    candidates = candidates.filter(r => luminance(r.nm) >= MIN_LUMINANCE).sort((a, b) => {
      const brightA = luminance(a.nm) >= MIN_LUMINANCE, brightB = luminance(b.nm) >= MIN_LUMINANCE;
      if (brightA !== brightB) return brightA ? -1 : 1;
      return Math.abs(a.nm - 555) - Math.abs(b.nm - 555);
    });
    let best = null;
    for (const r of candidates) {
      const expected = expectedByNm.get(r.nm);
      for (const pt of r.screenFromWorld) {
        if (pt[0] < 0 || pt[0] >= canvasBox.width || pt[1] < 0 || pt[1] >= canvasBox.height) continue;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const px = pngPixel(img, canvasBox.x + pt[0] + dx, canvasBox.y + pt[1] + dy);
            if (!px) continue;
            const diff = Math.max(Math.abs(px[0] - expected[0]), Math.abs(px[1] - expected[1]), Math.abs(px[2] - expected[2]));
            if (!best || diff < best.diff) best = { r, expected, px, diff };
          }
        }
      }
      if (best && best.diff <= 2) break;
    }
    if (!best) {
      check('exact sRGB color of a drawn ray', false, `no on-screen ok-status ray (>600nm) found among ${candidates.length} candidates`);
    } else {
      check(
        `exact sRGB color at ${best.r.nm.toFixed(0)}nm`,
        best.diff <= 2,
        `expected [${best.expected}], best pixel found [${best.px.slice(0, 3)}], max channel diff ${best.diff} (tolerance 2/255, searched ${candidates.length} rays)`,
      );
    }

    // ---- (3) stopping down to f/8 removes marginal rays exactly as the engine's own status says --------------
    await page.evaluate(() => window.p2p.set({ fno: window.p2p.model().lens.maxFno }));
    await page.evaluate(() => window.p2p.settle());
    const wideOpen = await page.evaluate(() => window.p2p.pieces.lens.probe());
    const wideOkCount = wideOpen.rays.filter((r) => r.status === 'ok').length;

    await page.evaluate(() => window.p2p.set({ fno: 8 }));
    await page.evaluate(() => window.p2p.settle());
    const stoppedDown = await page.evaluate(() => window.p2p.pieces.lens.probe());
    const stoppedOkCount = stoppedDown.rays.filter((r) => r.status === 'ok').length;
    const stoppedDrawnOkCount = stoppedDown.rays.filter((r) => r.status === 'ok' && r.world.length > 0).length;

    check(
      'f/8 drops marginal rays vs wide open',
      stoppedOkCount < wideOkCount,
      `ok rays: wide open ${wideOkCount}, f/8 ${stoppedOkCount} (must decrease)`,
    );
    check(
      'drawn ray count matches engine status count at f/8',
      stoppedDrawnOkCount === stoppedOkCount,
      `drawn-with-points ok rays ${stoppedDrawnOkCount} vs engine-status ok rays ${stoppedOkCount}`,
    );

    // ---- (4) iris drawn opening radius vs model.iris.radius ---------------------------------------------------
    await page.waitForTimeout(200); // let the (<=150ms) blade animation settle after the f/8 change above
    const irisProbe = await page.evaluate(() => window.p2p.pieces.lens.probe());
    const irisErr = Math.abs(irisProbe.iris.drawnRadius - irisProbe.iris.modelRadius) / irisProbe.iris.modelRadius;
    check(
      'iris drawn radius vs model.iris.radius',
      irisErr <= 0.005,
      `drawn ${irisProbe.iris.drawnRadius.toFixed(4)} mm vs model ${irisProbe.iris.modelRadius.toFixed(4)} mm (${(irisErr * 100).toFixed(2)}%, tolerance 0.5%)`,
    );

    check('zero console errors during the gate', consoleErrors.length === 0, `${consoleErrors.length} error(s)${consoleErrors.length ? ': ' + consoleErrors.slice(0, 3).join(' | ') : ''}`);

    await browser.close();
    await close();
  } catch (err) {
    await browser.close().catch(() => {});
    throw err;
  }
}

await main();

const failed = results.filter((r) => !r.pass);
console.log('');
console.log(`accuracy/lens.mjs: ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.error(`accuracy/lens.mjs: FAILED (${failed.length}): ${failed.map((f) => f.name).join(', ')}`);
  process.exitCode = 1;
} else {
  console.log('accuracy/lens.mjs: all checks passed');
}
