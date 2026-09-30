// Golden and edge-case tests for spectrum.ts.

import { BINS16, BINS24, FRAUNHOFER, VISIBLE_HI_NM, VISIBLE_LO_NM, bins, wavelengthColor } from './spectrum';

describe('FRAUNHOFER', () => {
  it('matches the standard reference wavelengths (nm), each in its expected color region', () => {
    expect(FRAUNHOFER.d).toBeCloseTo(587.5618, 4);
    expect(FRAUNHOFER.F).toBeCloseTo(486.1327, 4);
    expect(FRAUNHOFER.C).toBeCloseTo(656.2725, 4);
    expect(FRAUNHOFER.e).toBeCloseTo(546.074, 4);
    expect(FRAUNHOFER.g).toBeCloseTo(435.8343, 4);
    expect(FRAUNHOFER.Fp).toBeCloseTo(479.9914, 4);
    expect(FRAUNHOFER.Cp).toBeCloseTo(643.8469, 4);
    // sanity ordering: g < F' < F < d < C' < C (violet to red)
    expect(FRAUNHOFER.g).toBeLessThan(FRAUNHOFER.Fp);
    expect(FRAUNHOFER.Fp).toBeLessThan(FRAUNHOFER.F);
    expect(FRAUNHOFER.F).toBeLessThan(FRAUNHOFER.d);
    expect(FRAUNHOFER.d).toBeLessThan(FRAUNHOFER.Cp);
    expect(FRAUNHOFER.Cp).toBeLessThan(FRAUNHOFER.C);
  });
});

describe('bins', () => {
  it('builds n evenly spaced bins with edges.length = n+1 and weights summing to hi-lo', () => {
    const b = bins(10, 400, 700);
    expect(b.edges.length).toBe(11);
    expect(b.centers.length).toBe(10);
    expect(b.weights.length).toBe(10);
    expect(b.edges[0]).toBeCloseTo(400, 10);
    expect(b.edges[10]).toBeCloseTo(700, 10);
    const weightSum = b.weights.reduce((a, w) => a + w, 0);
    expect(weightSum).toBeCloseTo(300, 8);
    for (const w of b.weights) expect(w).toBeCloseTo(30, 10);
    for (let i = 0; i < b.centers.length; i++) {
      expect(b.centers[i]).toBeCloseTo((b.edges[i] + b.edges[i + 1]) / 2, 10);
    }
  });

  it('edges are strictly increasing', () => {
    const b = bins(7, 380, 780);
    for (let i = 1; i < b.edges.length; i++) expect(b.edges[i]).toBeGreaterThan(b.edges[i - 1]);
  });

  it('n=1 is the whole range as a single bin', () => {
    const b = bins(1, 500, 600);
    expect(b.edges).toEqual([500, 600]);
    expect(b.centers).toEqual([550]);
    expect(b.weights).toEqual([100]);
  });

  it('rejects a non-positive or non-integer bin count', () => {
    expect(() => bins(0, 400, 700)).toThrow();
    expect(() => bins(-3, 400, 700)).toThrow();
    expect(() => bins(2.5, 400, 700)).toThrow();
  });
});

describe('BINS16 / BINS24', () => {
  it('have the documented counts over the documented visible range', () => {
    expect(BINS16.centers.length).toBe(16);
    expect(BINS24.centers.length).toBe(24);
    for (const b of [BINS16, BINS24]) {
      expect(b.edges[0]).toBeCloseTo(VISIBLE_LO_NM, 10);
      expect(b.edges[b.edges.length - 1]).toBeCloseTo(VISIBLE_HI_NM, 10);
    }
  });
});

describe('wavelengthColor', () => {
  it('reads green-dominant sRGB for 550nm (near the y-bar peak)', () => {
    const c = wavelengthColor(550);
    expect(c.srgb[1]).toBeGreaterThan(c.srgb[0]);
    expect(c.srgb[1]).toBeGreaterThan(c.srgb[2]);
  });

  it('reads red-dominant sRGB for 650nm', () => {
    const c = wavelengthColor(650);
    expect(c.srgb[0]).toBeGreaterThan(c.srgb[1]);
    expect(c.srgb[0]).toBeGreaterThan(c.srgb[2]);
  });

  it('reads blue-dominant sRGB for 460nm', () => {
    const c = wavelengthColor(460);
    expect(c.srgb[2]).toBeGreaterThan(c.srgb[0]);
    expect(c.srgb[2]).toBeGreaterThan(c.srgb[1]);
  });

  it('y-bar (xyz[1], the luminance channel) peaks in the green near 555-560nm, per the CIE standard observer', () => {
    const ys = [500, 530, 555, 560, 580, 610].map((nm) => wavelengthColor(nm).xyz[1]);
    const peakIdx = ys.indexOf(Math.max(...ys));
    expect([2, 3]).toContain(peakIdx); // 555 or 560 nm
  });

  it('is dim (small XYZ) at the violet and red edges of the visible range relative to the middle', () => {
    const edge = wavelengthColor(400).xyz[1] + wavelengthColor(700).xyz[1];
    const middle = wavelengthColor(555).xyz[1];
    expect(edge).toBeLessThan(middle);
  });

  it('decays to ~0 (not NaN) far outside the visible range', () => {
    for (const nm of [100, 200, 1200, 5000]) {
      const c = wavelengthColor(nm);
      expect(Number.isFinite(c.xyz[0])).toBe(true);
      expect(Number.isFinite(c.xyz[1])).toBe(true);
      expect(Number.isFinite(c.xyz[2])).toBe(true);
      expect(c.xyz[0]).toBeLessThan(1e-6);
      expect(c.xyz[1]).toBeLessThan(1e-6);
      expect(c.xyz[2]).toBeLessThan(1e-6);
      expect(c.srgb[0]).toBeCloseTo(0, 6);
      expect(c.srgb[1]).toBeCloseTo(0, 6);
      expect(c.srgb[2]).toBeCloseTo(0, 6);
    }
  });

  it('srgb is always clamped to [0, 1] even though linear is not', () => {
    for (const nm of [400, 450, 500, 550, 555, 600, 650, 700]) {
      const c = wavelengthColor(nm);
      for (const v of c.srgb) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  it('linear never has a negative component (gamut-clipped)', () => {
    for (let nm = 380; nm <= 780; nm += 10) {
      const c = wavelengthColor(nm);
      for (const v of c.linear) expect(v).toBeGreaterThanOrEqual(0);
    }
  });
});
