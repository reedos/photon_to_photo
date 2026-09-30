// A per-pixel sensor model: photons in, a raw digital number and a PixelState (src/engine/types.ts) out,
// plus the analytic mean/variance/SNR and dynamic-range figures the loupe (BRIEF.md set piece 6/9) and the
// sensor level's spec cards read directly, without drawing a sample.
//
// Overall shape (photon -> electron -> DN) follows the standard CMOS/CCD noise-simulation pipeline
// described in Konnik, M. & Welsh, J., "High-level numerical simulations of noise in CCD and CMOS
// photosensors: review and tutorial," arXiv:1412.4031 (2014), and the SNR/dynamic-range formulas follow
// Janesick, J. R., "Photon Transfer," SPIE Press (2007) — both cited at each formula below. `SensorSpec` is
// this module's own local type (types.ts is the lead's; data/sensors.json will supply real SensorSpec
// values after the merge — see ENGINE.md and BRIEF.md's data-injection note).

import type { CfaColor, PixelState, Rng } from './types';

// ---- sensor description (local type; data/sensors.json fills this in after the merge) --------------------

/** Read noise in each dual-conversion-gain mode, e- rms, referred to the sensor node before analog gain. */
export interface ReadNoiseSpec {
  /** Low-conversion-gain mode: used below `dcgSwitchIso`. Larger charge-handling range, more read noise. */
  lcgE: number;
  /** High-conversion-gain mode: used at/above `dcgSwitchIso`. Smaller full well in that mode, less read noise. */
  hcgE: number;
}

export interface SensorSpec {
  pitchUm: number; // pixel pitch, micrometers
  fillFactor: number; // 0..1, fraction of the pixel area (post-microlens) that collects light
  /** Quantum efficiency by channel and wavelength, 0..1 (electrons generated per incident photon). */
  qe: Record<CfaColor, (nm: number) => number>;
  /** Full well capacity in LCG mode (below `dcgSwitchIso`), electrons. Also the fallback HCG-mode full well
   * when `fullWellHcgE` is not given (see that field). */
  fullWellE: number;
  /**
   * Full well capacity in HCG mode (at/above `dcgSwitchIso`), electrons. Optional — omit it for a sensor
   * whose two DCG modes are not distinguished (or before real per-mode data is available), in which case
   * `fullWellE` is used for both modes. When given, it should be SMALLER than `fullWellE`: dual conversion
   * gain switches to a smaller floating-diffusion sense-node capacitance in HCG mode (raising the
   * charge-to-voltage conversion gain, mV/e-, which is what lowers `readNoise.hcgE`), and full well in
   * electrons is that capacitance's charge capacity divided by e (Q = C*V), so the same physical switch that
   * lowers read noise necessarily also lowers full well — the same DCG tradeoff `ReadNoiseSpec.hcgE`'s own
   * doc comment names (see e.g. sensor architecture write-ups for cameras marketed with dual-gain/DCG
   * pixels). See `fullWellAtIso` and docs/engine/e3.md, "sensor.ts" section.
   */
  fullWellHcgE?: number;
  darkCurrentEPerS: number; // dark current rate at the sensor's reference temperature, e-/s/pixel
  readNoise: ReadNoiseSpec;
  dcgSwitchIso: number; // ISO at/above which the sensor switches from LCG to HCG mode
  /**
   * "Unity gain" ISO: the ISO setting at which the analog gain stage maps 1 electron to 1 DN, the usual
   * anchor for stating a sensor's ISO-to-gain relationship (e.g. Martinec, E., "Noise, Dynamic Range and
   * Bit Depth in Digital SLRs," theory.uchicago.edu, sensor characterization write-ups following the same
   * convention). `analogGain` below models gain as scaling linearly with ISO from this point, an
   * idealization real cameras only approximate (discrete gain steps, extended ISOs using digital rather
   * than analog gain) — see docs/engine/e3.md, "Known limits."
   */
  unityGainIso: number;
  bitDepth: number; // ADC output bits
  blackLevelDn: number; // black level offset added before quantization, DN
  /** Photoresponse non-uniformity: per-pixel multiplicative gain variation, fractional std. dev. (e.g. 0.01 = 1%). */
  prnuStdDev: number;
  baseIso: number; // the sensor's minimum (native) ISO
}

