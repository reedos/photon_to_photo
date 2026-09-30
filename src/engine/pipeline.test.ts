import { describe, expect, it } from 'vitest';
import { srgbEncode } from './color';
import {
  acesFilmicToneCurve,
  applyColorMatrix,
  applyToneCurve,
  applyWhiteBalance,
  bilateralFilter,
  blackLevelSubtract,
  cfaColorAt,
  clipHighlightsToNeutral,
  demosaicBilinear,
  demosaicMalvarHeCutler,
  encodeRGB8,
  gaussianBlur,
  makePlane,
  srgbToneCurve,
  unsharpMask,
  type BayerPattern,
  type Plane,
  type RgbPlanes,
} from './pipeline';
import { spectrumToCameraRGB, whiteBalanceGains } from './color';
import { FIXTURE_SENSOR } from './fixtures/e3-sensor';
import { BINS_10NM, D65_SPD, tableSpectrum } from './fixtures/e3-cie';

function rampPlane(width: number, height: number, a: number, b: number, c: number): Plane {
  const p = makePlane(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) p.data[y * width + x] = a * x + b * y + c;
  }
  return p;
}

describe('cfaColorAt', () => {
  it('reads the 2x2 pattern string as TL,TR / BL,BR', () => {
    expect(cfaColorAt('RGGB', 0, 0)).toBe('R');
    expect(cfaColorAt('RGGB', 1, 0)).toBe('G');
    expect(cfaColorAt('RGGB', 0, 1)).toBe('G');
    expect(cfaColorAt('RGGB', 1, 1)).toBe('B');
    expect(cfaColorAt('BGGR', 0, 0)).toBe('B');
    expect(cfaColorAt('BGGR', 1, 1)).toBe('R');
    expect(cfaColorAt('GRBG', 0, 0)).toBe('G');
    expect(cfaColorAt('GRBG', 1, 0)).toBe('R');
    expect(cfaColorAt('GBRG', 0, 0)).toBe('G');
    expect(cfaColorAt('GBRG', 1, 0)).toBe('B');
  });

  it('repeats every 2 pixels (edge case: coordinates far from the origin)', () => {
    expect(cfaColorAt('RGGB', 100, 200)).toBe('R');
    expect(cfaColorAt('RGGB', 101, 200)).toBe('G');
    expect(cfaColorAt('RGGB', 100, 201)).toBe('G');
    expect(cfaColorAt('RGGB', 101, 201)).toBe('B');
  });
});

describe('blackLevelSubtract', () => {
  it('subtracts a constant everywhere, including below zero (edge case, not clamped)', () => {
    const raw = makePlane(2, 2);
    raw.data.set([10, 512, 600, 0]);
    const out = blackLevelSubtract(raw, 512);
    expect(Array.from(out.data)).toEqual([-502, 0, 88, -512]);
  });
});

describe('demosaicBilinear', () => {
  const patterns: BayerPattern[] = ['RGGB', 'BGGR', 'GRBG', 'GBRG'];

  it('leaves a perfectly flat raw field flat in every channel, for every pattern', () => {
    for (const pattern of patterns) {
      const raw = makePlane(8, 8, 42);
      const { R, G, B } = demosaicBilinear(raw, pattern);
      for (const plane of [R, G, B]) {
        for (const v of plane.data) expect(v).toBeCloseTo(42, 4);
      }
    }
  });

  it('reproduces a smooth linear ramp exactly, away from the 1-pixel border (symmetric-kernel argument)', () => {
    // Every bilinear tap set used here (4-neighbor cross, 4-neighbor diagonal, or a 2-neighbor
    // horizontal/vertical pair) is symmetric about the center pixel, so its first spatial moment is zero
    // and it reproduces a * x + b * y + c exactly at every interior pixel — see the doc comment on
    // demosaicBilinear. The border is excluded because there the neighbor set is truncated asymmetrically.
    for (const pattern of ['RGGB', 'GBRG'] as BayerPattern[]) {
      const width = 12;
      const height = 12;
      const raw = rampPlane(width, height, 1.3, -0.7, 20);
      const { R, G, B } = demosaicBilinear(raw, pattern);
      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          const expected = 1.3 * x - 0.7 * y + 20;
          const idx = y * width + x;
          expect(R.data[idx]).toBeCloseTo(expected, 4);
          expect(G.data[idx]).toBeCloseTo(expected, 4);
          expect(B.data[idx]).toBeCloseTo(expected, 4);
        }
      }
    }
  });

  it('the native channel is read straight from the raw mosaic, unmodified', () => {
    const raw = makePlane(4, 4);
    raw.data.set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    const { R } = demosaicBilinear(raw, 'RGGB');
    expect(R.data[0]).toBe(1); // (0,0) is R in RGGB
  });
});

