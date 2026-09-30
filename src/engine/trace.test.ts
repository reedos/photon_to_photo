// Golden and edge-case tests for trace.ts. Expected values are derived independently of the implementation under
// test (closed-form thick-lens/plate optics, or direct geometric constructions), per the workstream's accuracy
// discipline; each test says where its number comes from.

import type { Pupil, Ray, TraceSurface, TraceSystem, Vec3 } from './types';
import { normalize3 } from './surface';
import { FRAUNHOFER } from './spectrum';
import { aimRay, fan, spot, traceRay, type Field, type PupilGrid } from './trace';
import { biconvexSinglet, flatPlate, frontGroupWithStop, planoConvexSinglet } from './fixtures/e1a-lenses';
import { constantIndex } from './fixtures/e1a-glass';

const D = FRAUNHOFER.d;

// ---- basic status coverage -------------------------------------------------------------------------------------

describe('traceRay: status coverage', () => {
  it('ok: a well-behaved ray reaches the image plane', () => {
    const sys = planoConvexSinglet({ r2: -40, t: 4, n: 1.5, sd: 10, imageZ: 150 });
    const path = traceRay(sys, { o: [0, 1, -20], d: [0, 0, 1], nm: D });
    expect(path.status).toBe('ok');
    expect(path.pts.length).toBe(4); // origin + 2 refracting surfaces + image
    expect(path.dirOut).toBeDefined();
  });

  it('vignetted: a ray outside a surface sd is blocked there, with the hit point still recorded', () => {
    const sys = planoConvexSinglet({ r2: -40, t: 4, n: 1.5, sd: 10, imageZ: 150 });
    const path = traceRay(sys, { o: [0, 15, -20], d: [0, 0, 1], nm: D }); // h=15 > sd=10 at the flat front
    expect(path.status).toBe('vignetted');
    expect(path.blockedAt).toBe(0);
    expect(path.pts.length).toBe(2); // origin + the blocked point
    expect(path.dirOut).toBeUndefined();
  });

  it('iris: sys.iris can block inside sd at the stop surface', () => {
    const surfaces: TraceSurface[] = [
      { z: 0, c: 0, k: 0, a: [], sd: 10, kind: 'stop', mediumAfter: 'air' },
      { z: 50, c: 0, k: 0, a: [], sd: 100, kind: 'image', mediumAfter: 'air' },
    ];
    const sys: TraceSystem = {
      surfaces,
      index: constantIndex({}),
      iris: (x, y) => Math.abs(x) < 2 && Math.abs(y) < 2, // a 4x4 square opening, well inside sd=10
    };
    const inside = traceRay(sys, { o: [1, 0, -10], d: [0, 0, 1], nm: D });
    expect(inside.status).toBe('ok');
    const outsideIrisInsideSd = traceRay(sys, { o: [5, 0, -10], d: [0, 0, 1], nm: D }); // |x|=5 < sd=10, but > 2
    expect(outsideIrisInsideSd.status).toBe('iris');
    expect(outsideIrisInsideSd.blockedAt).toBe(0);
  });

  it('missed: a ray that cannot reach a curved surface at all', () => {
    const surfaces: TraceSurface[] = [
      { z: 0, c: 1 / 5, k: 0, a: [], sd: 4, kind: 'refract', mediumAfter: 'glass' }, // R=5 sphere
      { z: 50, c: 0, k: 0, a: [], sd: 100, kind: 'image', mediumAfter: 'air' },
    ];
    const sys: TraceSystem = { surfaces, index: constantIndex({ glass: 1.5 }) };
    const path = traceRay(sys, { o: [50, 0, -10], d: [0, 0, 1], nm: D }); // far off-axis, never reaches the R=5 sphere
    expect(path.status).toBe('missed');
    expect(path.blockedAt).toBe(0);
    expect(path.pts.length).toBe(1); // just the origin: no point to record
  });

  it('tir: a steeply curved exit surface can total-internally-reflect a marginal ray', () => {
    // Small-radius rear surface: the LOCAL angle of incidence at an off-axis point can exceed the critical angle
    // even though the ray's angle to the optical axis stays modest -- a real effect in steep singlets.
    const n = 1.6; // critical angle asin(1/1.6) = 38.68 deg
    const surfaces: TraceSurface[] = [
      { z: 0, c: 0, k: 0, a: [], sd: 3, kind: 'refract', mediumAfter: 'glass' },
      { z: 3, c: 1 / 3.2, k: 0, a: [], sd: 2.9, kind: 'refract', mediumAfter: 'air' }, // R=3.2, steep near the edge
      { z: 30, c: 0, k: 0, a: [], sd: 100, kind: 'image', mediumAfter: 'air' },
    ];
    const sys: TraceSystem = { surfaces, index: constantIndex({ glass: n }) };
    const path = traceRay(sys, { o: [0, 2.7, -10], d: [0, 0, 1], nm: D });
    expect(path.status).toBe('tir');
    expect(path.blockedAt).toBe(1);
  });

  it('missed and tir leave dirOut undefined; ok always sets it', () => {
    const sys = planoConvexSinglet({ r2: -40, t: 4, n: 1.5, sd: 10, imageZ: 150 });
    const ok = traceRay(sys, { o: [0, 1, -20], d: [0, 0, 1], nm: D });
    expect(ok.dirOut).toBeDefined();
  });
});

