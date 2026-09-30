import { describe, expect, it } from 'vitest';
import { makeRng } from './rng';
import {
  analogGain,
  engineeringDR,
  expectedElectrons,
  fullWellAtIso,
  maxDn,
  photographicDR,
  readNoiseE,
  readout,
  samplePixel,
  snr,
  varianceE,
  type SensorSpec,
} from './sensor';
import { FIXTURE_SENSOR, SHOT_NOISE_ONLY_SENSOR } from './fixtures/e3-sensor';

describe('expectedElectrons', () => {
  it('matches a hand-computed sum for a flat QE curve', () => {
    const sensor: SensorSpec = { ...FIXTURE_SENSOR, fillFactor: 0.8, qe: { R: () => 0.5, G: () => 0.5, B: () => 0.5 } };
    const photons = [100, 200, 300];
    const bins = [500, 550, 600];
    // Hand calculation: 0.8 * 0.5 * (100+200+300) = 240
    expect(expectedElectrons(sensor, photons, bins, 'R')).toBeCloseTo(240, 9);
  });

  it('uses the requested channel\'s QE, not another channel\'s', () => {
    const sensor: SensorSpec = { ...FIXTURE_SENSOR, fillFactor: 1, qe: { R: () => 1, G: () => 0, B: () => 0.5 } };
    expect(expectedElectrons(sensor, [10], [500], 'R')).toBeCloseTo(10, 9);
    expect(expectedElectrons(sensor, [10], [500], 'G')).toBeCloseTo(0, 9);
    expect(expectedElectrons(sensor, [10], [500], 'B')).toBeCloseTo(5, 9);
  });

  it('rejects mismatched array lengths (edge case)', () => {
    expect(() => expectedElectrons(FIXTURE_SENSOR, [1, 2], [500], 'R')).toThrow();
  });
});

describe('readNoiseE / analogGain / maxDn', () => {
  it('switches from LCG to HCG exactly at dcgSwitchIso (edge case: the boundary itself)', () => {
    expect(readNoiseE(FIXTURE_SENSOR, FIXTURE_SENSOR.dcgSwitchIso - 1)).toBe(FIXTURE_SENSOR.readNoise.lcgE);
    expect(readNoiseE(FIXTURE_SENSOR, FIXTURE_SENSOR.dcgSwitchIso)).toBe(FIXTURE_SENSOR.readNoise.hcgE);
    expect(FIXTURE_SENSOR.readNoise.hcgE).toBeLessThan(FIXTURE_SENSOR.readNoise.lcgE);
  });

  it('analog gain is 1 DN/e- exactly at unityGainIso, and scales linearly', () => {
    expect(analogGain(FIXTURE_SENSOR, FIXTURE_SENSOR.unityGainIso)).toBeCloseTo(1, 9);
    expect(analogGain(FIXTURE_SENSOR, FIXTURE_SENSOR.unityGainIso * 4)).toBeCloseTo(4, 9);
  });

  it('maxDn is 2^bitDepth - 1', () => {
    expect(maxDn(FIXTURE_SENSOR)).toBe(2 ** FIXTURE_SENSOR.bitDepth - 1);
  });
});