describe('demosaicMalvarHeCutler', () => {
  it('reproduces a smooth linear ramp exactly, away from the 2-pixel border (symmetric-kernel argument)', () => {
    // MHC_CROSS, MHC_H, MHC_V and MHC_DIAG all sum to 8 and are each symmetric under kx -> -kx and
    // ky -> -ky (checked by inspection of the published coefficients), so their first spatial moments
    // vanish and, divided by 8, each reproduces a*x + b*y + c exactly (same argument as the bilinear test,
    // just with a 5x5 support) — this is the specific claim ENGINE.md asks this module to test.
    const width = 16;
    const height = 16;
    for (const pattern of ['RGGB', 'GRBG'] as BayerPattern[]) {
      const raw = rampPlane(width, height, 2.1, 0.9, -5);
      const { R, G, B } = demosaicMalvarHeCutler(raw, pattern);
      for (let y = 2; y < height - 2; y++) {
        for (let x = 2; x < width - 2; x++) {
          const expected = 2.1 * x + 0.9 * y - 5;
          const idx = y * width + x;
          expect(R.data[idx]).toBeCloseTo(expected, 4);
          expect(G.data[idx]).toBeCloseTo(expected, 4);
          expect(B.data[idx]).toBeCloseTo(expected, 4);
        }
      }
    }
  });

  it('falls back to the bilinear result inside the 2-pixel border (edge case)', () => {
    const width = 10;
    const height = 10;
    const raw = makePlane(width, height);
    for (let i = 0; i < raw.data.length; i++) raw.data[i] = (i * 37) % 97; // arbitrary non-smooth values
    const mhc = demosaicMalvarHeCutler(raw, 'RGGB');
    const bilinear = demosaicBilinear(raw, 'RGGB');
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (x < 2 || x >= width - 2 || y < 2 || y >= height - 2) {
          const idx = y * width + x;
          expect(mhc.R.data[idx]).toBe(bilinear.R.data[idx]);
          expect(mhc.G.data[idx]).toBe(bilinear.G.data[idx]);
          expect(mhc.B.data[idx]).toBe(bilinear.B.data[idx]);
        }
      }
    }
  });

  it('handles a plane smaller than the 5x5 kernel support without crashing (edge case)', () => {
    const raw = makePlane(3, 3, 7);
    expect(() => demosaicMalvarHeCutler(raw, 'RGGB')).not.toThrow();
  });
});

describe('applyWhiteBalance', () => {
  it('scales each channel by its own gain (hand-computed)', () => {
    const planes: RgbPlanes = { R: makePlane(1, 1, 10), G: makePlane(1, 1, 20), B: makePlane(1, 1, 30) };
    const out = applyWhiteBalance(planes, [0.5, 1, 2]);
    expect(out.R.data[0]).toBeCloseTo(5, 4);
    expect(out.G.data[0]).toBeCloseTo(20, 4);
    expect(out.B.data[0]).toBeCloseTo(60, 4);
  });
});