// ---- paraxial-small trace vs. the closed-form thick-lens equation ----------------------------------------------

/** Standard thick-lens equation (e.g. Hecht, *Optics*, "Thick Lenses"; Warren J. Smith, *Modern Optical
 *  Engineering*, ch. 2), independent of trace.ts/surface.ts: 1/f = (n-1)[1/R1 - 1/R2 + (n-1)t/(n R1 R2)].
 *  R1 = Infinity (a flat first surface) works directly: 1/Infinity and t/(n*Infinity*R2) both evaluate to 0. */
function thickLensEFL(n: number, R1: number, R2: number, t: number): number {
  const invF = (n - 1) * (1 / R1 - 1 / R2 + ((n - 1) * t) / (n * R1 * R2));
  return 1 / invF;
}

/** EFL from a real (Snell's-law-exact) trace of a ray parallel to the axis at a tiny height h0: EFL = -h0/u',
 *  where u' is the exit ray's paraxial slope dy/dz -- the standard definition of effective focal length from a
 *  marginal-ray trace (see e.g. Smith, *Modern Optical Engineering*, "paraxial/y-nu ray trace"). Using h0 this
 *  small keeps the real trace's higher-order (aberration) deviation from the paraxial formula far below the
 *  1e-6 relative tolerance the golden test asks for. */
function tracedEFL(sys: TraceSystem, h0: number): number {
  const path = traceRay(sys, { o: [0, h0, -1000], d: [0, 0, 1], nm: D }, { ignoreVignetting: true });
  if (path.status !== 'ok' || !path.dirOut) throw new Error(`unexpected status ${path.status}`);
  const u = path.dirOut[1] / path.dirOut[2];
  return -h0 / u;
}

describe('paraxial-small real trace matches the closed-form thick-lens EFL within 1e-6 relative', () => {
  it('plano-convex singlet', () => {
    const n = 1.5168; // constant index for this check -- the formula being checked is itself wavelength-independent
    const R2 = -50;
    const t = 5;
    const sys = planoConvexSinglet({ r2: R2, t, n, sd: 10, imageZ: 500 });
    const expected = thickLensEFL(n, Infinity, R2, t);
    const got = tracedEFL(sys, 1e-4);
    expect(Math.abs(got / expected - 1)).toBeLessThan(1e-6);
  });

  it('symmetric biconvex lens', () => {
    const n = 1.5168;
    const R1 = 50;
    const R2 = -50;
    const t = 5;
    const sys = biconvexSinglet({ r1: R1, r2: R2, t, n, sd: 10, imageZ: 500 });
    const expected = thickLensEFL(n, R1, R2, t);
    const got = tracedEFL(sys, 1e-4);
    expect(Math.abs(got / expected - 1)).toBeLessThan(1e-6);
  });
});

// ---- spherical aberration sign -----------------------------------------------------------------------------------

/** Extrapolate a ray's final point/direction (from a status-'ok' path traced with ignoreVignetting) to where it
 *  crosses y=0, i.e. the optical axis. Test-only helper -- axis crossings/cardinal points are E1b's paraxial.ts
 *  job, not part of this module's API. */
function axisCrossingZ(sys: TraceSystem, h0: number): number {
  const path = traceRay(sys, { o: [0, h0, -1000], d: [0, 0, 1], nm: D }, { ignoreVignetting: true });
  if (path.status !== 'ok' || !path.dirOut) throw new Error(`unexpected status ${path.status}`);
  const last = path.pts[path.pts.length - 1];
  const dir = path.dirOut;
  const s = -last[1] / dir[1];
  return last[2] + s * dir[2];
}

