// Adversarial verification tests for workstream E3 (rng.ts, sensor.ts, color.ts, pipeline.ts, scene.ts).
// Each test here encodes an INDEPENDENTLY derived expected value (never by calling the function under
// test to produce its own expectation) with its derivation cited in a comment, per the review's proof
// rule. This file is throwaway review output, not part of E3's own test suite.

import { describe, expect, it } from 'vitest';
import { radiance, type Billboard, type Scene } from './scene';
import { BINS_10NM } from './fixtures/e3-cie';

describe('FINDING 1: scene.ts rayBillboardIntersect computes a mirrored (left-right flipped) u axis', () => {
  it('a ray landing on the world +x side of a camera-facing billboard should read u > 0, not u < 0', () => {
    // Independent derivation of the correct sign, from the engine's OWN declared axis convention
    // (src/engine/types.ts header: "x is horizontal and y vertical in the frame (y up)... z is the
        // optical axis, light travels +z" -- a standard right-handed x,y,z frame, i.e. x_hat . cross(y_hat)
    // = z_hat is NOT the identity used here; the textbook right-handed identity is x_hat x y_hat = z_hat,
    // e.g. any linear-algebra/computer-graphics reference on orientation (Hearn & Baker, "Computer
    // Graphics," or simply the definition of a right-handed coordinate system)).
    //
    // For a billboard directly facing the camera along the world z axis, forward = +z (the ray's own
    // travel direction, per types.ts), up = +y, so by x_hat x y_hat = z_hat, "right" (the local u axis)
    // must be world +x: right x up = forward => right = +x here (verified independently: with
    // up=[0,1,0], forward=[0,0,1], solving right x [0,1,0] = [0,0,1] gives right=[1,0,0], since
    // [1,0,0] x [0,1,0] = [0,0,1] by direct computation).
    //
    // scene.test.ts's own inline comments independently confirm this was the INTENDED convention and were
    // never actually checked by an assertion:
    //   "Billboard is 200mm wide/tall at z=1000, so the right edge is at x=100mm as seen from the origin."
    //   "const a = radiance(s, [0, 0, 0], [50, 0, 1000], bins, vLambda); // u ~ +0.25, v=0 -> angle 0"
    // i.e. the builder's own comments assert u should be POSITIVE for a world +x offset -- but
    // rayBillboardIntersect computes `right = normalize(cross(bb.up, bb.normal))`, which (for this
    // camera-facing setup, normal=[0,0,-1]=-forward) evaluates to cross([0,1,0],[0,0,-1]) = [-1,0,0]:
    // the OPPOSITE sign from world +x. The correct formula is cross(bb.normal, bb.up) (normal x up),
    // which for this setup gives cross([0,0,-1],[0,1,0]) = [1,0,0], the correct +x.
    let observedU: number | null = null;
    const probe: Billboard = {
      id: 'probe',
      center: [0, 0, 1000],
      normal: [0, 0, -1], // faces the camera at the origin, i.e. against the incoming +z ray
      up: [0, 1, 0],
      widthMm: 200,
      heightMm: 200,
      reflectanceAt: (u) => {
        observedU = u;
        return () => 1;
      },
    };
    const scene: Scene = { billboards: [probe], illuminant: { spectrum: () => 1, lux: 100 } };
    // A ray from the origin landing 50mm to the WORLD +x side of the billboard's center (x=50 at z=1000).
    const result = radiance(scene, [0, 0, 0], [50, 0, 1000], BINS_10NM, () => 1);
    expect(result.hitId).toBe('probe'); // sanity: it does hit
    expect(observedU).not.toBeNull();
    // Independently derived expected value: u = world-x-offset / widthMm = 50 / 200 = 0.25 (positive).
    expect(observedU as unknown as number).toBeCloseTo(0.25, 6);
  });
});
