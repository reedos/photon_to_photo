// The image pipeline: black level, demosaic, white balance, color matrix, tone curve, encode, plus a
// simple noise-reduction and sharpening stage. Every stage is a separate, composable function over
// `Plane`s (Float32Array-backed, this module's own local type — set piece 8 in BRIEF.md, "From mosaic to
// photo," scrubs back and forth through exactly these stages) so a caller (the render pipeline, or a UI
// scrubber) can run, skip or reorder them and inspect the intermediate planes directly.

import { mat3Vec3, srgbEncode, type Mat3 } from './color';
import type { CfaColor, Vec3 } from './types';

// ---- planes -------------------------------------------------------------------------------------------

/** A single-channel image buffer, row-major, `data[y * width + x]`. */
export interface Plane {
  width: number;
  height: number;
  data: Float32Array;
}

export function makePlane(width: number, height: number, fill = 0): Plane {
  const data = new Float32Array(width * height);
  if (fill !== 0) data.fill(fill);
  return { width, height, data };
}

export interface RgbPlanes {
  R: Plane;
  G: Plane;
  B: Plane;
}

function mapPlane(p: Plane, f: (v: number) => number): Plane {
  const out = makePlane(p.width, p.height);
  for (let i = 0; i < p.data.length; i++) out.data[i] = f(p.data[i]);
  return out;
}

// ---- Bayer geometry -------------------------------------------------------------------------------------

export type BayerPattern = 'RGGB' | 'BGGR' | 'GRBG' | 'GBRG';

/** The CFA color a Bayer sensor's mosaic reads at (x, y) under the given 2x2-repeating pattern. */
export function cfaColorAt(pattern: BayerPattern, x: number, y: number): CfaColor {
  const evenRow = y % 2 === 0;
  const evenCol = x % 2 === 0;
  const topLeft = pattern[0] as CfaColor; // (0,0); pattern strings are e.g. "RGGB" = TL,TR / BL,BR
  const topRight = pattern[1] as CfaColor;
  const bottomLeft = pattern[2] as CfaColor;
  const bottomRight = pattern[3] as CfaColor;
  if (evenRow) return evenCol ? topLeft : topRight;
  return evenCol ? bottomLeft : bottomRight;
}

// ---- stage: black level subtraction ----------------------------------------------------------------------

/** Subtracts the sensor's black level from a raw mosaic plane. Not clamped: read noise can (and should be
 * allowed to) push a value below zero here — clamping happens once, at `encodeRGB8`. */
export function blackLevelSubtract(raw: Plane, blackLevelDn: number): Plane {
  return mapPlane(raw, (v) => v - blackLevelDn);
}

// ---- stage: demosaic ------------------------------------------------------------------------------------

const NEIGHBOR_OFFSETS: Array<[number, number]> = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
];

/**
 * Bilinear demosaic: each missing channel at a pixel is the average of that channel's same-colored
 * neighbors within the surrounding 3x3 window (Gunturk, B. K. et al., "Demosaicking: Color Filter Array
 * Interpolation," IEEE Signal Processing Magazine 22(1), 2005, §II, "Bilinear Interpolation"). Bayer
 * geometry makes this reduce, at every site, to exactly the standard bilinear coefficients — a 4-tap cross
 * average for green at a red/blue site, a 4-tap diagonal average for blue-at-red/red-at-blue, and a 2-tap
 * average (horizontal or vertical, whichever the geometry puts the same-colored neighbors on) for
 * red/blue at a green site — without hand-coding each of the four `BayerPattern` variants separately: the
 * neighbor colors are read from `cfaColorAt`, so this one loop is correct for all of them. At the image
 * border, fewer neighbors are available and the average is over whatever is in bounds.
 */
export function demosaicBilinear(raw: Plane, pattern: BayerPattern): RgbPlanes {
  const { width, height } = raw;
  const out: RgbPlanes = { R: makePlane(width, height), G: makePlane(width, height), B: makePlane(width, height) };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const native = cfaColorAt(pattern, x, y);
      out[native].data[idx] = raw.data[idx];
      for (const ch of ['R', 'G', 'B'] as CfaColor[]) {
        if (ch === native) continue;
        let sum = 0;
        let count = 0;
        for (const [dx, dy] of NEIGHBOR_OFFSETS) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          if (cfaColorAt(pattern, nx, ny) === ch) {
            sum += raw.data[ny * width + nx];
            count++;
          }
        }
        out[ch].data[idx] = count > 0 ? sum / count : 0;
      }
    }
  }
  return out;
}

