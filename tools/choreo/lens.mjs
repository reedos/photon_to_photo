// The lens cutaway's 8s recording (tools/record.mjs drives this): start wide open on p50, slowly orbit, stop
// down to f/8 (the blades close, marginal rays drop out), rack focus from infinity to the closest focus (the
// focus group moves), then switch to p135 (rebuild). Drives the page through window.p2p only -- see
// tools/record.mjs's own header for why nothing here may await a page promise that needs rAF/timers.

export const query = 'piece=lens&lens=p50&fno=1.4&focus=inf&shutter=1%2F250&iso=100&format=ff';
export const seconds = 8;

let orbitBox = null;

export async function setup(vt) {
  await vt.page.evaluate(() => window.p2p.set({ lens: 'p50', fno: 1.4, focusM: null }));
  await vt.until(() => !!window.p2p?.model?.(), { max: 5000 });
  await vt.page.locator('#stage-section').scrollIntoViewIfNeeded();
  orbitBox = await vt.page.locator('#view').boundingBox();
  // A small, slow orbit over the first 2s -- a real pointer drag over the view's own center (OrbitControls' own
  // input path; pieces never own the camera, so this is driven the same way a reader's mouse would drive it,
  // not a p2p call), a few px total so the framing stays close to the piece's own three-quarter view.
  await vt.page.mouse.move(orbitBox.x + orbitBox.width / 2, orbitBox.y + orbitBox.height / 2);
  await vt.page.mouse.down();
}

const clamp01 = (t) => Math.min(1, Math.max(0, t));
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const lerp = (a, b, t) => a + (b - a) * t;

export async function frame(vt, t) {
  // 0.0 - 2.0s: wide open on p50, a slow orbit via the same drag OrbitControls reads from a reader's own mouse.
  if (t < 2.0) {
    const cx = orbitBox.x + orbitBox.width / 2;
    const cy = orbitBox.y + orbitBox.height / 2;
    await vt.page.mouse.move(cx + t * 14, cy - t * 3);
    return;
  }
  if (t < 2.05) {
    await vt.page.mouse.up();
    return;
  }

  // 2.0 - 4.5s: stop down from f/1.4 to f/8, eased.
  if (t < 4.5) {
    const u = easeInOut(clamp01((t - 2.0) / 2.5));
    const fno = lerp(1.4, 8, u);
    await vt.page.evaluate((f) => window.p2p.set({ fno: f }), fno);
    return;
  }

  // 4.5 - 7.0s: rack focus from infinity to the lens's closest focus, eased.
  if (t < 7.0) {
    const u = easeInOut(clamp01((t - 4.5) / 2.5));
    if (u <= 0.001) {
      await vt.page.evaluate(() => window.p2p.set({ focusM: null }));
      return;
    }
    const closestM = await vt.page.evaluate(() => window.p2p.model().lens.closestFocusMm / 1000);
    // Log-interpolate from a very large "infinity stand-in" distance down to the closest focus, so the motion
    // reads as a smooth rack rather than snapping at the very start (infinity itself is not a finite point to
    // interpolate from).
    const farM = 20;
    const m = Math.exp(lerp(Math.log(farM), Math.log(closestM), u));
    await vt.page.evaluate((mm) => window.p2p.set({ focusM: mm }), m);
    return;
  }

  // 7.0 - 8.0s: switch to p135 (a lens-id change -- the piece rebuilds its geometry and re-frames the camera).
  if (t < 7.05) {
    await vt.page.evaluate(() => window.p2p.set({ lens: 'p135', fno: 8, focusM: null }));
  }
}
