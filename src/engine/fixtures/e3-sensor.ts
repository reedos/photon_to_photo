// An illustrative SensorSpec (src/engine/sensor.ts) for E3's tests: round numbers plausible for a modern
// full-frame CMOS sensor (tens of thousands of electrons of full well, sub-2 e- read noise in HCG mode, a
// visible drop in read noise at the DCG switch, ~1% PRNU), but NOT a specific vendor's measured spec — no
// datasheet or teardown was consulted for these numbers. Real, cited sensor specs belong in
// data/sensors.json, which the lead adds after the E1-E3 merge (ENGINE.md); this file exists only so
// sensor.test.ts has something concrete to run the pipeline against.

import type { SensorSpec } from '../sensor';

function gaussianQE(peakNm: number, sigmaNm: number, peakQE: number): (nm: number) => number {
  return (nm: number) => peakQE * Math.exp(-((nm - peakNm) ** 2) / (2 * sigmaNm * sigmaNm));
}

/** A representative Bayer-CFA full-frame sensor. Peak QE per channel roughly where R/G/B CFA dyes pass light. */
export const FIXTURE_SENSOR: SensorSpec = {
  pitchUm: 5.94,
  fillFactor: 0.9,
  qe: {
    R: gaussianQE(600, 55, 0.62),
    G: gaussianQE(535, 50, 0.68),
    B: gaussianQE(465, 45, 0.6),
  },
  fullWellE: 63000,
  darkCurrentEPerS: 0.05,
  readNoise: { lcgE: 2.8, hcgE: 1.0 },
  dcgSwitchIso: 800,
  unityGainIso: 640,
  bitDepth: 14,
  blackLevelDn: 512,
  prnuStdDev: 0.01,
  baseIso: 100,
};

/** Same as FIXTURE_SENSOR but with every noise source zeroed except photon shot noise, for golden SNR checks. */
export const SHOT_NOISE_ONLY_SENSOR: SensorSpec = {
  ...FIXTURE_SENSOR,
  darkCurrentEPerS: 0,
  readNoise: { lcgE: 0, hcgE: 0 },
  prnuStdDev: 0,
};
