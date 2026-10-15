// The detail inset (BRIEF.md set piece 2): "a magnified orthographic view of the image plane around the
// off-axis bundle's landing point, where the wavelengths visibly separate ... with the magnification stated in
// its caption and the scale badge." It is drawn as a spot diagram: lens.ts puts a wavelength-colored dot at each
// traced landing point of the off-axis fan and the sensor's pixel grid behind them, and this module supplies the
// orthographic camera looking straight at that patch of the image plane, the inset's rectangle in the view, and
// the magnification, a measured ratio of two screen scales rather than a chosen constant.
import * as THREE from 'three/webgpu';
import type { RaySample } from './rays';
import { badgeJoin, compactInsetRect, compactView, isPhone } from '../phone-frame';
import { fmtMag } from '../../app/units';

export interface InsetFrame {
  camera: THREE.OrthographicCamera;
  rect: { left: number; bottom: number; width: number; height: number };
  magnification: number;
  spreadMm: number;
  /** Score loop r2: the landing spread split into its two parts. `colorShiftMm` is the largest distance between
   *  two wavelengths' landing centroids (lateral color); `spotMm` is the widest single-wavelength chord (the
   *  monochromatic aberration, plus any defocus). */
  colorShiftMm: number;
  spotMm: number;
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
  /** The inset's own caption with its magnification in it ("Edge of frame, magnified 100×"), so the scale is stated on
   *  the picture it describes rather than in the view's far corner (R2-07). */
  caption(): string;
  /** A round length on the image plane and how many screen px it spans inside the inset (the inset's scale bar). */
  scaleBar(): { px: number; label: string };
}

const PADDING = 1.5; // the landing spread fills about 1/PADDING of the inset's height (R1-12, R2-07: the spots fill it)
// The band at the inset's top that its caption ("Edge of frame, magnified 140×") takes, in px: the spots are centered in the
// rest of the height, so the top cluster never runs into the caption (score loop r2, landscape phone).
const TITLE_BAND_PX = 40; // score loop r6: two caption lines (the desktop caption wraps in a 200 px frame) plus a 6 px safe band; was 24
// A narrow compact inset (every phone held upright, a phone on its side) sets its caption on two lines, "Magnified" over the
// figure, so the band is two lines tall there (score loop r5: the one-line caption ran past the inset, the figure lost).
const NARROW_INSET_PX = 150;
const TITLE_BAND_TWO_LINES_PX = 44; // was 38
function isCompact(viewW: number, viewH: number): boolean { return isPhone() || compactView(viewH, viewW); }
function titleBand(rect: { width: number }, viewW: number, viewH: number): number {
  return isCompact(viewW, viewH) && rect.width < NARROW_INSET_PX ? TITLE_BAND_TWO_LINES_PX : TITLE_BAND_PX;
}
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
 *  right and of the scale badge's bottom-left corner. A compact view (a phone, or a phone on its side) takes the
 *  shared top-right rule in phone-frame.ts, capped by the view's own size, and lens.ts frames the cutaway into the
 *  free region beside it, so the image plane and the pins stay clear (Reed's decision 3). */
export function insetRect(viewW: number, viewH: number): InsetFrame['rect'] {
  // Compact views (a phone, or a view too short for the bottom-right corner) size the inset from the view itself
  // and lens.ts frames the cutaway beside it with the same rule (phone-frame.ts).
  // A phone held upright gives the inset 30% of the width, not 38%: the cutaway beside it then spans about 60% of the
  // view instead of about half, and its pins stop crowding over the rays (score loop r3).
  if (isPhone()) return compactInsetRect(viewW, viewH, Math.round(viewW * 0.3), 0.86);
  if (compactView(viewH, viewW)) return compactInsetRect(viewW, viewH, 168, 0.86);
  const width = Math.min(212, Math.max(160, Math.round(viewW * 0.18)));
  const height = Math.round(width * 0.86);
  return { left: Math.max(8, viewW - 22 - width), bottom: 58, width, height };
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
  const band = titleBand(rect, viewW, viewH);
  const maxField = samples.reduce((m, s) => Math.max(m, s.field), 0);
  const landing = samples
    .filter((s) => s.status === 'ok' && s.field === maxField)
    .map((s) => s.world[s.world.length - 1])
    .map(([x, y]) => ({ x, y }));

  let cx = 0, cy = 0;
  for (const p of landing) { cx += p.x; cy += p.y; }
  if (landing.length > 0) { cx /= landing.length; cy /= landing.length; }
  const spreadMm = Math.max(MIN_SPREAD_MM, maxChord(landing));
  const byNm = new Map<number, { x: number; y: number }[]>();
  for (const s of samples) {
    if (s.status !== 'ok' || s.field !== maxField) continue;
    const [x, y] = s.world[s.world.length - 1];
    let list = byNm.get(s.nm);
    if (!list) byNm.set(s.nm, (list = []));
    list.push({ x, y });
  }
  const centroids: { x: number; y: number }[] = [];
  let spotMm = 0;
  for (const pts of byNm.values()) {
    spotMm = Math.max(spotMm, maxChord(pts));
    centroids.push({ x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length });
  }
  const colorShiftMm = maxChord(centroids);

  // the spread fills 1/PADDING of the height left under the caption band (score loop r2)
  const insetHalfHeightMm = ((spreadMm * PADDING) / 2) * (rect.height / Math.max(40, rect.height - band));
  const aspect = rect.width / rect.height;
  // The spot column sits a tenth of the width right of center, so the scale bar and its label in the bottom-left
  // corner stay clear of the lowest spot (R2-07). Only the frustum shifts; the center and the scale do not.
  const halfW = insetHalfHeightMm * aspect;
  const shift = 0.2 * halfW;
  // The caption band, in mm at this inset's scale; the frustum moves up by half of it, so the spots sit centered
  // below the caption. Only the frustum shifts; the center and the scale do not.
  const bandMm = (band / rect.height) * insetHalfHeightMm * 2;
  const camera = new THREE.OrthographicCamera(
    -halfW - shift, halfW - shift, insetHalfHeightMm + bandMm / 2, -insetHalfHeightMm + bandMm / 2, 0.01, 100,
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
    camera, rect, magnification: measure(), spreadMm, colorShiftMm, spotMm, center,
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
      return insetCaption(fmtMag(frame.magnification), rect.width, compactView(viewH, viewW));
    },
    badge() {
      const mag = fmtMag(frame.magnification);
      return frame.gridShown ? badgeJoin(`INSET ${mag}`, '1 SQUARE = 1 PIXEL') : `INSET ${mag}`;
    },
  };
  return frame;
}

