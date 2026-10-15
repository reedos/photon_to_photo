// Physical edges for the realized clear apertures (R-L6 / LF-03, the 10/11/2026 aperture review).
//
// realize.ts sizes each surface's clear semi-diameter (sd) from the real rays the lens must pass. Nothing in that
// survey knows that glass is a solid: on about 50 element/neighbor pairs across the 20 lenses the surveyed sd ran
// past the radius where an element's front and rear surfaces meet (p105's L3 by 7 mm), or past the radius where
// one element's glass would run into its neighbor's (s35 L1/L2 by 3.3 mm). A real lens cannot have that glass, so
// this step caps the sds to the largest values a physical lens could hold, after the survey and before anything
// traces or draws the lens. The prescription (data/lenses/*.json) is not touched: the cap is derived.
//
// The glass model is the one blender/lens_v2.py draws: an element is a solid of revolution whose rim radius is the
// larger of its surfaces' sds; each surface follows its prescription out to its own sd and is flat-ground (constant
// sag) from there to the rim. Two rules, both checked at infinity focus and at the closest focus (focus groups move
// the air gaps; an element's own thickness never changes):
//
// 1. Edge thickness. Inside each element (and each plate), the glass between its first and last surface is at
//    least MIN_EDGE_MM thick at every radius out to the rim. The interfaces of a resin layer laminated inside an
//    element only have to stay in order (no negative layer thickness).
// 2. Neighbor clearance. Where two elements both have glass at the same radius, the air between them is at least
//    MIN_AIR_MM, never more than the prescription's own axial gap (n500's first two elements are 0.05 mm apart on
//    the axis). A cemented pair shares its interface and only must not overlap. Every pair is checked, not only
//    adjacent ones, so a steep meniscus cannot reach past a smaller neighbor into the next element.
//
// Where a rule fails, the radius it first fails at (found by bisection) becomes the cap. For an edge, every surface
// of that element is capped there. For a neighbor clash, the element with the smaller rim is capped (it loses less
// radius), the same choice blender/lens_v2.py's resolve_neighbors made. Caps can interact (capping one surface of a
// cemented interface changes its partner's profile), so the rules repeat until nothing changes. Every cap is
// returned with its before and after value; realize.ts records them in Realization.capped.
//
// The stop must keep setting the f-number. So a cap never goes below the height the on-axis, full-aperture
// bundle reaches on that element (realize.ts passes it in), as long as the glass there is still physical: edge
// thickness >= 0 and no overlap with the neighbor. Only the assumed minimums give way, and the surface is marked
// `relaxed`. On 10/11/2026 that happens on three lenses, none in the lineup: p105 (L3's edge, and L12 against
// L13), p135 (L4 against L3) and p20 (L15 against L14 at the closest focus). If even a knife edge could not hold
// the axial bundle the physical limit would win and the surface would be marked `axialCut` (one is: p105's L11 against
// L13 at its closest focus, 7 um short of the marginal ray, since the autofocus shift moved its focus group 0.13 mm
// further on 10/12/2026).
//
// MIN_EDGE_MM = 0.5 is ASSUMED. Optical shops quote about 1 mm (or 3 to 5 percent of the diameter) as a comfortable
// edge for a ground and chamfered element and treat 0.5 mm as the practical minimum, below which the edge chips
// during centering and the 45-degree protective bevel eats the whole edge (Fischer, Tadic-Galeb and Yoder, Optical
// System Design, 2nd ed., ch. 18; Kingslake and Johnson, Lens Design Fundamentals, 2nd ed., sec. 9.1). The minimum
// is used here because the patents' designs are tight and real fast primes do run thin edges; a larger value
// would cap more glass than a real maker would. MIN_AIR_MM = 0.1 is ASSUMED too: a spacer or edge-contact seat
// needs some air between ground rims; it matches the Blender model's clearance.
//
// Evidence: derived (geometry of the prescription and the realized sds), with the two minimums assumed.

import type { ResolvedLens } from './lens';
import type { TraceSystem } from './types';
import { sag } from './surface';

export const MIN_EDGE_MM = 0.5; // assumed, see above
export const MIN_AIR_MM = 0.1;  // assumed, see above
/** How far inside the bisected limit a cap is set (mm), so a check that samples the same profile never sees a
 *  rounding-level violation at the rim. */
