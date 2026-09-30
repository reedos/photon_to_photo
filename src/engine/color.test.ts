import { describe, expect, it } from 'vitest';
import {
  fitCameraToXYZ,
  linearSrgbToXyz,
  LINEAR_SRGB_TO_XYZ,
  mat3Invert,
  mat3Vec3,
  reflectanceToXYZ,
  spectrumToCameraRGB,
  spectrumToXYZ,
  srgbDecode,
  srgbEncode,
  whiteBalanceGains,
  xyzToLinearSrgb,
  XYZ_TO_LINEAR_SRGB,
  type ChannelSensitivities,
} from './color';
import { BINS_10NM, CIE1931_XBAR, CIE1931_YBAR, CIE1931_ZBAR, D65_SPD, D65_XYZ, tableSpectrum } from './fixtures/e3-cie';
import type { Vec3 } from './types';

const cmfs = { xbar: tableSpectrum(CIE1931_XBAR), ybar: tableSpectrum(CIE1931_YBAR), zbar: tableSpectrum(CIE1931_ZBAR) };
const d65 = tableSpectrum(D65_SPD);

describe('spectrumToXYZ / reflectanceToXYZ', () => {
  it('integrates a constant spectrum against ybar to the hand-summed value (sanity on the quadrature rule)', () => {
    // Hand calculation, not calling spectrumToXYZ: sum(ybar_i * weight_i) directly from the fixture arrays.
    let expected = 0;
    for (let i = 0; i < CIE1931_YBAR.length; i++) expected += CIE1931_YBAR[i] * BINS_10NM.weights[i];
    const [, y] = spectrumToXYZ(() => 1, BINS_10NM, cmfs);
    expect(y).toBeCloseTo(expected, 9);
  });

  it('a perfect reflector under D65, normalized to Y=100, reproduces the published D65 white point', () => {
    // Golden values: CIE 15:2004 / Schanda (2007) "Colorimetry" appendix A, X=95.047 Y=100 Z=108.883 (see
    // fixtures/e3-cie.ts). Our 10 nm quadrature of the same underlying tables was checked numerically
    // against this target at ~0.03-0.07% relative error (see the derivation note in that fixture file);
    // 0.5% leaves ample margin while still catching a real formula error (a wrong CMF/illuminant pairing,
    // a missing normalization, a transposed X/Z) which would miss by many percent.
    const xyz = reflectanceToXYZ(() => 1, d65, BINS_10NM, cmfs);
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(xyz[i] - D65_XYZ[i]) / D65_XYZ[i]).toBeLessThan(0.005);
    }
    expect(xyz[1]).toBeCloseTo(100, 6); // Y=100 by construction, should be exact to float precision
  });

  it('scales linearly with reflectance (edge case: a black patch is all zeros)', () => {
    const zero = reflectanceToXYZ(() => 0, d65, BINS_10NM, cmfs);
    expect(zero).toEqual([0, 0, 0]);
    const half = reflectanceToXYZ(() => 0.5, d65, BINS_10NM, cmfs);
    const full = reflectanceToXYZ(() => 1, d65, BINS_10NM, cmfs);
    for (let i = 0; i < 3; i++) expect(half[i]).toBeCloseTo(full[i] / 2, 9);
  });
});

describe('spectrumToCameraRGB', () => {
  it('reads out per-channel integrals against flat sensitivities (hand-computable)', () => {
    const sens: ChannelSensitivities = { R: () => 2, G: () => 1, B: () => 0.5 };
    let integral = 0;
    for (let i = 0; i < D65_SPD.length; i++) integral += D65_SPD[i] * BINS_10NM.weights[i];
    const [r, g, b] = spectrumToCameraRGB(d65, BINS_10NM, sens);
    expect(r).toBeCloseTo(2 * integral, 6);
    expect(g).toBeCloseTo(1 * integral, 6);
    expect(b).toBeCloseTo(0.5 * integral, 6);
  });
});

