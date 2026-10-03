import { airyIntensity, airyRadius, psfOnPixels } from '../app/engine-api';
import type { Model } from '../engine/model-types';

export const DIFFRACTION_GRID = 17;
export const DIFFRACTION_SIZE = 408;
/** Display lift only: the engine intensities and integrated fractions stay unchanged. */
export const diffractionDisplay = (relative: number) => Math.pow(Math.max(0, Math.min(1, relative)), .25);

export function diffractionPattern(model: Model, nm: number) {
  const pitchMm = model.sensor.pitchUm / 1000, workingFno = model.focus.workingFno;
  const radiusMm = airyRadius(nm, workingFno), spanMm = DIFFRACTION_GRID * pitchMm;
  const peak = airyIntensity(0, nm, workingFno);
  // Radial lookup evaluates the engine solution; interpolation is only rasterization.
  const maxR = spanMm / Math.SQRT2, bins = 4096;
  const radial = Float64Array.from({ length: bins + 1 }, (_, i) => airyIntensity(i / bins * maxR, nm, workingFno) / peak);
  const intensity = new Float32Array(DIFFRACTION_SIZE ** 2);
  for (let y = 0; y < DIFFRACTION_SIZE; y++) for (let x = 0; x < DIFFRACTION_SIZE; x++) {
    const r = Math.hypot(x + .5 - DIFFRACTION_SIZE / 2, y + .5 - DIFFRACTION_SIZE / 2) / DIFFRACTION_SIZE * spanMm;
    const at = r / maxR * bins, lo = Math.floor(at), fraction = at - lo;
    intensity[y * DIFFRACTION_SIZE + x] = radial[lo] * (1 - fraction) + radial[Math.min(bins, lo + 1)] * fraction;
  }
  const pixels = psfOnPixels(pitchMm, workingFno, [nm], [1], [0, 0], 1, (DIFFRACTION_GRID - 1) / 2);
  return { nm, workingFno, pitchMm, radiusMm, spanMm, intensity, pixels,
    radiusPx: radiusMm / pitchMm, radiusRaster: radiusMm / spanMm * DIFFRACTION_SIZE,
    centerFraction: pixels.cells.find(c => c.ix === 0 && c.iy === 0)!.fraction };
}
export type DiffractionPattern = ReturnType<typeof diffractionPattern>;
