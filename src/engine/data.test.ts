import { describe, it, expect } from 'vitest';
import { jiangAvailable, jiangCameraSensitivities } from './jiang';
import { systemAt, cardinal } from './lens';
import { FRAUNHOFER_D_NM } from './glass';
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
  spectralColor,
  D850_SENSOR_ID,
  Z8_SENSOR_ID,
} from './data';

// R-S1 (10/10/2026 correctness review): the display color comes from the cited 1 nm CIE table. Normalizing the
// analytic fit instead painted the 742.5 and 767.5 nm ray bins green; the table puts them in the red.
describe('spectralColor (the site-wide display color for light)', () => {
  it('uses the CIE table: deep red stays red, violet stays blue-violet, every bin at full display brightness', () => {
    for (const nm of [692.5, 717.5, 742.5, 767.5]) {
      const [r, g, b] = spectralColor(nm).srgb;
      expect(r).toBeCloseTo(1, 9);
      expect(g).toBeLessThan(0.5);
      expect(b).toBeLessThan(0.2);
    }
    const violet = spectralColor(392.5).srgb;
    expect(violet[2]).toBeCloseTo(1, 9);
    expect(violet[1]).toBeLessThan(0.1);
    for (const nm of BINS.centers) expect(Math.max(...spectralColor(nm).srgb)).toBeCloseTo(1, 9);
  });
});

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

  // r4 (10/12/2026): LensInfo.efl used to drop each surface's diffractive spec, so the PF lenses read 538.94 mm
  // (n500) and 859.05 mm (z800) against 489.71 and 780.01 traced.
  it('getLensInfo(id).efl equals the traced infinity EFL for every lens, diffractive ones included', () => {
    for (const id of lensIds()) {
      const sys = systemAt(getRealizedLens(id), null);
      const traced = cardinal(sys, FRAUNHOFER_D_NM, getRealizedLens(id).realization.stopRadius).efl;
      expect(getLensInfo(id).efl, id).toBeCloseTo(traced, 9);
    }
    expect(getLensInfo('n500').efl).toBeCloseTo(489.71, 1);
    expect(getLensInfo('z800').efl).toBeCloseTo(780.01, 1);
    // Realizing all 20 lenses takes 11 s alone and took 31.5 s and timed out on a loaded cold run (r5, 10/14/2026), so the default 30 s is too tight.
  }, 120_000);

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

  // Score-loop r1 (10/11/2026): the old method-of-moments fit gave R/G = 0.955 under daylight, 1.74x the D700 it
  // was fitted to. The refit keeps each channel's photon-weighted D65 response. Measured D700 ratios on the source's
  // own 400-720 nm, 10 nm grid (data/color/camera-sensitivity-jiang2013.json): R/G 0.550, B/G 0.723.
  const D700_D65_R_OVER_G = 0.550;
  const D700_D65_B_OVER_G = 0.723;
  function d65Ratios(sens: { R: (nm: number) => number; G: (nm: number) => number; B: (nm: number) => number }) {
    const sum = { R: 0, G: 0, B: 0 };
    for (let nm = 400; nm <= 720; nm += 10) {
      const photons = D65_SPECTRUM(nm) * nm;
      sum.R += sens.R(nm) * photons;
      sum.G += sens.G(nm) * photons;
      sum.B += sens.B(nm) * photons;
    }
    return { rg: sum.R / sum.G, bg: sum.B / sum.G };
  }

  it('the Gaussian model keeps the D700 daylight channel balance (R/G and B/G within 5%)', () => {
    const { rg, bg } = d65Ratios(gaussianCameraSensitivities(1));
    expect(Math.abs(rg / D700_D65_R_OVER_G - 1)).toBeLessThan(0.05);
    expect(Math.abs(bg / D700_D65_B_OVER_G - 1)).toBeLessThan(0.05);
  });

  it.skipIf(!jiangAvailable)('the pinned D700 daylight ratios match the measured table', () => {
    const { rg, bg } = d65Ratios(jiangCameraSensitivities('Nikon D700'));
    expect(rg).toBeCloseTo(D700_D65_R_OVER_G, 3);
    expect(bg).toBeCloseTo(D700_D65_B_OVER_G, 3);
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
  it('bounds continuous ISO history without changing rebuilt sensor values', () => {
    const first = sensorFor('ff', 111.123);
    const active = sensorFor('ff', 222.234);
    for (let i = 0; i < 135; i++) {
      sensorFor('ff', 333 + i / 100);
      expect(sensorFor('ff', 222.234)).toBe(active);
    }
    const rebuilt = sensorFor('ff', 111.123);
    expect(rebuilt).not.toBe(first);
    expect(rebuilt.info).toEqual(first.info);
    expect(rebuilt.spec.readNoise).toEqual(first.spec.readNoise);
  });
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

// Score-loop r1 (10/11/2026): the D850's black level is Jim Kasson's dark-frame measurement (400 DN at base ISO,
// blog.kasson.com, 10/30/2017), labeled reported below ISO 1600 where he saw it move lower. The Z8 has no cited
// figure and keeps the assumed 512 DN.
describe('raw black level', () => {
  it('D850 uses the reported 400 DN, labeled reported at base ISO and assumed from ISO 1600', () => {
    const base = sensorFor('ff', 64, D850_SENSOR_ID);
    expect(base.spec.blackLevelDn).toBe(400);
    expect(base.info.figs.blackLevelDn.ev).toBe('reported');
    expect(base.info.figs.blackLevelDn.src).toContain('kasson.com');
    const high = sensorFor('ff', 3200, D850_SENSOR_ID);
    expect(high.spec.blackLevelDn).toBe(400);
    expect(high.info.figs.blackLevelDn.ev).toBe('assumed');
  });
  it('Z8 keeps the assumed 512 DN', () => {
    const z8 = sensorFor('ff', 64, Z8_SENSOR_ID);
    expect(z8.spec.blackLevelDn).toBe(512);
    expect(z8.info.figs.blackLevelDn.ev).toBe('assumed');
  });
});

// Score-loop r3 (10/11/2026): PRNU is Jim Kasson's flat-field measurement of other full-frame cameras (Nikon D4 and
// Sony a9, 0.3-0.4% with his 99x99 kernel), replacing 1.5% from an onsemi industrial sensor datasheet. It stands in
// for the D850 and Z8, so wherever it is applied to them it is labeled assumed.
describe('PRNU and the ADC clip point', () => {
  it('PRNU is 0.4% RMS from Kasson, applied as an assumption', () => {
    for (const id of [D850_SENSOR_ID, Z8_SENSOR_ID]) expect(sensorFor('ff', 100, id).spec.prnuStdDev).toBeCloseTo(0.004, 10);
  });
  it('the D850 raw value clips below the full well even at base ISO 64', () => {
    const { info } = sensorFor('ff', 64, D850_SENSOR_ID);
    // (16383 - 400) DN / (64 / 233 DN per electron) = 58,188 e-, 1.6% under the 59,126 e- full well
    expect(info.adcClipE).toBeCloseTo((16383 - 400) * 233 / 64, 6);
    expect(info.adcClipE).toBeLessThan(info.fullWellE);
    expect(1 - info.adcClipE / info.fullWellE).toBeCloseTo(0.016, 3);
    expect(sensorFor('ff', 100, D850_SENSOR_ID).info.adcClipE).toBeCloseTo((16383 - 400) * 233 / 100, 6); // 37,240 e-
    expect(info.figs.adcClipE.ev).toBe('derived');
  });
});

// Score loop r4 (10/12/2026): the Photodiode card showed the green figure (44%) for a red pixel, which peaks near 32%.
describe('per-channel peak quantum efficiency', () => {
  it('the D850 green peak is the sensor figure, red about 0.73 of it and blue about 0.98 (the fitted Gaussian amplitudes)', () => {
    const { info } = sensorFor('ff', 100, D850_SENSOR_ID);
    const g = info.figs.qePeakG.v, r = info.figs.qePeakR.v, b = info.figs.qePeakB.v;
    expect(g).toBeCloseTo(info.figs.qePeak.v, 3);
    expect(r / g).toBeCloseTo(0.7337, 3);
    expect(b / g).toBeCloseTo(0.984, 3);
    // score loop r6: the green peak is calibrated to the measured ISO (about 0.52), above Claff's 44% starting scale
    expect(g).toBeGreaterThan(0.50);
    expect(g).toBeLessThan(0.58);
    expect(r).toBeGreaterThan(0.36);
    expect(r).toBeLessThan(0.42);
    expect(info.figs.qePeakR.ev).toBe('derived');
  });
});
