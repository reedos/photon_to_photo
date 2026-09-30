import { describe, expect, it } from 'vitest';
import {
  daylightChromaticity,
  daylightSpd,
  illuminantSpectralIrradiance,
  KM_LUMENS_PER_WATT,
  planckianSpectralRadiance,
  radiance,
  siemensStarReflectance,
  type Billboard,
  type PointHighlight,
  type Scene,
} from './scene';
import { BINS_10NM, CIE1931_YBAR, D65_CCT_K, D65_SPD, D65_XY, DAYLIGHT_S0, DAYLIGHT_S1, DAYLIGHT_S2, tableSpectrum } from './fixtures/e3-cie';
import type { Vec3 } from './types';

// CIE 1931 ybar IS the CIE 1924 photopic luminous efficiency function V(lambda) — by construction, the Y
// tristimulus was defined to track luminance (CIE 15:2004, §3.3.3, "the y-bar(l) function... is identical
// to the spectral luminous efficiency function for photopic vision"). Reused here as V(lambda) so this
// test file needs no separate fixture table for it.
const vLambda = tableSpectrum(CIE1931_YBAR);
const d65 = tableSpectrum(D65_SPD);

describe('illuminantSpectralIrradiance (the lux -> radiance conversion ENGINE.md asks this module to test)', () => {
  it('reproduces the target lux exactly when integrated back through V(lambda) (construction check)', () => {
    for (const lux of [1, 400, 100000]) {
      const irradiance = illuminantSpectralIrradiance(d65, lux, BINS_10NM, vLambda);
      let integral = 0;
      for (let i = 0; i < BINS_10NM.centers.length; i++) {
        integral += irradiance(BINS_10NM.centers[i]) * CIE1931_YBAR[i] * BINS_10NM.weights[i];
      }
      expect(KM_LUMENS_PER_WATT * integral).toBeCloseTo(lux, 6);
    }
  });

  it('is proportional to lux at fixed wavelength (edge case: doubling lux doubles irradiance everywhere)', () => {
    const e1 = illuminantSpectralIrradiance(d65, 500, BINS_10NM, vLambda);
    const e2 = illuminantSpectralIrradiance(d65, 1000, BINS_10NM, vLambda);
    for (const nm of [450, 550, 650]) expect(e2(nm)).toBeCloseTo(2 * e1(nm), 9);
  });

  it('rejects a spectrum with zero luminous integral (edge case)', () => {
    expect(() => illuminantSpectralIrradiance(() => 0, 100, BINS_10NM, vLambda)).toThrow();
  });
});

