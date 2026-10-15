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

    await page.goto(new URL('?piece=camera', url).href, { waitUntil: 'load' });
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
    // The fan's bins are composited with a per-channel MAX blend (src/pieces/lens.ts, score loop r1), so a pixel that
    // one bin crosses alone is that bin's exact color, and a pixel that several coincident bins cross is exactly the
    // per-channel max of their engine colors (the white light of the shared stretch). Where the bins of one ray
    // share their first segment (same field, same entry and first-surface points), that segment's midpoint is such a
    // pixel; its expected value is computed here from the same wavelengthSrgb255() hook, so a double sRGB encoding or
    // a tinted ray still fails it.
    let bestCoincident = null;
    {
      const drawnRays = probe.rays.filter((r) => r.world.length >= 2 && !(r.status !== 'ok' && r.world.length <= 2));
      const groups = new Map();
      for (const r of drawnRays) {
        const [a, b] = r.world;
        const key = `${r.field}|${a.map((v) => v.toFixed(5)).join(',')}|${b.map((v) => v.toFixed(5)).join(',')}`;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(r);
      }
      for (const members of groups.values()) {
        if (members.length < 2) continue;
        for (const m of members) if (!expectedByNm.has(m.nm)) expectedByNm.set(m.nm, await page.evaluate((nm) => window.p2p.pieces.lens.wavelengthSrgb255(nm), m.nm));
        const expected = [0, 1, 2].map((k) => Math.max(...members.map((m) => expectedByNm.get(m.nm)[k])));
        const [p0, p1] = members[0].screenFromWorld;
        const mid = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
        if (mid[0] < 0 || mid[0] >= canvasBox.width || mid[1] < 0 || mid[1] >= canvasBox.height) continue;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const px = pngPixel(img, canvasBox.x + mid[0] + dx, canvasBox.y + mid[1] + dy);
          if (!px) continue;
          const diff = Math.max(Math.abs(px[0] - expected[0]), Math.abs(px[1] - expected[1]), Math.abs(px[2] - expected[2]));
          if (!bestCoincident || diff < bestCoincident.diff) bestCoincident = { n: members.length, expected, px, diff };
        }
      }
    }
    if (best && best.diff <= 2) {
      check(`exact sRGB color at ${best.r.nm.toFixed(0)}nm`, true,
        `expected [${best.expected}], best pixel found [${best.px.slice(0, 3)}], max channel diff ${best.diff} (tolerance 2/255, searched ${candidates.length} rays)`);
    } else if (bestCoincident) {
      check(`exact sRGB color where ${bestCoincident.n} coincident bins combine (per-channel max of their engine colors)`, bestCoincident.diff <= 2,
        `expected [${bestCoincident.expected}], best pixel found [${bestCoincident.px.slice(0, 3)}], max channel diff ${bestCoincident.diff} (tolerance 2/255); `
        + `no single bin runs alone on screen at this framing (closest single-bin diff ${best ? best.diff : 'n/a'})`);
    } else {
      check('exact sRGB color of a drawn ray', false, `no on-screen ok-status ray found among ${candidates.length} candidates and no coincident bins on screen`);
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

    // ---- (5) score loop r2: the fans start on the focused plane, so they converge on the sensor ---------------
    // At f/8 the on-axis fan's landing chord at the bin nearest the d line stays under 2 x CoC at any focus (before
    // r2 the fans came from infinity: n500 at 8.91 m landed over 3.8 mm). And the inset legend names whichever part
    // of the spread dominates: one color's own blur, or the shift between colors.
    for (const [lens, focusM] of [['p50', 3], ['p50', 0.6], ['n50', 3], ['n500', 8.91], ['n500', 30], ['s35', 1]]) {
      await page.evaluate(([l, f]) => window.p2p.set({ lens: l, fno: 8, focusM: f, format: 'ff' }), [lens, focusM]);
      await page.evaluate(() => window.p2p.settle());
      const pr = await page.evaluate(() => window.p2p.pieces.lens.probe());
      const coc = await page.evaluate(() => window.p2p.model().figs.cocMm.v);
      const nms = [...new Set(pr.rays.map((r) => r.nm))];
      const nmD = nms.reduce((a, b) => (Math.abs(b - 587.56) < Math.abs(a - 587.56) ? b : a));
      const pts = pr.rays.filter((r) => r.field === 0 && r.nm === nmD && r.status === 'ok').map((r) => r.engine[r.engine.length - 1]);
      let chord = 0;
      for (const a of pts) for (const b of pts) chord = Math.max(chord, Math.hypot(a[0] - b[0], a[1] - b[1]));
      const focusMm = await page.evaluate(() => window.p2p.model().focus.distanceMm);
      check(`${lens} focused at ${focusM} m: fans start on the focused plane`, pr.fanSourceMm !== null && Math.abs(pr.fanSourceMm - focusMm) < 1e-6,
        `rays start ${pr.fanSourceMm === null ? 'at infinity' : (pr.fanSourceMm / 1000).toFixed(3) + ' m'} from the sensor; focus ${(focusMm / 1000).toFixed(3)} m`);
      // The drawn fan samples the WIDE-OPEN pupil and clips it at the current iris (marginal-rays.ts), so at f/8 a short
      // lens draws only its chief ray; the chord is checked where at least three on-axis rays survive. src/engine/
      // camera.test.ts checks 15-ray f/8 fans for 11 lens/focus cases.
      if (pts.length >= 3) {
        check(`${lens} f/8 focused at ${focusM} m: on-axis fan converges on the sensor`, chord < 2 * coc,
          `${nmD.toFixed(1)} nm landing chord ${(chord * 1000).toFixed(1)} µm over ${pts.length} rays (limit 2 x CoC = ${(2 * coc * 1000).toFixed(1)} µm)`);
      }
      const ins = pr.inset;
      // score loop r4 wording: a plain key. It states the red-to-violet distance, and the widest one-color spread when there is one
      const um = (mm) => `${(mm * 1000).toFixed(mm < 0.01 ? 1 : 0)} µm`;
      const keyOk = ins.legend.startsWith('Colors land in different places') && ins.legend.includes(`red to violet ${um(ins.colorShiftMm)} apart`)
        && (ins.spotMm < 0.0001 ? /each color lands in one point/.test(ins.legend) : ins.legend.includes(`up to ${um(ins.spotMm)}`));
      check(`${lens} at ${focusM} m: inset legend states the color shift and one color's own spread`, keyOk && !/spread is chromatic aberration|color error|other blur/.test(ins.legend),
        `color shift ${(ins.colorShiftMm * 1000).toFixed(1)} µm, widest one-color spread ${(ins.spotMm * 1000).toFixed(1)} µm; legend "${ins.legend}"`);
    }

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
