// R2-FID-1: a stray white line left the back of the body in the m50 cutaway. The engine's fans are right; the view's
// backward extension of the entry segment divided by a first segment that ran backward (a ray clipped at the front
// surface) and put its start point about 1e8 mm behind the camera. The claim restated as the pass condition: for
// every lineup lens, at its closest focus, its default focus and infinity, wide open and at f/8, no point the rig
// draws for the light lies more than 1 m from the camera (sensor at the origin).
import { describe, expect, it } from 'vitest';
import { compute, PANE_LENS_IDS } from '../app/engine-api';
import { marginalAwareFans } from '../pieces/lens/marginal-rays';
import { LENS_FACTS } from '../app/rig-cards';
import { extendEntryPaths } from './camera-rig';

const NMS = [460, 550, 640];
const FIELDS = [0, 0.7];

describe('the drawn ray fans stay with the rig', () => {
  for (const lens of PANE_LENS_IDS) {
    it(`${lens}: no drawn point more than 1 m from the sensor at closest, default and infinity focus`, () => {
      const base = compute({ lens });
      const closestM = base.realized.realization.closestFocusMm / 1000;
      const len = LENS_FACTS[lens]?.lengthMm ?? 100;
      let worst = 0; let drawnPaths = 0;
      for (const focusM of [closestM, undefined, null] as (number | null | undefined)[]) {
        for (const fno of [undefined, 8]) {
          const model = compute({ lens, ...(focusM === undefined ? {} : { focusM }), ...(fno ? { fno } : {}) });
          const surf = model.system.surfaces;
          const imageZ = surf[surf.length - 1].z;
          const fans = marginalAwareFans(model, FIELDS, NMS, 7);
          const drawn = extendEntryPaths(fans, surf[0].z, Math.max(120, len * 0.7), len);
          for (const f of drawn) for (const p of f.paths) {
            drawnPaths++;
            for (const q of p.pts) worst = Math.max(worst, Math.hypot(q[0], q[1], q[2] - imageZ));
          }
        }
      }
      expect(drawnPaths).toBeGreaterThan(0);
      expect(worst).toBeLessThan(1000);
    });
  }

  it('drops a path whose first segment steps backward instead of extending it behind the camera', () => {
    const fan = { field: 0.7, nm: 550, paths: [
      { nm: 550, status: 'vignetted', pts: [[0, -21.04, -4.73], [0, -21.08, -4.87]] },
      { nm: 550, status: 'ok', pts: [[0, 0, -100], [0, 1, -90], [0, 0, 0]] },
    ] } as any;
    const [out] = extendEntryPaths([fan], -100, 120, 60);
    expect(out.paths.length).toBe(1);
    for (const q of out.paths[0].pts) expect(Math.abs(q[2])).toBeLessThan(400);
  });
});
