// The visual accuracy gate for set piece 9, the loupe (docs/PROTOTYPE.md's "Visual accuracy gate" section,
// docs/pieces/loupe.md). Builds+serves the app, drives it with Playwright's system Chrome on the real WebGPU
// backend, taps a real highlight-edge pixel, and checks the DRAWN geometry and the loupe's own test hooks
// against the engine's numbers. Six numbered checks plus the WebGL2-fallback/console-error checks, each prints
// PASS/FAIL with the actual numbers:
//   1. drawn fill height / well height == electrons/fullWell within 1%, and the fill's own emissive
//      brightness follows the same fraction. This is a SCENE-GRAPH check (it reads chargeMesh.scale.y and
//      .color straight back out of the same JS objects updateWellFill() just set) -- it would still pass if
//      the mesh were invisible, occluded or off-camera, which is exactly what check 5 below exists to catch
//      (found by the accuracy verifier's own independent review this same week).
//   2. the final image's measured raw DN noise over a flat mid-gray ColorChecker patch vs the engine's
//      predicted sigma, within 5%.
//   3. pixelAt() is deterministic: two calls at the same (renderId, x, y) return identical PixelState.
//   4. the badge's N times the dots drawn reproduces the pixel's real photon count within one dot.
//   5. the charge fill is genuinely VISIBLE and RESPONSIVE on a real rendered pixel, not just in the scene
//      graph: two taps with very different electrons/fullWell fractions each sample the actual screenshot at
//      the charge mesh's own projected screen position (debugCamera().chargeNdc) and must (a) each read as
//      visibly different from that frame's own background, and (b) differ from each other in the direction
//      the engine's own fillFrac gap predicts. Adapted from the accuracy verifier's shots/review-loupe/
//      independent.mjs + pngdecode.mjs (a canvas drawImage()/getImageData() readback on the #gl canvas returns
//      all-zero/transparent pixels in this headless WebGPU setup even though the same frame screenshots with
//      real content, so this decodes a real Playwright screenshot instead of trusting an in-page pixel read).
//   6. the breadcrumb inset actually shows the photo (real pixel variance over its own rendered rect, not one
//      flat empty color) and its own tapped-pixel marker is visible -- a regression test for critic finding
//      "breadcrumb-empty" (fixed this session: the inset rendered the whole main scene, coplanar with and
//      indistinguishable from the far-below sensor grid from its own top-down orthographic view).
//
//   P2P_PREVIEW_PORT=47513 node tools/accuracy/loupe.mjs
import { createRequire } from 'node:module';
import { startPreview } from '../preview.mjs';
import { decodePNG } from './pngdecode.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

let failed = false;
function check(name, pass, detail) {
  const line = `accuracy/loupe: ${pass ? 'PASS' : 'FAIL'} -- ${name}: ${detail}`;
  if (pass) console.log(line);
  else { console.error(line); failed = true; }
}

