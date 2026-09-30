// Diffraction: the Bessel functions the Airy pattern needs, the normalized point spread function, its integral
// over a pixel, the diffraction-limited MTF, and the f-number where diffraction starts to cost resolution.
// Workstream E2 (engine/closed-form). See docs/engine/e2.md for the full derivations.
//
// Units: r and pitch in mm (engine convention), wavelength `nm` in nanometers (converted to mm internally
// wherever it is combined with a length), N is the working f-number (dimensionless).

// ---- Bessel J0 and J1 ------------------------------------------------------------------------------------------
// Two pieces, chosen for x < 15 vs x >= 15:
//  - x < 15: the defining power series (exact for all real x; DLMF 10.2.2 for J1, DLMF 10.2.1 for J0 - equivalently
//    Abramowitz & Stegun 9.1.10 / 9.1.12). Converges for every x, but alternating terms of growing magnitude lose
//    precision to cancellation as x grows, so it is used only below the crossover.
//  - x >= 15: the standard large-x asymptotic expansion (DLMF 10.17.3-10.17.5, equivalently Abramowitz & Stegun
//    9.2.5/9.2.9/9.2.10), truncated after the first two terms of each of P(nu,x) and Q(nu,x):
//      J_nu(x) ~ sqrt(2/(pi x)) [ P(nu,x) cos(w) - Q(nu,x) sin(w) ],  w = x - nu*pi/2 - pi/4
//      P(nu,x) ~ 1 - a2/x^2,  Q(nu,x) ~ a1/x - a3/x^3,   mu = 4 nu^2
//      a1 = (mu-1)/8,  a2 = (mu-1)(mu-9)/(2! 8^2),  a3 = (mu-1)(mu-9)(mu-25)/(3! 8^3)
//    For nu=0: mu=0, a1=-1/8, a2=9/128, a3=-75/1024, w = x - pi/4.
//    For nu=1: mu=4, a1=3/8,  a2=-15/128, a3=105/1024, w = x - 3pi/4.
//
// Tested error bound: both j0 and j1 below were checked (diffraction.test.ts) against an independent reference -
// numerical quadrature (composite Simpson's rule) of the integral representation J_n(x) = (1/pi) INT_0^pi
// cos(n*theta - x sin(theta)) d(theta) (DLMF 10.9.2) - across x in [0, 60]. Measured max absolute error: j1 about
// 5.8e-7 (worst case right at the x=15 crossover), j0 about 3.0e-7. Both are reported in the test file alongside
// the sweep that measured them, so a future change that regresses accuracy fails the test, not just this comment.

const SERIES_TO_ASYMPTOTIC_CROSSOVER = 15;

function j1Series(x: number): number {
  const h = x / 2;
  const h2 = h * h;
  let term = h; // k = 0 term: (x/2)^1 / (0! 1!)
  let sum = term;
  for (let k = 1; k < 60; k++) {
    term *= -h2 / (k * (k + 1));
    sum += term;
    if (k > 5 && Math.abs(term) < 1e-18 * Math.abs(sum)) break;
  }
  return sum;
}

function j0Series(x: number): number {
  const h2 = (x / 2) * (x / 2);
  let term = 1; // k = 0 term
  let sum = 1;
  for (let k = 1; k < 60; k++) {
    term *= -h2 / (k * k);
    sum += term;
    if (k > 5 && Math.abs(term) < 1e-18 * Math.abs(sum)) break;
  }
  return sum;
}

function j1Asymptotic(x: number): number {
  const w = x - (3 * Math.PI) / 4;
  const P = 1 + 15 / (128 * x * x);
  const Q = 3 / (8 * x) - 105 / (1024 * x * x * x);
  return Math.sqrt(2 / (Math.PI * x)) * (P * Math.cos(w) - Q * Math.sin(w));
}

function j0Asymptotic(x: number): number {
  const w = x - Math.PI / 4;
  const P = 1 - 9 / (128 * x * x);
  const Q = -1 / (8 * x) + 75 / (1024 * x * x * x);
  return Math.sqrt(2 / (Math.PI * x)) * (P * Math.cos(w) - Q * Math.sin(w));
}

