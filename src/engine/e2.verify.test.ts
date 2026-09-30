// Adversarial review findings for workstream E2 (engine/closed-form).
// Each test below encodes an independently-derived expected value (see the comment above it) and is run against
// the code under review, NOT against itself. Do not edit src/engine/{formats,thinlens,dof,diffraction,exposure}.ts
// from this file; it exists to prove findings, not to fix them.

import { describe, it, expect } from 'vitest';
import { imageDistance, objectDistance, objectDistanceFromMechanical } from './thinlens';
import { blurDiameter, dofLimits } from './dof';

describe('FINDING 1: dof.ts does not special-case focus = Infinity, unlike blurDiameter\'s own `point` parameter', () => {
  // types.ts's Scenario models infinity focus as `focusM: null` ("null = infinity"); there is no other numeric
  // convention for infinity focus anywhere in the engine, and blurDiameter itself already special-cases its
  // `point` argument for Infinity two lines away in the same function (`Number.isFinite(point) ? imageDistance(point, f) : f`).
  // A caller passing Infinity for `focus` (the natural translation of Scenario.focusM = null) hits
  // `imageDistance(Infinity, f)` = (Infinity*f)/(Infinity-f) = Infinity/Infinity = NaN (an indeterminate form,
  // NOT a graceful division-by-zero-to-Infinity the way e.g. objectDistance(f, f) is). That NaN propagates through
  // every computation that depends on vs, silently breaking a normal, explicitly-typed use case (landscape/astro:
  // "focus at infinity").

  it('blurDiameter(f, N, Infinity, point) should be finite (camera focused at infinity, checking blur of a closer point)', () => {
    const f = 50,
      N = 8,
      point = 2000;
    // Independent derivation: focused at infinity, the sensor sits at v = f exactly (the well-defined limit of
    // imageDistance(focus, f) as focus -> Infinity; verified numerically below to match the existing, correct,
    // finite-focus code path in the limit). A point at 2000 mm images at vp = imageDistance(2000, f) (thinlens.ts,
    // independently verified in thinlens.test.ts). blur = D * |vp - f| / vp, D = f/N.
    const vp = imageDistance(point, f); // = 50*2000/1950 = 51.282051282...
    const D = f / N; // 6.25
    const expectedBlur = (D * Math.abs(vp - f)) / vp; // = 0.15625 mm

    // Cross-check the "focused at infinity means vs -> f" premise itself, independently of blurDiameter, using
    // dofLimits' own vs = imageDistance(focus, f) at a very large but finite focus (the same large-finite-as-proxy-
    // for-infinity technique this suite's own blurDiameter/thinlens tests already use):
    const vsAtHugeFocus = imageDistance(1e12, f);
    expect(vsAtHugeFocus).toBeCloseTo(f, 6);

    const actual = blurDiameter(f, N, Infinity, point);
    expect(Number.isFinite(actual)).toBe(true); // FAILS: actual is NaN
    expect(actual).toBeCloseTo(expectedBlur, 6);
  });

  it('dofLimits(f, N, c, Infinity) should give a finite near limit and far = Infinity, not NaN across the board', () => {
    const f = 50,
      N = 8,
      c = 0.03;
    const D = f / N; // 6.25

    // Independent derivation: focused at infinity, vs = f. Every finite object distance images at vp > f (a real
    // object never images closer than f), so only the "near" branch of the blur equation applies:
    //   c = D (vp - f) / vp  =>  vp (D - c) = D f  =>  vp = D f / (D - c)
    // then near = objectDistance(vp, f). With f=50, N=8, c=0.03: D=6.25, vp = 6.25*50/(6.25-0.03) = 312.5/6.22
    //   = 50.241157556... mm; near = vp*50/(vp-50) = 10416.6667 mm exactly (= f^2/(N*c), coincidentally also
    //   equal to hyperfocal(f,N,c) - f).
    const vp = (D * f) / (D - c);
    const expectedNear = objectDistance(vp, f);
    expect(expectedNear).toBeCloseTo(10416.6667, 3);

    // Cross-check the closed form against the existing (correct, finite-focus) code path taken to a huge focus
    // distance, confirming convergence to the same value independently of the Infinity special-case in question:
    const nearAtHugeFocus = dofLimits(f, N, c, 1e12).near;
    expect(nearAtHugeFocus).toBeCloseTo(expectedNear, 1);

    const limits = dofLimits(f, N, c, Infinity);
    expect(limits.far).toBe(Infinity); // FAILS: far is NaN, not Infinity
    expect(Number.isFinite(limits.near)).toBe(true); // FAILS: near is NaN
    expect(limits.near).toBeCloseTo(expectedNear, 2);
  });
});

