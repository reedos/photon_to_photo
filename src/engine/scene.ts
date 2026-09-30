// Synthetic scenes only (never a real photo — BRIEF.md): a declarative scene of billboards (planes with a
// spectral reflectance per region, standing in for a ColorChecker, a Siemens star, a subject...) and point
// highlights (tiny emitters, for background bokeh), lit by an illuminant given as a CCT and a lux level.
// `radiance` casts one ray and returns the spectral radiance it carries back and the hit depth — the
// primitive a renderer (E4's render.ts) calls once per sample per pixel.
//
// Distances are mm, angles radians, wavelengths nm, matching types.ts's stated conventions; light travels
// +z. Radiance/irradiance are spectral, W . sr^-1 . m^-2 . nm^-1 and W . m^-2 . nm^-1 respectively, "per
// bin" meaning per the caller's `Bins.weights[i]` (nm) — consistent with color.ts's integration convention.

import type { Bins, Vec3 } from './types';

// ---- small vec3 helpers (local to this module; E1a's optics-trace may have its own — not shared here to
// keep this module's own dependency surface at zero beyond types.ts) --------------------------------------

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}
function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function normalize(a: Vec3): Vec3 {
  const len = Math.sqrt(dot(a, a));
  if (len < 1e-12) throw new Error('scene.ts: cannot normalize a zero-length vector');
  return scale(a, 1 / len);
}

// ---- declarative scene -------------------------------------------------------------------------------------

/** A finite rectangular plane in 3D (mm), with a spectral reflectance that can vary across its face. */
export interface Billboard {
  id: string;
  /** Center position, mm. */
  center: Vec3;
  /** Unit surface normal (points back towards the camera side, i.e. against the incoming ray for a visible hit). */
  normal: Vec3;
  /** Unit "up" direction in the billboard's own plane; must not be parallel to `normal`. */
  up: Vec3;
  widthMm: number;
  heightMm: number;
  /**
   * Spectral reflectance (0..1) at local coordinates u, v in [-0.5, 0.5] (fractions of widthMm/heightMm
   * from center) — a function of (u, v) so a single billboard can carry many regions, e.g. a ColorChecker's
   * 24 patches or a Siemens star (see `siemensStarReflectance` below).
   */
  reflectanceAt: (u: number, v: number) => (nm: number) => number;
}

/** A small emissive sphere: a background point light (e.g. a streetlight) for the bokeh set piece. */
export interface PointHighlight {
  id: string;
  position: Vec3; // mm
  radiusMm: number;
  /** Spectral radiance the highlight itself emits, W . sr^-1 . m^-2 . nm^-1 (this module does not attenuate it). */
  radianceAt: (nm: number) => number;
}

export interface Illuminant {
  /** Relative spectral shape; any consistent overall scale (see `illuminantSpectralIrradiance`). */
  spectrum: (nm: number) => number;
  /** Target illuminance, lux, that `spectrum` is normalized to reproduce (via the V(lambda) integral). */
  lux: number;
}

export interface Scene {
  billboards: Billboard[];
  pointHighlights?: PointHighlight[];
  illuminant: Illuminant;
}

// ---- illuminant: lux -> spectral irradiance, via the photopic luminous efficiency integral -----------------

/** CIE 1924 photopic luminous efficacy at 555 nm, lm/W — exact by the SI definition of the candela (the
 * 1979 CGPM resolution fixing Kcd = 683 lm/W; unchanged by the 2019 SI redefinition). */
export const KM_LUMENS_PER_WATT = 683;

/**
 * Scales a RELATIVE spectral shape to an absolute spectral irradiance E(lambda) (W . m^-2 . nm^-1) such
 * that its photometric integral reproduces the target illuminance exactly: lux = Km * integral(E(l) V(l) dl)
 * (CIE 018:2019, "The Basis of Physical Photometry," the defining equation of illuminance from spectral
 * irradiance). `spectrum`'s overall scale is irrelevant — only its shape (relative variation with
 * wavelength) matters, since it is renormalized here; this is what lets `planckianSpectralRadiance` below
 * be used directly as a `spectrum`, unconverted, even though its literal units are per-meter, not per-nm
 * (the per-meter-to-per-nm Jacobian is a wavelength-INDEPENDENT constant, so it cancels in this
 * normalization — see that function's doc comment).
 */
export function illuminantSpectralIrradiance(
  spectrum: (nm: number) => number,
  lux: number,
  bins: Bins,
  vLambda: (nm: number) => number,
): (nm: number) => number {
  let integral = 0;
  for (let i = 0; i < bins.centers.length; i++) {
    integral += spectrum(bins.centers[i]) * vLambda(bins.centers[i]) * bins.weights[i];
  }
  if (!(integral > 0)) {
    throw new Error('illuminantSpectralIrradiance: spectrum has zero or negative luminous integral');
  }
  const k = lux / (KM_LUMENS_PER_WATT * integral);
  return (nm: number) => k * spectrum(nm);
}