const CAP_SAFETY_MM = 1e-3;

export interface CappedSurface {
  surface: number;          // index into ResolvedLens.raw
  element: number | null;   // the element (1-based) the surface belongs to, null for a plate
  before: number;           // sd from the clear-aperture survey (mm)
  after: number;            // sd after the cap (mm)
  rule: 'edge' | 'neighbor';
  reason: string;
  axialNeed: number;        // height of the on-axis, full-aperture bundle on this surface (mm); 0 if not given
  relaxed: boolean;         // the cap stopped at axialNeed, short of the assumed minimum edge or air
  axialCut: boolean;        // not even a knife edge or touching glass holds the axial bundle: the cap cuts it
}

interface Body {
  element: number | null;   // element index, or null for a plate
  label: string;
  surfaces: number[];       // every surface of the body, front to back
}

function bodiesOf(lens: ResolvedLens): Body[] {
  const out: Body[] = [];
  for (const e of lens.elements) {
    const s: number[] = [];
    for (let i = e.surfaces[0]; i <= e.surfaces[1]; i++) s.push(i);
    out.push({ element: e.index, label: `element ${e.index}`, surfaces: s });
  }
  for (const p of lens.plates) out.push({ element: null, label: `${p.kind} plate`, surfaces: [p.surfaces[0], p.surfaces[1]] });
  return out.sort((a, b) => a.surfaces[0] - b.surfaces[0]);
}

/** The z of surface s's glass at radius r: its prescription out to its sd, flat-ground beyond. */
function zAt(sys: TraceSystem, sd: number[], s: number, r: number): number {
  const surf = sys.surfaces[s];
  return surf.z + sag(surf, Math.min(r, sd[s]));
}

function rimOf(b: Body, sd: number[]): number {
  return Math.max(...b.surfaces.map((s) => sd[s]));
}

/** The first radius in [0, rMax] at which f(r) < need, found by a 400-step scan and then bisection, or null. */
function firstFailure(f: (r: number) => number, need: number, rMax: number): number | null {
  const N = 400;
  let prev = 0;
  for (let k = 0; k <= N; k++) {
    const r = (rMax * k) / N;
    if (f(r) < need) {
      if (k === 0) return 0;
      let lo = prev, hi = r;
      for (let it = 0; it < 60; it++) {
        const mid = (lo + hi) / 2;
        if (f(mid) < need) hi = mid; else lo = mid;
      }
      return lo;
    }
    prev = r;
  }
  return null;
}

/**
 * Caps the surveyed clear semi-diameters `sdIn` (indexed like lens.raw) so every element has a physical edge and
 * clears its neighbors, in each of the given systems (the same lens at different focus positions).
 *
 * `axialNeed[s]` is the height the on-axis, full-aperture bundle reaches on surface s (any focus, F/d/C). A cap
 * never goes below it as long as the glass there is still physical (edge thickness >= 0, no overlap with the
 * neighbor): only the assumed minimums are relaxed, so the stop keeps setting the f-number, and the surface is
 * marked `relaxed`. If even that is impossible (the prescription's own glass crosses inside the axial bundle), the
 * physical limit wins and the surface is marked `axialCut`: that lens can no longer reach its stated f-number.
 *
 * Returns the capped sds and one record per surface that changed.
 */
