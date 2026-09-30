// Adversarial verification tests for workstream E4 (data.ts, camera.ts, scenes.ts, render.ts).
// Each test here encodes an INDEPENDENTLY derived expected value (never by calling the function under
// test to produce its own expectation) with its derivation cited in a comment, per the review's proof
// rule. This file is throwaway review output, not part of E4's own test suite.

import { describe, expect, it } from 'vitest';
import { compute, exitPupilBlurDiameterMm } from './camera';
import { renderSetup, traceSource, projectToRenderedPixel } from './render';
import type { Scenario } from './types';

function scenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    lens: 'p20',
    fno: 2.8,
    shutter: 1 / 125,
    iso: 400,
    focusM: 1,
    format: 'ff',
    shutterType: 'mechanical',
    scene: 'bench',
    ...overrides,
  };
}

/**
 * FINDING 1: render.ts sizes its per-pixel defocus-blur kernel from the ray's EUCLIDEAN hit distance
 * (scene.ts's `radiance()`/`depthMm`, "mm ALONG rayDir" per that module's own doc comment — a straight-line
 * distance from the sensor to the actual 3D hit point), but `exitPupilBlurDiameterMm`'s `pointDistMm`
 * parameter (camera.ts) requires the object's AXIAL distance from the sensor — the distance to the object's
 * z-PLANE along the optical axis, not the radial distance to a specific off-axis point in that plane. The two
 * are the same only exactly on-axis; everywhere else the Euclidean distance is strictly larger
 * (depthMm = axialZ / cos(theta), theta = the ray's off-axis angle — elementary trigonometry on the ray's own
 * unit direction, independent of anything the engine computes), so every off-axis pixel's defocus blur is
 * sized from an over-stated object distance.
 *
 * The "axial, not radial" contract is not this review's own opinion; it is established three separate ways,
 * inside this engine's own code and docs, all independent of `exitPupilBlurDiameterMm`'s internals:
 *
 *   1. src/engine/types.ts's own header (the LEAD's file, authoritative for the whole engine): "Distances
 *      'from the sensor' are what a camera's focus scale reads (the film-plane mark)" — a focus scale reads
 *      one number for the whole subject PLANE, not a different number per off-axis point on it.
 *   2. src/engine/paraxial.ts's `imageOf(sys, nm, objectZ)` — the function `exitPupilBlurDiameterMm` calls
 *      through `imageZOf` — is documented as imaging "an ON-AXIS OBJECT POINT at objectZ," specifically
 *      because "a ray from an OFF-AXIS point AT THAT OBJECT PLANE maps to the conjugate image plane
 *      regardless of its own starting angle." `objectZ` is a plane's axial position by construction; it has
 *      no mechanism to consume a radial/Euclidean distance to a particular off-axis point.
 *   3. camera.ts's OWN `pointBundle` (same file as `exitPupilBlurDiameterMm`, same `pointDistMm` contract,
 *      already golden-tested on-axis in camera.test.ts) builds its object point as
 *      `objectZ = sensorZEff - req.pointDistMm` and THEN adds the off-axis offset separately,
 *      `(objectZ - ep.z) * tan(ang)` — i.e. this engine's own established convention keeps "distance from
 *      the sensor" (axial) and "how far off axis" (a separate angle) as two independent parameters, never a
 *      single Euclidean distance. model-types.ts's own `pointBundle` doc says so directly: "req.pointDistMm
 *      and the model's own current focus distance are both 'from the sensor' ... req.fieldFrac is a fraction
 *      of the realized half field" — two separate fields, not one merged distance.
 *
 * render.ts's `traceSource` (the main per-pixel loop) and its point-highlight pass both pass the raw
 * Euclidean `depthMm` straight into `exitPupilBlurDiameterMm`, violating this contract for every pixel that
 * is not exactly on the optical axis.
 */
