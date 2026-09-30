// Choreography for set piece 9, the loupe (9 s): the final image on screen, a tap on a real highlight-edge
// pixel (found by p2p.pieces.loupe.findHighlightEdge(), not a hardcoded coordinate), the dive down to the
// well while photons arrive and the charge is visible, a short hold, then Back up to the photo. Driven
// entirely through window.p2p (synchronous calls inside frame()/setup()) per tools/record.mjs's own rule:
// never await a page promise that needs rAF or timers under the virtual clock.
//
//   node tools/preview.mjs   (in one terminal, P2P_PREVIEW_PORT=47513)
//   node tools/record.mjs tools/choreo/loupe.mjs --base http://127.0.0.1:47513/

export const query = 'piece=loupe&lens=p50&fno=1.4&shutter=1/250&iso=100&focus=3&format=ff';
export const seconds = 9;

// Frame timeline (see the module doc comment): hold on the photo, tap, dive (piece-internal 480ms delay +
// its own log-dolly animation), hold at the well, Back.
const T_TAP = 1.0;
const T_BACK = 6.6;

let tapped = false;
let backed = false;

export async function setup(vt) {
  // Wait for the app and a first render before frame 0, same guard record.mjs's own callers use.
  await vt.until(() => Boolean(window.p2p && typeof window.p2p.backend === 'function' && window.p2p.backend()));
  await vt.until(() => window.p2p.render() !== null);
  // The 3D stage sits below the page's own scenario controls at scroll 0 -- without this, every frame this
  // choreography records is the "Set the shot" panel, never the stage at all (found running this choreography
  // this session: the un-scrolled contact sheet was 12 identical frames of scenario sliders). shots/review-
  // loupe/independent.mjs and tools/accuracy/loupe.mjs both already scroll #gl/#stage-section into view before
  // reading anything visual, for the same reason.
  await vt.page.evaluate(() => document.getElementById('stage-section').scrollIntoView({ block: 'start' }));
  // NOT `await vt.page.evaluate(() => window.p2p.settle())` -- settle() resolves via a real
  // requestAnimationFrame, which this module's own virtual clock (tools/vt.mjs's shim) never fires except
  // inside vt.advance()/vt.until(); awaiting it directly here deadlocks setup() forever (found running this
  // choreography this session -- exactly the failure mode this module's own header comment already warns
  // against, just not yet applied to this one call). record.mjs's own caller already runs `vt.wait(300)`
  // right after setup() returns, which pumps the virtual clock through vt.advance() and settles the first
  // frame the same way -- nothing here needs to force an extra one.
}

export async function frame(vt, t) {
  if (!tapped && t >= T_TAP) {
    tapped = true;
    await vt.page.evaluate(() => {
      const edge = window.p2p.pieces.loupe.findHighlightEdge();
      const view = window.p2p.render();
      const target = edge ?? { x: Math.floor(view.width / 2), y: Math.floor(view.height / 2) };
      window.p2p.pieces.loupe.tap(target.x, target.y);
    });
  }
  if (!backed && t >= T_BACK) {
    backed = true;
    await vt.page.evaluate(() => window.p2p.pieces.loupe.back());
  }
}
