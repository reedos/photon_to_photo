// Choreography for set piece 3 (cone of focus + bokeh disk), 8s: docs/pieces/cone.md's recording brief.
//   0.0-4.5s  the point walks 0.8m -> the focus distance (3m) -> 20m, on axis (the disk shrinks to a point,
//             mid-clip, and grows again on either side of true focus)
//   4.5-6.0s  the point moves out to the frame corner (field 0 -> 1), defocused, so the cat's-eye shows
//   6.0-8.0s  the aperture stops down from wide open (f/1.4) to f/5.6, on axis, defocused (the disk shrinks and
//             the blade shape starts to show)
// See tools/record.mjs's own contract comment: drive the page with synchronous p2p calls inside frame(), never
// await a page promise that needs rAF/timers under the virtual clock.
export const query = 'piece=cone&lens=p50&fno=1.4&focus=3';
export const seconds = 8;

const FOCUS_M = 3;
const NEAR_M = 0.8;
const FAR_M = 20;
const CORNER_POINT_M = 4; // defocused enough for a clearly visible cat's eye
const STOPPED_POINT_M = 4; // defocused enough that the stopped-down disk still reads as a disk, not a point
const START_FNO = 1.4;
const END_FNO = 5.6;

function lerp(a, b, t) { return a + (b - a) * t; }
/** Log-interpolate a distance in meters (matches ui.ts's own focus-slider convention: log scale, sub-meter to
 *  tens of meters spans multiple orders of magnitude). */
function logLerpM(aM, bM, t) { return Math.exp(lerp(Math.log(aM), Math.log(bM), t)); }
function smooth(t) { return t * t * (3 - 2 * t); } // ease in/out, cheap cubic smoothstep

export async function setup(vt) {
  // Make sure the piece is really showing 'cone' and the overlay sliders exist before frame() starts driving them.
  await vt.until(() => !!(window.p2p && typeof window.p2p.pieces?.cone?.setPoint === 'function'), { max: 20000 });
  // The page loads scrolled to the top (the scenario builder); the 3D stage sits further down.
  await vt.page.evaluate(() => document.getElementById('stage-section')?.scrollIntoView());
  await vt.page.evaluate(() => window.p2p.pieces.cone.setPoint(0.8 * 1000, 0));
}

export async function frame(vt, t) {
  if (t <= 4.5) {
    const u = smooth(Math.min(1, t / 4.5));
    // Two-segment log walk (near -> focus -> far) so the true-focus point (the disk collapsing to ~0) actually
    // lands partway through this phase, not right at an endpoint.
    const mid = 4.5 * (Math.log(FOCUS_M / NEAR_M) / Math.log(FAR_M / NEAR_M));
    const distM = t <= mid
      ? logLerpM(NEAR_M, FOCUS_M, smooth(Math.min(1, t / Math.max(1e-6, mid))))
      : logLerpM(FOCUS_M, FAR_M, smooth(Math.min(1, (t - mid) / Math.max(1e-6, 4.5 - mid))));
    void u;
    await vt.page.evaluate((d) => window.p2p.pieces.cone.setPoint(d * 1000, 0), distM);
  } else if (t <= 6.0) {
    const u = smooth(Math.min(1, (t - 4.5) / 1.5));
    await vt.page.evaluate(([d, f]) => window.p2p.pieces.cone.setPoint(d * 1000, f), [CORNER_POINT_M, u]);
  } else {
    const u = smooth(Math.min(1, (t - 6.0) / 2.0));
    const fno = lerp(START_FNO, END_FNO, u);
    await vt.page.evaluate(([f, d]) => { window.p2p.set({ fno: f }); window.p2p.pieces.cone.setPoint(d * 1000, 0); }, [fno, STOPPED_POINT_M]);
  }
}
