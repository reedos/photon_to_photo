// Focus travel: maps a lens's real focus solve (systemAt's own internal parameter -- t in [0,1] for a
// variable-gap focus method, or the unit-focus extension e in mm) onto the [0,1] range PANE.md's distance
// scale needs: t(infinity) = 0, t(closest focus) = 1. Used by src/scene/lens-exterior.ts to place the
// engraved distance-scale marks and to rotate the focus ring by an assumed representative throw angle.
//
// Rather than reach into lens.ts's private Newton solve (buildSurfaces/solveNewton are not exported, and
// duplicating that solver here would be a second place to keep in sync with it), this recovers the SAME
// parameter externally from systemAt's own output, which is already exported and already exact. Both of
// systemAt's focus methods move every non-image surface by an amount that is an AFFINE function of the
// internal parameter (gap method: z_i(t) = z_i(0) + t * delta_i, since overrideMap interpolates linearly
// between g.atInfinity and g.atClose; unit method: z_i(e) = z_i(0) - e for every non-image surface, the whole
// barrel shifting by the extension). So the Euclidean norm of the surface-z differences from the infinity
// system, `norm(d) = sqrt(sum_i (z_i(d) - z_i(inf))^2)`, is EXACTLY `|t(d)| * sqrt(sum_i delta_i^2)` for the
// gap method (a positive constant times t) and exactly `|e(d)| * sqrt(surfaceCount)` for the unit method --
// in both cases a fixed positive multiple of the lens's own internal solved parameter. Normalizing by the
// same norm at the closest focus therefore reproduces systemAt's own t (or e, ratio-normalized) exactly:
//   t(d) = norm(d) / norm(closestFocusMm),  t(infinity) = 0 by construction,  t(closestFocusMm) = 1.
// Evidence: derived, exact for both of systemAt's focus methods (not an approximation) -- see the affine
// argument above.

import type { RealizedLens } from './realize';
import { systemAt } from './lens';
import type { TraceSystem } from './types';

/** Euclidean norm of the per-surface z displacement between two systems built from the same lens, excluding
 *  the final (image/sensor) surface, which systemAt always pins to the fixed sensor plane regardless of focus. */
function surfaceZDeltaNorm(a: TraceSystem, b: TraceSystem): number {
  let sum = 0;
  const n = Math.min(a.surfaces.length, b.surfaces.length) - 1; // exclude the image surface
  for (let i = 0; i < n; i++) {
    const d = b.surfaces[i].z - a.surfaces[i].z;
    sum += d * d;
  }
  return Math.sqrt(sum);
}

/**
 * The system at the design's own gap-table close-focus condition, set DIRECTLY (the gap surfaces' raw
 * thickness pinned to `atClose`, exactly realize.ts's own `at1` construction) rather than by asking
 * systemAt() to solve for a target distance. This matters: systemAt's Newton solve, asked for a target
 * distance-from-sensor that sits right at (or past) the edge of what a design's transcribed focus.gaps table
 * can actually reach, can converge to a raw t outside [0,1] and clamp to the WRONG end (0, "no movement",
 * instead of 1) if the solve's sign happens to diverge that way for a particular gap-table transcription --
 * observed directly for n50 (data/lenses/n50.json's rear-focus gap table reaches a real close condition at
 * ~1.7m object distance, patent's own R convention; the product's spec'd 0.45m minimum focus, which
 * realize.ts's own "the larger of the two" rule keeps as the exposed closestFocusMm, is well past what the
 * transcribed gap table was ever fit to reach). Pinning the gaps to their atClose value directly sidesteps
 * that solve pathology entirely, the same way realize.ts's own closest-focus reachability check already does.
 * For a 'unit' focus method (no gaps table at all), there is no atClose gap to pin, so this falls back to the
 * ordinary solve at the design's own closestFocusMm, which has no analogous domain-edge pathology (the unit
 * extension solve is unbounded and monotonic, not clamped into [0,1]).
 */