// ---- illuminant shape: Planck's law -------------------------------------------------------------------------

// CODATA/SI values, exact by the 2019 SI redefinition (BIPM, "The International System of Units (SI),"
// 9th ed., 2019): h (Planck constant), c (speed of light in vacuum), k (Boltzmann constant).
const PLANCK_H = 6.62607015e-34; // J . s
const SPEED_OF_LIGHT = 299792458; // m / s
const BOLTZMANN_K = 1.380649e-23; // J / K

/**
 * Planck's law: the spectral radiance of a blackbody at temperature `tempK`, evaluated at wavelength `nm`.
 * Standard textbook formula (e.g. Hecht, E., "Optics," 5th ed., Pearson, 2017, §13.1); returned in SI units
 * per meter of wavelength (W . sr^-1 . m^-2 . m^-1), NOT per nm — deliberately: see
 * `illuminantSpectralIrradiance`'s doc comment for why this is safe to use directly as a relative shape.
 */
export function planckianSpectralRadiance(nm: number, tempK: number): number {
  const lambdaM = nm * 1e-9;
  const c1 = 2 * PLANCK_H * SPEED_OF_LIGHT * SPEED_OF_LIGHT;
  const c2 = (PLANCK_H * SPEED_OF_LIGHT) / BOLTZMANN_K;
  return c1 / (Math.pow(lambdaM, 5) * (Math.exp(c2 / (lambdaM * tempK)) - 1));
}

// ---- illuminant shape: CIE daylight locus from S0/S1/S2 -----------------------------------------------------

/**
 * The daylight locus's chromaticity (x, y) at a correlated color temperature, valid for 4000-25000 K (Judd,
 * D. B., MacAdam, D. L. & Wyszecki, G., "Spectral Distribution of Typical Daylight as a Function of
 * Correlated Color Temperature," JOSA 54(8), 1964, pp. 1031-1040; reproduced at Wikipedia, "Standard
 * illuminant," section "Computation," retrieved 2026-09-28).
 */
export function daylightChromaticity(cctK: number): { x: number; y: number } {
  if (cctK < 4000 || cctK > 25000) {
    throw new Error(`daylightChromaticity: ${cctK} K is outside the daylight locus's valid range [4000, 25000]`);
  }
  const x =
    cctK <= 7000
      ? 0.244063 + (0.09911e3) / cctK + (2.9678e6) / (cctK * cctK) - (4.607e9) / (cctK * cctK * cctK)
      : 0.23704 + (0.24748e3) / cctK + (1.9018e6) / (cctK * cctK) - (2.0064e9) / (cctK * cctK * cctK);
  const y = -3.0 * x * x + 2.87 * x - 0.275;
  return { x, y };
}

/**
 * The CIE daylight SPD at a correlated color temperature, from the mean SPD S0 and its first two
 * characteristic-vector SPDs S1, S2 (same source as `daylightChromaticity`): S_D(l) = S0(l) + M1*S1(l) +
 * M2*S2(l), with M1/M2 from the chromaticity above and rounded to 3 decimal places (required to reproduce
 * the canonical D-illuminants' published values to their own stated precision — same source, "In order to
 * match all significant digits of the published data... M1 and M2 have to be rounded to three decimal
 * places"). `s0`/`s1`/`s2` must be sampled at the same wavelengths (any `Bins.centers`); this function is
 * checked against the real, measured CIE Illuminant D65 table at D65's own CCT in scene.test.ts, which is
 * as strong a validation of this formula as the fixtures allow.
 */
export function daylightSpd(cctK: number, s0: readonly number[], s1: readonly number[], s2: readonly number[]): number[] {
  if (s0.length !== s1.length || s1.length !== s2.length) {
    throw new Error('daylightSpd: s0, s1 and s2 must have the same length');
  }
  const { x, y } = daylightChromaticity(cctK);
  const m = 0.0241 + 0.2562 * x - 0.7341 * y;
  const m1 = Math.round(((-1.3515 - 1.7703 * x + 5.9114 * y) / m) * 1000) / 1000;
  const m2 = Math.round(((0.03 - 31.4424 * x + 30.0717 * y) / m) * 1000) / 1000;
  return s0.map((v, i) => v + m1 * s1[i] + m2 * s2[i]);
}

// ---- Siemens star, a named test/scene pattern from BRIEF.md's scene list ------------------------------------

/**
 * A Siemens star reflectance pattern: `spokes` alternating high/low-reflectance wedges around the
 * billboard's center, the classic radial resolution test target. `reflectanceAt(u, v)` for a `Billboard`.
 */
export function siemensStarReflectance(
  spokes: number,
  highReflectance: (nm: number) => number,
  lowReflectance: (nm: number) => number,
): (u: number, v: number) => (nm: number) => number {
  return (u: number, v: number) => {
    const angle = Math.atan2(v, u); // -pi..pi
    const wedge = Math.floor(((angle + Math.PI) / (2 * Math.PI)) * spokes);
    return wedge % 2 === 0 ? highReflectance : lowReflectance;
  };
}