// ---- expected electrons from incident photons -------------------------------------------------------------

/**
 * Expected electrons collected in a pixel's well, before any noise: fill factor times the QE-weighted sum
 * of photons arriving in each wavelength bin. `photonsByBin` are MEAN photon counts (e.g. from
 * scene.ts/E2's radiometry), not already-sampled draws — the Poisson draw happens once, in `samplePixel`,
 * against this combined mean (see that function's doc comment for why one draw is enough).
 */
export function expectedElectrons(
  sensor: SensorSpec,
  photonsByBin: readonly number[],
  binCentersNm: readonly number[],
  channel: CfaColor,
): number {
  if (photonsByBin.length !== binCentersNm.length) {
    throw new Error('expectedElectrons: photonsByBin and binCentersNm must have the same length');
  }
  const qe = sensor.qe[channel];
  let sum = 0;
  for (let i = 0; i < photonsByBin.length; i++) {
    sum += photonsByBin[i] * qe(binCentersNm[i]);
  }
  return sensor.fillFactor * sum;
}

// ---- readout: noise, gain, black level, quantization -------------------------------------------------------

/** Read noise (e- rms) at the given ISO: HCG mode at/above `dcgSwitchIso`, LCG mode below it. */
export function readNoiseE(sensor: SensorSpec, iso: number): number {
  return iso >= sensor.dcgSwitchIso ? sensor.readNoise.hcgE : sensor.readNoise.lcgE;
}

/**
 * Full well capacity (electrons) at the given ISO: `fullWellHcgE` at/above `dcgSwitchIso` if the sensor
 * specifies one, else `fullWellE` in both modes (same LCG-below/HCG-at-or-above split as `readNoiseE`; see
 * `SensorSpec.fullWellHcgE` for why the two modes can legitimately differ).
 */
export function fullWellAtIso(sensor: SensorSpec, iso: number): number {
  if (iso >= sensor.dcgSwitchIso && sensor.fullWellHcgE !== undefined) {
    return sensor.fullWellHcgE;
  }
  return sensor.fullWellE;
}

/**
 * Analog gain, DN per electron, from the unity-gain ISO model: gain = iso / unityGainIso (so gain = 1 DN/e-
 * exactly at `sensor.unityGainIso`). See `SensorSpec.unityGainIso` for the citation and the idealization
 * this makes.
 */
export function analogGain(sensor: SensorSpec, iso: number): number {
  return iso / sensor.unityGainIso;
}

/** The ADC's maximum code, 2^bitDepth - 1. */
export function maxDn(sensor: SensorSpec): number {
  return Math.pow(2, sensor.bitDepth) - 1;
}

/**
 * Deterministic readout of an ALREADY-DETERMINED electron count (no shot/dark/PRNU sampling — see
 * `samplePixel` for that): read noise -> analog gain -> black level -> ADC quantization and clipping.
 * Exposed separately from `samplePixel` so the ISO-invariance test can compare two ISOs' MEAN readout
 * without the sampling noise obscuring the comparison, and so a caller building a scanline doesn't have to
 * re-derive this arithmetic. `readNoiseSample` defaults to 0 (report the noise-free DN); pass
 * `rng.normal() * readNoiseE(sensor, iso)` to include a sampled draw.
 */
export function readout(sensor: SensorSpec, electrons: number, iso: number, readNoiseSample = 0): number {
  const gain = analogGain(sensor, iso);
  const dnAnalog = (electrons + readNoiseSample) * gain + sensor.blackLevelDn;
  return Math.min(maxDn(sensor), Math.max(0, Math.round(dnAnalog)));
}

// ---- full stochastic pixel sample --------------------------------------------------------------------------