describe('clipHighlightsToNeutral', () => {
  it('a fully clipped raw pixel comes out neutral white: unequal WB gains stop mattering once clipped', () => {
    // A pixel that saturated the sensor identically in every channel (raw value 1.0 pre-WB, this pipeline's
    // own normalized full-scale) demosaics to R=G=B=1.0 everywhere. Distinct white-balance gains (as any real
    // illuminant produces) then pull the three channels apart -- exactly the case that, left unclipped into
    // applyColorMatrix, produces the pink/magenta cast this function exists to prevent (see its doc comment).
    const gains: [number, number, number] = [1.8, 1, 1.3]; // G's own gain is always 1 (color.ts's whiteBalanceGains)
    const planes: RgbPlanes = {
      R: makePlane(2, 2, 1 * gains[0]),
      G: makePlane(2, 2, 1 * gains[1]),
      B: makePlane(2, 2, 1 * gains[2]),
    };
    expect(planes.R.data[0]).not.toBeCloseTo(planes.G.data[0], 4); // sanity: the bug case really is unequal here
    const out = clipHighlightsToNeutral(planes, gains);
    // Clipped to the least-gained channel's own ceiling (G's gain, 1.0 here) -- neutral (equal) everywhere.
    for (let i = 0; i < 4; i++) {
      expect(out.R.data[i]).toBeCloseTo(1, 6);
      expect(out.G.data[i]).toBeCloseTo(1, 6);
      expect(out.B.data[i]).toBeCloseTo(1, 6);
    }
  });

  it('leaves an unsaturated (below every channel ceiling) pixel completely untouched', () => {
    const gains: [number, number, number] = [1.8, 1, 1.3];
    // Well below min(gains) = 1 in every channel: nothing should clip.
    const planes: RgbPlanes = { R: makePlane(1, 1, 0.1), G: makePlane(1, 1, 0.3), B: makePlane(1, 1, 0.2) };
    const out = clipHighlightsToNeutral(planes, gains);
    expect(out.R.data[0]).toBeCloseTo(0.1, 6);
    expect(out.G.data[0]).toBeCloseTo(0.3, 6);
    expect(out.B.data[0]).toBeCloseTo(0.2, 6);
  });

  it('composed with applyColorMatrix: clipping FIRST keeps a blown highlight neutral through the matrix, ' +
     'clipping only AFTER the matrix (the bug this replaces) does not', () => {
    // A saturated-in-every-channel highlight (1.0 pre-WB, all channels -- see the first test in this
    // describe block) under real, unequal gains. A non-identity color matrix (representative of a fitted
    // camera-to-sRGB matrix, which routinely has off-diagonal and negative terms) is applied either AFTER
    // this function (fixed order) or in its place, i.e. straight after white balance with no common-ceiling
    // clip at all (the bug: independent per-channel clamping only ever happens later, at encodeRGB8, which
    // is AFTER the matrix has already mixed the unequal channels).
    const gains: [number, number, number] = [1.8, 1, 1.3];
    const preWb: RgbPlanes = { R: makePlane(1, 1, 1), G: makePlane(1, 1, 1), B: makePlane(1, 1, 1) };
    const wb = applyWhiteBalance(preWb, gains); // [1.8, 1, 1.3] -- unequal, though the true scene point is neutral
    // A representative fitted matrix with real off-diagonal/negative terms (not identity, not diagonal).
    const m: [number, number, number, number, number, number, number, number, number] =
      [1.6, -0.4, -0.2, -0.3, 1.7, -0.4, -0.1, -0.5, 1.6];

    const buggyOrder = applyColorMatrix(wb, m); // matrix sees the unclipped, unequal [1.8, 1, 1.3] directly
    const fixedOrder = applyColorMatrix(clipHighlightsToNeutral(wb, gains), m); // matrix sees [1, 1, 1]

    // Fixed order: the matrix's input is neutral (equal channels), so its output is exactly m's row sums
    // applied to a scalar -- still equal across channels only if the matrix's row sums happen to match, which
    // a real fitted matrix generally does NOT guarantee either; the point this test actually needs is the
    // NEXT clamp (encodeRGB8's implicit per-channel [0,1] clamp): after that clamp, compare the two orders'
    // clamped outputs directly to show they differ, i.e. that WHERE the clip happens changes the rendered
    // result -- which is the whole reason this is a named, fixed pitfall rather than a no-op reordering.
    const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
    const buggyClamped = [clamp01(buggyOrder.R.data[0]), clamp01(buggyOrder.G.data[0]), clamp01(buggyOrder.B.data[0])];
    const fixedClamped = [clamp01(fixedOrder.R.data[0]), clamp01(fixedOrder.G.data[0]), clamp01(fixedOrder.B.data[0])];
    expect(fixedClamped).not.toEqual(buggyClamped); // the ordering measurably matters
    // And the fixed order's result, for a genuinely neutral saturated source, is provably still equal-ish
    // in structure: it is m applied to (ceiling, ceiling, ceiling), i.e. ceiling * (row sums of m) -- compute
    // that directly and confirm fixedOrder matches it exactly (clipping first really did neutralize the
    // input before the matrix, with no other hidden effect).
    const ceiling = Math.min(...gains);
    const rowSum = (row: number[]) => row.reduce((a, b) => a + b, 0);
    const expected = [rowSum(m.slice(0, 3)) * ceiling, rowSum(m.slice(3, 6)) * ceiling, rowSum(m.slice(6, 9)) * ceiling];
    expect(fixedOrder.R.data[0]).toBeCloseTo(expected[0], 6);
    expect(fixedOrder.G.data[0]).toBeCloseTo(expected[1], 6);
    expect(fixedOrder.B.data[0]).toBeCloseTo(expected[2], 6);
  });
});