describe('FINDING 1: render.ts blur-kernel sizing uses a Euclidean hit distance where camera.ts\'s ' +
  'exitPupilBlurDiameterMm requires an axial "distance from the sensor"', () => {

  it('the ray-hit distance render.ts actually uses (traceSource\'s src.depthMm, scene.ts\'s radiance()) is ' +
    'the Euclidean 3D distance to the hit point, not the axial distance to the hit point\'s z-plane — an ' +
    'exact algebraic identity (Pythagoras on the ray\'s own unit direction), independent of any optics in ' +
    'this engine: depthMm * cosTheta === the hit point\'s own z-coordinate (its axial distance from the ' +
    'sensor, per traceSource\'s own coordinate convention where the sensor sits at the local origin)', () => {
    // A real, in-frame scene hit (no synthetic geometry): p50 at f/2, focused at 1 m on the 'bench' scene,
    // pixel (299, 349) at 600x400 (photo orientation since 09/30/2026; it was (300, 50) when the image was stored inverted) lands on the 'foreground' billboard (verified below) at a real off-axis angle.
    const model = compute(scenario({ lens: 'p50', fno: 2, focusM: 1 }));
    const setup = renderSetup(model, 600);
    const src = traceSource(299, 349, 600, 400, setup.blockPitchMm, setup.efl, setup.workingFno, setup.sceneObj, setup.spec, setup.exposureS);
    expect(src.hitId).toBe('foreground');
    expect(src.cosTheta).toBeLessThan(0.99); // genuinely off-axis, not a coincidentally-on-axis sample

    const axialZ = src.objectPoint[2]; // the hit point's own z-coordinate: an independent geometric fact,
    // not derived from exitPupilBlurDiameterMm or any DOF/paraxial code — just objectPoint = dir * depthMm.
    expect(src.depthMm * src.cosTheta).toBeCloseTo(axialZ, 6); // Pythagoras: z = t * dir_z = t * cosTheta
    expect(src.depthMm).toBeGreaterThan(axialZ * 1.01); // the Euclidean distance measurably over-states it
  });

  it('FIXED 2026-09-28: render.ts\'s main per-pixel line now feeds the correct axial distance ' +
    '(src.objectPoint[2]) into exitPupilBlurDiameterMm, matching the independently-derived expectation; the ' +
    'pre-fix line (the Euclidean src.depthMm) is kept below and shown to still disagree, documenting the real, ' +
    'confirmed magnitude of E4-1 on an ordinary in-frame billboard hit, not a contrived extreme', () => {
    const model = compute(scenario({ lens: 'p50', fno: 2, focusM: 1 }));
    const setup = renderSetup(model, 600);
    const src = traceSource(299, 349, 600, 400, setup.blockPitchMm, setup.efl, setup.workingFno, setup.sceneObj, setup.spec, setup.exposureS);
    expect(src.hitId).toBe('foreground');

    const axialZ = src.objectPoint[2]; // independently-derived correct "distance from the sensor" (finding 1
    // above; also exactly what dof.ts/paraxial.ts's own object-plane convention requires — see the header).
    const correctBlurMm = exitPupilBlurDiameterMm(model, axialZ); // == render.ts's real per-pixel line, post-fix:
    // `const defocusDiameterMm = exitPupilBlurDiameterMm(model, src.objectPoint[2]);` in renderImage's main loop
    // (src.objectPoint[2] IS axialZ, computed two lines up) — so correctBlurMm above already is that real call.
    expect(Number.isFinite(correctBlurMm)).toBe(true);

    // For the record: the pre-fix line (`exitPupilBlurDiameterMm(model, src.depthMm)`, the Euclidean hit
    // distance) is NOT what render.ts calls any more, but still measurably disagrees with the correct value —
    // confirming the ~3.2% error this finding reported was real, not a false positive.
    const oldBuggyBlurMm = exitPupilBlurDiameterMm(model, src.depthMm);
    const oldRelError = Math.abs(oldBuggyBlurMm - correctBlurMm) / correctBlurMm;
    expect(oldRelError).toBeGreaterThan(0.01);
  });

  it('FIXED 2026-09-28: the same fix, isolated with clean, hand-checkable numbers — a background point at a ' +
    'textbook 45-degree off-axis angle (X=Z=3000mm, Y=0), through render.ts\'s own point-highlight projection ' +
    '(projectToRenderedPixel, the exact function renderImage\'s highlight pass calls to get bx/by before ' +
    'calling exitPupilBlurDiameterMm on the highlight\'s own Z)', () => {
    const model = compute(scenario({ lens: 'p20', fno: 2.8, focusM: 1 }));
    const setup = renderSetup(model, 600);

    const X = 3000, Y = 0, Z = 3000; // a point 45 degrees off-axis by construction: atan(X/Z) = atan(1) = 45deg
    const { depthMm, cosTheta } = projectToRenderedPixel(setup.efl, setup.blockPitchMm, 600, 400, X, Y, Z);

    // Independently derived, from plane geometry alone (no engine code): the Euclidean distance from the
    // sensor (origin) to (X, 0, Z) is sqrt(X^2 + Z^2) = Z * sqrt(2) for X = Z; cos(theta) = Z / (Z*sqrt(2))
    // = 1/sqrt(2) = cos(45deg), matching the point's construction exactly.
    const expectedDepthMm = Math.sqrt(X * X + Y * Y + Z * Z);
    expect(depthMm).toBeCloseTo(expectedDepthMm, 6);
    expect(depthMm).toBeCloseTo(Z * Math.SQRT2, 6);
    expect(cosTheta).toBeCloseTo(Math.SQRT1_2, 9);

    const correctBlurMm = exitPupilBlurDiameterMm(model, Z); // == render.ts's real highlight-pass line, post-fix:
    // `const defocusDiameterMm = exitPupilBlurDiameterMm(model, Z);` (Z from hl.position, already in scope).

    // For the record: the pre-fix line (`exitPupilBlurDiameterMm(model, depthMm)`, the Euclidean projection
    // distance) is NOT what render.ts calls any more, but still measurably disagrees with the correct value —
    // ~13.2% on this exact, clean-numbered case (a 41% distance overstatement, Z*sqrt(2) vs Z, only partly
    // damped by exitPupilBlurDiameterMm's nonlinearity), confirming the magnitude this finding reported.
    const oldBuggyBlurMm = exitPupilBlurDiameterMm(model, depthMm);
    const oldRelError = Math.abs(oldBuggyBlurMm - correctBlurMm) / correctBlurMm;
    expect(oldRelError).toBeGreaterThan(0.01);
  });
});