describe('readout (deterministic)', () => {
  it('adds black level and rounds to the nearest DN', () => {
    const dn = readout(FIXTURE_SENSOR, 0, FIXTURE_SENSOR.unityGainIso, 0);
    expect(dn).toBe(FIXTURE_SENSOR.blackLevelDn);
  });

  it('clips at 0 and at 2^bits - 1 (edge cases)', () => {
    expect(readout(FIXTURE_SENSOR, 0, FIXTURE_SENSOR.unityGainIso, -1e9)).toBe(0);
    expect(readout(FIXTURE_SENSOR, 1e12, FIXTURE_SENSOR.unityGainIso, 0)).toBe(maxDn(FIXTURE_SENSOR));
  });

  it('ISO invariance above the DCG switch: pushing a lower ISO in post matches shooting at the higher ISO,\n     except for quantization', () => {
    // Both ISOs are >= dcgSwitchIso, so both use HCG-mode read noise (equal in both captures) and differ
    // only in analog gain, which is exactly linear in ISO (analogGain model). Comparing noise-free
    // (readNoiseSample=0) readouts isolates that gain/quantization relationship, which is what "ISO
    // invariance" is actually a claim about (the noise floor, not the mean) — see docs/engine/e3.md.
    const isoLow = FIXTURE_SENSOR.dcgSwitchIso; // e.g. 800
    const isoHigh = isoLow * 4; // e.g. 3200, still >= dcgSwitchIso
    // Kept well under the isoHigh capture's own ADC ceiling ((maxDn - blackLevel) / gainHigh): once EITHER
    // capture clips at the ADC, no amount of post-hoc pushing can recover the lost highlight information —
    // that saturation behavior is exactly what samplePixel's own saturated-flag test above covers, and is
    // not what "ISO invariance" is a claim about (it is a claim about the noise floor in the linear range).
    for (const electrons of [0, 5, 50, 500, 3000]) {
      const dnLow = readout(FIXTURE_SENSOR, electrons, isoLow, 0);
      const dnHigh = readout(FIXTURE_SENSOR, electrons, isoHigh, 0);
      // Push dnLow's signal (above black) by the ISO ratio, as raw post-processing would.
      const pushed = Math.round((dnLow - FIXTURE_SENSOR.blackLevelDn) * (isoHigh / isoLow) + FIXTURE_SENSOR.blackLevelDn);
      expect(Math.abs(pushed - dnHigh)).toBeLessThanOrEqual(2); // rounding-only discrepancy
    }
  });

  it('below the DCG switch, the same push does NOT reproduce the higher-ISO read noise (edge case,\n     demonstrates the switch is doing something)', () => {
    // Read noise itself (not just the mean) differs across the switch: this is what actually breaks
    // invariance below it, even though `readout`'s mean-only arithmetic above is agnostic to which side
    // of the switch it's on.
    const rnBelow = readNoiseE(FIXTURE_SENSOR, FIXTURE_SENSOR.dcgSwitchIso - 1);
    const rnAtSwitch = readNoiseE(FIXTURE_SENSOR, FIXTURE_SENSOR.dcgSwitchIso);
    expect(rnBelow).not.toBe(rnAtSwitch);
  });
});

describe('analytic variance / SNR (shot-noise-only sensor)', () => {
  it('matches the textbook shot-noise SNR = sqrt(signal) when every other noise source is zero', () => {
    // BRIEF.md's own accuracy-discipline checklist names this formula explicitly. With dark current, read
    // noise and PRNU all zero (SHOT_NOISE_ONLY_SENSOR), varianceE reduces to exactly signalE, so
    // snr = signalE / sqrt(signalE) = sqrt(signalE).
    for (const signalE of [1, 10, 100, 10000]) {
      expect(varianceE(SHOT_NOISE_ONLY_SENSOR, signalE, 0.01, 100)).toBeCloseTo(signalE, 9);
      expect(snr(SHOT_NOISE_ONLY_SENSOR, signalE, 0.01, 100)).toBeCloseTo(Math.sqrt(signalE), 6);
    }
  });

  it('snr(0) = 0 (edge case: division by zero avoided)', () => {
    expect(snr(FIXTURE_SENSOR, 0, 0.01, 100)).toBe(0);
  });

  it('adding read noise strictly increases variance and strictly decreases SNR at fixed signal', () => {
    const signalE = 1000;
    const noisy: SensorSpec = { ...SHOT_NOISE_ONLY_SENSOR, readNoise: { lcgE: 5, hcgE: 5 } };
    expect(varianceE(noisy, signalE, 0.01, 100)).toBeGreaterThan(varianceE(SHOT_NOISE_ONLY_SENSOR, signalE, 0.01, 100));
    expect(snr(noisy, signalE, 0.01, 100)).toBeLessThan(snr(SHOT_NOISE_ONLY_SENSOR, signalE, 0.01, 100));
  });

  it('PRNU variance follows the derived exact formula (hand-computed, not just the small-PRNU approximation)', () => {
    const sensor: SensorSpec = { ...FIXTURE_SENSOR, darkCurrentEPerS: 0, readNoise: { lcgE: 0, hcgE: 0 }, prnuStdDev: 0.05 };
    const signalE = 2000;
    const p = 0.05;
    // Var[Y] = signalE*(1+p^2) + signalE^2*p^2, derived in sensor.ts's doc comment; computed here
    // independently from the arguments, not by calling varianceE.
    const expected = signalE * (1 + p * p) + signalE * signalE * p * p;
    expect(varianceE(sensor, signalE, 0.01, 100)).toBeCloseTo(expected, 6);
  });
});

describe('engineeringDR', () => {
  it('matches log2(fullWell / readNoise) by hand', () => {
    const iso = FIXTURE_SENSOR.dcgSwitchIso;
    const expected = Math.log2(FIXTURE_SENSOR.fullWellE / FIXTURE_SENSOR.readNoise.hcgE);
    expect(engineeringDR(FIXTURE_SENSOR, iso)).toBeCloseTo(expected, 9);
  });
});

