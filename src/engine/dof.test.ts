import { describe, it, expect } from 'vitest';
import { cocFor, blurDiameter, hyperfocal, dofLimits } from './dof';
import { FORMATS } from './formats';
import { imageDistance, objectDistance } from './thinlens';

describe('cocFor', () => {
  it('divides format diagonal by the divisor (default 1500)', () => {
    expect(cocFor(FORMATS.ff)).toBeCloseTo(FORMATS.ff.diag / 1500, 9);
  });

  it('a stricter divisor gives a smaller (tighter) circle of confusion', () => {
    expect(cocFor(FORMATS.ff, 1000)).toBeGreaterThan(cocFor(FORMATS.ff, 1500));
  });
});

describe('hyperfocal distance (golden)', () => {
  it('50 mm f/8, c = 0.03 mm gives H = 10.47 m', () => {
    // Hand calc (derivation in dof.ts's own doc comment, computed independently with a calculator, not by
    // calling this function): H = f^2/(Nc) + f = 2500/(8*0.03) + 50 = 2500/0.24 + 50 = 10416.6667 + 50
    //                            = 10466.6667 mm = 10.46667 m.
    const H = hyperfocal(50, 8, 0.03);
    expect(H / 1000).toBeCloseTo(10.4667, 3);
    expect(H / 1000).toBeCloseTo(10.47, 2);
  });

  it('pupilMag = 1 is the default and matches explicit pupilMag = 1', () => {
    expect(hyperfocal(50, 8, 0.03, 1)).toBeCloseTo(hyperfocal(50, 8, 0.03), 12);
  });

  it('pupil magnification > 1 (larger exit pupil, more blur per unit defocus) lengthens the hyperfocal distance', () => {
    // A bigger exit pupil produces more blur for the same physical defocus, so to keep an infinity point's blur
    // within the same circle of confusion the lens must be focused farther away: H grows with pupilMag (H is
    // proportional to 1/N_eff = pupilMag/N).
    const f = 50;
    const H1 = hyperfocal(f, 8, 0.03, 1);
    const H2 = hyperfocal(f, 8, 0.03, 1.3);
    expect(H2).toBeGreaterThan(H1);
    // H - f is exactly the f^2/(N_eff c) term, which does scale linearly with pupilMag.
    expect(H2 - f).toBeCloseTo((H1 - f) * 1.3, 6);
  });
});

describe('dofLimits (golden, hand-derived independently of dofLimits() itself)', () => {
  // Hand calculation using the v-space method documented in dof.ts, worked out with a calculator:
  //   f=50, N=8, c=0.03, focus s=3000 mm.
  //   D = f/N = 6.25 mm
  //   v_s = f s/(s-f) = 50*3000/2950 = 50.847457627 mm
  //   v_n = v_s / (1 - c/D) = 50.847457627 / (1 - 0.0048) = 51.092702600 mm
  //     n = f v_n/(v_n - f) = 50*51.092702600/1.092702600 = 2337.90524 mm = 2.33791 m
  //   v_m = v_s / (1 + c/D) = 50.847457627 / 1.0048 = 50.604555759 mm
  //     far = f v_m/(v_m - f) = 50*50.604555759/0.604555759 = 4185.26786 mm = 4.18527 m
  //   total = far - near = 1847.36262 mm = 1.84736 m
  const limits = dofLimits(50, 8, 0.03, 3000);

  it('near limit', () => {
    expect(limits.near).toBeCloseTo(2337.9052, 2);
  });
  it('far limit', () => {
    expect(limits.far).toBeCloseTo(4185.2679, 2);
  });
  it('total DOF', () => {
    expect(limits.total).toBeCloseTo(1847.3626, 2);
  });
  it('reports the same hyperfocal distance as hyperfocal()', () => {
    expect(limits.hyperfocal).toBeCloseTo(hyperfocal(50, 8, 0.03), 9);
  });

  it('cross-checks (loosely) against the classic s>>f hyperfocal-shortcut formulas near=Hs/(H+s-f), far=Hs/(H-s+f)', () => {
    const H = hyperfocal(50, 8, 0.03);
    const s = 3000,
      f = 50;
    const nearShortcut = (H * s) / (H + s - f);
    const farShortcut = (H * s) / (H - s + f);
    // These are a different (approximate, s>>f) derivation from the exact one dofLimits uses, so they agree only
    // loosely here (s is not >> f): within 0.5%, not to golden precision.
    expect(Math.abs(nearShortcut - limits.near) / limits.near).toBeLessThan(0.005);
    expect(Math.abs(farShortcut - limits.far) / limits.far).toBeLessThan(0.005);
  });
});