export interface SamplePixelParams {
  x: number;
  y: number;
  cfa: CfaColor;
  /** Mean photon count per wavelength bin arriving at the pixel's area during the exposure. */
  photonsByBin: readonly number[];
  binCentersNm: readonly number[];
  exposureS: number;
  iso: number;
}

/**
 * Draws one pixel's full stochastic journey and returns a `PixelState` (src/engine/types.ts): the same
 * structure the loupe set piece (BRIEF.md #9) reads to show a single well filling. Order of operations,
 * each cited where the model choice is non-obvious:
 *
 * 1. `electronsMean` = fillFactor * sum(photons_i * QE(bin_i))  [expectedElectrons]
 * 2. `photoE` = Poisson(electronsMean) — ONE draw, not one draw per wavelength bin. This is valid because
 *    thinning a Poisson process (each of `electronsMean`'s underlying photons converts independently with
 *    probability QE) leaves it Poisson with the thinned mean: the classic Poisson thinning property (see
 *    e.g. Ross, S. M., "Introduction to Probability Models," 12th ed., Academic Press, 2019, §5.3.3, "The
 *    Poisson Process," or Devroye, L., "Non-Uniform Random Variate Generation," Springer (1986), ch. X.2).
 *    A per-bin draw-then-sum would give the identical distribution at higher cost.
 * 3. `photoWithPrnuE` = photoE * (1 + N(0, prnuStdDev)) — PRNU multiplies the PHOTO-generated signal only
 *    (Janesick 2007, ch. 4: PRNU is a photoresponse effect). Dark current has its own non-uniformity
 *    (DSNU), not modeled here — see docs/engine/e3.md, "Known limits."
 * 4. `darkE` = Poisson(darkCurrentEPerS * exposureS), independent of the photo-electrons (a separate
 *    thermal-generation process).
 * 5. `totalE` = photoWithPrnuE + darkE, clipped at `fullWellAtIso(sensor, iso)` (HCG's own, smaller full
 *    well at/above `dcgSwitchIso`, when `fullWellHcgE` is given); `saturated` = totalE > that full well
 *    before clipping.
 * 6. Read noise, analog gain, black level and ADC quantization via `readout`.
 */
export function samplePixel(sensor: SensorSpec, rng: Rng, p: SamplePixelParams): PixelState {
  const electronsMean = expectedElectrons(sensor, p.photonsByBin, p.binCentersNm, p.cfa);
  const photonsMean = p.photonsByBin.reduce((s, v) => s + v, 0);

  const photoE = rng.poisson(electronsMean);
  const prnuFactor = Math.max(0, 1 + rng.normal() * sensor.prnuStdDev);
  const photoWithPrnuE = photoE * prnuFactor;

  const darkMeanE = sensor.darkCurrentEPerS * p.exposureS;
  const darkE = rng.poisson(darkMeanE);

  const fullWell = fullWellAtIso(sensor, p.iso);
  const totalE = photoWithPrnuE + darkE;
  const saturated = totalE > fullWell;
  const electrons = Math.min(totalE, fullWell);

  const rn = readNoiseE(sensor, p.iso);
  const dn = readout(sensor, electrons, p.iso, rng.normal() * rn);

  return {
    x: p.x,
    y: p.y,
    cfa: p.cfa,
    photonsMean,
    photonsByBin: p.photonsByBin.slice(),
    electronsMean,
    electrons,
    fullWell,
    readNoise: rn,
    dn,
    saturated,
  };
}

// ---- analytic mean / variance / SNR / dynamic range ---------------------------------------------------------