describe('fullWellAtIso (per-DCG-mode full well)', () => {
  it('falls back to fullWellE in both modes when fullWellHcgE is not given (FIXTURE_SENSOR, backward compatible)', () => {
    expect(fullWellAtIso(FIXTURE_SENSOR, FIXTURE_SENSOR.dcgSwitchIso - 1)).toBe(FIXTURE_SENSOR.fullWellE);
    expect(fullWellAtIso(FIXTURE_SENSOR, FIXTURE_SENSOR.dcgSwitchIso)).toBe(FIXTURE_SENSOR.fullWellE);
  });

  it('uses fullWellHcgE at/above dcgSwitchIso and fullWellE below it, when fullWellHcgE is given (edge case: the boundary itself)', () => {
    const dcg: SensorSpec = { ...FIXTURE_SENSOR, fullWellHcgE: 20000 };
    expect(fullWellAtIso(dcg, dcg.dcgSwitchIso - 1)).toBe(dcg.fullWellE);
    expect(fullWellAtIso(dcg, dcg.dcgSwitchIso)).toBe(20000);
  });

  it('a smaller HCG-mode full well lowers engineeringDR/photographicDR/samplePixel\'s clip at high ISO,\n     not just readNoiseE (regression for the single-fullWellE gap in docs/engine/e3.md "Known limits")', () => {
    // Independent derivation: with fullWellHcgE < fullWellE, real DCG physics (see SensorSpec.fullWellHcgE's
    // doc comment) says HCG-mode dynamic range should be lower than a naive fullWellE/hcgReadNoise
    // calculation would give, because the smaller HCG full well takes back some of what the lower HCG read
    // noise gains. Before this fix, engineeringDR/photographicDR/samplePixel all referenced sensor.fullWellE
    // unconditionally, so this scenario was inexpressible through the public API at all.
    const dcg: SensorSpec = { ...FIXTURE_SENSOR, fullWellHcgE: 20000 };
    const iso = dcg.dcgSwitchIso;

    const naiveDR = Math.log2(dcg.fullWellE / dcg.readNoise.hcgE); // the old (wrong) calculation, by hand
    const correctDR = Math.log2(dcg.fullWellHcgE! / dcg.readNoise.hcgE); // independently by hand, from the smaller full well
    expect(engineeringDR(dcg, iso)).toBeCloseTo(correctDR, 9);
    expect(engineeringDR(dcg, iso)).toBeLessThan(naiveDR);

    expect(photographicDR(dcg, 0.01, iso, 0.02)).toBeLessThan(photographicDR(FIXTURE_SENSOR, 0.01, iso, 0.02));

    const rng = makeRng(9, 9);
    const hugePhotons = [450, 500, 550, 600, 650].map(() => 1e7);
    const state = samplePixel(dcg, rng, { x: 0, y: 0, cfa: 'G', photonsByBin: hugePhotons, binCentersNm: [450, 500, 550, 600, 650], exposureS: 0.01, iso });
    expect(state.fullWell).toBe(20000); // not FIXTURE_SENSOR.fullWellE (63000)
    expect(state.electrons).toBe(20000);
    expect(state.saturated).toBe(true);
  });
});

describe('photographicDR', () => {
  it('is smaller than engineering DR (a higher SNR floor costs stops relative to the SNR=1 definition)', () => {
    const iso = FIXTURE_SENSOR.dcgSwitchIso;
    const eDR = engineeringDR(FIXTURE_SENSOR, iso);
    const pDR = photographicDR(FIXTURE_SENSOR, 0.01, iso, 0.02);
    expect(pDR).toBeLessThan(eDR);
    expect(pDR).toBeGreaterThan(0);
  });

  it('grows as the circle of confusion (averaging patch) grows, holding the sensor fixed', () => {
    const iso = FIXTURE_SENSOR.dcgSwitchIso;
    const small = photographicDR(FIXTURE_SENSOR, 0.01, iso, 0.01);
    const large = photographicDR(FIXTURE_SENSOR, 0.01, iso, 0.05);
    expect(large).toBeGreaterThan(small);
  });

  it('clamps a sub-pixel COC to at least one pixel of averaging (edge case)', () => {
    const iso = FIXTURE_SENSOR.dcgSwitchIso;
    const tiny = photographicDR(FIXTURE_SENSOR, 0.01, iso, 1e-9);
    const onePixel = photographicDR(FIXTURE_SENSOR, 0.01, iso, FIXTURE_SENSOR.pitchUm / 1000);
    expect(tiny).toBeCloseTo(onePixel, 6);
  });
});

