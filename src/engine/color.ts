// Spectra to camera RGB and to CIE XYZ, XYZ <-> linear sRGB, sRGB encode/decode, a least-squares
// camera-to-XYZ fit, and white-balance gains. Pure functions of the spectra/CMFs/matrices passed in: no
// data/ imports (ENGINE.md), so a caller supplies real QE curves, CMFs and illuminants (from data/color/*
// once the lead adds it, or from src/engine/fixtures/e3-cie.ts for these tests).
//
// Wavelength integrals throughout use the caller's `Bins` (src/engine/types.ts) as a simple weighted sum:
// integral ~= sum_i f(centers[i]) * weights[i], i.e. a midpoint/rectangle rule over each bin's width. This
// matches how `Bins.weights` is documented ("bin widths or quadrature weights") and is the same convention
// spectrum.ts's `bins()` is described as producing (ENGINE.md, workstream E1a).

import type { Bins, Vec3 } from './types';
import type { CfaColor } from './types';

function integrate(bins: Bins, f: (nm: number) => number): number {
  let sum = 0;
  const { centers, weights } = bins;
  for (let i = 0; i < centers.length; i++) {
    sum += f(centers[i]) * weights[i];
  }
  return sum;
}

// ---- linear algebra (3x3), shared with pipeline.ts's color-matrix stage -------------------------------

/** Row-major 3x3: [m00, m01, m02, m10, m11, m12, m20, m21, m22]. */
export type Mat3 = readonly [number, number, number, number, number, number, number, number, number];

export function mat3Vec3(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

export function mat3Multiply(a: Mat3, b: Mat3): Mat3 {
  const r = new Array(9) as number[];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      r[row * 3 + col] =
        a[row * 3 + 0] * b[0 * 3 + col] + a[row * 3 + 1] * b[1 * 3 + col] + a[row * 3 + 2] * b[2 * 3 + col];
    }
  }
  return r as unknown as Mat3;
}

/** 3x3 inverse by the classical adjugate/cofactor method. Throws if the matrix is singular (det ~ 0). */
export function mat3Invert(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const D = -(b * i - c * h);
  const E = a * i - c * g;
  const F = -(a * h - b * g);
  const G = b * f - c * e;
  const H = -(a * f - c * d);
  const I = a * e - b * d;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) {
    throw new Error('mat3Invert: matrix is singular (|det| < 1e-12)');
  }
  const invDet = 1 / det;
  // Adjugate is the transpose of the cofactor matrix; dividing by det gives the inverse.
  return [A * invDet, D * invDet, G * invDet, B * invDet, E * invDet, H * invDet, C * invDet, F * invDet, I * invDet];
}

// ---- CIE XYZ from spectra --------------------------------------------------------------------------------

/** Color matching functions as continuous functions of wavelength (nm), e.g. table lookups over real data. */
export interface CMFs {
  xbar: (nm: number) => number;
  ybar: (nm: number) => number;
  zbar: (nm: number) => number;
}

/**
 * Raw radiometric tristimulus integral of a spectral function (CIE 15:2004, "Colorimetry," 3rd ed., §7,
 * eq. 7.1-7.3, without the illuminant/reflectance split or the Y=100 normalization those equations use
 * for object colors — see `reflectanceToXYZ` for that). Appropriate when `spectrum` is itself a physical
 * spectral radiance or irradiance (W . sr^-1 . m^-2 . nm^-1 or W . m^-2 . nm^-1): the result is un-
 * normalized tristimulus values in whatever units `spectrum` carries times nm.
 */
export function spectrumToXYZ(spectrum: (nm: number) => number, bins: Bins, cmfs: CMFs): Vec3 {
  return [
    integrate(bins, (nm) => spectrum(nm) * cmfs.xbar(nm)),
    integrate(bins, (nm) => spectrum(nm) * cmfs.ybar(nm)),
    integrate(bins, (nm) => spectrum(nm) * cmfs.zbar(nm)),
  ];
}

/**
 * Tristimulus values of a reflecting object under an illuminant, normalized so a perfect (rho=1)
 * reflector maps to Y=100 — the standard method for computing e.g. a ColorChecker patch's "true" XYZ (CIE
 * 15:2004 §7.3, eq. 7.4-7.6): X = k * integral(R(l) S(l) xbar(l) dl), k = 100 / integral(S(l) ybar(l) dl),
 * and similarly for Y, Z.
 */
export function reflectanceToXYZ(
  reflectance: (nm: number) => number,
  illuminant: (nm: number) => number,
  bins: Bins,
  cmfs: CMFs,
): Vec3 {
  const k = 100 / integrate(bins, (nm) => illuminant(nm) * cmfs.ybar(nm));
  return [
    k * integrate(bins, (nm) => reflectance(nm) * illuminant(nm) * cmfs.xbar(nm)),
    k * integrate(bins, (nm) => reflectance(nm) * illuminant(nm) * cmfs.ybar(nm)),
    k * integrate(bins, (nm) => reflectance(nm) * illuminant(nm) * cmfs.zbar(nm)),
  ];
}

// ---- camera RGB from spectra ------------------------------------------------------------------------------

/** A camera's per-channel spectral sensitivity (QE x optical transmission, or just QE — caller's choice). */
export type ChannelSensitivities = Record<CfaColor, (nm: number) => number>;

/** Camera RGB response to a spectral function, one integral per channel against its sensitivity curve. */
export function spectrumToCameraRGB(spectrum: (nm: number) => number, bins: Bins, sens: ChannelSensitivities): Vec3 {
  return [
    integrate(bins, (nm) => spectrum(nm) * sens.R(nm)),
    integrate(bins, (nm) => spectrum(nm) * sens.G(nm)),
    integrate(bins, (nm) => spectrum(nm) * sens.B(nm)),
  ];
}