describe('XYZ <-> linear sRGB', () => {
  it('LINEAR_SRGB_TO_XYZ and XYZ_TO_LINEAR_SRGB are inverses of each other (cross-checks both citations)', () => {
    const computedInverse = mat3Invert(LINEAR_SRGB_TO_XYZ);
    for (let i = 0; i < 9; i++) {
      expect(computedInverse[i]).toBeCloseTo(XYZ_TO_LINEAR_SRGB[i], 5);
    }
  });

  it('maps white (1,1,1) to the D65 white point chromaticity (0.3127, 0.3290)', () => {
    // D65 chromaticity per CIE 15:2004 / Wikipedia "Standard illuminant" (widely reproduced constant).
    const xyz = linearSrgbToXyz([1, 1, 1]);
    const sum = xyz[0] + xyz[1] + xyz[2];
    expect(xyz[0] / sum).toBeCloseTo(0.3127, 3);
    expect(xyz[1] / sum).toBeCloseTo(0.329, 3);
  });

  it('round-trips arbitrary colors through XYZ and back', () => {
    const samples: Vec3[] = [
      [0.2, 0.5, 0.9],
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [0.01, 0.01, 0.01],
    ];
    for (const rgb of samples) {
      const back = xyzToLinearSrgb(linearSrgbToXyz(rgb));
      for (let i = 0; i < 3; i++) expect(back[i]).toBeCloseTo(rgb[i], 6);
    }
  });
});

describe('srgbEncode / srgbDecode', () => {
  it('are inverses, including at and around the toe breakpoint (edge case)', () => {
    for (const linear of [0, 0.0001, 0.0031308, 0.0031308 * 2, 0.18, 0.5, 1]) {
      expect(srgbDecode(srgbEncode(linear))).toBeCloseTo(linear, 6);
    }
  });

  it('is continuous across the breakpoint: the two branches agree at the junction (edge case)', () => {
    const justBelow = srgbEncode(0.0031308 - 1e-9);
    const justAbove = srgbEncode(0.0031308 + 1e-9);
    expect(Math.abs(justAbove - justBelow)).toBeLessThan(1e-6);
  });

  it('maps 0 -> 0 and 1 -> 1 (1.055*1^(1/2.4)-0.055 lands a float epsilon under 1)', () => {
    expect(srgbEncode(0)).toBe(0);
    expect(srgbEncode(1)).toBeCloseTo(1, 12);
    expect(srgbDecode(0)).toBe(0);
    expect(srgbDecode(1)).toBeCloseTo(1, 12);
  });

  it('clamps negative input to 0 (edge case: read noise can push a linear value below black)', () => {
    expect(srgbEncode(-0.5)).toBe(0);
    expect(srgbDecode(-0.5)).toBe(0);
  });
});