export function closestFocusSystem(realized: RealizedLens): TraceSystem {
  const design = realized.design;
  const gaps = design.focus.gaps ?? [];
  // a design that extrapolates its table (focus.extrapolate) reaches its true closest focus past t = 1: solve it
  if (design.focus.extrapolate) return systemAt(realized, realized.realization.closestFocusMm, { clamp: true });
  if (design.focus.method !== 'unit' && gaps.length > 0) {
    const scale = design.scale;
    const pinned = {
      ...realized,
      raw: realized.raw.map((r, i) => {
        const g = gaps.find((gg) => gg.surface === i);
        return g ? { ...r, t: g.atClose * scale } : r;
      }),
    };
    return systemAt(pinned, null);
  }
  return systemAt(realized, realized.realization.closestFocusMm, { clamp: true });
}

/**
 * The lens's own solved focus parameter, normalized to [0, 1]: 0 at infinity, 1 at the design's own gap-table
 * close-focus condition (see closestFocusSystem above -- not always numerically identical to
 * realized.realization.closestFocusMm's own solve for the reason documented there, but the same physical
 * extreme). `distanceMm` is measured from the sensor, the same convention every Scenario/focus field in the
 * engine uses; `null` means infinity (t = 0).
 */
export function focusParameterT(realized: RealizedLens, distanceMm: number | null): number {
  if (distanceMm === null) return 0;
  const sysInf = systemAt(realized, null);
  const closestMm = realized.realization.closestFocusMm;
  const sysClosest = closestFocusSystem(realized);
  const denom = surfaceZDeltaNorm(sysInf, sysClosest);
  if (denom < 1e-9) return 0; // no surface moves with focus (shouldn't happen for a real design; guards div by 0)
  // Distances farther than closestMm (but less than infinity) give t < 1; a request AT or closer than
  // closestMm clamps to the closest-focus system built above, t = 1, matching systemAt's own opts.clamp
  // behavior for compute()'s scenario handling (and sidestepping the same solve-domain edge for a target
  // distance right at closestMm that motivated pinning the gaps directly above).
  const sysD = distanceMm <= closestMm ? sysClosest : systemAt(realized, distanceMm, { clamp: true });
  const t = surfaceZDeltaNorm(sysInf, sysD) / denom;
  return Math.max(0, Math.min(1, t));
}

/**
 * An assumed representative full focus-ring throw angle (infinity to closest focus), per lens, in degrees.
 * No maker publishes this figure for any of the seven lineup lenses (checked in research/exteriors.md and
 * its 09/28/2026 addendum); these are round, representative values informed by the lens's own focus
 * mechanism -- a longer throw for a manually-clutched AF ring (more precise manual override), a shorter one
 * for a focus-by-wire mirrorless ring (which the camera can map to whatever range it likes, and mirrorless
 * makers commonly tune shorter for speed). Evidence: assumed, every entry.
 */
export const ASSUMED_FOCUS_THROW_DEG: Record<string, number> = {
  s35: 100, // Sigma Art AF prime, mechanically coupled ring
  n50: 80, // Nikon G-type AF prime, short throw typical of a compact 50mm
  n500: 90, // AF-S PF super-telephoto, internal focus
  n500fl: 100, // AF-S FL super-telephoto, internal focus
  z35: 60, // Z-mount S-line, focus-by-wire
  m50: 60, // Z-mount S-line, focus-by-wire
  z800: 70, // Z-mount S-line super-telephoto, focus-by-wire
};

/** `throwDeg` for a lens id, falling back to a generic 80 deg for any id not in the assumed table above. */
export function assumedThrowDeg(lensId: string): number {
  return ASSUMED_FOCUS_THROW_DEG[lensId] ?? 80;
}

/** The focus ring's rotation (radians) for a given focus distance: throw * t(d), t from focusParameterT. */
export function focusRingAngleRad(realized: RealizedLens, distanceMm: number | null, lensId: string): number {
  const t = focusParameterT(realized, distanceMm);
  const throwDeg = assumedThrowDeg(lensId);
  return (throwDeg * t * Math.PI) / 180;
}

/** Inverse: given a ring angle (radians, 0 at infinity), the fraction t in [0,1] it represents. Used by the
 *  on-model drag hit-test (lens-exterior.ts's dragToFocus) to go from a pointer drag back to t, then to a
 *  focus distance via the caller's own distance-from-t search (monotonic but not analytically invertible in
 *  general, since t(d) depends on the lens's real optics, not a closed form). */
export function ringAngleToT(angleRad: number, lensId: string): number {
  const throwRad = (assumedThrowDeg(lensId) * Math.PI) / 180;
  if (throwRad <= 0) return 0;
  return Math.max(0, Math.min(1, angleRad / throwRad));
}