// Malvar-He-Cutler (2004) 5x5 kernels, coefficients in eighths (each kernel's taps sum to 8; divide by 8
// below). Reproduced from Malvar, H. S., He, L.-W. & Cutler, R., "High-Quality Linear Interpolation for
// Demosaicing of Bayer-Patterned Color Images," Proc. IEEE ICASSP 2004 — via the numeric kernel tables in
// colour-demosaicing (github.com/colour-science/colour-demosaicing, BSD-3-Clause,
// colour_demosaicing/bayer/demosaicing/malvar2004.py), retrieved 2026-09-28, which is the standard open-
// source reference implementation of this exact algorithm. Indexed [row][col], row/col -2..2 (5 entries).
// prettier-ignore
const MHC_CROSS: number[][] = [ // "GR_GB": green at a red or blue site
  [0, 0, -1, 0, 0],
  [0, 0, 2, 0, 0],
  [-1, 2, 4, 2, -1],
  [0, 0, 2, 0, 0],
  [0, 0, -1, 0, 0],
];
// prettier-ignore
const MHC_H: number[][] = [ // "Rg_RB_Bg_BR": the chroma channel whose same-color neighbors are E/W
  [0, 0, 0.5, 0, 0],
  [0, -1, 0, -1, 0],
  [-1, 4, 5, 4, -1],
  [0, -1, 0, -1, 0],
  [0, 0, 0.5, 0, 0],
];
// MHC_V ("Rg_BR_Bg_RB") is MHC_H transposed: the chroma channel whose same-color neighbors are N/S.
const MHC_V: number[][] = MHC_H[0].map((_, col) => MHC_H.map((row) => row[col]));
// prettier-ignore
const MHC_DIAG: number[][] = [ // "Rb_BB_Br_RR": red at a blue site, or blue at a red site (diagonal neighbors)
  [0, 0, -1.5, 0, 0],
  [0, 2, 0, 2, 0],
  [-1.5, 0, 6, 0, -1.5],
  [0, 2, 0, 2, 0],
  [0, 0, -1.5, 0, 0],
];

function applyMhcKernel(raw: Plane, x: number, y: number, kernel: number[][]): number {
  const { width, data } = raw;
  let sum = 0;
  for (let ky = -2; ky <= 2; ky++) {
    const row = kernel[ky + 2];
    const rowOffset = (y + ky) * width;
    for (let kx = -2; kx <= 2; kx++) {
      const w = row[kx + 2];
      if (w !== 0) sum += w * data[rowOffset + x + kx];
    }
  }
  return sum / 8;
}

/**
 * Malvar-He-Cutler (2004) demosaic: a 5x5 gradient-corrected linear filter per case (green at red/blue,
 * the two orientations of red/blue at green, and red-at-blue/blue-at-red), applied directly to the raw
 * mosaic (see the kernel citations above). Every kernel here is spatially symmetric (unchanged under
 * kx -> -kx and ky -> -ky) and its taps sum to 8, so — dividing by 8 — it reproduces any locally linear
 * function of (x, y) exactly: the center value's own linear terms survive the symmetric averaging exactly,
 * with no residual (this is what pipeline.test.ts's ramp test checks). Needs a 2-pixel margin, so pixels
 * within 2 of the border fall back to `demosaicBilinear`'s result (also ramp-exact, by the same symmetric-
 * kernel argument, just with smaller kernels — see that test for both).
 */
export function demosaicMalvarHeCutler(raw: Plane, pattern: BayerPattern): RgbPlanes {
  const { width, height } = raw;
  const bilinear = demosaicBilinear(raw, pattern);
  const out: RgbPlanes = {
    R: makePlane(width, height),
    G: makePlane(width, height),
    B: makePlane(width, height),
  };
  out.R.data.set(bilinear.R.data);
  out.G.data.set(bilinear.G.data);
  out.B.data.set(bilinear.B.data);

  for (let y = 2; y < height - 2; y++) {
    for (let x = 2; x < width - 2; x++) {
      const idx = y * width + x;
      const native = cfaColorAt(pattern, x, y);
      if (native === 'G') {
        const westIsR = cfaColorAt(pattern, x - 1, y) === 'R';
        out.R.data[idx] = applyMhcKernel(raw, x, y, westIsR ? MHC_H : MHC_V);
        out.B.data[idx] = applyMhcKernel(raw, x, y, westIsR ? MHC_V : MHC_H);
        out.G.data[idx] = raw.data[idx];
      } else {
        const other = native === 'R' ? 'B' : 'R';
        out[native].data[idx] = raw.data[idx];
        out.G.data[idx] = applyMhcKernel(raw, x, y, MHC_CROSS);
        out[other].data[idx] = applyMhcKernel(raw, x, y, MHC_DIAG);
      }
    }
  }
  return out;
}

// ---- stage: white balance -------------------------------------------------------------------------------

/** Multiplies each channel plane by its gain (see color.ts's `whiteBalanceGains` for how gains are derived). */
export function applyWhiteBalance(planes: RgbPlanes, gains: Vec3): RgbPlanes {
  return {
    R: mapPlane(planes.R, (v) => v * gains[0]),
    G: mapPlane(planes.G, (v) => v * gains[1]),
    B: mapPlane(planes.B, (v) => v * gains[2]),
  };
}