describe('FINDING 2: objectDistanceFromMechanical, below the minimum conjugate distance (D < 4f), returns a root that does not satisfy 1/u + 1/v = 1/f', () => {
  // thinlens.test.ts previously documented and tested that this case "clamps to the double root rather than going
  // complex/NaN" and asserted the clamped value equals (D+0)/2 - i.e. the clamp itself was intentional. But the
  // clamped (u, v) pair is not a degenerate-but-valid answer: it actively fails the Gaussian conjugate equation
  // this function exists to invert, silently (no NaN, no throw, no flag on the result), for a very ordinary
  // real-world case explicitly named in this review's brief: focusing closer than a lens's minimum focus distance
  // (D = T - interstitium < 4f is exactly "the requested mechanical distance is inside minimum focus"). CONFIRMED
  // REAL and fixed: objectDistanceFromMechanical now returns NaN when D < 4f (thinlens.ts).
  //
  // Correction to the reviewer's own proposed check: the reviewer's original assertion computed v as
  // `totalDistance - u` (this module's own u + v = D relation) and then checked 1/u + 1/v ~= 1/f. That specific
  // check can never pass for ANY return value at D < 4f, correct or not - it is not implementation slack, it is
  // the same fact that makes the discriminant negative. Solving u + v = D and 1/u + 1/v = 1/f simultaneously
  // means solving u^2 - Du + Df = 0 (thinlens.ts's own derivation comment); its discriminant is D^2 - 4Df, exactly
  // what `disc < 0` tests. So "D < 4f" and "no real (u, v) satisfies both equations at this D" are the same
  // statement - re-derived independently here with the quadratic formula (D=180, f=60: disc = 180^2-4*180*60 =
  // 32400-43200 = -10800 < 0, confirmed with node), not assumed from the implementation. The reviewer's own
  // evidence text anticipates this ("a correct... result would either satisfy this... or be NaN/throw to signal
  // infeasibility") - this test now checks for that NaN signal instead of the unsatisfiable identity.
  it('signals infeasibility (NaN) rather than returning a pair that silently fails 1/u + 1/v = 1/f when D < 4f', () => {
    const f = 60;
    const totalDistance = 3 * f; // D = 180 mm, below the 4f = 240 mm minimum: no real object/image conjugate exists

    // Independent re-derivation that D < 4f really is infeasible (not just "this implementation can't do it"):
    // u^2 - Du + Df = 0 has discriminant D^2 - 4Df; real roots require that to be >= 0, i.e. D >= 4f.
    const D = totalDistance;
    const disc = D * D - 4 * D * f;
    expect(disc).toBeLessThan(0); // -10800: confirms no real (u, v) pair can exist for this input at all

    const u = objectDistanceFromMechanical(totalDistance, f, 0);
    expect(Number.isNaN(u)).toBe(true); // the honest signal the reviewer's own evidence calls for

    // The previous (pre-fix) behavior, for the record: clamping to (D+0)/2 = 90 gave 1/u+1/v = 2/90 = 0.022222
    // against 1/f = 0.016667 - about 33% off, silently. That is what made the old behavior a real defect.
    const oldClampedU = D / 2;
    const oldClampedV = D - oldClampedU;
    const lhs = 1 / oldClampedU + 1 / oldClampedV;
    const rhs = 1 / f;
    expect(Math.abs(lhs - rhs)).toBeGreaterThan(1e-3); // documents the ~33% error the old clamp silently produced
  });
});