/**
 * Total noise variance in electrons^2 at a given mean signal, combining shot noise, PRNU, dark shot noise
 * and read noise — the same four terms `samplePixel` draws, derived analytically (Janesick 2007, ch. 5,
 * "Signal-to-Noise Ratio"; PRNU term derived below since Janesick states the small-PRNU approximation
 * directly):
 *
 *   Var = signalE*(1 + prnuStdDev^2) + signalE^2*prnuStdDev^2 + darkMeanE + readNoiseE^2
 *
 * Derivation of the first two terms: let X ~ Poisson(signalE) be the photo-electron count and
 * P ~ (1 + N(0, prnuStdDev^2)) the independent PRNU factor, Y = X*P. E[Y] = signalE (E[P]=1).
 * E[Y^2] = E[X^2]E[P^2] = (signalE + signalE^2)(1 + prnuStdDev^2), so
 * Var[Y] = E[Y^2] - signalE^2 = signalE*(1+prnuStdDev^2) + signalE^2*prnuStdDev^2. For prnuStdDev << 1 this
 * reduces to the familiar signalE + (prnuStdDev*signalE)^2 approximation; the exact form is used here.
 */
export function varianceE(sensor: SensorSpec, signalE: number, exposureS: number, iso: number): number {
  const p = sensor.prnuStdDev;
  const darkMeanE = sensor.darkCurrentEPerS * exposureS;
  const rn = readNoiseE(sensor, iso);
  return signalE * (1 + p * p) + signalE * signalE * p * p + darkMeanE + rn * rn;
}

/** Signal-to-noise ratio at a given mean signal: signalE / sqrt(varianceE(...)). See `varianceE` for the terms. */
export function snr(sensor: SensorSpec, signalE: number, exposureS: number, iso: number): number {
  if (signalE <= 0) return 0;
  return signalE / Math.sqrt(varianceE(sensor, signalE, exposureS, iso));
}

/**
 * Engineering dynamic range, in stops: log2(full well / read noise), the ratio of the largest signal the
 * well can hold to the smallest the read noise floor can distinguish from zero (SNR=1 low endpoint) — the
 * definition used e.g. at photonstophotos.net's "Engineering and Photographic Dynamic Range" primer
 * (Sensor_Analysis_Primer/Engineering_and_Photographic_Dynamic_Range.htm, retrieved 2026-09-28).
 */
export function engineeringDR(sensor: SensorSpec, iso: number): number {
  return Math.log2(fullWellAtIso(sensor, iso) / readNoiseE(sensor, iso));
}

/**
 * Photographic Dynamic Range (PDR), Bill Claff's definition as documented at photonstophotos.net (see
 * `engineeringDR`'s citation): the low endpoint is not SNR=1 but a photographically-relevant SNR threshold
 * evaluated after averaging over a patch the size of the circle of confusion, which is what "adjusted for
 * the appropriate Circle Of Confusion" means in that source — averaging N pixels' worth of independent
 * shot/read noise over a COC-sized patch improves SNR by sqrt(N) (the standard noise-averaging result), so
 * the per-pixel SNR needed to hit a COC-averaged threshold of `snrThreshold` (Claff's site uses a
 * resolution-scaled value; a flat 20 is used here as the commonly-cited round figure for print-scale
 * viewing — see docs/engine/e3.md for the caveat) is `snrThreshold / sqrt(N)`.
 *
 * Finds the signal level at which snr(...) first reaches that per-pixel threshold, by bisection (snr is
 * monotonic increasing in signalE), and returns log2(fullWellAtIso(sensor, iso) / thatSignal).
 */
export function photographicDR(
  sensor: SensorSpec,
  exposureS: number,
  iso: number,
  cocMm: number,
  snrThreshold = 20,
): number {
  const pitchMm = sensor.pitchUm / 1000;
  const cocPixels = Math.max(1, cocMm / pitchMm);
  const nPixelsInCoc = cocPixels * cocPixels; // area averaging over a COC-sized patch
  const perPixelThreshold = snrThreshold / Math.sqrt(nPixelsInCoc);
  const fullWell = fullWellAtIso(sensor, iso);

  let lo = 0;
  let hi = fullWell;
  // snr(lo=0) = 0 < threshold by construction (signalE<=0 returns 0); snr(hi=fullWell) should exceed the
  // threshold for any sensible sensor. 60 bisection steps is far more precision than this figure needs.
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (snr(sensor, mid, exposureS, iso) < perPixelThreshold) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  const thresholdSignalE = (lo + hi) / 2;
  return Math.log2(fullWell / thresholdSignalE);
}
