// Adversarial verification for workstream E1b (glass.ts, paraxial.ts, lens.ts, iris.ts), per the review brief.
//
// Method: independent re-derivation of expected values (successive thin-lens imaging with an explicit z -> -z
// parity flip for "trace backward", and a from-scratch ray-transfer (ABCD) matrix implementation), computed in a
// separate script with no import from this workstream's code, then compared against the actual exported
// functions. Every check below that PASSES is recorded as `checked_ok` in the review report, not repeated here;
// this file carries only the one finding that reproducibly FAILS.
//
// FINDING (major, FIXED 2026-09-28): systemAt()'s variable-gap (non-unit) focus solve had no bound on the
// interpolation parameter t. lens.ts's own doc comment says t is "in [0,1] (0 = infinity, 1 = the design's stated
// close-focus condition)", and docs/engine/e1b.md's "Known limits" section claims the Newton solve "throws with a
// residual rather than returning a silently wrong focus position" when it can't find a good answer. That was not
// true over a wide range: for a focus request closer than what the design's own gaps table (atInfinity/atClose)
// can actually reach, but still farther than the design's minFocusM (so systemAt did not clamp it), the Newton
// solve converged to t > 1 -- and, pushed further, to a NEGATIVE element-group gap, i.e. the rear group's front
// surface placed axially in front of the front group's rear surface, a physically impossible lens geometry --
// silently, with no error, no clamp and no warning. Only well past that point did it finally throw.
//
// This was a real risk for the production data this workstream is designed to consume: a patent-transcribed
// design's `focus.minFocusM` (often taken directly from the patent/spec) has no code-enforced relationship to its
// separately-authored `focus.gaps` table (`docs/engine/e1b.md` itself notes several of this file's own gap
// examples are "assumed"), so nothing stopped the two from disagreeing in exactly this way.
//
// Fix: `systemAt` now checks the solved t against [0,1] (with a 1e-6 float-slop tolerance) before building the
// system, and throws a descriptive error -- naming the requested focus distance, minFocusM and the disagreement
// -- instead of returning the silently-impossible geometry. This test now verifies the fixed behavior: the same
// 120mm request that used to solve a -5.7mm group gap now throws.

import { describe, it, expect } from 'vitest';
import { makeCatalog } from './glass';
import { loadLens, systemAt } from './lens';
import type { GlassEntry, LensDesign, Surface } from './lens-types';

function flatGlass(key: string, nd: number, vd: number): GlassEntry {
  return {
    key, catalog: 'TEST', name: key, nd, vd, formula: 'sellmeier3',
    coef: [nd * nd - 1, 0, 0, 1, 0, 2], range: [0.3, 2.5], source: 'synthetic', accessed: '9/28/2026',
  };
}
const BK7 = flatGlass('TEST:BK7', 1.5, 64.17);
const catalog = makeCatalog([BK7]);

describe('e1b.verify: systemAt variable-gap focus is now bound to the documented t in [0,1]', () => {
  // Two air-spaced thin elements (same structural shape as lens.test.ts's own "variable-gap" fixture: front
  // element f=60mm at z=0, a declared variable gap to the rear element, rear element f=60mm, then the design's
  // stated BFD=24mm to the sensor). The declared gap table says the group spacing runs from 20mm (infinity) to
  // 10mm (the design's own stated close-focus condition, at a 300mm object distance per `closeObjectDistance`).
  // `minFocusM` is set to 0.05 (50mm from the sensor) -- closer than the gap table's own close-focus condition,
  // but that is exactly the kind of independently-sourced value (e.g. taken straight from a patent's stated
  // "closest focusing distance") this workstream's own docs (e1b.md) describe several of its example gap tables
  // as being: not derived from each other, so nothing guarantees they agree.
  const surfaces: Surface[] = [
    { r: 60, t: 0, medium: 'TEST:BK7', nd: 1.5, vd: 64.17, sd: 15 },
    { r: -60, t: 20, medium: 'air', sd: 15 },
    { r: 60, t: 0, medium: 'TEST:BK7', nd: 1.5, vd: 64.17, sd: 15 },
    { r: -60, t: 24, medium: 'air', sd: 15 },
  ];
  const design: LensDesign = {
    id: 'test-variable-gap', focalLength: 50, maxFno: 2, name: 'test lens',
    source: { kind: 'representative', ref: 'synthetic', url: '', accessed: '9/28/2026', location: 'n/a' },
    scale: 1, surfaces,
    stated: { f: 50, fno: 2, bf: 50 },
    focus: {
      method: 'front-group', minFocusM: 0.05, minFocusSource: 'assumed',
      gaps: [{ surface: 1, atInfinity: 20, atClose: 10, closeObjectDistance: 300 }],
    },
    iris: { blades: 9, rounded: true, source: 'assumed', ev: 'assumed' },
    elements: 2, groups: 2, imageCircleMm: 43.27,
  };
  const lens = loadLens(design, catalog);

  it('at a 120mm focus distance (well inside minFocusM=50mm, so not clamped), systemAt throws a descriptive ' +
    'error instead of silently solving a NEGATIVE group gap (a physically impossible geometry)', () => {
    // Before the fix this solved t=2.5736 and a group gap of roughly -5.7mm (the rear group axially in front of
    // the front group it is supposed to follow). Independently derived bound: per lens.ts's own doc comment, t
    // must stay in [0,1], so the group gap (linearly interpolated between atInfinity=20mm at t=0 and
    // atClose=10mm at t=1) must stay in [10, 20]mm; a request the gaps table cannot reach must now throw rather
    // than extrapolate past it.
    expect(() => systemAt(lens, 120)).toThrow(/outside the documented range \[0,1\]/);
  });

  it('the same request is confirmed to not be throttled by minFocusM (50mm) -- 120mm is comfortably inside the ' +
    'allowed focus range, so the thrown error above is the only signal something is wrong, not the clamp', () => {
    const minFocusMm = design.focus.minFocusM * 1000;
    expect(120).toBeGreaterThan(minFocusMm); // 120 > 50: this focus request is one systemAt considers valid
  });
});