/** Bessel function of the first kind, order 1. See the module header for the method and its tested error bound. */
export function j1(x: number): number {
  if (x < 0) return -j1(-x); // J1 is odd
  return x < SERIES_TO_ASYMPTOTIC_CROSSOVER ? j1Series(x) : j1Asymptotic(x);
}

/** Bessel function of the first kind, order 0. See the module header for the method and its tested error bound. */
export function j0(x: number): number {
  if (x < 0) x = -x; // J0 is even
  return x < SERIES_TO_ASYMPTOTIC_CROSSOVER ? j0Series(x) : j0Asymptotic(x);
}

/**
 * The first zero of J1(x), tabulated to 10 digits (DLMF ยง10.21(xv) / Table 10.6; equivalently Abramowitz & Stegun
 * Table 9.5). This is the exact radial argument of the Airy pattern's first dark ring; `airyRadius` below uses the
 * conventional rounded 1.22 (= this value / pi, to 3 significant figures) instead, per the project's own
 * convention (ENGINE.md), which differs from 1.21966... by under 0.03%.
 */
export const J1_FIRST_ZERO = 3.8317059702;

// ---- Airy pattern -----------------------------------------------------------------------------------------------
/**
 * Airy disk radius (mm): the radius of the pattern's first dark ring, at working f-number N and wavelength `nm`.
 *   r = 1.22 * lambda * N     (image space, working f-number - i.e. N already includes any pupil-magnification /
 *                               macro correction the caller wants; see exposure.ts's `workingFNumber`)
 * 1.22 is the conventional rounding of J1_FIRST_ZERO / pi (Airy, G. B., 1835; restated in every optics text, e.g.
 * Hecht, "Optics", 5th ed., ยง10.2.6, or Born & Wolf, "Principles of Optics", 7th ed., ยง8.5.2).
 */
export function airyRadius(nm: number, N: number): number {
  return 1.22 * (nm * 1e-6) * N; // nm -> mm
}

/**
 * Airy pattern intensity (1/mm^2) at radius r (mm) from the pattern center, normalized so that integrating over
 * the whole plane gives total encircled energy 1 (i.e. this is a probability density over landing position, times
 * the fraction of light that reaches the image plane at all - absorption/vignetting are separate factors a caller
 * multiplies in).
 *
 * I(r) = [pi / (4 (lambda N)^2)] * [2 J1(x) / x]^2,   x = pi r / (lambda N)
 *
 * Derivation (Born & Wolf, "Principles of Optics", ยง8.5.2 gives the unnormalized I(theta) = I0 [2J1(v)/v]^2 form;
 * the normalizing I0 below is derived here, not quoted, so it is guaranteed consistent with `encircledEnergy`):
 * differentiating the encircled-energy closed form EE(x) = 1 - J0(x)^2 - J1(x)^2 (see `encircledEnergy`) with
 * respect to x, using J0'(x) = -J1(x) and J1'(x) = J0(x) - J1(x)/x, gives dEE/dx = 2 J1(x)^2 / x. Since
 * dEE = I(r) 2 pi r dr and x = pi r/(lambda N) (so dr = (lambda N/pi) dx), equating the two expressions for dEE and
 * matching to the [2J1(x)/x]^2 form fixes I0 = pi / (4 (lambda N)^2).
 */
export function airyIntensity(r: number, nm: number, N: number): number {
  const lam = nm * 1e-6; // nm -> mm
  const x = (Math.PI * r) / (lam * N);
  const sinc = x === 0 ? 1 : (2 * j1(x)) / x; // 2J1(x)/x -> 1 as x -> 0
  const I0 = Math.PI / (4 * lam * N * lam * N);
  return I0 * sinc * sinc;
}

/**
 * Fraction of total Airy-pattern energy encircled within radius r (mm), at wavelength `nm` and working f-number N.
 *   EE(x) = 1 - J0(x)^2 - J1(x)^2,   x = pi r / (lambda N)
 * Classic closed form for the circular-aperture diffraction pattern's encircled energy (Born & Wolf, ยง8.5.2, or
 * Mahajan, V. N., "Optical Imaging and Aberrations, Part I", ยง4). EE(J1_FIRST_ZERO) = 0.8380 (83.8% of the energy
 * lies inside the first dark ring) is the textbook figure this module's golden test checks.
 */