describe('applyColorMatrix', () => {
  it('applies the matrix per pixel (hand-computed, non-identity matrix)', () => {
    const planes: RgbPlanes = { R: makePlane(1, 1, 1), G: makePlane(1, 1, 2), B: makePlane(1, 1, 3) };
    // [[1,0,0],[0,2,0],[1,1,1]] * [1,2,3] = [1, 4, 6]
    const out = applyColorMatrix(planes, [1, 0, 0, 0, 2, 0, 1, 1, 1]);
    expect(out.R.data[0]).toBeCloseTo(1, 4);
    expect(out.G.data[0]).toBeCloseTo(4, 4);
    expect(out.B.data[0]).toBeCloseTo(6, 4);
  });

  it('the identity matrix is a no-op (edge case)', () => {
    const planes: RgbPlanes = { R: makePlane(1, 1, 0.2), G: makePlane(1, 1, 0.5), B: makePlane(1, 1, 0.9) };
    const out = applyColorMatrix(planes, [1, 0, 0, 0, 1, 0, 0, 0, 1]);
    expect(out.R.data[0]).toBeCloseTo(0.2, 4);
    expect(out.G.data[0]).toBeCloseTo(0.5, 4);
    expect(out.B.data[0]).toBeCloseTo(0.9, 4);
  });
});

describe('tone curves', () => {
  it('srgbToneCurve is exactly color.ts\'s srgbEncode (re-export, not a reimplementation)', () => {
    for (const x of [0, 0.001, 0.0031308, 0.18, 0.5, 1]) expect(srgbToneCurve(x)).toBe(srgbEncode(x));
  });

  it('acesFilmicToneCurve maps 0 -> 0, is monotonic increasing, and saturates towards 1 without exceeding it', () => {
    expect(acesFilmicToneCurve(0)).toBe(0);
    let prev = -1;
    for (let x = 0; x <= 20; x += 0.5) {
      const v = acesFilmicToneCurve(x);
      expect(v).toBeGreaterThanOrEqual(prev);
      expect(v).toBeLessThanOrEqual(1);
      prev = v;
    }
    expect(acesFilmicToneCurve(1000)).toBeLessThanOrEqual(1);
  });

  it('applyToneCurve maps every plane pointwise', () => {
    const planes: RgbPlanes = { R: makePlane(1, 1, 0.5), G: makePlane(1, 1, 0.25), B: makePlane(1, 1, 1) };
    const out = applyToneCurve(planes, (x) => x * 2);
    expect(out.R.data[0]).toBeCloseTo(1, 4);
    expect(out.G.data[0]).toBeCloseTo(0.5, 4);
    expect(out.B.data[0]).toBeCloseTo(2, 4);
  });
});

describe('encodeRGB8', () => {
  it('scales [0,1] to [0,255] and rounds', () => {
    const planes: RgbPlanes = { R: makePlane(1, 1, 0), G: makePlane(1, 1, 0.5), B: makePlane(1, 1, 1) };
    const img = encodeRGB8(planes);
    expect(img.data[0]).toBe(0);
    expect(img.data[1]).toBeGreaterThanOrEqual(127);
    expect(img.data[1]).toBeLessThanOrEqual(128);
    expect(img.data[2]).toBe(255);
  });

  it('clamps out-of-range values (edge case: negative from read noise, >1 from an unclipped highlight)', () => {
    const planes: RgbPlanes = { R: makePlane(1, 1, -5), G: makePlane(1, 1, 0.5), B: makePlane(1, 1, 5) };
    const img = encodeRGB8(planes);
    expect(img.data[0]).toBe(0);
    expect(img.data[2]).toBe(255);
  });
});

describe('bilateralFilter', () => {
  it('leaves a flat field unchanged', () => {
    const p = makePlane(6, 6, 0.4);
    const out = bilateralFilter(p, { spatialSigma: 1.5, rangeSigma: 0.1 });
    for (const v of out.data) expect(v).toBeCloseTo(0.4, 4);
  });

  it('preserves a step edge when rangeSigma is small, and smooths it when rangeSigma is large (edge cases)', () => {
    const width = 10;
    const height = 4;
    const step = makePlane(width, height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) step.data[y * width + x] = x < 5 ? 0 : 1;
    const preserved = bilateralFilter(step, { spatialSigma: 2, rangeSigma: 0.01, radius: 4 });
    const smoothed = bilateralFilter(step, { spatialSigma: 2, rangeSigma: 100, radius: 4 });
    // Right at the edge (x=4, still in the "0" region), a small rangeSigma should barely move the value...
    const edgeIdx = 2 * width + 4;
    expect(Math.abs(preserved.data[edgeIdx] - 0)).toBeLessThan(0.05);
    // ...while a large rangeSigma (range weight ~1 everywhere) should pull it markedly towards the mean,
    // behaving like a plain Gaussian blur.
    expect(smoothed.data[edgeIdx]).toBeGreaterThan(0.2);
  });
});

