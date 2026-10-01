// Deterministic illustrated materials for the synthetic field scene. Dimensions and markings are assumed
// generic songbird / bark features, not measurements of a species or a photograph. ColorChecker spectra are
// pigment stand-ins; the tonal patterns below are authored reflectance, not a directional-lighting simulation.
// Coordinates are millimeters in the original billboard. sceneFor scales the billboard while retaining UVs.
import { colorCheckerReflectance } from './data';

type Spectrum = (nm: number) => number;
const BROWN = colorCheckerReflectance('dark skin');
const BUFF = colorCheckerReflectance('light skin');
const PALE = colorCheckerReflectance('neutral 8 (.23 D)');
const OCHRE = colorCheckerReflectance('orange yellow');
const FOLIAGE = colorCheckerReflectance('foliage');

function smooth(lo: number, hi: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

function ellipse(x: number, y: number, cx: number, cy: number, rx: number, ry: number, angle = 0): number {
  const dx = x - cx, dy = y - cy, c = Math.cos(angle), s = Math.sin(angle);
  return ((dx * c + dy * s) / rx) ** 2 + ((-dx * s + dy * c) / ry) ** 2;
}

function stroke(x: number, y: number, ax: number, ay: number, bx: number, by: number, radius: number): boolean {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2 <= radius * radius;
}

function tail(x: number, y: number): boolean {
  const t = (y + 54) / -68;
  return t >= 0 && t <= 1 && Math.abs(x + 29 + 24 * t) <= 16 - 6 * t;
}

function beak(x: number, y: number): boolean {
  return x >= 44 && x <= 71 && Math.abs(y - 76) <= 6.5 * (1 - (x - 44) / 27);
}

function feet(x: number, y: number): boolean {
  if (y > -57) return false;
  return stroke(x, y, 12, -61, 7, -120, 1.7) || stroke(x, y, -4, -69, -10, -120, 1.6)
    || stroke(x, y, 7, -120, 17, -122, 1.5) || stroke(x, y, 7, -120, 1, -124, 1.5)
    || stroke(x, y, -10, -120, -1, -121, 1.4) || stroke(x, y, -10, -120, -17, -123, 1.4);
}

export function fieldBirdCoverage(x: number, y: number): boolean {
  return ellipse(x, y, -4, -8, 52, 74, -0.28) <= 1
    || ellipse(x, y, 8, 48, 30, 35, -0.15) <= 1
    || ellipse(x, y, 18, 78, 34, 32) <= 1 || beak(x, y) || tail(x, y) || feet(x, y);
}

/** Smooth pigment boundaries and millimeter-scale feather markings retain detail as the optics blur them. */
export function fieldBirdReflectance(x: number, y: number): Spectrum {
  const eyeRadius = Math.hypot(x - 30, y - 83);
  if (eyeRadius < 4.6) {
    // A small assumed catchlight, with finite reflectance: it still goes through the scene's light/noise model.
    const catchlight = 1 - smooth(0.7, 1.5, Math.hypot(x - 31.4, y - 84.5));
    return () => 0.016 + 0.69 * catchlight;
  }
  if (beak(x, y)) {
    const seam = 1 - smooth(0.3, 1.1, Math.abs(y - 76));
    const tone = (y > 76 ? 0.42 : 0.68) * (1 - 0.7 * seam);
    return (nm) => tone * BROWN(nm);
  }
  if (feet(x, y) && !tail(x, y) && y < -76) return (nm) => 0.5 * BROWN(nm);

  const wingRadius = ellipse(x, y, -19, 2, 32, 52, -0.38);
  const wing = 1 - smooth(0.83, 1.05, wingRadius);
  const inTail = tail(x, y) && y < -55;
  // Warm breast rolls into the darker flank; the pale cheek and eyebrow connect it to the eye ring.
  const breast = smooth(-17, 29, x + 0.15 * y) * (1 - smooth(29, 65, y));
  const cheek = 1 - smooth(0.58, 1.2, ellipse(x, y, 28, 67, 22, 12));
  const eyeRing = 1 - smooth(5, 7, eyeRadius);
  const brow = smooth(5, 16, x) * (1 - smooth(39, 47, x)) * (1 - smooth(1.4, 3.4, Math.abs(y - (91 + 0.06 * (x - 20)))));
  let pale = Math.max(breast * 0.9, cheek * 0.62, eyeRing * 0.82, brow * 0.68);

  // Long folded flight feathers, with broad buff edges and offset rows of smaller upper-wing coverts.
  const shaft = x + 0.44 * y;
  const feather = 0.5 + 0.5 * Math.cos(shaft * 0.72 + 0.25 * Math.sin(y * 0.08));
  const covert = 0.5 + 0.5 * Math.cos(y * 0.48 + 1.8 * Math.sin(x * 0.38));
  const edge = smooth(0.77, 0.98, feather);
  const wingTone = 0.40 + 0.31 * edge + 0.12 * covert * smooth(-16, 22, y);
  const tailTone = 0.32 + 0.22 * smooth(0.72, 0.98, 0.5 + 0.5 * Math.cos((x - 0.35 * y) * 0.85));
  const form = 0.74 + 0.22 * (1 - smooth(0.1, 1.1, ellipse(x, y, 12, 16, 48, 88)));
  const fine = 0.95 + 0.05 * Math.sin(0.55 * y + 1.2 * Math.sin(x * 0.22));
  let tone = form * fine * (1 - wing) + wingTone * wing;
  pale *= 1 - wing * 0.90;
  if (inTail) { tone = tailTone; pale = 0; }
  const warm = 0.07 * (1 - pale) * (1 - wing) * smooth(22, 53, y);
  return (nm) => tone * ((1 - pale - warm) * BROWN(nm) + pale * (0.52 * BUFF(nm) + 0.48 * PALE(nm)) + warm * OCHRE(nm));
}

export function fieldBranchCoverage(u: number, v: number): boolean {
  const mid = 0.1 * Math.sin(u * 5.5), half = 0.26 - 0.16 * Math.abs(u);
  const twig = u > 0.18 && u < 0.36 && Math.abs(v - (mid + (u - 0.18) * 2.2)) < 0.065;
  return Math.abs(v - mid) < half || twig;
}

export function fieldBranchReflectance(u: number, v: number): Spectrum {
  const x = u * 900, y = (v - 0.1 * Math.sin(u * 5.5)) * 70;
  const half = (0.26 - 0.16 * Math.abs(u)) * 70;
  const round = Math.sqrt(Math.max(0, 1 - (y / half) ** 2));
  const ridges = 0.5 + 0.5 * Math.sin(y * 0.76 + 0.6 * Math.sin(x * 0.045) + x * 0.017);
  const knot = Math.hypot((x + 150) / 27, (y - 2) / 8);
  const knotLines = (1 - smooth(0.5, 2.1, knot)) * (0.5 + 0.5 * Math.cos(knot * 13));
  const tone = (0.40 + 0.55 * round) * (0.78 + 0.22 * ridges) * (1 - 0.30 * knotLines);
  const lichen = 0.32 * smooth(0.3, 0.78, Math.sin(x * 0.063 + y * 0.11) * Math.cos(x * 0.027 - y * 0.26)) * smooth(-5, 5, y);
  return (nm) => tone * ((1 - lichen) * BROWN(nm) + lichen * (0.65 * PALE(nm) + 0.35 * FOLIAGE(nm)));
}