export function encircledEnergy(r: number, nm: number, N: number): number {
  const lam = nm * 1e-6;
  const x = (Math.PI * r) / (lam * N);
  const J0x = j0(x);
  const J1x = j1(x);
  return 1 - J0x * J0x - J1x * J1x;
}

// ---- PSF integrated over a pixel grid -----------------------------------------------------------------------------
export interface PixelPsfCell {
  ix: number; // pixel column offset from the PSF center
  iy: number; // pixel row offset from the PSF center
  fraction: number; // fraction of total polychromatic PSF energy landing in this pixel's photosensitive area
  errorEstimate: number; // absolute error estimate on `fraction`, from Richardson extrapolation (see below)
}

export interface PsfOnPixelsResult {
  cells: PixelPsfCell[];
  totalFraction: number; // sum of fraction over the returned grid
  maxErrorEstimate: number; // largest single-cell error estimate
}

function simpsonCoeffs(n: number): Float64Array {
  const w = new Float64Array(n + 1);
  w[0] = 1;
  w[n] = 1;
  for (let i = 1; i < n; i++) w[i] = i % 2 === 0 ? 2 : 4;
  return w;
}

/**
 * Composite 2D Simpson's rule over a square [cx-half, cx+half] x [cy-half, cy+half], n subintervals per axis
 * (n even). Standard product-rule extension of 1D Simpson (e.g. Press, Teukolsky, Vetterling & Flannery,
 * "Numerical Recipes", 3rd ed., ยง4.1-4.2 for the 1D rule; the 2D product form is immediate from applying it on
 * each axis).
 */
function integrateSquare2D(
  f: (x: number, y: number) => number,
  cx: number,
  cy: number,
  half: number,
  n: number
): number {
  if (half <= 0) return 0;
  const h = (2 * half) / n;
  const w = simpsonCoeffs(n);
  let total = 0;
  for (let i = 0; i <= n; i++) {
    const x = cx - half + i * h;
    let row = 0;
    for (let j = 0; j <= n; j++) {
      const y = cy - half + j * h;
      row += w[j] * f(x, y);
    }
    total += w[i] * row;
  }
  return total * (h / 3) * (h / 3);
}

/**
 * Integrates the polychromatic Airy PSF over a grid of pixels of pitch `pitch` (mm) and fill factor `fill`
 * (0..1, photosensitive area / pixel area - modeled here as a square active area of side `pitch * sqrt(fill)`
 * centered in the pixel; a common simplifying assumption when the real microlens/photodiode aperture shape isn't
 * modeled, labeled here rather than asserted as exact). `bins` are wavelength centers (nm) and `weights` their
 * relative spectral contribution (need not sum to 1; normalized internally) - a polychromatic PSF is the
 * incoherent (intensity-domain) sum of the monochromatic Airy patterns, which is correct for the ordinary case of
 * spatially incoherent, temporally broadband scene light. `offset` (mm) shifts the PSF center relative to the
 * central pixel's center, for sampling sub-pixel phase. `gridRadius` sets how many pixels out from the center are
 * evaluated in each direction.
 *
 * Each cell's `fraction` is estimated at two grid resolutions (n=8 and n=16 subintervals per axis) and Richardson-
 * extrapolated: for a 4th-order method like Simpson's rule, halving the step roughly divides the error by 16, so
 * errorEstimate = |I_16 - I_8| / 15 is the standard practical error estimate (Numerical Recipes ยง4.2), and the
 * finer estimate I_16 is what's returned as `fraction`.
 */