describe('samplePixel (stochastic)', () => {
  const bins = [450, 500, 550, 600, 650];

  it('has a saturated flag consistent with clipping at full well', () => {
    const rng = makeRng(1, 1);
    const hugePhotons = bins.map(() => 1e7);
    // iso = dcgSwitchIso (not baseIso): at base ISO this fixture's low analog gain (100/640) maps a full
    // well to well under the ADC ceiling (63000*100/640 + 512 = 10356 < maxDn 16383) — a full well and a
    // full ADC code are only forced to coincide by calibrating the base-ISO gain to do so, which this
    // fixture's round numbers were not chosen to satisfy. At iso=800 the gain (800/640=1.25) comfortably
    // overflows the ADC, so the DN ceiling is exercised too.
    const state = samplePixel(FIXTURE_SENSOR, rng, {
      x: 0, y: 0, cfa: 'G', photonsByBin: hugePhotons, binCentersNm: bins, exposureS: 0.01, iso: FIXTURE_SENSOR.dcgSwitchIso,
    });
    expect(state.saturated).toBe(true);
    expect(state.electrons).toBe(FIXTURE_SENSOR.fullWellE);
    expect(state.dn).toBe(maxDn(FIXTURE_SENSOR));
  });

  it('is all zeros signal-side with no light and no dark current (edge case)', () => {
    const rng = makeRng(2, 2);
    const dark: SensorSpec = { ...FIXTURE_SENSOR, darkCurrentEPerS: 0, prnuStdDev: 0, readNoise: { lcgE: 0, hcgE: 0 } };
    const state = samplePixel(dark, rng, {
      x: 3, y: 4, cfa: 'B', photonsByBin: [0, 0, 0, 0, 0], binCentersNm: bins, exposureS: 0.01, iso: dark.dcgSwitchIso,
    });
    expect(state.electronsMean).toBe(0);
    expect(state.electrons).toBe(0);
    expect(state.dn).toBe(dark.blackLevelDn);
    expect(state.saturated).toBe(false);
  });

  it('reports fields consistent with its inputs (x, y, cfa, fullWell)', () => {
    const rng = makeRng(3, 3);
    const state = samplePixel(FIXTURE_SENSOR, rng, {
      x: 12, y: 34, cfa: 'R', photonsByBin: [1000, 1000, 1000, 1000, 1000], binCentersNm: bins, exposureS: 0.01, iso: 100,
    });
    expect(state.x).toBe(12);
    expect(state.y).toBe(34);
    expect(state.cfa).toBe('R');
    expect(state.fullWell).toBe(FIXTURE_SENSOR.fullWellE);
    expect(state.readNoise).toBe(readNoiseE(FIXTURE_SENSOR, 100));
  });

  it('sample mean and variance of raw electrons track the analytic moments (statistical, fixed seed)', () => {
    const rng = makeRng(0xbeef, 12);
    const n = 20000;
    const photonsByBin = bins.map(() => 400); // moderate flux, well below full well
    let sum = 0;
    let sumSq = 0;
    let electronsMean = 0;
    for (let i = 0; i < n; i++) {
      const state = samplePixel(FIXTURE_SENSOR, rng, {
        x: 0, y: 0, cfa: 'G', photonsByBin, binCentersNm: bins, exposureS: 0.02, iso: FIXTURE_SENSOR.dcgSwitchIso,
      });
      electronsMean = state.electronsMean; // constant across draws
      sum += state.electrons;
      sumSq += state.electrons * state.electrons;
    }
    const sampleMean = sum / n;
    const sampleVar = sumSq / n - sampleMean * sampleMean;
    const darkMeanE = FIXTURE_SENSOR.darkCurrentEPerS * 0.02;
    const expectedMean = electronsMean + darkMeanE; // pre-clip mean; flux is far below full well so clipping is negligible
    const expectedVar = varianceE(FIXTURE_SENSOR, electronsMean, 0.02, FIXTURE_SENSOR.dcgSwitchIso) - readNoiseE(FIXTURE_SENSOR, FIXTURE_SENSOR.dcgSwitchIso) ** 2; // `electrons` is pre-read-noise
    // Generous statistical bounds (this combines shot+dark+PRNU, not a single simple distribution).
    expect(Math.abs(sampleMean - expectedMean)).toBeLessThan(6 * Math.sqrt(expectedVar / n));
    expect(Math.abs(sampleVar - expectedVar) / expectedVar).toBeLessThan(0.15);
  });

  it('is deterministic across runs at a fixed seed', () => {
    const params = {
      x: 5, y: 6, cfa: 'G' as const, photonsByBin: [200, 300, 400, 300, 200], binCentersNm: bins, exposureS: 0.01, iso: 400,
    };
    const a = samplePixel(FIXTURE_SENSOR, makeRng(77, 88), params);
    const b = samplePixel(FIXTURE_SENSOR, makeRng(77, 88), params);
    expect(b).toEqual(a);
  });
});
