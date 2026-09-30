// Depth of field: hyperfocal distance, near/far limits, and the image-side defocus blur diameter of an arbitrary
// point, thin-lens and pupil-magnification-corrected. Workstream E2 (engine/closed-form). See docs/engine/e2.md.
//
// Distance convention: `focus` and `point` below are object distances in the positive-distance photographic
// convention of thinlens.ts. For the plain (pupilMag = 1) formulas, treat them as measured from the front
// principal plane (exact for a thin lens; the usual photographic approximation for a real one). When correcting
// for pupil magnification (pupilMag != 1), the physically correct reference for these same distances is the
// entrance pupil, not the front principal plane - it is the entrance pupil's size and position that set the cone
// of light an off-axis or defocused point sends into the lens. This module does not have the entrance pupil's own
// offset from the front principal plane (that is E1b's Cardinal.ep, from an actual traced system); a caller
// combining this with a real lens should pass distances measured from Cardinal.ep.z. The pupilMag = 1 default
// treats the two references as coincident, which is exact for a thin lens and the standard approximation
// otherwise (H. H. Nasse, "Depth of Field and Bokeh", Zeiss Camera Lens News 2010, frames pupil-magnification
// corrections the same way: relative to the entrance pupil).

import type { Format } from './types';
import { imageDistance, objectDistance } from './thinlens';

// ---- circle of confusion --------------------------------------------------------------------------------------
/**
 * The circle of confusion (mm) conventionally used as the "acceptably sharp" blur-disk diameter for a format,
 * as format diagonal / `divisor`. THIS IS AN ASSUMPTION, not a physical constant - evidence kind 'assumed'.
 * Origin: the diagonal/N convention comes from a fixed-viewing-angle heuristic (a print of some standard size
 * viewed from a standard distance, or an equivalent on-screen viewing angle, so that a coarser sensor's
 * larger native blur disk is judged against the same final-image angular blur). Divisors of 1000 (stricter,
 * "critical" sharpness), 1442-1500 (typical "acceptable" prints/screens) and 1730 (looser, Zeiss's older
 * convention) all appear in circulation; 1500 is the modern default most DOF calculators (e.g. DOFMaster,
 * PhotoPills) ship with, which is why it is this function's default. Callers who want a different print/viewing
 * assumption pass a different divisor.
 */
export function cocFor(format: Format, divisor: number = 1500): number {
  return format.diag / divisor;
}

// ---- defocus blur diameter -------------------------------------------------------------------------------------
/**
 * The image-side blur-disk diameter (mm) that a point at object distance `point` produces on the sensor when the
 * lens (focal length f, mm; f-number N; positive-distance convention) is focused at `focus`. `point` may be
 * `Infinity` for a point at infinity.
 *
 * Derivation (thin lens, pupilMag = 1): a point at distance p converges to an image at distance v_p = imageDistance
 * (p, f) from the rear principal plane. If the sensor sits at the focus conjugate v_s = imageDistance(focus, f)
 * instead, the cone of light from the entrance pupil (diameter D = f/N) has been cut by similar triangles at
 * fraction |v_p - v_s| / v_p of its way to the apex at v_p, so the blur-disk diameter is
 *   blur = D * |v_p - v_s| / v_p
 * This is the standard geometric defocus-blur derivation (see e.g. Ray, S. F., "Applied Photographic Optics",
 * 3rd ed., ch. 10, or Kingslake, "Optics in Photography", ch. 6); re-derived here so it is guaranteed consistent
 * with `hyperfocal`/`dofLimits` below, which invert exactly this relation.
 *
 * Pupil-magnification correction: after the lens, the cone that actually converges toward the image is bounded by
 * the EXIT pupil, not the entrance pupil. Modeling the exit pupil as a simple scaled copy of the entrance pupil
 * (diameter D_exit = pupilMag * D, per Cardinal.pupilMag = xp.r / ep.r in src/engine/types.ts) and using the same
 * image-side distances gives
 *   blur = pupilMag * D * |v_p - v_s| / v_p
 * This ignores the (usually small, relative to typical defocus distances) axial offset between the rear principal
 * plane and the actual exit pupil; see the module doc above for when that matters.
 *
 * `focus` may also be `Infinity` (camera focused at infinity - the natural translation of Scenario.focusM = null
 * in src/engine/types.ts). imageDistance(Infinity, f) is the indeterminate form Infinity/Infinity, so that case is
 * special-cased directly to its well-defined limit v_s -> f as focus -> Infinity (same limit `point` already uses
 * below), rather than routed through imageDistance.
 */