// ---- stage: highlight clip (neutralize blown highlights before the color matrix mixes them) ----------------

/**
 * The standard raw-converter "highlight recovery: clip" technique (Coffin, D., dcraw.c, highlight mode 0,
 * "Clip (default)" -- the default highlight mode of the most widely used open-source raw converter; see also
 * Adobe DNG Specification 1.7.1.0 (2023), §6.2.2, "Clipping," which documents the same common-ceiling
 * approach for its own default rendering). Placed here, between `applyWhiteBalance` and `applyColorMatrix`.
 *
 * The bug this fixes: a genuinely blown highlight has every channel at (or interpolated from neighbors at)
 * the sensor's own raw saturation level -- call that 1.0 in this pipeline's normalized [0, 1] units, the
 * same for every channel, since it is a property of the SENSOR, not of white balance. White balance then
 * multiplies each channel by its own gain (`gains`), so the SAME physical saturation level maps to a
 * DIFFERENT numeric ceiling per channel: `gains[c]` for channel c. If each channel is left to clip
 * independently at its own (different) ceiling -- which is what happens if clipping is deferred to
 * `encodeRGB8`'s `Uint8ClampedArray`, AFTER `applyColorMatrix` has already linearly mixed the three
 * unclamped, unequal values -- the matrix can rotate what would have been a neutral (equal-channel) triple
 * into a non-neutral one before anything ever clips it, and the eventual independent clamp cannot undo that:
 * the result renders as a color cast (typically pink/magenta, since red and blue commonly carry the larger
 * white-balance gains under a warm-ish daylight illuminant) instead of neutral white.
 *
 * The fix: clip every channel to the SAME ceiling, `min(gains)` -- the post-white-balance saturation level
 * of the LEAST-gained channel (the channel that needed the smallest boost, so its own raw saturation maps to
 * the lowest post-WB value of the three). Any pixel that was genuinely sensor-saturated in every channel
 * (all three at 1.0 pre-WB) becomes, after this common clip, EXACTLY equal in all three channels --
 * unambiguously neutral -- before `applyColorMatrix` ever sees it, so the matrix (which maps a neutral input
 * to a neutral output, by construction of how `fitColorMatrix` in render.ts anchors its fit at the
 * reflectance-1 white point) cannot introduce a color cast into it. `whiteBalanceGains` (color.ts) always
 * normalizes G to a gain of exactly 1, so `min(gains)` is G's own ceiling in every case this engine's data
 * produces, but the minimum is taken generically (not hardcoded to the G channel) so this stays correct if
 * that normalization convention ever changes.
 */
export function clipHighlightsToNeutral(planes: RgbPlanes, gains: Vec3): RgbPlanes {
  const ceiling = Math.min(gains[0], gains[1], gains[2]);
  return {
    R: mapPlane(planes.R, (v) => Math.min(v, ceiling)),
    G: mapPlane(planes.G, (v) => Math.min(v, ceiling)),
    B: mapPlane(planes.B, (v) => Math.min(v, ceiling)),
  };
}

// ---- stage: color matrix ---------------------------------------------------------------------------------

/** Applies a 3x3 matrix (e.g. color.ts's `fitCameraToXYZ` composed with `XYZ_TO_LINEAR_SRGB`) per pixel. */
export function applyColorMatrix(planes: RgbPlanes, m: Mat3): RgbPlanes {
  const { width, height } = planes.R;
  const out: RgbPlanes = { R: makePlane(width, height), G: makePlane(width, height), B: makePlane(width, height) };
  for (let i = 0; i < width * height; i++) {
    const [r, g, b] = mat3Vec3(m, [planes.R.data[i], planes.G.data[i], planes.B.data[i]]);
    out.R.data[i] = r;
    out.G.data[i] = g;
    out.B.data[i] = b;
  }
  return out;
}

// ---- stage: tone curve -----------------------------------------------------------------------------------

/** The sRGB OETF (IEC 61966-2-1), re-exported from color.ts as a tone curve for pipeline composition. */
export const srgbToneCurve = srgbEncode;

/**
 * A filmic tone curve: Narkowicz, K., "ACES Filmic Tone Mapping Curve," 2016 (widely reproduced fitted
 * approximation to the ACES reference rendering + output transform for display on an sRGB-like target;
 * used as a drop-in filmic curve in many real-time renderers). Unlike the sRGB OETF, this compresses
 * highlights with a shoulder rather than clipping them abruptly, at the cost of not being a standard.
 */
