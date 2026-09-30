import { describe, it, expect } from 'vitest';
import { jiangAvailable, jiangCameraSensitivities } from './jiang';
import {
  GLASS_CATALOG,
  lensIds,
  getRealizedLens,
  getLensInfo,
  BINS,
  CMF,
  V_LAMBDA,
  D65_SPECTRUM,
  DAYLIGHT_S0,
  DAYLIGHT_LAMBDAS,
  COLOR_CHECKER_NAMES,
  colorCheckerReflectance,
  gaussianCameraSensitivities,
  sensorFor,
  sensorReadNoiseAtIso,
  defaultSensorId,
  lensDesign,
} from './data';

describe('GLASS_CATALOG', () => {
  it('loads a non-empty catalog', () => {
    expect(GLASS_CATALOG.entries().length).toBeGreaterThan(100);
  });
});

describe('lenses', () => {
  it('lists all 12 primes plus the PANE.md lineup lenses (docs/PANE.md, 09/28/2026)', () => {
    expect(lensIds().sort()).toEqual(
      [
        'p105', 'p135', 'p20', 'p200', 'p24', 'p28', 'p300', 'p35', 'p400', 'p50', 'p500', 'p85',
        's35', 'n50', 'n500', 'n500fl', 'z35', 'm50', 'z800',
      ].sort(),
    );
  });

  it('getRealizedLens(p50) resolves and traces', () => {
    const lens = getRealizedLens('p50');
    expect(lens.realization.stopRadius).toBeGreaterThan(0);
    expect(lens.raw.length).toBeGreaterThan(10);
  });

  it('getRealizedLens is cached (same object on a second call)', () => {
    expect(getRealizedLens('p50')).toBe(getRealizedLens('p50'));
  });

  it('getLensInfo(p50) reports the design EFL near 49.58 mm (patent-stated f)', () => {
    const info = getLensInfo('p50');
    expect(info.efl).toBeCloseTo(49.58, 0);
    expect(info.maxFno).toBeCloseTo(1.46, 2);
    expect(info.blades).toBe(9);
    expect(info.elements).toBe(13);
  });

  it('an unknown lens id throws', () => {
    expect(() => getRealizedLens('nope')).toThrow();
  });

  it("Finding P1: n50's surface 11 asphere stores the patent's kappa=0 as k=-1, not k=0 " +
    '(data/lenses/n50.json; see surface.test.ts for the sag regression proving this is the right value)', () => {
    const design = lensDesign('n50');
    const surf11 = design.surfaces[10]; // 0-indexed: patent surface 11 is index 10
    expect(surf11.asph?.k).toBe(-1);
  });
});

describe('spectral data', () => {
  it('BINS has 16 bins spanning 380-780 nm', () => {
    expect(BINS.centers.length).toBe(16);
    expect(BINS.edges[0]).toBeCloseTo(380, 6);
    expect(BINS.edges[BINS.edges.length - 1]).toBeCloseTo(780, 6);
  });

  it('CMF.ybar peaks near 555-560 nm', () => {
    const peak = BINS.centers.reduce((best, nm) => (CMF.ybar(nm) > CMF.ybar(best) ? nm : best));
    expect(peak).toBeGreaterThan(540);
    expect(peak).toBeLessThan(580);
  });

  it('V_LAMBDA is the same function as CMF.ybar', () => {
    expect(V_LAMBDA(555)).toBe(CMF.ybar(555));
  });

  it('D65_SPECTRUM is positive across the visible range', () => {
    for (const nm of [400, 500, 600, 700]) expect(D65_SPECTRUM(nm)).toBeGreaterThan(0);
  });

  it('daylight basis tables line up with their own lambda grid', () => {
    expect(DAYLIGHT_S0.length).toBe(DAYLIGHT_LAMBDAS.length);
  });
});

describe('ColorChecker', () => {
  it('has 24 named patches', () => {
    expect(COLOR_CHECKER_NAMES.length).toBe(24);
  });

  it('white patch reflects more than black patch at 550 nm', () => {
    const white = colorCheckerReflectance('white 9.5 (.05 D)');
    const black = colorCheckerReflectance('black 2 (1.5 D)');
    expect(white(550)).toBeGreaterThan(black(550));
  });

  it('an unknown patch name throws', () => {
    expect(() => colorCheckerReflectance('nope')).toThrow();
  });
});

describe('camera sensitivities', () => {
  it('gaussianCameraSensitivities scales its peak to the given QE', () => {
    const sens = gaussianCameraSensitivities(0.8);
    // Sample densely (not just at BINS' 25 nm centers) to actually land near the Gaussian's true peak.
    let gPeak = 0;
    for (let nm = 380; nm <= 780; nm += 0.5) gPeak = Math.max(gPeak, sens.G(nm));
    expect(gPeak).toBeCloseTo(0.8, 3);
  });

  it.skipIf(!jiangAvailable)('jiangCameraSensitivities defaults to the Nikon D700 and is positive near its peaks', () => {
    const sens = jiangCameraSensitivities();
    expect(sens.G(535)).toBeGreaterThan(0);
    expect(sens.R(600)).toBeGreaterThan(0);
    expect(sens.B(465)).toBeGreaterThan(0);
  });

  it.skipIf(!jiangAvailable)('an unknown camera name throws', () => {
    expect(() => jiangCameraSensitivities('nope')).toThrow();
  });
});

describe('sensorFor', () => {
  it('builds a full-frame sensor at ISO 100', () => {
    const { spec, info } = sensorFor('ff', 100);
    expect(spec.pitchUm).toBeCloseTo(3.76, 1);
    expect(info.widthPx).toBeGreaterThan(9000);
    expect(info.readNoiseE).toBeGreaterThan(0);
    expect(spec.readNoise.lcgE).toBe(spec.readNoise.hcgE);
  });

  it('read noise drops noticeably above the DCG switch ISO for the full-frame pick', () => {
    const low = sensorReadNoiseAtIso('Sony a7R IV (ILCE-7RM4)', 200);
    const high = sensorReadNoiseAtIso('Sony a7R IV (ILCE-7RM4)', 400);
    expect(high).toBeLessThan(low);
  });

  it('read noise clamps outside the table range', () => {
    const belowTable = sensorReadNoiseAtIso('Sony a7R IV (ILCE-7RM4)', 1);
    const atFirstPoint = sensorReadNoiseAtIso('Sony a7R IV (ILCE-7RM4)', 50);
    expect(belowTable).toBe(atFirstPoint);
  });

  it('caches by (sensor id, iso)', () => {
    expect(sensorFor('ff', 100)).toBe(sensorFor('ff', 100));
    expect(sensorFor('ff', 100)).not.toBe(sensorFor('ff', 400));
  });

  it('builds sensors for all three formats', () => {
    for (const f of ['ff', 'apsc', 'mft'] as const) {
      const { spec, info } = sensorFor(f, 200);
      expect(spec.fullWellE).toBeGreaterThan(0);
      expect(info.id).toBe(defaultSensorId(f));
    }
  });
});
