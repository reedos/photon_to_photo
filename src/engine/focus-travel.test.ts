import { describe, it, expect } from 'vitest';
import { getRealizedLens } from './data';
import { focusParameterT, focusRingAngleRad, ringAngleToT, assumedThrowDeg, ASSUMED_FOCUS_THROW_DEG } from './focus-travel';

const LINEUP = ['s35', 'n50', 'n500', 'n500fl', 'z35', 'm50', 'z800'];

describe('focusParameterT', () => {
  for (const id of LINEUP) {
    it(`${id}: t(infinity) = 0, t(closest) = 1, monotonic in between`, () => {
      const realized = getRealizedLens(id);
      const closest = realized.realization.closestFocusMm;
      expect(focusParameterT(realized, null)).toBe(0);
      expect(focusParameterT(realized, closest)).toBeCloseTo(1, 6);

      // Monotonic (non-increasing t as the object gets farther) across a spread of marked distances, sorted
      // ascending by actual distance -- t must decrease (or hold, once past infinity's t=0) as distance grows.
      const distances = [closest, closest * 2, closest * 5, closest * 20, 5000, 20000].sort((a, b) => a - b);
      let prevT = 1;
      for (const d of distances) {
        const t = focusParameterT(realized, d);
        expect(t).toBeGreaterThanOrEqual(-1e-6);
        expect(t).toBeLessThanOrEqual(1 + 1e-6);
        expect(t).toBeLessThanOrEqual(prevT + 1e-6);
        prevT = t;
      }
    });

    it(`${id}: a distance closer than the closest focus clamps to t = 1`, () => {
      const realized = getRealizedLens(id);
      const closest = realized.realization.closestFocusMm;
      expect(focusParameterT(realized, closest / 2)).toBeCloseTo(1, 6);
    });
  }
});

describe('the distance-scale mark angle vs. the engine focus travel', () => {
  for (const id of LINEUP) {
    it(`${id}: ring angle = assumed throw * t(d), for a marked distance`, () => {
      const realized = getRealizedLens(id);
      const closest = realized.realization.closestFocusMm;
      const markDistances = [closest, closest * 3, 3000];
      for (const d of markDistances) {
        const t = focusParameterT(realized, d);
        const angle = focusRingAngleRad(realized, d, id);
        const throwRad = (assumedThrowDeg(id) * Math.PI) / 180;
        expect(angle).toBeCloseTo(throwRad * t, 10);
      }
      // infinity: angle 0
      expect(focusRingAngleRad(realized, null, id)).toBe(0);
    });
  }

  it('ringAngleToT is the inverse of the throw*t mapping', () => {
    for (const id of LINEUP) {
      const throwRad = (assumedThrowDeg(id) * Math.PI) / 180;
      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        const angle = throwRad * t;
        expect(ringAngleToT(angle, id)).toBeCloseTo(t, 10);
      }
    }
  });

  it('every lineup lens has its own assumed throw angle, none fall back to the generic default', () => {
    for (const id of LINEUP) {
      expect(ASSUMED_FOCUS_THROW_DEG[id]).toBeDefined();
      expect(ASSUMED_FOCUS_THROW_DEG[id]).toBeGreaterThan(0);
    }
  });
});