// ---- XYZ <-> linear sRGB, sRGB encode/decode (IEC 61966-2-1) ---------------------------------------------

// Derived from the sRGB primaries R(0.6400, 0.3300), G(0.3000, 0.6000), B(0.1500, 0.0600) and the D65
// white point (0.3127, 0.3290), per IEC 61966-2-1:1999, "Multimedia systems and equipment - Colour
// measurement and management - Part 2-1: Colour management - Default RGB colour space - sRGB." These
// specific nine-digit coefficients are the commonly reproduced solution of that primaries system (e.g.
// Lindbloom, B., "RGB/XYZ Matrices," brucelindbloom.com; the W3C CSS Color 4 spec, §"predefined-rgb"); we
// cross-check LINEAR_SRGB_TO_XYZ against the CIE D65 white point fixture in color.test.ts rather than
// re-deriving the primaries system here.
export const LINEAR_SRGB_TO_XYZ: Mat3 = [
  0.4124564, 0.3575761, 0.1804375, 0.2126729, 0.7151522, 0.072175, 0.0193339, 0.119192, 0.9503041,
];
export const XYZ_TO_LINEAR_SRGB: Mat3 = [
  3.2404542, -1.5371385, -0.4985314, -0.969266, 1.8760108, 0.041556, 0.0556434, -0.2040259, 1.0572252,
];

export function linearSrgbToXyz(rgb: Vec3): Vec3 {
  return mat3Vec3(LINEAR_SRGB_TO_XYZ, rgb);
}

export function xyzToLinearSrgb(xyz: Vec3): Vec3 {
  return mat3Vec3(XYZ_TO_LINEAR_SRGB, xyz);
}

/** sRGB OETF (IEC 61966-2-1 §4.3, the piecewise gamma-2.4-with-linear-toe transfer function). c in [0, 1]. */
export function srgbEncode(c: number): number {
  const x = Math.max(0, c);
  return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

/** sRGB EOTF: inverse of `srgbEncode`. c in [0, 1]. */
export function srgbDecode(c: number): number {
  const x = Math.max(0, c);
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}

// ---- camera-to-XYZ matrix, fitted by least squares --------------------------------------------------------

/**
 * Fits a 3x3 matrix M (xyz ~= M * cameraRGB) by ordinary least squares over a set of patches, minimizing
 * sum_i ||M rgb_i - xyz_i||^2. Solved via the normal equations (A^T A) M_row^T = A^T b for each output row
 * independently, sharing one 3x3 inverse of A^T A across all three (A is the N x 3 design matrix of
 * cameraRGB rows) — standard linear least squares; see e.g. Golub, G. H. & Van Loan, C. F., "Matrix
 * Computations," 4th ed., Johns Hopkins University Press, 2013, §5.3, "The Normal Equations." Needs at
 * least 3 patches spanning 3 independent directions in RGB (typically a ColorChecker's 24 patches or more)
 * or `mat3Invert` will throw on the resulting singular A^T A.
 */
export function fitCameraToXYZ(cameraRGB: Vec3[], xyz: Vec3[]): Mat3 {
  if (cameraRGB.length !== xyz.length) {
    throw new Error('fitCameraToXYZ: cameraRGB and xyz must have the same length');
  }
  if (cameraRGB.length < 3) {
    throw new Error('fitCameraToXYZ: need at least 3 patches to fit a 3x3 matrix');
  }
  const AtA: number[][] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const AtB: number[][] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < cameraRGB.length; i++) {
    const r = cameraRGB[i];
    const t = xyz[i];
    for (let a = 0; a < 3; a++) {
      for (let b = 0; b < 3; b++) AtA[a][b] += r[a] * r[b];
      for (let j = 0; j < 3; j++) AtB[a][j] += r[a] * t[j];
    }
  }
  const AtAInv = mat3Invert([
    AtA[0][0], AtA[0][1], AtA[0][2], AtA[1][0], AtA[1][1], AtA[1][2], AtA[2][0], AtA[2][1], AtA[2][2],
  ]);
  const M = new Array(9).fill(0) as number[];
  for (let j = 0; j < 3; j++) {
    // Row j of M = AtAInv * (column j of AtB).
    for (let k = 0; k < 3; k++) {
      let s = 0;
      for (let a = 0; a < 3; a++) s += AtAInv[k * 3 + a] * AtB[a][j];
      M[j * 3 + k] = s;
    }
  }
  return M as unknown as Mat3;
}

// ---- white balance -------------------------------------------------------------------------------------

/**
 * Per-channel gains that make a spectrally flat (rho = 1) neutral patch read equal in R, G and B under the
 * given illuminant, normalized to a gain of 1 on G (the conventional raw-pipeline reference channel: G has
 * two samples per Bayer quad and the least photon-shot noise at a given exposure). This is the "AsShotNeutral
 * / gray-world" gain used throughout raw processing pipelines, e.g. Adobe DNG Specification 1.7.1.0 (2023),
 * §6, "Mapping Camera Color Space to CIE XYZ Space."
 */
export function whiteBalanceGains(illuminant: (nm: number) => number, bins: Bins, sens: ChannelSensitivities): Vec3 {
  const [r, g, b] = spectrumToCameraRGB(illuminant, bins, sens);
  if (r <= 0 || g <= 0 || b <= 0) {
    throw new Error('whiteBalanceGains: illuminant produces a zero or negative channel response');
  }
  return [g / r, 1, g / b];
}