/** The inset's caption. Only the dot and the number are glued (a caption never wraps after a dangling "·" or leaves
 *  the "×" alone); every other space may break, so a long caption wraps inside its frame instead of running through the
 *  border (score loop r5: the old no-break spaces made "Edge, magnified 690×" one 130 px word in a 101 px frame, and the
 *  magnification, the inset's scale statement, ran off the view). A frame narrower than `WORDED_MIN_W` px, which is
 *  every phone held upright, gets a three-word form that always fits: "Edge · 690×". */
export const WORDED_MIN_W = 150;
export function insetCaption(mag: string, frameW: number, compact: boolean): string {
  const nb = String.fromCharCode(0xa0);
  if (frameW < WORDED_MIN_W) return `Edge ·${nb}${mag}`;
  // The number is the inset's enlargement over the lens as drawn in the main view (score loop r5: a bare "magnified 420×" never said 420× of what).
  return compact ? `Edge, ${mag}` : `Edge of frame, ${mag} larger than drawn`;
}

/** The inset legend (score loop r4: plain words). What is drawn: a dot is one traced ray, the dots line up from red to
 *  violet (the colors land that far apart), and the bar beside them for each color is that color's own spread. The
 *  comparison of the two (which part is larger) lives on the inset's card, not in this one-line key; the old line packed
 *  "color error", "other blur" and two sizes joined by a bare ">" into one sentence. */
export function insetLegend(frame: Pick<InsetFrame, 'colorShiftMm' | 'spotMm'>, short: boolean | 'phone', pitchUm?: number): string {
  // A portrait phone's inset is about 100 px wide, so its key is only the two marks it explains (score loop r5); the
  // colors' distance apart is in the inset's card.
  if (short === 'phone') return frame.spotMm < 0.0001 ? 'Dot = ray · each color lands in one point' : 'Dot = ray · bar = one color’s spread';
  const um = (mm: number) => `${(mm * 1000).toFixed(mm < 0.01 ? 1 : 0)} µm`;
  const shift = um(frame.colorShiftMm), own = um(frame.spotMm);
  // score loop r6: the shift in pixels, so "20 µm" is something a reader can count on the grid
  const px = pitchUm && pitchUm > 0 && frame.colorShiftMm * 1000 / pitchUm >= 0.5 ? ` (about ${Math.round(frame.colorShiftMm * 1000 / pitchUm)} px)` : '';
  // a fan whose colors each land in one point has no own-color spread to show
  if (frame.spotMm < 0.0001) return short ? `Dot = ray · each color lands in one point · colors ${shift} apart` : `Colors land in different places: red to violet ${shift} apart${px} · dot = one ray · each color lands in one point`;
  return short ? `Dot = ray · bar = one color’s spread · colors ${shift} apart` : `Colors land in different places: red to violet ${shift} apart${px} · dot = one ray · bar = one color’s own spread (up to ${own})`;
}
