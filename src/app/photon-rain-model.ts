import type { Model } from '../engine/model-types';
import { Pcg32 } from '../engine/rng';
import { BINS } from '../engine/data';
import { daylightAt, sceneDefaultCctK } from '../engine/scenes';
import { compute } from './engine-api';

export const RAIN_PIXELS = 256;
export const VISIBLE_RAIN_PIXELS = 8;
export const RAIN_DURATION = 6;
export interface RainArrival { at: number; nm: number; offset: number }
export interface RainExperiment {
  mean: number;
  exposureS: number;
  samples: number[][];
  visible: RainArrival[][];
  seed: number;
}

/** A separate uniform on-axis gray experiment, retaining the chosen aperture/shutter/sensor.
 * Lighting is deliberately set to six expected incident photons so sparse arrivals are visible. */
export function dimReference(source: Model): Model {
  const unit = compute({ ...source.scenario, lux: 1, motion: { speedMps: 0 } });
  return compute({ ...unit.scenario, lux: 6 / unit.exposure.photonsMidGray });
}

/** Full Poisson photon counts, followed by uniform arrival times conditional on each count:
 * a homogeneous Poisson process. No weighted dots and no electron/read-noise claims. */
export function rainExperiment(model: Model, seed = 37): RainExperiment {
  const mean = model.exposure.photonsMidGray;
  if (!Number.isFinite(mean) || mean < 0 || mean > 5000) throw new RangeError('Photon rain expects a controlled dim-reference exposure.');
  const rng = new Pcg32(seed), light = daylightAt(model.scenario.cct ?? sceneDefaultCctK(model.scenario.scene));
  // Gray reflectance and the engine's achromatic lens throughput cancel when normalizing
  // this spectrum. Photon numbers are proportional to spectral power × wavelength × bin width.
  const weights = BINS.centers.map((nm, i) => Math.max(0, light(nm)) * nm * BINS.weights[i]);
  const total = weights.reduce((sum, value) => sum + value, 0);
  const cdf = weights.map((_, i) => weights.slice(0, i + 1).reduce((sum, value) => sum + value, 0) / total);
  const samples: number[][] = [], visible: RainArrival[][] = [];
  for (let pixel = 0; pixel < RAIN_PIXELS; pixel++) {
    const count = rng.poisson(mean);
    const arrivals = Array.from({ length: count }, () => rng.next()).sort((a, b) => a - b);
    samples.push(arrivals);
    if (pixel < VISIBLE_RAIN_PIXELS) {
      // Independent stream means changing display properties never changes sampled photon counts.
      const colors = new Pcg32(seed, pixel + 10);
      visible.push(arrivals.map(at => {
        const u = colors.next(), bin = cdf.findIndex(value => value >= u);
        return { at, nm: BINS.centers[Math.max(0, bin)], offset: colors.next() - .5 };
      }));
    }
  }
  return { mean, exposureS: model.scenario.shutter, samples, visible, seed };
}

export function arrived(times: readonly number[], progress: number): number {
  if (progress <= 0) return 0;
  let lo = 0, hi = times.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (times[mid] <= progress) lo = mid + 1; else hi = mid; }
  return lo;
}

/** Stable Poisson PMF, starting at its mode rather than exp(-mean), which underflows in bright cases. */
export function poissonPmf(mean: number, max: number): number[] {
  const out = Array(max + 1).fill(0) as number[];
  if (mean === 0) { out[0] = 1; return out; }
  const mode = Math.min(max, Math.floor(mean));
  let logFactorial = 0;
  for (let k = 2; k <= mode; k++) logFactorial += Math.log(k);
  out[mode] = Math.exp(-mean + mode * Math.log(mean) - logFactorial);
  for (let k = mode; k > 0; k--) out[k - 1] = out[k] * k / mean;
  for (let k = mode; k < max; k++) out[k + 1] = out[k] * mean / (k + 1);
  return out;
}

export function rainSnapshot(experiment: RainExperiment, progress: number) {
  const p = Math.min(1, Math.max(0, progress)), mean = experiment.mean * p;
  const counts = experiment.samples.map(times => arrived(times, p));
  const max = Math.max(5, ...counts, Math.ceil(mean + 5 * Math.sqrt(mean)));
  const histogram = Array(max + 1).fill(0) as number[];
  counts.forEach(value => histogram[value]++);
  return { counts, histogram, expected: poissonPmf(mean, max), mean,
    observedMean: counts.reduce((sum, value) => sum + value, 0) / counts.length,
    sigma: Math.sqrt(mean), relativeNoise: mean > 0 ? 1 / Math.sqrt(mean) : null };
}