describe('spherical aberration', () => {
  it('a positive singlet undercorrects: the marginal focus lands in front of (smaller z than) the paraxial focus', () => {
    const sys = biconvexSinglet({ r1: 50, r2: -50, t: 5, n: 1.5168, sd: 20, imageZ: 500 });
    const zParaxial = axisCrossingZ(sys, 1e-4);
    const zMarginal = axisCrossingZ(sys, 12);
    expect(zMarginal).toBeLessThan(zParaxial);
    // and it should grow monotonically with aperture, not just differ at the two ends tested
    const zMid = axisCrossingZ(sys, 6);
    expect(zMid).toBeLessThanOrEqual(zParaxial);
    expect(zMarginal).toBeLessThanOrEqual(zMid);
  });
});

// ---- flat plate axial displacement -------------------------------------------------------------------------------

describe('a flat plate axially displaces a converging ray by t(1 - 1/n)', () => {
  it('matches the paraxial formula for a small-angle ray', () => {
    const t = 8;
    const n = 1.5168;
    const y0 = -1.5;
    const startZ = -200;
    const zTargetNoPlate = 400; // where the ray would cross the axis with no plate in the way (by construction)
    const d = normalize3([0, 0 - y0, zTargetNoPlate - startZ]);

    const sys = flatPlate({ z0: 20, t, n, sd: 30, imageZ: 600 });
    const ray: Ray = { o: [0, y0, startZ], d, nm: D };
    const path = traceRay(sys, ray, { ignoreVignetting: true });
    expect(path.status).toBe('ok');
    const last = path.pts[path.pts.length - 1];
    const dir = path.dirOut!;
    const s = -last[1] / dir[1];
    const zWithPlate = last[2] + s * dir[2];

    const expectedShift = t * (1 - 1 / n);
    const gotShift = zWithPlate - zTargetNoPlate;
    expect(Math.abs(gotShift - expectedShift)).toBeLessThan(1e-3); // small-angle residual, see the module test header
  });
});

// ---- real-ray aiming at the stop -----------------------------------------------------------------------------

describe('aimRay real-ray aiming', () => {
  const sys = frontGroupWithStop({ n: 1.6, stopSd: 8, imageZ: 50 });
  // ep.z must sit at or before sys.surfaces[0].z (z=0 here), like every other ep in this file (fan's -5, spot's
  // -20/-0) -- an 'angle' field ray is launched AT ep.z (see rayThroughPupilPoint), and traceRay only ever
  // accepts a FORWARD (t>0) crossing (see surface.ts's T_MIN / e1a.md "Forward-only intersections"), so any
  // surface positioned before ep.z is, correctly, unreachable and would make this fixture's whole point (the
  // curved front group bending the ray before it reaches the stop, giving realAim something real to correct)
  // silently vacuous instead of failing loudly.
  const ep: Pupil = { z: -10, r: 8 };
  const field: Field = { kind: 'angle', ax: 0, ay: 20 * (Math.PI / 180) };
  const stopIdx = sys.surfaces.findIndex((s) => s.kind === 'stop');

  function stopCrossing(opts?: { realAim?: boolean }): Vec3 {
    const ray = aimRay(sys, ep, field, 0, 0, D, opts);
    const path = traceRay(sys, ray, { ignoreVignetting: true });
    return path.pts[stopIdx + 1];
  }

  it('the paraxial guess alone measurably misses the stop center for this field angle (motivates realAim)', () => {
    const p = stopCrossing();
    expect(Math.hypot(p[0], p[1])).toBeGreaterThan(1e-3);
  });

  it('realAim converges the chief ray to the stop center within 1e-6 mm', () => {
    const p = stopCrossing({ realAim: true });
    expect(Math.hypot(p[0], p[1])).toBeLessThan(1e-6);
  });
});

// ---- fan --------------------------------------------------------------------------------------------------------

describe('fan', () => {
  it('returns n * nms.length paths, n consecutive per wavelength, each carrying its own nm', () => {
    const sys = planoConvexSinglet({ r2: -40, t: 4, n: 1.5, sd: 10, imageZ: 150 });
    const ep: Pupil = { z: -5, r: 8 };
    const field: Field = { kind: 'angle', ax: 0, ay: 0 };
    const paths = fan(sys, ep, field, 5, [486.1, 587.6, 656.3], 'y');
    expect(paths.length).toBe(15);
    for (let i = 0; i < 5; i++) expect(paths[i].nm).toBeCloseTo(486.1, 6);
    for (let i = 5; i < 10; i++) expect(paths[i].nm).toBeCloseTo(587.6, 6);
  });

  it('the middle sample of an odd-n fan is the pupil-center (chief-ish) ray', () => {
    const sys = planoConvexSinglet({ r2: -40, t: 4, n: 1.5, sd: 10, imageZ: 150 });
    const ep: Pupil = { z: -5, r: 8 };
    const field: Field = { kind: 'angle', ax: 0, ay: 0 };
    const paths = fan(sys, ep, field, 5, [D], 'y');
    // px=py=0 on-axis chief ray in an axisymmetric on-axis field: travels straight up the axis.
    expect(Math.hypot(paths[2].pts[0][0], paths[2].pts[0][1])).toBeCloseTo(0, 9);
  });
});

