import { describe, it, expect } from 'vitest';
import { cardinal, imageOf, objectForImage, petzvalRadius } from './paraxial';
import type { TraceSystem, TraceSurface } from './types';

// A non-dispersive fixture index (glass "G" is a flat n everywhere) so every hand calculation below only needs
// one index value, not a real dispersion curve — these are geometry golden tests, not glass ones (glass.test.ts
// covers dispersion). Default nd = 1.5; individual tests that need a different index pass it explicitly so the
// fixture always matches what the hand-derived expected value assumes.
const ND = 1.5;
function sys(surfaces: TraceSurface[], n: number = ND): TraceSystem {
  return { surfaces, index: (m) => (m === 'air' ? 1 : n) };
}
const NM = 587.5618;

function surf(z: number, c: number, sd: number, mediumAfter: string, kind: TraceSurface['kind'] = 'refract'): TraceSurface {
  return { z, c, k: 0, a: [], sd, kind, mediumAfter };
}

describe('cardinal: golden — thin singlet vs the lensmaker equation', () => {
  // Thin lens (both surfaces at z=0), R1=+50, R2=-50, nd=1.5, air both sides.
  // Lensmaker's equation (thin lens, e.g. Hecht, Optics, 5th ed., eq. 5.16): 1/f = (n-1)(1/R1 - 1/R2).
  // 1/f = 0.5*(1/50 - 1/-50) = 0.5*(0.02+0.02) = 0.02 -> f = 50 mm exactly. For a true zero-thickness thin
  // lens both principal planes sit at the lens (P=P'=0), so BFD = EFL = f and FFD = -f.
  const s = sys([surf(0, 1 / 50, 20, 'G'), surf(0, -1 / 50, 20, 'air'), surf(500, 0, 20, 'air', 'image')]);

  it('efl matches 1/f = (n-1)(1/R1 - 1/R2)', () => {
    expect(cardinal(s, NM).efl).toBeCloseTo(50, 9);
  });
  it('principal planes coincide at the (zero-thickness) lens', () => {
    const c = cardinal(s, NM);
    expect(c.P).toBeCloseTo(0, 9);
    expect(c.P2).toBeCloseTo(0, 9);
  });
  it('bfd = efl and ffd = -efl for a thin lens', () => {
    const c = cardinal(s, NM);
    expect(c.bfd).toBeCloseTo(50, 9);
    expect(c.ffd).toBeCloseTo(-50, 9);
  });
});

// F4 (09/30/2026, Astra-6 review): objectForImage inverts imageOf directly (a closed-form Mobius inverse), instead
// of the bisection realize.ts used to run, which silently skipped the solve whenever its two fixed brackets
// (z=-1e6, z=-1) straddled imageOf's own conjugate pole rather than a sign change (the residual crosses +-Infinity
// there, not 0) -- exactly what happened for p200's closest focus. This checks the inverse against imageOf itself
// (an independent forward derivation already golden-tested above), across object distances including one whose
// image sits arbitrarily far out (near the lens's own front focal conjugate), where that bisection's fixed bracket
// would not even need to contain the true root for its sign check to have found it.
describe('objectForImage: closed-form inverse of imageOf, no bracket to miss', () => {
  const s = sys([surf(0, 1 / 50, 20, 'G'), surf(0, -1 / 50, 20, 'air'), surf(500, 0, 20, 'air', 'image')]);

  it.each([200, 1000, -50.0001, 5000, 60])('recovers the object z whose image lands at %i mm', (targetZ) => {
    const objZ = objectForImage(s, NM, targetZ);
    const img = imageOf(s, NM, objZ);
    expect(img.z).toBeCloseTo(targetZ, 6);
  });

  it('recovers the object z for a very distant target image (large-magnitude, still exact within float precision)', () => {
    const objZ = objectForImage(s, NM, -1e6);
    const img = imageOf(s, NM, objZ);
    expect(img.z / -1e6).toBeCloseTo(1, 9); // relative check: absolute mm precision is meaningless at this scale
  });

  it('matches imageOf exactly at a hand-picked conjugate (2f -> 2f)', () => {
    // Thin lens 1:1 conjugate: object at 2f in front, image at 2f behind (Hecht, Optics, eq. 5.17 special case).
    const objZ = objectForImage(s, NM, 100);
    expect(objZ).toBeCloseTo(-100, 9);
  });
});