export function blurDiameter(f: number, N: number, focus: number, point: number, pupilMag: number = 1): number {
  const D = (f / N) * pupilMag;
  const vs = Number.isFinite(focus) ? imageDistance(focus, f) : f; // focused at infinity: sensor sits at v = f
  const vp = Number.isFinite(point) ? imageDistance(point, f) : f; // a point at infinity images at v = f
  return (D * Math.abs(vp - vs)) / vp;
}

// ---- hyperfocal distance and near/far limits ---------------------------------------------------------------------
/**
 * Hyperfocal distance H (mm): the focus distance beyond which everything out to infinity is within the permissible
 * circle of confusion c (mm), for focal length f (mm) and f-number N.
 *
 * Derivation: set `blurDiameter(f, N, H, Infinity, pupilMag)` = c and solve for H. With D = (f/N)*pupilMag,
 * v_H = imageDistance(H, f):
 *   c = D (v_H - f) / f   =>   v_H = f + cf/D
 * Substituting v_H = fH/(H-f) and solving the resulting linear equation in H gives the closed form
 *   H = f^2 / (N_eff * c) + f,   N_eff = N / pupilMag
 * which is the classic hyperfocal formula (with N replaced by N_eff when pupilMag != 1) - see e.g. Ray, "Applied
 * Photographic Optics", ch. 10. Verified against the golden case 50 mm f/8 c = 0.03 mm -> H = 10.47 m in
 * dof.test.ts (hand-derivation, independent of this function, in the test file).
 */
export function hyperfocal(f: number, N: number, c: number, pupilMag: number = 1): number {
  const Neff = N / pupilMag;
  return (f * f) / (Neff * c) + f;
}

export interface DofLimits {
  near: number; // mm, object distance
  far: number; // mm, object distance; Infinity when focus is at or beyond the hyperfocal distance
  total: number; // mm; Infinity when far is Infinity
  hyperfocal: number; // mm
}

/**
 * Near and far distance limits (mm) for a lens of focal length f, f-number N and circle of confusion c, focused at
 * `focus` (mm, from the front principal plane / entrance pupil - see module doc). Optional `pupilMag` applies the
 * same exit-pupil correction as `blurDiameter`.
 *
 * Derivation: solve `blurDiameter(f, N, focus, p, pupilMag)` = c for p on each side of focus.
 * Near (p < focus, so v_p > v_s): c = D(v_p - v_s)/v_p  =>  v_p = v_s / (1 - c/D)
 * Far  (p > focus, so v_p < v_s): c = D(v_s - v_p)/v_p  =>  v_p = v_s / (1 + c/D)
 * then p = objectDistance(v_p, f) in each case. The far limit is infinite whenever the solved v_p <= f (no real
 * object distance converges to an image distance at or below f). Algebraically equivalent to (and cross-checked
 * against, in dof.test.ts) the textbook hyperfocal-based shortcuts near = Hs/(H+s-f), far = Hs/(H-s+f) in the
 * s >> f limit; kept in this v-space form here because it stays exact at any s, not just s >> f.
 *
 * `focus` may be `Infinity` (see `blurDiameter`'s doc above for why and the Scenario.focusM = null convention this
 * models): vs takes its well-defined limit f rather than the indeterminate imageDistance(Infinity, f). With vs = f,
 * vm = f/(1 + c/D) is always < f, so far correctly comes out Infinity (as it must - focused at infinity, nothing is
 * ever "too far"), and near falls out of the same vn formula as the finite-focus case.
 */
export function dofLimits(f: number, N: number, c: number, focus: number, pupilMag: number = 1): DofLimits {
  const Neff = N / pupilMag;
  const D = f / Neff;
  const H = hyperfocal(f, N, c, pupilMag);
  const vs = Number.isFinite(focus) ? imageDistance(focus, f) : f; // focused at infinity: sensor sits at v = f

  const vn = vs / (1 - c / D);
  const near = objectDistance(vn, f);

  const vm = vs / (1 + c / D);
  const far = vm > f ? objectDistance(vm, f) : Infinity;

  return { near, far, total: far - near, hyperfocal: H };
}