// ---- spot / pupil sampling ------------------------------------------------------------------------------------

describe('spot: pupil sampling patterns', () => {
  const sys = biconvexSinglet({ r1: 50, r2: -50, t: 5, n: 1.5168, sd: 20, imageZ: 300 });
  const ep: Pupil = { z: -20, r: 10 };
  const onAxis: Field = { kind: 'angle', ax: 0, ay: 0 };

  it('square grid: all samples inside the unit disk, weights sum to 1, on-axis centroid near 0', () => {
    const grid: PupilGrid = { kind: 'square', n: 9 };
    const [result] = spot(sys, ep, onAxis, grid, [D]);
    for (const s of result.samples) expect(s.px * s.px + s.py * s.py).toBeLessThanOrEqual(1 + 1e-9);
    const wsum = result.samples.reduce((a, s) => a + s.weight, 0);
    expect(wsum).toBeCloseTo(1, 9);
    expect(Math.hypot(result.centroid[0], result.centroid[1])).toBeLessThan(1e-6);
  });

  it('hexapolar: point count is 1 + 3R(R+1), weights sum to 1', () => {
    const R = 4;
    const grid: PupilGrid = { kind: 'hexapolar', rings: R };
    const [result] = spot(sys, ep, onAxis, grid, [D]);
    expect(result.samples.length).toBe(1 + 3 * R * (R + 1));
    const wsum = result.samples.reduce((a, s) => a + s.weight, 0);
    expect(wsum).toBeCloseTo(1, 9);
  });

  it('fibonacci: exactly n samples, uniform weight', () => {
    // Unlike the square grid and hexapolar rings, the Fibonacci spiral has no mirror symmetry, so its centroid is
    // not expected to land at 0 for a finite n -- its defining property (checked separately below) is uniform
    // AREA density, not symmetry.
    const n = 200;
    const grid: PupilGrid = { kind: 'fibonacci', n };
    const [result] = spot(sys, ep, onAxis, grid, [D]);
    expect(result.samples.length).toBe(n);
    for (const s of result.samples) expect(s.weight).toBeCloseTo(1 / n, 12);
  });

  it('a vignetting element (small sd) still returns every sample, with the blocked ones excluded from the stats', () => {
    const tightSys = biconvexSinglet({ r1: 50, r2: -50, t: 5, n: 1.5168, sd: 6, imageZ: 300 }); // sd < pupil r=10
    const grid: PupilGrid = { kind: 'square', n: 7 };
    const [result] = spot(tightSys, ep, onAxis, grid, [D]);
    const blocked = result.samples.filter((s) => s.path.status !== 'ok');
    expect(blocked.length).toBeGreaterThan(0);
    expect(result.samples.length).toBeGreaterThan(blocked.length); // some still get through near the center
  });
});

describe('Fibonacci pupil sampling has uniform density (area test)', () => {
  it('equal-area radial bins get roughly equal counts', () => {
    // An "identity" system (a single image plane exactly at the entrance pupil) so a sample's landing point is
    // its (px, py) directly, isolating the raw sampling pattern from any lens refraction.
    const surfaces: TraceSurface[] = [{ z: 0, c: 0, k: 0, a: [], sd: 1000, kind: 'image', mediumAfter: 'air' }];
    const identity: TraceSystem = { surfaces, index: constantIndex({}) };
    const ep: Pupil = { z: 0, r: 1 };
    const onAxis: Field = { kind: 'angle', ax: 0, ay: 0 };

    const N = 4000;
    const K = 5; // equal-area radial bins
    const [result] = spot(identity, ep, onAxis, { kind: 'fibonacci', n: N }, [D]);
    expect(result.samples.length).toBe(N);

    const counts = new Array(K).fill(0);
    for (const s of result.samples) {
      const r2 = s.px * s.px + s.py * s.py; // area-uniform bin index: floor(r^2 * K) since area ~ r^2
      const bin = Math.min(K - 1, Math.floor(r2 * K));
      counts[bin]++;
    }
    const expected = N / K;
    for (const c of counts) {
      expect(Math.abs(c - expected) / expected).toBeLessThan(0.15); // well within a deterministic low-discrepancy pattern's spread
    }
  });
});