describe('dofLimits edge cases', () => {
  it('focus at (or beyond) the hyperfocal distance makes the far limit infinite', () => {
    const H = hyperfocal(50, 8, 0.03);
    const limits = dofLimits(50, 8, 0.03, H);
    expect(limits.far).toBe(Infinity);
    expect(limits.total).toBe(Infinity);
  });

  it('near limit is always less than the focus distance, and far always greater, for a normal (non-hyperfocal) focus', () => {
    const limits = dofLimits(50, 8, 0.03, 3000);
    expect(limits.near).toBeLessThan(3000);
    expect(limits.far).toBeGreaterThan(3000);
  });

  it('stopping down (larger N) widens total DOF', () => {
    const wide = dofLimits(50, 2.8, 0.03, 3000);
    const narrow = dofLimits(50, 16, 0.03, 3000);
    expect(narrow.total).toBeGreaterThan(wide.total);
  });
});

describe('blurDiameter', () => {
  it('is zero for a point exactly at the focus distance', () => {
    expect(blurDiameter(50, 8, 3000, 3000)).toBeCloseTo(0, 9);
  });

  it('matches the near/far circle of confusion at the dofLimits boundary', () => {
    const c = 0.03;
    const limits = dofLimits(50, 8, c, 3000);
    expect(blurDiameter(50, 8, 3000, limits.near)).toBeCloseTo(c, 6);
    expect(blurDiameter(50, 8, 3000, limits.far)).toBeCloseTo(c, 6);
  });

  it('a point at Infinity matches the imageDistance(Infinity) limit (v -> f)', () => {
    const f = 50,
      N = 8,
      focus = 3000;
    const viaInfinity = blurDiameter(f, N, focus, Infinity);
    const viaLargeFinite = blurDiameter(f, N, focus, 1e9);
    expect(viaInfinity).toBeCloseTo(viaLargeFinite, 4);
  });

  it('blur grows monotonically with distance from the focus point, on both sides', () => {
    const f = 50,
      N = 8,
      focus = 3000;
    const near1 = blurDiameter(f, N, focus, 2500);
    const near2 = blurDiameter(f, N, focus, 2000);
    expect(near2).toBeGreaterThan(near1);
    const far1 = blurDiameter(f, N, focus, 3500);
    const far2 = blurDiameter(f, N, focus, 5000);
    expect(far2).toBeGreaterThan(far1);
  });

  it('pupil magnification scales blur diameter linearly (exit-pupil model)', () => {
    const f = 50,
      N = 8,
      focus = 3000,
      point = 2000;
    const base = blurDiameter(f, N, focus, point, 1);
    const scaled = blurDiameter(f, N, focus, point, 1.4);
    expect(scaled).toBeCloseTo(base * 1.4, 9);
  });

  it('is symmetric under swapping which of focus/point is nearer, up to the sign that abs() removes', () => {
    // blurDiameter(f,N,3000,2000) is the near-side blur when focused at 3000; check it is self-consistent with the
    // underlying imageDistance relation rather than just trusting the formula.
    const f = 50,
      N = 8;
    const vs = imageDistance(3000, f);
    const vp = imageDistance(2000, f);
    const expected = (f / N) * (Math.abs(vp - vs) / vp);
    expect(blurDiameter(f, N, 3000, 2000)).toBeCloseTo(expected, 9);
  });
});

describe('golden: full-frame diagonal / 1500 matches the CoC used above', () => {
  it('cocFor(FORMATS.ff) is close to the classic 0.029-0.03 mm full-frame CoC convention', () => {
    const c = cocFor(FORMATS.ff);
    expect(c).toBeGreaterThan(0.025);
    expect(c).toBeLessThan(0.035);
  });
});

// Sanity that thinlens.ts's objectDistance is exactly the inverse dof.ts relies on (belt and suspenders for the
// v-space derivation dofLimits uses).
describe('consistency with thinlens.ts', () => {
  it('objectDistance(imageDistance(u, f), f) recovers u', () => {
    const f = 50,
      u = 3000;
    expect(objectDistance(imageDistance(u, f), f)).toBeCloseTo(u, 6);
  });
});