export function acesFilmicToneCurve(x: number): number {
  const a = 2.51;
  const b = 0.03;
  const c = 2.43;
  const d = 0.59;
  const e = 0.14;
  const v = (x * (a * x + b)) / (x * (c * x + d) + e);
  return Math.min(1, Math.max(0, v));
}

export function applyToneCurve(planes: RgbPlanes, curve: (x: number) => number): RgbPlanes {
  return { R: mapPlane(planes.R, curve), G: mapPlane(planes.G, curve), B: mapPlane(planes.B, curve) };
}

// ---- stage: encode ---------------------------------------------------------------------------------------

export interface EncodedImage {
  width: number;
  height: number;
  /** Interleaved RGB, 8 bits/channel. */
  data: Uint8ClampedArray;
}

/** Packs three [0, 1] planes into interleaved 8-bit RGB. Uint8ClampedArray clamps to [0, 255] and rounds on write. */
export function encodeRGB8(planes: RgbPlanes): EncodedImage {
  const { width, height } = planes.R;
  const data = new Uint8ClampedArray(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    data[i * 3 + 0] = planes.R.data[i] * 255;
    data[i * 3 + 1] = planes.G.data[i] * 255;
    data[i * 3 + 2] = planes.B.data[i] * 255;
  }
  return { width, height, data };
}

// ---- noise reduction: bilateral filter --------------------------------------------------------------------

export interface BilateralParams {
  spatialSigma: number;
  rangeSigma: number;
  /** Window half-width in pixels; defaults to round(2 * spatialSigma). */
  radius?: number;
}

/**
 * Edge-preserving smoothing: each output pixel is a weighted average of its spatial neighborhood, weighted
 * by both distance (a Gaussian in space) and similarity (a Gaussian in value) — Tomasi, C. & Manduchi, R.,
 * "Bilateral Filtering for Gray and Color Images," Proc. IEEE ICCV, 1998. Applied per plane (not jointly
 * across R/G/B), so chroma noise in one channel does not pull the weighting of another.
 */
export function bilateralFilter(plane: Plane, params: BilateralParams): Plane {
  const radius = params.radius ?? Math.max(1, Math.round(params.spatialSigma * 2));
  const { width, height, data } = plane;
  const out = makePlane(width, height);
  const twoSigmaSpatialSq = 2 * params.spatialSigma * params.spatialSigma;
  const twoSigmaRangeSq = 2 * params.rangeSigma * params.rangeSigma;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const center = data[y * width + x];
      let wSum = 0;
      let vSum = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const v = data[ny * width + nx];
          const spatialW = Math.exp(-(dx * dx + dy * dy) / twoSigmaSpatialSq);
          const rangeW = twoSigmaRangeSq > 0 ? Math.exp(-((v - center) ** 2) / twoSigmaRangeSq) : 1;
          const w = spatialW * rangeW;
          wSum += w;
          vSum += w * v;
        }
      }
      out.data[y * width + x] = wSum > 0 ? vSum / wSum : center;
    }
  }
  return out;
}

// ---- sharpening: unsharp mask -----------------------------------------------------------------------------

/** Separable Gaussian blur, edge-replicated border. A helper for `unsharpMask`, exported for reuse/testing. */
export function gaussianBlur(plane: Plane, sigma: number): Plane {
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel = new Array<number>(2 * radius + 1);
  let kSum = 0;
  for (let i = -radius; i <= radius; i++) {
    const w = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel[i + radius] = w;
    kSum += w;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= kSum;

  const { width, height, data } = plane;
  const clampX = (x: number) => Math.min(width - 1, Math.max(0, x));
  const clampY = (y: number) => Math.min(height - 1, Math.max(0, y));

  const tmp = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let s = 0;
      for (let k = -radius; k <= radius; k++) s += kernel[k + radius] * data[y * width + clampX(x + k)];
      tmp[y * width + x] = s;
    }
  }
  const out = makePlane(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let s = 0;
      for (let k = -radius; k <= radius; k++) s += kernel[k + radius] * tmp[clampY(y + k) * width + x];
      out.data[y * width + x] = s;
    }
  }
  return out;
}

/**
 * Unsharp mask: output = input + amount * (input - blur(input, sigma)) — a darkroom technique from analog
 * photography, formalized for digital images e.g. in Polesel, A., Ramponi, G. & Mathews, V. J., "Image
 * Enhancement via Adaptive Unsharp Masking," IEEE Transactions on Image Processing 9(3), 2000. `amount=0`
 * is the identity; not clamped here (encodeRGB8 clamps at the end of the pipeline).
 */
export function unsharpMask(plane: Plane, params: { sigma: number; amount: number }): Plane {
  const blurred = gaussianBlur(plane, params.sigma);
  const out = makePlane(plane.width, plane.height);
  for (let i = 0; i < plane.data.length; i++) {
    out.data[i] = plane.data[i] + params.amount * (plane.data[i] - blurred.data[i]);
  }
  return out;
}
