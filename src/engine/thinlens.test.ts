import { describe, it, expect } from 'vitest';
import {
  imageDistance,
  objectDistance,
  magnification,
  magnificationFromObject,
  objectDistanceForMagnitude,
  objectDistanceFromMechanical,
} from './thinlens';

describe('thin-lens equation', () => {
  it('imageDistance/objectDistance are inverses (round trip) for an ordinary photographic distance', () => {
    const f = 50,
      u = 3000; // 3 m
    const v = imageDistance(u, f);
    expect(objectDistance(v, f)).toBeCloseTo(u, 6);
  });

  it('imageDistance(3000, 50) matches the hand-computed image distance used in dof.test.ts (50*3000/2950)', () => {
    // Hand calc: v = uf/(u-f) = 50*3000/2950 = 50.847457627...
    expect(imageDistance(3000, 50)).toBeCloseTo(50.847457627, 6);
  });

  it('an object at infinity images at v = f (limit, checked with a very large finite u)', () => {
    expect(imageDistance(1e9, 50)).toBeCloseTo(50, 4);
  });

  it('the classic 1:1 macro point is at u = v = 2f', () => {
    const f = 100;
    const u = 2 * f;
    const v = imageDistance(u, f);
    expect(v).toBeCloseTo(2 * f, 9);
    expect(Math.abs(magnification(u, v))).toBeCloseTo(1, 9);
  });

  it('magnification is negative (real, inverted image) for an ordinary real object', () => {
    const f = 50,
      u = 1000;
    const v = imageDistance(u, f);
    expect(magnification(u, v)).toBeLessThan(0);
  });

  it('magnificationFromObject agrees with magnification(u, imageDistance(u, f))', () => {
    const f = 85,
      u = 5000;
    const v = imageDistance(u, f);
    expect(magnificationFromObject(u, f)).toBeCloseTo(magnification(u, v), 9);
  });

  it('magnification magnitude decreases monotonically as the object recedes', () => {
    const f = 50;
    const mNear = Math.abs(magnificationFromObject(1000, f));
    const mFar = Math.abs(magnificationFromObject(10000, f));
    expect(mFar).toBeLessThan(mNear);
  });
});

describe('objectDistanceForMagnitude', () => {
  it('|m| = 1 gives u = 2f (round trip with magnificationFromObject)', () => {
    const f = 105;
    const u = objectDistanceForMagnitude(1, f);
    expect(u).toBeCloseTo(2 * f, 9);
    expect(Math.abs(magnificationFromObject(u, f))).toBeCloseTo(1, 9);
  });

  it('round-trips for a non-unit magnification (0.25, typical of a non-macro lens close-focused)', () => {
    const f = 50;
    const u = objectDistanceForMagnitude(0.25, f);
    expect(Math.abs(magnificationFromObject(u, f))).toBeCloseTo(0.25, 6);
  });

  it('a smaller magnitude of magnification corresponds to a farther object distance', () => {
    const f = 50;
    expect(objectDistanceForMagnitude(0.1, f)).toBeGreaterThan(objectDistanceForMagnitude(0.5, f));
  });
});

describe('objectDistanceFromMechanical', () => {
  it('round-trips against imageDistance for a thin lens (interstitium = 0)', () => {
    // Independent construction: pick f and u, derive v and the mechanical total D = u + v, then recover u.
    const cases: Array<[number, number]> = [
      [50, 100], // the symmetric 1:1 point (D = 4f exactly)
      [50, 150],
      [85, 2000],
      [50, 3000],
      [200, 50000],
    ];
    for (const [f, u] of cases) {
      const v = imageDistance(u, f);
      const D = u + v;
      expect(objectDistanceFromMechanical(D, f, 0)).toBeCloseTo(u, 4);
    }
  });

  it('round-trips with a nonzero (including negative) interstitium', () => {
    const f = 50,
      u = 3000,
      interstitium = 12; // a thick lens whose rear principal plane is 12 mm ahead of the front one
    const v = imageDistance(u, f);
    const total = u + interstitium + v; // mechanical subject-to-sensor distance
    expect(objectDistanceFromMechanical(total, f, interstitium)).toBeCloseTo(u, 3);

    const negInterstitium = -8;
    const total2 = u + negInterstitium + v;
    expect(objectDistanceFromMechanical(total2, f, negInterstitium)).toBeCloseTo(u, 3);
  });

  it('the minimum total conjugate distance D = 4f is the 1:1 double root: u = v = 2f', () => {
    const f = 60;
    const u = objectDistanceFromMechanical(4 * f, f, 0);
    expect(u).toBeCloseTo(2 * f, 6);
  });

  it('below the minimum (D < 4f) returns NaN rather than a pair that silently fails 1/u + 1/v = 1/f', () => {
    // D = 3f = 180 < 4f = 240: no real (u, v) with u+v=D and 1/u+1/v=1/f exists (that is what the negative
    // discriminant means). Confirmed by hand: the old D/2 clamp gave u=v=90, for which 1/u+1/v = 0.022222 vs
    // 1/f = 0.016667 - off by ~33%, not a rounding artifact (see FINDING 2 in e2.verify.test.ts). NaN is the
    // correct, explicit signal that the requested mechanical distance is inside this lens's minimum focus.
    const f = 60;
    const u = objectDistanceFromMechanical(3 * f, f, 0);
    expect(Number.isNaN(u)).toBe(true);
  });
});
