// Sensor formats: physical dimensions, crop factor, field of view (with focus breathing) and equivalence.
// Workstream E2 (engine/closed-form). See docs/engine/e2.md for the conventions and derivations.
//
// Units follow src/engine/types.ts: lengths in mm, angles in radians (callers convert to degrees for display).

import type { Format, FormatId } from './types';

// ---- format dimensions ---------------------------------------------------------------------------------------------
// Sources:
// - Full frame: 36 x 24 mm is the 35 mm still-photography frame itself (the format the "35 mm equivalent" scale is
//   defined against); every full-frame camera maker (Canon, Nikon, Sony, Leica, ...) states this figure.
// - APS-C (Nikon/Sony/Pentax/Fujifilm "DX"/APS-C nominal): 23.5 x 15.6 mm, as published in these makers' body
//   spec sheets (e.g. Nikon DX sensor size, Sony/Fujifilm APS-C spec pages).
// - APS-C (Canon): Canon's APS-C bodies are built slightly smaller, commonly published as 22.3 x 14.9 mm (Canon's
//   own spec sheets; some models print 22.2 x 14.8 mm - within rounding of the same physical sensor family). Kept
//   as a separate variant below rather than folded into FormatId, since the shared `FormatId` type only names
//   'ff' | 'apsc' | 'mft'.
// - Micro Four Thirds: 17.3 x 13.0 mm, the Four Thirds / Micro Four Thirds System Standard (the consortium
//   specification Olympus/Panasonic publish; restated on every MFT body's spec sheet).

function diagonalOf(w: number, h: number): number {
  return Math.hypot(w, h);
}

const FF_W = 36.0;
const FF_H = 24.0;
const FF_DIAG = diagonalOf(FF_W, FF_H); // 43.2666... mm; golden test checks this rounds to 43.27

function makeFormat(id: FormatId, name: string, w: number, h: number): Format {
  const diag = diagonalOf(w, h);
  return { id, name, w, h, diag, crop: FF_DIAG / diag };
}

/** The three sensor formats the project models. Nominal (Nikon/Sony/Fuji) dimensions for APS-C. */
export const FORMATS: Record<FormatId, Format> = {
  ff: makeFormat('ff', 'Full frame (35 mm)', FF_W, FF_H),
  apsc: makeFormat('apsc', 'APS-C', 23.5, 15.6),
  mft: makeFormat('mft', 'Micro Four Thirds', 17.3, 13.0),
};

/**
 * Canon's APS-C variant (22.3 x 14.9 mm), distinct enough from the Nikon/Sony/Fuji nominal APS-C (23.5 x 15.6 mm)
 * to matter for crop factor and equivalence. Same FormatId ('apsc') as FORMATS.apsc; use this object in its place
 * when the scenario names a Canon APS-C body.
 */
export const APSC_CANON: Format = makeFormat('apsc', 'APS-C (Canon)', 22.3, 14.9);

/** Diagonal of an arbitrary w x h rectangle, mm. Exposed since crop factor and FOV both need it. */
export function diagonal(w: number, h: number): number {
  return diagonalOf(w, h);
}

/** Crop factor of an arbitrary format relative to full frame: FF diagonal / this diagonal. */
export function cropFactorOf(w: number, h: number): number {
  return FF_DIAG / diagonalOf(w, h);
}

// ---- field of view, with focus breathing ---------------------------------------------------------------------------
/**
 * Angle of view for a sensor dimension `dim` (mm - width, height or diagonal) imaged through an optical system
 * whose image-side distance (from the rear principal plane to the sensor) is `imageDistance` (mm).
 *
 * fov = 2 atan( dim / (2 * imageDistance) )
 *
 * This is the standard photographic "angle of view" formula (e.g. as published by every camera maker for a given
 * focal length and sensor size), generalized from focal length to image distance so that it captures focus
 * breathing: for a simple (unit-focusing) lens, focusing closer extends the lens away from the sensor, so the
 * image-side distance grows past f and the field of view narrows exactly as this formula predicts. At infinity
 * focus the image-side distance equals f (the thin-lens image distance for an object at infinity), which is the
 * default when `imageDistance` is omitted, recovering the familiar fov = 2 atan(dim / (2f)).
 *
 * Internal-focusing lenses instead change their effective focal length as they focus (sometimes breathing the
 * other way); callers model that by passing the focus-dependent effective focal length as `f` and its own image
 * distance, not by this function alone.
 *
 * Returns radians (engine convention); multiply by 180/PI for degrees.
 */