describe('planckianSpectralRadiance', () => {
  it("peaks at Wien's displacement law wavelength (independent check, not from this module)", () => {
    // Wien's displacement law: lambda_max * T = b, b = 2.897771955e-3 m.K (CODATA, exact by the 2019 SI
    // constants; derivable from Planck's law but stated here as its own, separately-published constant —
    // e.g. Hecht, "Optics," 5th ed., §13.1). Peak found by direct numeric search over Planck's law, not by
    // calling anything else in this module.
    const WIEN_B_M_K = 2.897771955e-3;
    for (const tempK of [3000, 5000, 6504, 9000]) {
      const expectedPeakNm = (WIEN_B_M_K / tempK) * 1e9;
      let bestNm = 0;
      let bestValue = -Infinity;
      for (let nm = 100; nm <= 3000; nm += 1) {
        const v = planckianSpectralRadiance(nm, tempK);
        if (v > bestValue) {
          bestValue = v;
          bestNm = nm;
        }
      }
      expect(bestNm).toBeCloseTo(expectedPeakNm, -0.3); // within about 1 nm of the 1 nm search grid
    }
  });

  it('is positive and finite everywhere in the visible range (edge case sweep)', () => {
    for (let nm = 380; nm <= 780; nm += 20) {
      const v = planckianSpectralRadiance(nm, 5000);
      expect(v).toBeGreaterThan(0);
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe('daylightChromaticity', () => {
  it("matches D65's published chromaticity at D65's own CCT", () => {
    const { x, y } = daylightChromaticity(D65_CCT_K);
    expect(x).toBeCloseTo(D65_XY[0], 3);
    expect(y).toBeCloseTo(D65_XY[1], 3);
  });

  it('is continuous across the 7000 K branch boundary (edge case)', () => {
    const below = daylightChromaticity(6999.99);
    const above = daylightChromaticity(7000.01);
    expect(Math.abs(above.x - below.x)).toBeLessThan(0.001);
  });

  it('rejects CCTs outside the daylight locus\'s valid [4000, 25000] K range (edge case)', () => {
    expect(() => daylightChromaticity(3999)).toThrow();
    expect(() => daylightChromaticity(25001)).toThrow();
  });
});

describe('daylightSpd', () => {
  it('reproduces the real, measured CIE D65 table at D65\'s own CCT (golden, independent published data)', () => {
    // DAYLIGHT_S0/S1/S2 and D65_SPD are two INDEPENDENTLY published tables (Wyszecki & Stiles's basis
    // functions vs. CIE's own measured/adopted D65 SPD) — this checks the formula actually reconstructs
    // real data, not just that the code is internally consistent with itself.
    const computed = daylightSpd(D65_CCT_K, DAYLIGHT_S0, DAYLIGHT_S1, DAYLIGHT_S2);
    for (let i = 0; i < D65_SPD.length; i++) {
      expect(Math.abs(computed[i] - D65_SPD[i]) / D65_SPD[i]).toBeLessThan(0.005);
    }
  });

  it('rejects mismatched S0/S1/S2 lengths (edge case)', () => {
    expect(() => daylightSpd(6500, [1, 2, 3], [1, 2], [1, 2, 3])).toThrow();
  });
});

describe('siemensStarReflectance', () => {
  it('alternates high/low reflectance across spokes, by angle', () => {
    const high = () => 0.9;
    const low = () => 0.05;
    const pattern = siemensStarReflectance(8, high, low);
    // At angle 0 (u=1,v=0), wedge index = floor((0+pi)/(2pi)*8) = floor(4) = 4 -> even -> high.
    expect(pattern(1, 0)(500)).toBe(0.9);
    // Rotate by one wedge (2*pi/8 = pi/4): u=cos(pi/4), v=sin(pi/4) -> wedge 5 -> odd -> low.
    expect(pattern(Math.cos(Math.PI / 4 + 0.01), Math.sin(Math.PI / 4 + 0.01))(500)).toBe(0.05);
  });
});

describe('radiance', () => {
  const bins = BINS_10NM;
  const whitePatch: Billboard = {
    id: 'white',
    center: [0, 0, 1000],
    normal: [0, 0, -1],
    up: [0, 1, 0],
    widthMm: 200,
    heightMm: 200,
    reflectanceAt: () => () => 0.9,
  };
  const scene: Scene = {
    billboards: [whitePatch],
    illuminant: { spectrum: d65, lux: 1000 },
  };

  it('a straight-on ray to a Lambertian billboard matches L = rho * E / pi by hand, at every bin', () => {
    const origin: Vec3 = [0, 0, 0];
    const dir: Vec3 = [0, 0, 1];
    const result = radiance(scene, origin, dir, bins, vLambda);
    expect(result.hitId).toBe('white');
    expect(result.depthMm).toBeCloseTo(1000, 6);
    const irradiance = illuminantSpectralIrradiance(d65, 1000, bins, vLambda);
    for (let i = 0; i < bins.centers.length; i++) {
      const expected = (0.9 * irradiance(bins.centers[i])) / Math.PI;
      expect(result.radianceByBin[i]).toBeCloseTo(expected, 9);
    }
  });

  it('the lux -> radiance chain integrates back to the target lux through V(lambda) (ENGINE.md\'s explicit ask)', () => {
    // With rho=1 (a perfect diffuser) the Lambertian relation inverts to E(l) = pi * L(l), so integrating
    // pi * L(l) * V(l) over the bins and scaling by Km should reproduce the scene's stated lux exactly.
    const perfectDiffuser: Billboard = { ...whitePatch, id: 'white100', reflectanceAt: () => () => 1 };
    const s: Scene = { billboards: [perfectDiffuser], illuminant: { spectrum: d65, lux: 750 } };
    const result = radiance(s, [0, 0, 0], [0, 0, 1], bins, vLambda);
    let integral = 0;
    for (let i = 0; i < bins.centers.length; i++) {
      integral += Math.PI * result.radianceByBin[i] * CIE1931_YBAR[i] * bins.weights[i];
    }
    expect(KM_LUMENS_PER_WATT * integral).toBeCloseTo(750, 5);
  });

  it('a ray that misses every object returns zero radiance and a null depth/id (edge case)', () => {
    const result = radiance(scene, [1000, 1000, 0], [0, 0, 1], bins, vLambda);
    expect(result.hitId).toBeNull();
    expect(result.depthMm).toBeNull();
    for (const v of result.radianceByBin) expect(v).toBe(0);
  });

  it('a ray just outside the billboard\'s extent misses; just inside it hits (edge case: the u/v=0.5 boundary)', () => {
    // Billboard is 200mm wide/tall at z=1000, so the right edge is at x=100mm as seen from the origin.
    const justOutside = radiance(scene, [0, 0, 0], [100.5, 0, 1000], bins, vLambda);
    const justInside = radiance(scene, [0, 0, 0], [99.5, 0, 1000], bins, vLambda);
    expect(justOutside.hitId).toBeNull();
    expect(justInside.hitId).toBe('white');
  });

  it('depth ordering: the nearer of a point highlight and a billboard on the same ray wins', () => {
    const highlight: PointHighlight = {
      id: 'bokeh-dot',
      position: [0, 0, 400], // in front of the billboard at z=1000
      radiusMm: 20,
      radianceAt: () => 500,
    };
    const nearer = radiance({ ...scene, pointHighlights: [highlight] }, [0, 0, 0], [0, 0, 1], bins, vLambda);
    expect(nearer.hitId).toBe('bokeh-dot');
    expect(nearer.depthMm).toBeLessThan(1000);

    const behindHighlight: PointHighlight = { ...highlight, id: 'behind', position: [0, 0, 1500] };
    const farther = radiance({ ...scene, pointHighlights: [behindHighlight] }, [0, 0, 0], [0, 0, 1], bins, vLambda);
    expect(farther.hitId).toBe('white'); // the billboard at z=1000 occludes the highlight behind it
  });

  it('a region-varying billboard (Siemens star) gives different radiance in different wedges', () => {
    const star: Billboard = {
      id: 'star',
      center: [0, 0, 1000],
      normal: [0, 0, -1],
      up: [0, 1, 0],
      widthMm: 200,
      heightMm: 200,
      reflectanceAt: siemensStarReflectance(4, () => 0.9, () => 0.05),
    };
    const s: Scene = { billboards: [star], illuminant: { spectrum: d65, lux: 1000 } };
    // Two rays landing in different wedges of the same billboard.
    const a = radiance(s, [0, 0, 0], [50, 0, 1000], bins, vLambda); // u ~ +0.25, v=0 -> angle 0
    const b = radiance(s, [0, 0, 0], [0, 50, 1000], bins, vLambda); // u=0, v ~ +0.25 -> angle pi/2
    expect(a.radianceByBin[10]).not.toBeCloseTo(b.radianceByBin[10], 6);
  });
});