export function psfOnPixels(
  pitch: number,
  N: number,
  bins: number[],
  weights: number[],
  offset: [number, number] = [0, 0],
  fill: number = 1,
  gridRadius: number = 3
): PsfOnPixelsResult {
  const weightSum = weights.reduce((a, b) => a + b, 0) || 1;
  const normWeights = weights.map((w) => w / weightSum);

  const intensity = (x: number, y: number): number => {
    const r = Math.hypot(x, y);
    let sum = 0;
    for (let i = 0; i < bins.length; i++) {
      sum += normWeights[i] * airyIntensity(r, bins[i], N);
    }
    return sum;
  };

  const half = (pitch * Math.sqrt(Math.max(fill, 0))) / 2;
  const cells: PixelPsfCell[] = [];
  let totalFraction = 0;
  let maxErrorEstimate = 0;

  for (let iy = -gridRadius; iy <= gridRadius; iy++) {
    for (let ix = -gridRadius; ix <= gridRadius; ix++) {
      const cx = ix * pitch - offset[0];
      const cy = iy * pitch - offset[1];
      const coarse = integrateSquare2D(intensity, cx, cy, half, 8);
      const fine = integrateSquare2D(intensity, cx, cy, half, 16);
      const errorEstimate = Math.abs(fine - coarse) / 15;
      cells.push({ ix, iy, fraction: fine, errorEstimate });
      totalFraction += fine;
      if (errorEstimate > maxErrorEstimate) maxErrorEstimate = errorEstimate;
    }
  }

  return { cells, totalFraction, maxErrorEstimate };
}

// ---- diffraction-limited MTF ----------------------------------------------------------------------------------
/**
 * Diffraction-limited (incoherent, aberration-free circular pupil) MTF at spatial frequency `nu` (cycles/mm), for
 * working f-number N and wavelength `nm`. Standard closed form (Goodman, J. W., "Introduction to Fourier Optics",
 * 3rd ed., ยง6.3; or Williams & Becklund, "Introduction to the Optical Transfer Function", ยง5.3):
 *   MTF(s) = (2/pi) [ arccos(s) - s sqrt(1 - s^2) ],   s = nu / nu_c,   nu_c = 1 / (lambda N)
 * with MTF = 0 for nu >= nu_c (the diffraction cutoff frequency) and MTF = 1 at nu = 0.
 */
export function mtfDiffraction(nu: number, N: number, nm: number): number {
  const lam = nm * 1e-6; // nm -> mm
  const nuC = 1 / (lam * N);
  const s = nu / nuC;
  if (s <= 0) return 1;
  if (s >= 1) return 0;
  return (2 / Math.PI) * (Math.acos(s) - s * Math.sqrt(1 - s * s));
}

// ---- the f-number where diffraction starts to cost resolution -----------------------------------------------------
/**
 * The f-number at which the Airy disk DIAMETER (2 * airyRadius) reaches `k` pixels of pitch `pitchMm` (mm), at
 * wavelength `nm`. Named here as the "Airy-diameter-equals-k-pixels" criterion: an engineering heuristic (not a
 * rigorous MTF threshold) for when diffraction starts visibly costing resolution against the pixel grid.
 *   2 * 1.22 * lambda * N = k * pitch   =>   N = k * pitch / (2 * 1.22 * lambda)
 * k = 2 is the commonly cited "diffraction limit" aperture in photography discussions (e.g. Cambridge in Colour's
 * "Diffraction Limited Photography" article uses Airy-disk-diameter about 2 pixel pitches as the point diffraction
 * becomes the dominant softening factor); k = 1.5 is a stricter variant some sources use for when softening first
 * becomes measurable rather than dominant. Both are provided since neither is a single universally standardized
 * name - see `diffractionLimitFNumber2px` / `diffractionLimitFNumber1_5px` below.
 */
export function diffractionLimitFNumber(nm: number, pitchMm: number, k: number): number {
  const radiusPerUnitN = airyRadius(nm, 1); // mm, i.e. 1.22 * lambda
  return (k * pitchMm) / (2 * radiusPerUnitN);
}

/** The "Airy-diameter-equals-2-pixels" diffraction-limit f-number. See `diffractionLimitFNumber`. */
export function diffractionLimitFNumber2px(nm: number, pitchMm: number): number {
  return diffractionLimitFNumber(nm, pitchMm, 2);
}

/** The stricter "Airy-diameter-equals-1.5-pixels" diffraction-limit f-number. See `diffractionLimitFNumber`. */
export function diffractionLimitFNumber1_5px(nm: number, pitchMm: number): number {
  return diffractionLimitFNumber(nm, pitchMm, 1.5);
}