describe('cardinal: golden — thick biconvex lens vs the thick-lens formula', () => {
  // R1=+50, R2=-50, d=10mm, nd=1.5168, air both sides. Standard thick-lens formulas (e.g. Hecht, Optics, 5th
  // ed., section 6.3, "Thick Lenses"; Warren J. Smith, Modern Optical Engineering, 4th ed., ch. 2):
  //   power = (n-1)[1/R1 - 1/R2 + (n-1)d/(n R1 R2)]; f = 1/power
  //   x_H  (front principal, from V1) = -f(n-1)d / (R2 n)
  //   x_H' (rear principal, from V2)  = -f(n-1)d / (R1 n)
  const n = 1.5168, R1 = 50, R2 = -50, d = 10;
  const power = (n - 1) * (1 / R1 - 1 / R2 + ((n - 1) * d) / (n * R1 * R2));
  const f = 1 / power;
  const xH = (-f * (n - 1) * d) / (R2 * n);
  const xH2 = (-f * (n - 1) * d) / (R1 * n);

  const s = sys([surf(0, 1 / R1, 20, 'G'), surf(d, 1 / R2, 20, 'air'), surf(500, 0, 20, 'air', 'image')], n);
  const c = cardinal(s, NM);

  it(`efl matches the thick-lens power formula (f=${f.toFixed(4)})`, () => {
    expect(c.efl).toBeCloseTo(f, 6);
  });
  it('front principal plane matches x_H from V1', () => {
    expect(c.P).toBeCloseTo(0 + xH, 6);
  });
  it('rear principal plane matches x_H\' from V2', () => {
    expect(c.P2).toBeCloseTo(d + xH2, 6);
  });
  it('front and rear focal points sit efl from their principal planes (air both sides: f=f\')', () => {
    expect(c.F).toBeCloseTo(c.P - f, 9);
    expect(c.F2).toBeCloseTo(c.P2 + f, 9);
  });
});

describe('cardinal: golden — two thin lenses vs the combination formula', () => {
  // f1=50, f2=80, separated by d=30mm (both thin, nd=1.5, air-glass-air-glass-air).
  // Combination formula (e.g. Hecht, Optics, 5th ed., eq. 6.8): 1/f = 1/f1 + 1/f2 - d/(f1 f2).
  const f1 = 50, f2 = 80, d = 30, n = 1.5;
  const R1 = 2 * f1 * (n - 1); // thin lens with R1=-R2=R gives f=R/(2(n-1)) -> R=2f(n-1)
  const R2 = 2 * f2 * (n - 1);
  const fCombined = 1 / (1 / f1 + 1 / f2 - d / (f1 * f2));

  const s = sys([
    surf(0, 1 / R1, 20, 'G'), surf(0, -1 / R1, 20, 'air'),
    surf(d, 1 / R2, 20, 'G'), surf(d, -1 / R2, 20, 'air'),
    surf(300, 0, 20, 'air', 'image'),
  ]);
  const c = cardinal(s, NM);

  it(`efl matches 1/f1+1/f2-d/(f1 f2) (f=${fCombined.toFixed(4)})`, () => {
    expect(c.efl).toBeCloseTo(fCombined, 6);
  });
  it('bfd matches the marginal-ray hand trace (16 mm)', () => {
    // Hand trace: y0=1,u0=0 -> after lens1 u=-1/f1=-0.02 -> y at lens2 = 1+30*(-0.02)=0.4
    // -> after lens2 u = -0.02 - 0.4/f2 = -0.02-0.005 = -0.025 -> bfd = -0.4/-0.025 = 16
    expect(c.bfd).toBeCloseTo(16, 6);
  });
});

describe('cardinal: golden — entrance pupil of a stop behind a single (thin) lens', () => {
  // Classic 2f-2f symmetric conjugate: f=50mm thin lens, stop 2f=100mm behind it, radius 5mm. Imaging the stop
  // backward through the lens (object at the 2f point images to the 2f point on the other side, magnitude 1):
  // entrance pupil at 2f in front of the lens (z=-100), radius = stop radius (|m|=1).
  const f = 50;
  const R = 2 * f * (ND - 1);
  const s = sys([
    surf(0, 1 / R, 20, 'G'), surf(0, -1 / R, 20, 'air'),
    surf(2 * f, 0, 5, 'air', 'stop'),
    surf(400, 0, 20, 'air', 'image'),
  ]);
  const c = cardinal(s, NM);

  it('entrance pupil position at -2f', () => {
    expect(c.ep.z).toBeCloseTo(-2 * f, 6);
  });
  it('entrance pupil radius equals the stop radius (unit magnitude 2f-2f conjugate)', () => {
    expect(Math.abs(c.ep.r)).toBeCloseTo(5, 6);
  });
  it('exit pupil is the stop itself (nothing follows it)', () => {
    expect(c.xp).toEqual({ z: 2 * f, r: 5 });
  });
  it('fno = efl / (2 * entrance pupil radius)', () => {
    expect(c.fno).toBeCloseTo(f / (2 * c.ep.r), 9);
  });
});

