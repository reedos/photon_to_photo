import { describe, expect, it } from 'vitest';
import { FOCUS_STEPS, focusStepFromMm, focusStepValue } from './focus-control';

describe('focus distance control', () => {
  it('lets a telephoto move farther than its 30 m opening distance without jumping to infinity', () => {
    for (const focal of [500, 800]) {
      const step = focusStepFromMm(5000, focal, 30000);
      expect(step).toBeLessThan(FOCUS_STEPS - 3);
      expect(focusStepValue(5000, focal, step + 1)).toBeGreaterThan(30000);
      expect(focusStepValue(5000, focal, step - 1)).toBeLessThan(30000);
    }
  });
  it('covers closest focus through finite distances, then infinity, in order', () => {
    for (const [closest, focal] of [[300, 35], [450, 50], [3600, 500], [5000, 800]]) {
      expect(focusStepValue(closest, focal, 0)).toBe(closest);
      let previous = 0;
      for (let i = 0; i < FOCUS_STEPS - 1; i++) {
        const mm = focusStepValue(closest, focal, i)!;
        expect(mm).toBeGreaterThan(previous);
        expect(focusStepFromMm(closest, focal, mm)).toBe(i);
        previous = mm;
      }
      expect(focusStepValue(closest, focal, FOCUS_STEPS - 1)).toBeNull();
      expect(focusStepFromMm(closest, focal, null)).toBe(FOCUS_STEPS - 1);
    }
  });
});