describe('fitCameraToXYZ', () => {
  it('exactly recovers the inverse of a known linear camera response (hand-computed target)', () => {
    // Construct camera RGB as a KNOWN linear transform of XYZ: rgb = diag(2, 3, 4) * xyz. The least-squares
    // fit of xyz ~= M * rgb should then recover M = diag(1/2, 1/3, 1/4) exactly (up to floating-point
    // error), independent of what spectra or patches were used to get there.
    const xyzTargets: Vec3[] = [
      [10, 20, 30],
      [5, 50, 5],
      [80, 10, 2],
      [1, 1, 1],
      [0, 90, 40],
      [33, 12, 76],
    ];
    const cameraRGB: Vec3[] = xyzTargets.map(([x, y, z]) => [2 * x, 3 * y, 4 * z]);
    const M = fitCameraToXYZ(cameraRGB, xyzTargets);
    const expected = [0.5, 0, 0, 0, 1 / 3, 0, 0, 0, 0.25];
    for (let i = 0; i < 9; i++) expect(M[i]).toBeCloseTo(expected[i], 9);
    // And it actually reconstructs every patch, not just the diagonal coefficients.
    for (let i = 0; i < xyzTargets.length; i++) {
      const back = mat3Vec3(M, cameraRGB[i]);
      for (let k = 0; k < 3; k++) expect(back[k]).toBeCloseTo(xyzTargets[i][k], 6);
    }
  });

  it('fits real CMF-shaped sensitivities better than the identity mapping (sanity, not exact)', () => {
    const sens: ChannelSensitivities = { R: cmfs.xbar, G: cmfs.ybar, B: cmfs.zbar };
    const reflectances = [() => 1, () => 0.5, (nm: number) => (nm < 550 ? 1 : 0.2), (nm: number) => (nm > 550 ? 1 : 0.2), () => 0.1, () => 0.8];
    const rgbs = reflectances.map((r) => spectrumToCameraRGB((nm) => r(nm) * d65(nm), BINS_10NM, sens));
    const xyzs = reflectances.map((r) => reflectanceToXYZ(r, d65, BINS_10NM, cmfs));
    const M = fitCameraToXYZ(rgbs, xyzs);
    let fitErr = 0;
    let identityErr = 0;
    for (let i = 0; i < rgbs.length; i++) {
      const fitted = mat3Vec3(M, rgbs[i]);
      for (let k = 0; k < 3; k++) {
        fitErr += (fitted[k] - xyzs[i][k]) ** 2;
        identityErr += (rgbs[i][k] - xyzs[i][k]) ** 2;
      }
    }
    expect(fitErr).toBeLessThan(identityErr);
    expect(fitErr).toBeLessThan(1e-6); // R=xbar, G=ybar, B=zbar is already exactly XYZ, so the fit should be ~exact
  });

  it('rejects mismatched lengths and too few patches (edge cases)', () => {
    expect(() => fitCameraToXYZ([[1, 0, 0]], [[1, 0, 0]])).toThrow();
    expect(() =>
      fitCameraToXYZ(
        [
          [1, 0, 0],
          [0, 1, 0],
        ],
        [
          [1, 0, 0],
          [0, 1, 0],
          [0, 0, 1],
        ],
      ),
    ).toThrow();
  });
});

describe('whiteBalanceGains', () => {
  it('recovers exact gains from known channel-strength ratios (hand-computable)', () => {
    const sens: ChannelSensitivities = { R: () => 2, G: () => 1, B: () => 0.5 };
    const [gr, gg, gb] = whiteBalanceGains(d65, BINS_10NM, sens);
    expect(gr).toBeCloseTo(0.5, 9);
    expect(gg).toBe(1);
    expect(gb).toBeCloseTo(2, 9);
  });

  it('neutralizes the illuminant: gains applied to the raw response equalize R, G, B', () => {
    const sens: ChannelSensitivities = { R: cmfs.xbar, G: cmfs.ybar, B: cmfs.zbar };
    const [r, g, b] = spectrumToCameraRGB(d65, BINS_10NM, sens);
    const [gr, gg, gb] = whiteBalanceGains(d65, BINS_10NM, sens);
    expect(r * gr).toBeCloseTo(g * gg, 6);
    expect(b * gb).toBeCloseTo(g * gg, 6);
  });

  it('rejects an illuminant with a zero channel response (edge case)', () => {
    const sens: ChannelSensitivities = { R: () => 0, G: () => 1, B: () => 1 };
    expect(() => whiteBalanceGains(d65, BINS_10NM, sens)).toThrow();
  });
});

describe('mat3Invert', () => {
  it('inverts the identity to itself', () => {
    const I: [number, number, number, number, number, number, number, number, number] = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const inv = mat3Invert(I);
    for (let i = 0; i < 9; i++) expect(inv[i]).toBeCloseTo(I[i], 12);
  });

  it('throws on a singular matrix (edge case)', () => {
    expect(() => mat3Invert([1, 2, 3, 2, 4, 6, 1, 1, 1])).toThrow();
  });
});
