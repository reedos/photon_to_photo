// The thin-lens equation, magnification, and the principal-plane framing that makes the same algebra exact for a
// thick (real, multi-element) lens. Workstream E2 (engine/closed-form). See docs/engine/e2.md.
//
// Convention (stated once here; every function below uses it): all distances are POSITIVE-distance photographic
// convention, not the signed Cartesian convention used in src/engine/paraxial.ts (E1b). Object distance u is
// measured from the front principal plane to the object, positive when the object is in front of the lens (the
// only physically meaningful case for a camera). Image distance v is measured from the rear principal plane to
// the image, positive when the image is real and behind the lens. This is the convention in which the classic
// Gaussian lens formula 1/f = 1/u + 1/v holds with no sign juggling (Hecht, "Optics", 5th ed., ยง5.2; Kingslake &
// Johnson, "Lens Design Fundamentals", 2nd ed., ch. 2).
//
// "Thick lens" is not a different formula: once u is measured from the FRONT principal plane H and v from the REAR
// principal plane H', a thick (or compound) lens obeys exactly the same 1/f = 1/u + 1/v relation as a thin lens
// (that is the defining property of the principal planes - see Hecht ยง6.2, or Kingslake & Johnson ch. 2). The
// functions below are therefore already the "thick-lens version"; what differs for a thick lens is only (a) the
// physical offset between H and H' (see `objectDistanceFromMechanical` below) and (b) that the entrance and exit
// pupils generally sit at different places with different sizes (pupil magnification), which matters for exposure
// (src/engine/exposure.ts, working f-number) and defocus blur (src/engine/dof.ts), not for this basic conjugate
// relation.

/**
 * Image distance from the rear principal plane, given object distance `u` from the front principal plane and
 * focal length `f` (all mm). Gaussian thin-lens equation: 1/f = 1/u + 1/v => v = uf/(u - f).
 * Requires u > f for a real image (a camera can't focus a real object inside its own focal length).
 */
export function imageDistance(u: number, f: number): number {
  return (u * f) / (u - f);
}

/** Inverse of `imageDistance`: the object distance that puts the image at `v` from the rear principal plane. */
export function objectDistance(v: number, f: number): number {
  return (v * f) / (v - f);
}

/**
 * Transverse (lateral) magnification for an object at distance `u` imaged at distance `v` (both from the
 * respective principal plane, mm). Signed per the Gaussian convention: m = -v/u, negative for the real, inverted
 * image a single positive lens forms of a real object (Hecht ยง5.2, eq. 5.14 adapted to the positive-distance
 * convention used here). Use `Math.abs(magnification(u, v))` where only the size ratio matters (e.g. exposure's
 * working f-number, dof's blur-diameter scaling).
 */
export function magnification(u: number, v: number): number {
  return -v / u;
}

/** Magnification directly from object distance and focal length (folds in `imageDistance`): m = -f / (u - f). */
export function magnificationFromObject(u: number, f: number): number {
  return -f / (u - f);
}

/**
 * The object distance corresponding to a given (unsigned) magnification, for a lens of focal length f focused so
 * that |image height / object height| = |m|. From m = -f/(u-f): u = f(1 + 1/|m|) for |m| > 0.
 * (|m| = 1 gives u = 2f, the classic "1:1 macro at twice the focal length from the front principal plane" result.)
 */
export function objectDistanceForMagnitude(absM: number, f: number): number {
  return f * (1 + 1 / absM);
}

/**
 * Converts a "mechanical" conjugate distance - the total object-to-image distance T (mm), as you'd measure with a
 * tape from the subject to the sensor - into the object distance u from the front principal plane, for a lens
 * whose focal length is f and whose principal planes are separated by `interstitium` = P' - P (mm; 0 for a thin
 * lens, and generally nonzero and possibly negative for a real photographic lens - see Cardinal.P/.P2 in
 * src/engine/types.ts, which E1b's paraxial.ts computes from an actual prescription).
 *
 * Derivation: with u from H and v from H', T = u + interstitium + v, i.e. u + v = D where D = T - interstitium.
 * Substituting v = D - u into the Gaussian equation 1/u + 1/v = 1/f and clearing denominators gives
 * u^2 - Du + Df = 0, a quadratic symmetric in u and v (swapping the two roots swaps which conjugate is "object"
 * and which is "image" - the pair (u, v) and (v, u) both satisfy u + v = D and 1/u + 1/v = 1/f). For ordinary
 * (non-macro) photography the object is the far conjugate, so u is the larger root:
 *   u = [D + sqrt(D^2 - 4Df)] / 2
 * Real solutions require D >= 4f (the D = 4f double root is the 1:1 macro position, u = v = 2f, the minimum
 * possible total conjugate distance for a given f - consistent with `objectDistanceForMagnitude(1, f)` above).
 * Standard "focusing distance from the flange" derivation (e.g. as used to convert a lens's marked focus-distance
 * scale, referenced to the film/sensor plane, into principal-plane conjugates); rearranged here from the same
 * 1/f = 1/u + 1/v relation as the rest of this module, so it is guaranteed consistent with
 * `imageDistance`/`objectDistance` rather than an independently sourced shortcut. Verified numerically against
 * `imageDistance`/`objectDistance` round-trips in thinlens.test.ts.
 *
 * D < 4f (the caller asked to focus closer than this lens's minimum focus distance) has NO real (u, v) solution:
 * that is precisely what the negative discriminant means, algebraically (no real u+v=D pair satisfies 1/u+1/v=1/f)
 * as well as physically (a lens whose minimum total conjugate is 4f cannot rack out any closer). Clamping the
 * discriminant to 0 and returning u = v = D/2 - the earlier behavior - manufactures a pair that satisfies neither:
 * it silently fails 1/u + 1/v = 1/f (by ~33% at D = 3f, f = 60mm - not a rounding artifact), with nothing in the
 * return value to say so. Returning NaN instead makes the infeasibility explicit, consistent with this module's
 * only other out-of-domain signal (`imageDistance`/`objectDistance` return +/-Infinity at their own pole, u = f /
 * v = f, rather than a plausible-looking finite number).
 */
export function objectDistanceFromMechanical(totalDistance: number, f: number, interstitium: number = 0): number {
  const D = totalDistance - interstitium;
  const disc = D * D - 4 * D * f;
  if (disc < 0) return NaN; // D < 4f: no real conjugate pair exists - see doc comment above
  const root = Math.sqrt(disc);
  return (D + root) / 2; // the larger root is u (the far conjugate, the ordinary-photography case)
}