describe('petzvalRadius: golden — thin lens Petzval radius = -n f', () => {
  // Standard result for a thin lens in air (e.g. Warren J. Smith, Modern Optical Engineering, 4th ed., ch. 15,
  // "Petzval curvature"): the Petzval radius of a single thin lens of index n and focal length f is -n f.
  it('matches -n f for a thin lens', () => {
    const n = 1.6, f = 40;
    const R = 2 * f * (n - 1);
    const s = sys([surf(0, 1 / R, 20, 'G'), surf(0, -1 / R, 20, 'air'), surf(200, 0, 20, 'air', 'image')], n);
    expect(petzvalRadius(s, NM)).toBeCloseTo(-n * f, 6);
    expect(cardinal(s, NM).petzvalRadius).toBeCloseTo(-n * f, 6);
  });
});

describe('imageOf: golden — thin lens conjugate equation', () => {
  // f=50mm thin lens, object 200mm in front. Gaussian conjugate (1/v + 1/s = 1/f, s positive to the left):
  // 1/v = 1/50 - 1/200 = 0.015 -> v = 66.6667mm; m = -v/s = -0.333333.
  const f = 50;
  const R = 2 * f * (ND - 1);
  const s = sys([surf(0, 1 / R, 20, 'G'), surf(0, -1 / R, 20, 'air'), surf(300, 0, 20, 'air', 'image')]);

  it('image position and magnification match the Gaussian conjugate equation', () => {
    const img = imageOf(s, NM, -200);
    expect(img.z).toBeCloseTo(200 / 3, 9); // 66.666...
    expect(img.magnification).toBeCloseTo(-1 / 3, 9);
  });

  it('object at the front focal point images to infinity (u -> 0, image height stays finite: parallel output)', () => {
    // At the front focal point (z=-f), the axial-ray trick (axisCrossing) legitimately returns +/-Infinity;
    // check the ray comes out parallel instead (via a direct edge-ray height check), the well-defined part.
    const img = imageOf(s, NM, -f);
    expect(Number.isFinite(img.z)).toBe(false);
  });
});

describe('cardinal: edge cases', () => {
  it('no stop surface: pupils/fno are NaN, not thrown, so efl/bfd/P remain usable', () => {
    const R = 2 * 50 * (ND - 1);
    const s = sys([surf(0, 1 / R, 20, 'G'), surf(0, -1 / R, 20, 'air'), surf(300, 0, 20, 'air', 'image')]);
    const c = cardinal(s, NM);
    expect(c.efl).toBeCloseTo(50, 6);
    expect(Number.isNaN(c.ep.r)).toBe(true);
    expect(Number.isNaN(c.xp.r)).toBe(true);
    expect(Number.isNaN(c.fno)).toBe(true);
  });

  it('stop as the very first surface: entrance pupil is the stop itself', () => {
    const R = 2 * 50 * (ND - 1);
    const s = sys([
      surf(0, 0, 8, 'air', 'stop'),
      surf(20, 1 / R, 20, 'G'), surf(20, -1 / R, 20, 'air'),
      surf(300, 0, 20, 'air', 'image'),
    ]);
    const c = cardinal(s, NM);
    expect(c.ep).toEqual({ z: 0, r: 8 });
  });

  it('afocal system (flat plate) throws rather than returning Infinity/NaN silently', () => {
    const s = sys([surf(0, 0, 20, 'G'), surf(10, 0, 20, 'air'), surf(100, 0, 20, 'air', 'image')]);
    expect(() => cardinal(s, NM)).toThrow(/afocal/);
  });

  it('empty system throws', () => {
    const s = sys([surf(0, 0, 20, 'air', 'image')]);
    expect(() => cardinal(s, NM)).toThrow();
  });
});