// ---- ray casting ---------------------------------------------------------------------------------------------

const T_EPSILON = 1e-6;

function raySphereIntersect(origin: Vec3, dir: Vec3, center: Vec3, radius: number): number | null {
  const oc = sub(origin, center);
  const b = dot(oc, dir); // dir assumed unit
  const c = dot(oc, oc) - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const sqrtDisc = Math.sqrt(disc);
  const t0 = -b - sqrtDisc;
  if (t0 > T_EPSILON) return t0;
  const t1 = -b + sqrtDisc;
  return t1 > T_EPSILON ? t1 : null;
}

function rayBillboardIntersect(origin: Vec3, dir: Vec3, bb: Billboard): { t: number; u: number; v: number } | null {
  const denom = dot(dir, bb.normal);
  if (Math.abs(denom) < 1e-9) return null; // parallel to the plane
  const t = dot(sub(bb.center, origin), bb.normal) / denom;
  if (t <= T_EPSILON) return null;
  const point = add(origin, scale(dir, t));
  // right = normal x up (not up x normal): for a camera-facing billboard (normal pointing back against
  // the incoming ray, e.g. normal=[0,0,-1] for a ray traveling +z), this makes u increase toward world +x,
  // matching types.ts's right-handed x,y,z convention (x_hat x y_hat = z_hat) with forward = -normal. See
  // docs/engine/e3.md, "scene.ts" section, and e3.verify.test.ts FINDING 1.
  const right = normalize(cross(bb.normal, bb.up));
  const u = dot(sub(point, bb.center), right) / bb.widthMm;
  const v = dot(sub(point, bb.center), bb.up) / bb.heightMm;
  if (Math.abs(u) > 0.5 || Math.abs(v) > 0.5) return null; // outside the billboard's extent
  return { t, u, v };
}

export interface RadianceResult {
  /** Spectral radiance per bin, W . sr^-1 . m^-2 . nm^-1, aligned to the `bins` argument's centers. */
  radianceByBin: number[];
  depthMm: number | null;
  hitId: string | null;
}

/**
 * Casts one ray into the scene and returns the spectral radiance it carries back to the origin, plus the
 * hit depth (mm along `rayDir`, which is normalized internally). A miss (no billboard or point highlight
 * hit) returns zero radiance in every bin and a null depth/id — this module has no environment/sky term;
 * a caller wanting one supplies it separately.
 *
 * For a billboard hit: Lambertian reflection, L = rho(lambda) * E(lambda) / pi, where E is the scene's
 * illuminant spectral irradiance (uniform over the whole scene — no shadowing or cosine-of-incidence
 * falloff from a directional source is modeled; see docs/engine/e3.md, "Known limits") and rho is the
 * billboard's reflectance at the hit point. The Lambertian (ideal diffuse) BRDF is f_r = rho/pi, giving
 * this outgoing radiance for any exitant direction under irradiance E — standard radiometry, e.g. Pharr,
 * M., Jakob, W. & Humphreys, G., "Physically Based Rendering," 4th ed., MIT Press, 2023, §5.6.1 (diffuse
 * reflection) and §4.1 (BRDFs).
 *
 * For a point highlight hit: its own emitted radiance, unattenuated (it is a light source, not a reflector).
 */
export function radiance(scene: Scene, rayOrigin: Vec3, rayDir: Vec3, bins: Bins, vLambda: (nm: number) => number): RadianceResult {
  const dir = normalize(rayDir);
  let bestT = Infinity;
  let hitBillboard: { bb: Billboard; u: number; v: number } | null = null;
  let hitPoint: PointHighlight | null = null;

  for (const bb of scene.billboards) {
    const hit = rayBillboardIntersect(rayOrigin, dir, bb);
    if (hit && hit.t < bestT) {
      bestT = hit.t;
      hitBillboard = { bb, u: hit.u, v: hit.v };
      hitPoint = null;
    }
  }
  for (const ph of scene.pointHighlights ?? []) {
    const t = raySphereIntersect(rayOrigin, dir, ph.position, ph.radiusMm);
    if (t !== null && t < bestT) {
      bestT = t;
      hitPoint = ph;
      hitBillboard = null;
    }
  }

  if (hitPoint) {
    return { radianceByBin: bins.centers.map((nm) => hitPoint.radianceAt(nm)), depthMm: bestT, hitId: hitPoint.id };
  }
  if (hitBillboard) {
    const reflectance = hitBillboard.bb.reflectanceAt(hitBillboard.u, hitBillboard.v);
    const irradiance = illuminantSpectralIrradiance(scene.illuminant.spectrum, scene.illuminant.lux, bins, vLambda);
    const radianceByBin = bins.centers.map((nm) => (reflectance(nm) * irradiance(nm)) / Math.PI);
    return { radianceByBin, depthMm: bestT, hitId: hitBillboard.bb.id };
  }
  return { radianceByBin: bins.centers.map(() => 0), depthMm: null, hitId: null };
}