export function fov(f: number, dim: number, imageDistance: number = f): number {
  return 2 * Math.atan(dim / (2 * imageDistance));
}

export type FovAxis = 'h' | 'v' | 'diag';

/** Convenience wrapper: field of view along one axis of a Format. See `fov` for the convention. */
export function fovForFormat(f: number, format: Format, axis: FovAxis, imageDistance: number = f): number {
  const dim = axis === 'h' ? format.w : axis === 'v' ? format.h : format.diag;
  return fov(f, dim, imageDistance);
}

// ---- equivalence -----------------------------------------------------------------------------------------------
// Stated as physics, not as a marketing claim (per docs/BRIEF.md's ACCURACY DISCIPLINE). Both results below fall
// out of one requirement: keep the entrance pupil diameter D = f/N the same in absolute (mm) terms.
//
// - Same field of view: fov depends on dim/f (formats.fov), and crop is defined from the DIAGONAL (crop = FF
//   diagonal / this diagonal), so a format's diagonal scales as exactly 1/format.crop. Matching diagonal fov
//   across two formats with crop factors c1 (reference) and c2 (target) therefore requires f2 = f1 * c1 / c2 - a
//   shorter lens on the higher-crop (smaller) format. This is exact for the diagonal field of view; for the
//   horizontal or vertical field of view alone it is exact only when the two formats share the same aspect ratio.
//   Full frame (36 x 24, 3:2) and nominal APS-C (23.5 x 15.6, ~1.5064:1) do not quite - close enough that the
//   difference is usually ignored in practice (as it is when a compact camera's spec sheet quotes a single "35 mm
//   equivalent focal length" from the diagonal crop alone), but formats.test.ts checks the diagonal case exactly
//   and the width case only to a loose tolerance, rather than asserting an exactness the geometry doesn't have.
//
// - Same depth of field *and* the same total light collected at the same shutter speed: both are governed by the
//   physical entrance pupil diameter D = f/N (DOF, because the blur-circle geometry in dof.ts scales with D at a
//   fixed subject distance and format-scaled circle of confusion - the format's CoC assumption in dof.ts is itself
//   diag/1500, so it scales with crop the same way f does; total light, because the light entering the lens scales
//   with pupil area independent of sensor size, while sensor area scales with 1/crop^2, exactly canceling the
//   irradiance-vs-total-light difference that would otherwise appear). Requiring D2 = D1 with f2 = f1*c1/c2 gives
//   N2 = f2/D1 = (f1*c1/c2) / (f1/N1) = N1 * c1/c2, i.e. N2 = N1/c2 when c1 = 1 (reference is full frame).
//
// Source for the physical reasoning: the standard photographic "equivalence" treatment (e.g. as discussed by DOF
// and diffraction calculators built on entrance-pupil-diameter matching); derived here from first principles above
// rather than quoted from one article, so the two results (fov and N) are guaranteed mutually consistent.

/** The focal length on a format with crop factor `toCrop` that reproduces the field of view of `f` on `fromCrop`. */
export function equivalentFocalLength(f: number, fromCrop: number, toCrop: number): number {
  return (f * fromCrop) / toCrop;
}

/**
 * The f-number on a format with crop factor `toCrop` that reproduces the depth of field and total light (at a
 * matched shutter speed) of `N` on `fromCrop`, assuming focal lengths were already matched by
 * `equivalentFocalLength` (same absolute entrance pupil diameter).
 */
export function equivalentFNumber(N: number, fromCrop: number, toCrop: number): number {
  return (N * fromCrop) / toCrop;
}

/** Format-based convenience wrappers around `equivalentFocalLength` / `equivalentFNumber`. */
export function equivalentFocalLengthFormat(f: number, from: Format, to: Format): number {
  return equivalentFocalLength(f, from.crop, to.crop);
}

export function equivalentFNumberFormat(N: number, from: Format, to: Format): number {
  return equivalentFNumber(N, from.crop, to.crop);
}
