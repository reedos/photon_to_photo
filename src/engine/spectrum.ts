// Wavelength bins, the standard Fraunhofer reference lines, and a wavelength-to-color stub for drawing spectral
// rays. Pure math, no Three.js, no DOM. Workstream E1a (engine/optics-trace). Units: nm (see types.ts header).

import type { Bins, Vec3 } from './types';

// ---- Fraunhofer lines ----------------------------------------------------------------------------------------

/**
 * Standard Fraunhofer reference wavelengths (nm) used to specify glass index and dispersion (nd/vd, the Abbe
 * number, partial dispersions) in optical-glass catalogs. Values as tabulated in SCHOTT Technical Information
 * TIE-29 "Refractive Index and Dispersion" (media.schott.com), Table 1, and reproduced identically by other
 * catalogs (Ohara, Hoya) and Zemax/CODE V. `Fp`/`Cp` are F' and C' (their apostrophes are not legal identifier
 * characters).
 */
export const FRAUNHOFER = {
  /** He d line, 587.5618 nm: the reference wavelength for nd and the modern Abbe number vd. */
  d: 587.5618,
  /** H F line, 486.1327 nm: the blue end of the classical (nd-based) Abbe number's F-C span. */
  F: 486.1327,
  /** H C line, 656.2725 nm: the red end of the classical Abbe number's F-C span. */
  C: 656.2725,
  /** Hg e line, 546.074 nm: the reference wavelength for ne and the modern Abbe number ve. */
  e: 546.074,
  /** Hg g line, 435.8343 nm. */
  g: 435.8343,
  /** Cd F' line, 479.9914 nm: the blue end of the modern (ne-based) Abbe number's F'-C' span. */
  Fp: 479.9914,
  /** Cd C' line, 643.8469 nm: the red end of the modern Abbe number's F'-C' span. */
  Cp: 643.8469,
} as const;

// ---- wavelength bins -------------------------------------------------------------------------------------------

/**
 * n evenly spaced wavelength bins covering [lo, hi] nm. edges has n+1 entries; centers[i] is the midpoint of
 * [edges[i], edges[i+1]]; weights[i] is that bin's width, (hi-lo)/n nm, matching the `Bins` contract in types.ts
 * ("bin widths or quadrature weights"). n must be a positive integer.
 */
export function bins(n: number, lo: number, hi: number): Bins {
  if (!(n >= 1) || !Number.isInteger(n)) throw new Error(`bins: n must be a positive integer, got ${n}`);
  const edges: number[] = new Array(n + 1);
  const centers: number[] = new Array(n);
  const weights: number[] = new Array(n);
  const width = (hi - lo) / n;
  for (let i = 0; i <= n; i++) edges[i] = lo + i * width;
  for (let i = 0; i < n; i++) {
    centers[i] = (edges[i] + edges[i + 1]) / 2;
    weights[i] = width;
  }
  return { centers, edges, weights };
}

/**
 * The visible range used for the binned-spectrum constants below: 380-780 nm. This is the common "visible
 * spectrum" engineering convention (e.g. CIE 15:2004 colorimetry practice tabulates the standard observer over
 * 360-830 nm, but the CIE 1931 y-bar luminous-efficiency curve is below 1e-3 of its peak outside 380-780 nm, so a
 * renderer loses negligible visible response by binning only that span). Assumed convention, not a measured
 * constant — recorded here so BINS16/BINS24 stay reproducible if the range is revisited.
 */
export const VISIBLE_LO_NM = 380;
export const VISIBLE_HI_NM = 780;

/** 16 bins across the visible range: the engine's default spectral-tracing resolution (BRIEF.md: "at least 16
 *  wavelength bins"). */
export const BINS16: Bins = bins(16, VISIBLE_LO_NM, VISIBLE_HI_NM);

/** 24 bins across the visible range: a higher-fidelity option for the same span. */
export const BINS24: Bins = bins(24, VISIBLE_LO_NM, VISIBLE_HI_NM);

// ---- wavelength -> color --------------------------------------------------------------------------------------

export interface WavelengthColor {
  /** CIE 1931 XYZ tristimulus values for a unit-radiance monochromatic source at this wavelength (i.e. the raw
   *  color-matching-function values themselves, not integrated against any spectrum). */
  xyz: Vec3;
  /** Linear sRGB (IEC 61966-2-1 primaries, D65 white), gamut-mapped per the note below. Components are not
   *  clamped to [0, 1]: relative brightness across wavelengths (violet and deep red are dim; 555 nm is bright)
   *  is preserved so callers can scale/tone-map a whole spectrum consistently. */
  linear: Vec3;
  /** `linear` clamped to [0, 1] and encoded with the sRGB opto-electronic transfer function, ready to draw. */
  srgb: Vec3;
}