describe('gaussianBlur / unsharpMask', () => {
  it('gaussianBlur leaves a flat field unchanged (edge case: nothing to blur)', () => {
    const p = makePlane(6, 6, 3);
    const out = gaussianBlur(p, 1.2);
    for (const v of out.data) expect(v).toBeCloseTo(3, 6);
  });

  it('unsharpMask with amount=0 is the identity', () => {
    const p = makePlane(5, 5);
    for (let i = 0; i < p.data.length; i++) p.data[i] = Math.sin(i);
    const out = unsharpMask(p, { sigma: 1, amount: 0 });
    for (let i = 0; i < p.data.length; i++) expect(out.data[i]).toBeCloseTo(p.data[i], 9);
  });

  it('unsharpMask increases contrast at a step edge (overshoot on both sides)', () => {
    const width = 12;
    const height = 3;
    const step = makePlane(width, height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) step.data[y * width + x] = x < 6 ? 0.2 : 0.8;
    const out = unsharpMask(step, { sigma: 1.5, amount: 1.5 });
    const row = 1;
    // Just left of the edge, unsharp masking should undershoot below the flat 0.2; just right, overshoot above 0.8.
    expect(out.data[row * width + 5]).toBeLessThan(0.2);
    expect(out.data[row * width + 6]).toBeGreaterThan(0.8);
    // Far from the edge, the flat regions are undisturbed (blur == value there).
    expect(out.data[row * width + 0]).toBeCloseTo(0.2, 6);
    expect(out.data[row * width + 11]).toBeCloseTo(0.8, 6);
  });
});

describe('the assembled pipeline', () => {
  it('a flat gray raw field survives black level, demosaic, an identity color matrix and a tone curve unchanged in hue', () => {
    const width = 10;
    const height = 10;
    const blackLevel = 512;
    const grayDn = 8000;
    const raw = makePlane(width, height, grayDn);
    const afterBlack = blackLevelSubtract(raw, blackLevel);
    const demosaiced = demosaicMalvarHeCutler(afterBlack, 'RGGB');
    const wb = applyWhiteBalance(demosaiced, [1, 1, 1]); // trivial gains: this test isolates the OTHER stages
    const normalized = applyToneCurve(wb, (v) => v / 16383); // normalize a 14-bit range to ~[0,1] first
    const identity: [number, number, number, number, number, number, number, number, number] = [
      1, 0, 0, 0, 1, 0, 0, 0, 1,
    ];
    const matrixed = applyColorMatrix(normalized, identity);
    const toned = applyToneCurve(matrixed, srgbToneCurve);
    const img = encodeRGB8(toned);
    const first = img.data[0];
    for (let i = 0; i < img.data.length; i += 3) {
      expect(img.data[i]).toBe(first); // R
      expect(img.data[i + 1]).toBe(first); // G
      expect(img.data[i + 2]).toBe(first); // B
    }
  });

  it('white balance neutralizes the illuminant: a real (non-flat) sensor response to a neutral patch becomes R=G=B', () => {
    // Build the RAW (non-equal) camera response of FIXTURE_SENSOR's QE to a spectrally flat reflectance
    // under D65 — genuinely different per channel, unlike the trivial flat-raw test above.
    const d65 = tableSpectrum(D65_SPD);
    const [r, g, b] = spectrumToCameraRGB(d65, BINS_10NM, FIXTURE_SENSOR.qe);
    expect(r).not.toBeCloseTo(g, 3); // sanity: the raw response is NOT already neutral
    const raw: RgbPlanes = { R: makePlane(1, 1, r), G: makePlane(1, 1, g), B: makePlane(1, 1, b) };
    const gains = whiteBalanceGains(d65, BINS_10NM, FIXTURE_SENSOR.qe);
    const wb = applyWhiteBalance(raw, gains);
    expect(wb.R.data[0]).toBeCloseTo(wb.G.data[0], 6);
    expect(wb.B.data[0]).toBeCloseTo(wb.G.data[0], 6);
  });
});