export function capToPhysicalEdges(lens: ResolvedLens, systems: TraceSystem[], sdIn: number[], axialNeed?: number[], axialMarginMm = 0): {
  sd: number[]; capped: CappedSurface[];
} {
  const sd = sdIn.slice();
  const need0 = axialNeed ?? sdIn.map(() => 0);
  const floor = need0.map((h) => (h > 0 ? h + axialMarginMm : 0));
  const bodies = bodiesOf(lens);
  const last = new Map<number, { rule: CappedSurface['rule']; reason: string; relaxed: boolean }>();
  /** Caps every surface of b at rStrict (where the assumed minimum still holds) or, where the axial bundle needs
   *  more, at that need as long as it stays inside rHard (the glass is still physical). Returns whether it changed. */
  const capBody = (b: Body, rStrict: number, rHard: number, rule: CappedSurface['rule'], reason: string): boolean => {
    let changed = false;
    const strict = Math.max(0, rStrict - CAP_SAFETY_MM), hard = Math.max(0, rHard - CAP_SAFETY_MM);
    // one floor for the whole body, its widest axial need: an element is one piece of glass, and flat-grinding one
    // surface inside the rim another surface needs would only bring the glass closer to its neighbor
    const bodyFloor = Math.max(...b.surfaces.map((s) => floor[s]));
    for (const s of b.surfaces) {
      const cap = Math.max(strict, Math.min(bodyFloor, hard));
      if (sd[s] > cap + 1e-9) {
        sd[s] = cap;
        last.set(s, { rule, reason, relaxed: cap > strict + 1e-9 });
        changed = true;
      }
    }
    return changed;
  };

  for (let pass = 0; pass < 8 * bodies.length + 8; pass++) {
    let changed = false;
    for (const sys of systems) {
      // (1) edge thickness inside each body
      for (const b of bodies) {
        const f = b.surfaces[0], k = b.surfaces[b.surfaces.length - 1];
        const rim = rimOf(b, sd);
        const thick = (r: number) => zAt(sys, sd, k, r) - zAt(sys, sd, f, r);
        // (a body thinner than MIN_EDGE_MM on the axis, a thin plate say, only has to stay that thick)
        const r1 = firstFailure(thick, Math.min(MIN_EDGE_MM, thick(0) - 1e-4), rim);
        if (r1 !== null) {
          const hard = firstFailure(thick, 0, rim) ?? Infinity; // no crossing inside the rim: no physical limit
          if (capBody(b, r1, hard, 'edge', `its surfaces come within ${MIN_EDGE_MM} mm of each other at the rim (edge thickness)`)) changed = true;
        }
        for (let j = 0; b.surfaces.length > 2 && j + 1 < b.surfaces.length; j++) {
          const s0 = b.surfaces[j], s1 = b.surfaces[j + 1];
          const layer = (r: number) => zAt(sys, sd, s1, r) - zAt(sys, sd, s0, r);
          const r2 = firstFailure(layer, -1e-4, rimOf(b, sd));
          if (r2 !== null && capBody(b, r2, r2, 'edge', `a laminated layer between surfaces ${s0} and ${s1} would turn negative`)) changed = true;
        }
      }
      // (2) clearance between every pair of bodies
      for (let i = 0; i < bodies.length; i++) {
        for (let j = i + 1; j < bodies.length; j++) {
          const a = bodies[i], b = bodies[j];
          const back = a.surfaces[a.surfaces.length - 1], front = b.surfaces[0];
          if (back === front) continue; // a cemented pair: one shared surface, the gap is zero by construction
          const gap = (r: number) => zAt(sys, sd, front, r) - zAt(sys, sd, back, r);
          const g0 = gap(0);
          const rMax = Math.min(rimOf(a, sd), rimOf(b, sd));
          const r = firstFailure(gap, Math.min(MIN_AIR_MM, g0 - 1e-4), rMax);
          if (r !== null) {
            const hard = firstFailure(gap, Math.min(0, g0) - 1e-4, rMax) ?? Infinity;
            const loser = rimOf(a, sd) <= rimOf(b, sd) ? a : b;
            const other = loser === a ? b : a;
            if (capBody(loser, r, hard, 'neighbor', `its glass would come within ${MIN_AIR_MM} mm of ${other.label}'s`)) changed = true;
          }
        }
      }
    }
    if (!changed) break;
  }

  const elementOf = new Map<number, number | null>();
  for (const b of bodies) for (const s of b.surfaces) if (!elementOf.has(s)) elementOf.set(s, b.element);
  const capped: CappedSurface[] = [];
  for (const [s, why] of [...last.entries()].sort((x, y) => x[0] - y[0])) {
    const need = need0[s] ?? 0;
    capped.push({
      surface: s, element: elementOf.get(s) ?? null, before: sdIn[s], after: sd[s], rule: why.rule, reason: why.reason,
      axialNeed: need, relaxed: why.relaxed, axialCut: sd[s] < need - 1e-9,
    });
  }
  return { sd, capped };
}