// Multi-lobe piecewise-Gaussian fit to the CIE 1931 2-degree standard observer, Table 1 / Equation 4 / Listing 1 of
// Wyman, C., Sloan, P.-P., and Shirley, P., "Simple Analytic Approximations to the CIE XYZ Color Matching
// Functions," Journal of Computer Graphics Techniques (JCGT) 2(2), 1-11 (2013), http://jcgt.org/published/0002/02/01/.
// Verified against the published PDF (Table 1 and Listing 1) 2026-09-28. Mean/max squared error vs. the 1 nm CIE
// tables: 3.1e-5 / 2.0e-4 (x-bar), 7.1e-6 / 6.4e-5 (y-bar), 1.6e-5 / 4.9e-4 (z-bar) (the paper's Table 2), well
// inside the between-observer measurement variance the CIE standard itself carries.
//
// g(lambda; alpha, mu, sigma1, sigma2) = alpha * exp(-0.5 * t^2), t = (lambda - mu) * (lambda < mu ? sigma1 : sigma2)
// (note: sigma multiplies, it does not divide -- these "sigma" columns are inverse widths, nm^-1, not widths).
function lobe(nm: number, alpha: number, mu: number, sigma1: number, sigma2: number): number {
  const t = (nm - mu) * (nm < mu ? sigma1 : sigma2);
  return alpha * Math.exp(-0.5 * t * t);
}

function xBar(nm: number): number {
  return (
    lobe(nm, 0.362, 442.0, 0.0624, 0.0374) +
    lobe(nm, 1.056, 599.8, 0.0264, 0.0323) +
    lobe(nm, -0.065, 501.1, 0.049, 0.0382)
  );
}
function yBar(nm: number): number {
  return lobe(nm, 0.821, 568.8, 0.0213, 0.0247) + lobe(nm, 0.286, 530.9, 0.0613, 0.0322);
}
function zBar(nm: number): number {
  return lobe(nm, 1.217, 437.0, 0.0845, 0.0278) + lobe(nm, 0.681, 459.0, 0.0385, 0.0725);
}

// CIE XYZ (D65) -> linear sRGB, the standard IEC 61966-2-1 matrix (e.g. https://en.wikipedia.org/wiki/SRGB
// "From CIE XYZ to sRGB", or Lindbloom, "RGB/XYZ Matrices," brucelindbloom.com).
function xyzToLinearSrgb([X, Y, Z]: Vec3): Vec3 {
  return [
    3.2406 * X - 1.5372 * Y - 0.4986 * Z,
    -0.9689 * X + 1.8758 * Y + 0.0415 * Z,
    0.0557 * X - 0.204 * Y + 1.057 * Z,
  ];
}

/**
 * A monochromatic source's XYZ (from the raw color-matching functions, no spectral integration) routinely falls
 * outside the sRGB gamut: real primaries cannot mix to a fully saturated spectral color. Gamut-map by the
 * simplest documented method — clip negative components to 0 — leaving the in-gamut components untouched; this
 * is the standard "clip" strategy (e.g. Lindbloom, "Gamut Mapping and related issues," brucelindbloom.com) as
 * opposed to (more involved) hue-preserving desaturation, which the color agent's future data table can upgrade
 * this to (see the module header).
 */
function gamutClip(rgb: Vec3): Vec3 {
  return [Math.max(0, rgb[0]), Math.max(0, rgb[1]), Math.max(0, rgb[2])];
}

/** sRGB opto-electronic transfer function (IEC 61966-2-1), applied per channel after clamping to [0, 1]. */
function srgbEncode(c: number): number {
  const v = Math.min(1, Math.max(0, c));
  return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

/**
 * Color of monochromatic light at `nm`, for drawing spectral rays (BRIEF.md set piece 2: "rays split by
 * wavelength"). A stub fitted analytically to the CIE 1931 CMFs (see the module comment above) until data/color
 * lands with a measured table (ENGINE.md); the signature is meant to stay stable across that swap.
 */
export function wavelengthColor(nm: number): WavelengthColor {
  const xyz: Vec3 = [xBar(nm), yBar(nm), zBar(nm)];
  const linear = gamutClip(xyzToLinearSrgb(xyz));
  const srgb: Vec3 = [srgbEncode(linear[0]), srgbEncode(linear[1]), srgbEncode(linear[2])];
  return { xyz, linear, srgb };
}
