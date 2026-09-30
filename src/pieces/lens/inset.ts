// The detail inset (BRIEF.md set piece 2): "a magnified orthographic view of the image plane around the
// off-axis bundle's landing point, where the wavelengths visibly separate ... with the magnification stated in
// its caption and the scale badge." It is drawn as a spot diagram: lens.ts puts a wavelength-colored dot at each
// traced landing point of the off-axis fan and the sensor's pixel grid behind them, and this module supplies the
// orthographic camera looking straight at that patch of the image plane, the inset's rectangle in the view, and
// the magnification, a measured ratio of two screen scales rather than a chosen constant.
import * as THREE from 'three/webgpu';
import type { RaySample } from './rays';
import { badgeJoin } from '../phone-frame';

export interface InsetFrame {
  camera: THREE.OrthographicCamera;
  rect: { left: number; bottom: number; width: number; height: number };
  magnification: number;
  spreadMm: number;
  center: THREE.Vector3;
  /** The field fraction whose landing spot the inset shows. */
  field: number;
  /** The view size this frame was laid out for (lens.ts re-lays it out when the view resizes). */
  viewW: number;
  viewH: number;
  /** Whether lens.ts drew the pixel grid (it leaves it out when a pixel would be under 4 screen px). */
  gridShown: boolean;
  /** Re-measures the magnification against the main camera where it is now (it moves during a dive or an orbit). */
  refreshMag(): number;
  /** The scale badge text for this inset (design/LOOK.md: the badge says how much the picture is scaled). */
  badge(): string;
  /** The inset's own caption with its magnification in it ("Edge of frame · 100×"), so the scale is stated on
   *  the picture it describes rather than in the view's far corner (R2-07). */
  caption(): string;
  /** A round length on the image plane and how many screen px it spans inside the inset (the inset's scale bar). */
  scaleBar(): { px: number; label: string };
}

const PADDING = 1.5; // the landing spread fills about 1/PADDING of the inset's height (R1-12, R2-07: the spots fill it)
const MIN_SPREAD_MM = 0.01; // floor so an on-axis/negligible-color lens doesn't divide by ~0

function maxChord(pts: { x: number; y: number }[]): number {
  let best = 0;
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
      if (d > best) best = d;
    }
  }
  return best;
}

/** The inset's rectangle. Desktop: bottom-right, just above the backend chip, clear of the HUD buttons at the top
 *  right and of the scale badge's bottom-left corner. Phone: top-right, just under the layer switch, since the
 *  bottom band holds the badge and the chip. lens.ts frames the cutaway away from whichever corner this takes. */
export function insetRect(viewW: number, viewH: number): InsetFrame['rect'] {
  const winW = typeof window !== 'undefined' ? window.innerWidth : viewW;
  const phone = winW <= 760;
  const width = phone ? Math.min(168, Math.round(viewW * 0.43)) : Math.min(212, Math.max(160, Math.round(viewW * 0.18)));
  const height = Math.round(width * 0.86);
  const right = phone ? 12 : 22;
  const bottom = phone ? Math.max(8, viewH - 58 - height) : 58;
  return { left: Math.max(8, viewW - right - width), bottom, width, height };
}

function niceRound(v: number): number {
  const magnitude = Math.pow(10, Math.floor(Math.log10(Math.max(1, v))));
  return Math.round(v / magnitude) * magnitude || Math.round(v);
}

/**
 * Builds the inset's orthographic camera, centered on the off-axis fan's landing centroid at the image plane,
 * sized so its computed spread fills the frame. `mainCamera` and the view size give the main view's own
 * mm-per-pixel scale at that same depth, so the magnification is a real ratio of two measured scales.
 */
export function buildInsetFrame(
  samples: RaySample[],
  imagePlaneZ: number,
  mainCamera: THREE.PerspectiveCamera,
  viewW: number,
  viewH: number,
  pitchUm: number,
): InsetFrame {
  const rect = insetRect(viewW, viewH);
  const maxField = samples.reduce((m, s) => Math.max(m, s.field), 0);
  const landing = samples
    .filter((s) => s.status === 'ok' && s.field === maxField)
    .map((s) => s.world[s.world.length - 1])
    .map(([x, y]) => ({ x, y }));

  let cx = 0, cy = 0;
  for (const p of landing) { cx += p.x; cy += p.y; }
  if (landing.length > 0) { cx /= landing.length; cy /= landing.length; }
  const spreadMm = Math.max(MIN_SPREAD_MM, maxChord(landing));

  const insetHalfHeightMm = (spreadMm * PADDING) / 2;
  const aspect = rect.width / rect.height;
  // The spot column sits a tenth of the width right of center, so the scale bar and its label in the bottom-left
  // corner stay clear of the lowest spot (R2-07). Only the frustum shifts; the center and the scale do not.
  const halfW = insetHalfHeightMm * aspect;
  const shift = 0.2 * halfW;
  const camera = new THREE.OrthographicCamera(
    -halfW - shift, halfW - shift, insetHalfHeightMm, -insetHalfHeightMm, 0.01, 100,
  );
  // Looking along the axis from the lens side, the way the main view faces the sensor; only the dots and the grid
  // (lens.ts) are in the inset's own scene.
  camera.position.set(cx, cy, imagePlaneZ - 10);
  camera.up.set(0, 1, 0);
  camera.lookAt(cx, cy, imagePlaneZ);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);

  // The main view's own mm-per-pixel scale at the image plane's depth (a perspective camera's visible height at
  // distance d is 2 d tan(fov/2)), so the ratio is a real comparison of two measured screen scales.
  const center = new THREE.Vector3(cx, cy, imagePlaneZ);
  const pxPerMmInset = rect.height / (insetHalfHeightMm * 2);
  const measure = () => {
    const depth = mainCamera.position.distanceTo(center);
    const mainFullHeightMm = 2 * depth * Math.tan(THREE.MathUtils.degToRad(mainCamera.fov / 2));
    return pxPerMmInset / (viewH / mainFullHeightMm);
  };

  const frame: InsetFrame = {
    camera, rect, magnification: measure(), spreadMm, center,
    field: maxField, viewW, viewH, gridShown: false,
    refreshMag() {
      frame.magnification = measure();
      return frame.magnification;
    },
    scaleBar() {
      // 1, 2 or 5 times a power of ten, in micrometers, spanning 36-90 px of the inset
      const pxPerUm = pxPerMmInset / 1000;
      const want = 56 / pxPerUm;
      const p10 = Math.pow(10, Math.floor(Math.log10(want)));
      const um = [1, 2, 5, 10].map((k) => k * p10).reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a));
      const label = um >= 1000 ? `${(um / 1000).toLocaleString('en-US')} mm` : `${um.toLocaleString('en-US', { maximumFractionDigits: 2 })} µm`;
      return { px: um * pxPerUm, label };
    },
    caption() {
      return `Edge of frame · ${niceRound(frame.magnification).toLocaleString('en-US')}×`;
    },
    badge() {
      const mag = niceRound(frame.magnification).toLocaleString('en-US');
      return frame.gridShown ? badgeJoin(`INSET ${mag}×`, '1 SQUARE = 1 PIXEL') : `INSET ${mag}×`;
    },
  };
  return frame;
}