async function main() {
  const { url, close } = await startPreview();
  const browser = await chromium.launch({
    headless: true,
    channel: 'chrome',
    args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--hide-scrollbars'],
  });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, colorScheme: 'dark' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    await page.goto(new URL('?piece=camera', url).href, { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean(window.p2p), { timeout: 20000 });

    const backend = await page.evaluate(() => window.p2p.backend());
    check('backend is webgpu', backend === 'webgpu', `got "${backend}"`);

    await page.evaluate(() => window.p2p.piece('loupe'));
    await page.evaluate(() => window.p2p.settle());
    await page.waitForFunction(() => window.p2p.render() !== null, { timeout: 20000 });

    // Tap a real highlight-edge pixel (per the choreography's own brief), not a hardcoded coordinate.
    const edge = await page.evaluate(() => window.p2p.pieces.loupe.findHighlightEdge());
    check('found a highlight-edge pixel to tap', edge !== null, edge ? `(${edge.x}, ${edge.y})` : 'none found');
    if (edge) await page.evaluate((e) => window.p2p.pieces.loupe.tap(e.x, e.y), edge);
    else await page.evaluate(() => window.p2p.pieces.loupe.tap(300, 200));

    // Let the dive settle and the async pixelAt() resolve.
    await page.waitForFunction(() => window.p2p.pieces.loupe.state().hasPixel === true, { timeout: 20000 });
    await page.evaluate(() => window.p2p.settle());
    await page.waitForTimeout(300);
    await page.evaluate(() => window.p2p.settle());

    // ---- check 1: drawn fill height/well height == electrons/fullWell within 1%; brightness follows too ----
    const fill = await page.evaluate(() => window.p2p.pieces.loupe.drawnFill());
    if (fill.fillFrac !== null) {
      const drawnFrac = fill.fillHeightUnits / fill.wellHeightUnits;
      const err = Math.abs(drawnFrac - fill.fillFrac) / Math.max(1e-9, fill.fillFrac);
      check('drawn fill height / well height == electrons/fullWell', err <= 0.01,
        `drawn ${drawnFrac.toFixed(4)} vs electrons/fullWell ${fill.fillFrac.toFixed(4)} (${(err * 100).toFixed(2)}%)`);
      // Brightness (the material's own color magnitude) tracks the same fraction: chargeMaterial's own
      // contract (look.ts) is color = baseColor * (0.22 + 0.78 * frac) (raised from a flat max(0.08, frac)
      // floor -- art director, "charge-fill-illegible": at this piece's typical mid-range fractions the old
      // floor scaled the icy-blue base color down to a desaturated gray next to the well's own glass tint),
      // so color[2] (the B channel, 0xff base) divided by 0xff/255=1 recovers that multiplier directly.
      const brightnessMultiplier = fill.chargeColor[2]; // B channel of 0xbfe4ff normalized is ~1.0 * multiplier
      const expectedMultiplier = 0.22 + 0.78 * Math.max(0, Math.min(1, fill.fillFrac));
      const bErr = Math.abs(brightnessMultiplier - expectedMultiplier) / expectedMultiplier;
      check('fill brightness follows the same fraction', bErr <= 0.05,
        `brightness multiplier ${brightnessMultiplier.toFixed(4)} vs expected ${expectedMultiplier.toFixed(4)} (${(bErr * 100).toFixed(2)}%)`);
    } else {
      check('drawn fill height / well height == electrons/fullWell', false, 'no pixel resolved');
    }

    // ---- check 2: measured raw DN noise vs the engine's predicted sigma, within 5% -------------------------
    const noise = await page.evaluate(() => window.p2p.pieces.loupe.grayPatchNoise());
    if (noise) {
      const err = Math.abs(noise.measuredSigmaDn - noise.predictedSigmaDn) / noise.predictedSigmaDn;
      check('measured noise vs predicted sigma (ColorChecker gray patch, G channel)', err <= 0.05,
        `measured ${noise.measuredSigmaDn.toFixed(3)} DN vs predicted ${noise.predictedSigmaDn.toFixed(3)} DN ` +
        `(${(err * 100).toFixed(2)}%, n=${noise.n} samples)`);
    } else {
      check('measured noise vs predicted sigma', false, 'grayPatchNoise() returned null (not enough samples?)');
    }

    // ---- check 3: pixelAt() is deterministic ----------------------------------------------------------------
    const twice = await page.evaluate(() => window.p2p.pieces.loupe.pixelAtTwice());
    const det = JSON.stringify(twice.a) === JSON.stringify(twice.b);
    check('pixelAt() is deterministic at the same (renderId, x, y)', det,
      det ? 'two calls returned identical PixelState' : `a=${JSON.stringify(twice.a)} b=${JSON.stringify(twice.b)}`);

    // ---- check 4: badge N * dots drawn == photon count within one dot ---------------------------------------
    const badge = await page.evaluate(() => window.p2p.pieces.loupe.badge());
    const badgeErr = Math.abs(badge.photonsMean - badge.n * badge.dotsDrawn);
    check('badge N x dots drawn == photon count within one dot', badgeErr <= badge.n,
      `${badge.n} x ${badge.dotsDrawn} = ${badge.n * badge.dotsDrawn} vs photonsMean ${badge.photonsMean.toFixed(1)} ` +
      `(off by ${badgeErr.toFixed(1)}, one dot = ${badge.n})`);

    // ---- check 5: the charge fill is visible and responsive on a REAL rendered pixel, not just the scene graph
    // (see the module header). stage.ts pauses its whole render loop via an IntersectionObserver whenever #gl
    // scrolls out of the viewport, so the canvas has to be scrolled into view first or every sample below is
    // stale/black regardless of what is actually drawn (found building this check; not a defect in the piece).
    await page.evaluate(() => document.getElementById('gl').scrollIntoView({ block: 'start' }));

    function pixelAt(img, x, y) {
      x = Math.max(0, Math.min(img.width - 1, Math.round(x)));
      y = Math.max(0, Math.min(img.height - 1, Math.round(y)));
      const o = (y * img.width + x) * 4;
      return [img.data[o], img.data[o + 1], img.data[o + 2], img.data[o + 3]];
    }
    async function tapAndSample(px, py) {
      await page.evaluate((e) => window.p2p.pieces.loupe.tap(e.x, e.y), { x: px, y: py });
      await page.waitForFunction(() => window.p2p.pieces.loupe.state().hasPixel === true, { timeout: 20000 });
      await page.waitForFunction(() => window.p2p.pieces.loupe.state().diveStage === 'well', { timeout: 20000 });
      await page.evaluate(() => window.p2p.settle());
      await page.waitForTimeout(3000); // let the camera finish easing into WELL_FRAME (DIVE_MAX_MS caps at 2400)
      await page.evaluate(() => window.p2p.settle());
      await page.waitForTimeout(300);
      const fill = await page.evaluate(() => window.p2p.pieces.loupe.drawnFill());
      const dbg = await page.evaluate(() => window.p2p.pieces.loupe.debugCamera());
      const canvasBox = await page.evaluate(() => {
        const r = document.getElementById('gl').getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      });
      const img = decodePNG(await page.screenshot({ clip: canvasBox }));
      const [ndcX, ndcY] = dbg.chargeNdc;
      const screenX = ((ndcX + 1) / 2) * img.width;
      const screenY = ((1 - ndcY) / 2) * img.height;
      return { fillFrac: fill.fillFrac, px: pixelAt(img, screenX, screenY), bg: pixelAt(img, 4, 4) };
    }
    async function findDarkPixel() {
      return page.evaluate(() => {
        const view = window.p2p.render();
        const lum = (i) => 0.2126 * view.rgba[i * 4] + 0.7152 * view.rgba[i * 4 + 1] + 0.0722 * view.rgba[i * 4 + 2];
        let best = null;
        for (let y = 1; y < view.height - 1; y += 3) {
          for (let x = 1; x < view.width - 1; x += 3) {
            const i = y * view.width + x;
            const l = lum(i);
            if (!best || l < best.l) best = { x, y };
          }
        }
        return best;
      });
    }
    const darkPx = (await findDarkPixel()) ?? { x: 10, y: 10 };
    const bright = await tapAndSample(edge ? edge.x : 300, edge ? edge.y : 200);
    const dark = await tapAndSample(darkPx.x, darkPx.y);
    const distFromBg = (s) => Math.hypot(s.px[0] - s.bg[0], s.px[1] - s.bg[1], s.px[2] - s.bg[2]);
    const fracGap = (bright.fillFrac ?? 0) - (dark.fillFrac ?? 0);
    if (bright.fillFrac === null || dark.fillFrac === null) {
      check('charge fill renders as a real, visible pixel (not just the scene graph)', false, 'one of the two taps did not resolve a pixel');
    } else {
      for (const [label, s] of [['bright', bright], ['dark', dark]]) {
        const d = distFromBg(s);
        check(`charge fill renders as a real, non-background pixel [${label} tap, fillFrac=${s.fillFrac.toFixed(3)}]`,
          d >= 8, `color-distance from background ${d.toFixed(1)} (rgb=${s.px.slice(0, 3)}, bg=${s.bg.slice(0, 3)})`);
      }
      if (Math.abs(fracGap) >= 0.1) {
        const colorDist = Math.hypot(bright.px[0] - dark.px[0], bright.px[1] - dark.px[1], bright.px[2] - dark.px[2]);
        const sumBright = bright.px[0] + bright.px[1] + bright.px[2];
        const sumDark = dark.px[0] + dark.px[1] + dark.px[2];
        const rightDirection = fracGap > 0 ? sumBright >= sumDark : sumBright <= sumDark;
        check('rendered charge color tracks electrons/fullWell in the right direction (real pixel, not scene graph)',
          colorDist >= 10 && rightDirection,
          `engine fillFrac gap ${fracGap.toFixed(3)} (bright ${bright.fillFrac.toFixed(3)} vs dark ${dark.fillFrac.toFixed(3)}), ` +
          `sampled color distance ${colorDist.toFixed(1)} (bright rgb=${bright.px.slice(0, 3)}, dark rgb=${dark.px.slice(0, 3)})`);
      } else {
        console.log(`accuracy/loupe: NOTE -- skipping the directional check, fracGap ${fracGap.toFixed(3)} too small at this scenario to be a fair test`);
      }
    }

    // ---- check 6: the breadcrumb inset actually shows the photo, not an empty/uniform box (critic,
    // "breadcrumb-empty" -- found again by the art director after the first fixer pass: the original version
    // of this check clipped the WHOLE .inset-frame DOM rect, which also carries the "THE PHOTO" label text
    // (.inset-frame::after) AND the unrelated .hud.bl scale-badge caption sitting in the same bottom-left
    // corner -- white label text alone supplies luma spread well over the threshold regardless of whether the
    // WebGPU-rendered thumbnail underneath is blank, so this used to pass even while the render was empty
    // (art director, "gate-check6-is-a-proxy"). Hides both text layers for one frame so only the actual
    // canvas pixels inside the rect are sampled, then restores them.
    const crumbRect = await page.evaluate(() => document.querySelector('.inset-frame')?.getBoundingClientRect() ?? null);
    if (!crumbRect) {
      check('breadcrumb inset is present once a target is set', false, 'no .inset-frame element found in the DOM');
    } else {
      const styleHandle = await page.evaluate(() => {
        const style = document.createElement('style');
        style.textContent = '.inset-frame::after { display: none !important; } .scale-badge { visibility: hidden !important; }';
        document.head.appendChild(style);
        return true;
      });
      void styleHandle;
      // Inset by a few px so the box's own 1px hairline border (a UI-chrome color, not canvas content --
      // sampling right up to the box edge lets the border ALONE supply enough luma spread to pass this check
      // even over an otherwise-empty canvas, the same "measures a proxy, not the claim" shape as the label
      // text bug this check is already working around) never enters the sample.
      const INSET = 4;
      const sampleRect = {
        x: crumbRect.x + INSET, y: crumbRect.y + INSET,
        width: Math.max(1, crumbRect.width - INSET * 2), height: Math.max(1, crumbRect.height - INSET * 2),
      };
      const crumbImg = decodePNG(await page.screenshot({ clip: sampleRect }));
      await page.evaluate(() => {
        const style = [...document.head.querySelectorAll('style')].find((s) => s.textContent?.includes('.inset-frame::after'));
        style?.remove();
      });
      let minL = 255, maxL = 0;
      for (let i = 0; i < crumbImg.data.length; i += 4) {
        const l = 0.2126 * crumbImg.data[i] + 0.7152 * crumbImg.data[i + 1] + 0.0722 * crumbImg.data[i + 2];
        if (l < minL) minL = l; if (l > maxL) maxL = l;
      }
      check('breadcrumb inset shows real image content, not a flat/empty box (label/caption text hidden for this sample)',
        maxL - minL >= 12,
        `luma range ${minL.toFixed(1)}-${maxL.toFixed(1)} (spread ${(maxL - minL).toFixed(1)}) over its own ${crumbImg.width}x${crumbImg.height} rect`);
      const crumbDbg = await page.evaluate(() => window.p2p.pieces.loupe.debugCamera());
      check('breadcrumb marks the tapped pixel', crumbDbg.crumbMarkerVisible === true,
        `crumbMarkerVisible=${crumbDbg.crumbMarkerVisible}`);
    }

    // ---- WebGL2 fallback: renders without errors --------------------------------------------------------
    const glCtx = await browser.newContext({ viewport: { width: 1200, height: 800 }, colorScheme: 'dark' });
    const glPage = await glCtx.newPage();
    const glErrors = [];
    glPage.on('pageerror', (e) => glErrors.push(String(e)));
    glPage.on('console', (m) => { if (m.type() === 'error') glErrors.push(m.text()); });
    await glPage.goto(`${url}?gl=webgl2`, { waitUntil: 'load' });
    await glPage.waitForFunction(() => Boolean(window.p2p), { timeout: 20000 });
    const glBackend = await glPage.evaluate(() => window.p2p.backend());
    await glPage.evaluate(() => window.p2p.piece('loupe'));
    await glPage.evaluate(() => window.p2p.settle());
    await glPage.waitForFunction(() => window.p2p.render() !== null, { timeout: 20000 });
    const glEdge = await glPage.evaluate(() => window.p2p.pieces.loupe.findHighlightEdge());
    await glPage.evaluate((e) => window.p2p.pieces.loupe.tap(e ? e.x : 300, e ? e.y : 200), glEdge);
    await glPage.waitForTimeout(2200);
    await glPage.evaluate(() => window.p2p.settle());
    check('WebGL2 fallback (?gl=webgl2) renders with zero console errors', glBackend === 'webgl2' && glErrors.length === 0,
      `backend "${glBackend}", ${glErrors.length} console error(s)${glErrors.length ? ': ' + glErrors.join(' | ') : ''}`);
    await glCtx.close();

    check('zero console errors on the main (WebGPU) page', errors.length === 0,
      errors.length ? errors.join(' | ') : 'none');
  } finally {
    await browser.close();
    await close();
  }
}

await main();
if (failed) {
  console.error('accuracy/loupe: FAILED');
  process.exitCode = 1;
} else {
  console.log('accuracy/loupe: all checks passed');
}
