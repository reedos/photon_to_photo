// Surface geometry for sequential ray tracing: sag, normals, ray/surface intersection, and the two per-surface
// direction changes (refraction and reflection). Pure math, no Three.js, no DOM. Workstream E1a (engine/optics-trace).
//
// Conventions (see types.ts header): mm, radians; z is the optical axis, light travels toward +z. A TraceSurface's
// `z` is its vertex position; `sag(s, h)` is the LOCAL displacement of the surface from that vertex plane at radial
// height h = sqrt(x^2+y^2), so the surface's absolute height at (x, y) is `s.z + sag(s, h)`.
//
// Sag formula (conic of revolution + even-asphere terms), from lens-types.ts's Asphere doc:
//   z(h) = c h^2 / (1 + sqrt(1 - (1+k) c^2 h^2)) + A4 h^4 + A6 h^6 + ...        with c = 1/r, k = 0 a sphere.
// This is the "c-form": Spencer, G. H., and Murty, M. V. R. K., "General Ray-Tracing Procedure," J. Opt. Soc. Am.
// 52(6), 672-678 (1962), the standard sequential-ray-tracing reference (reproduced in e.g. Warren J. Smith,
// "Modern Optical Engineering," 4th ed., ch. 16). It is deliberately NOT written as z = R - sqrt(R^2 - (1+k)h^2)
// with R = 1/c: that form needs 1/c (undefined at c=0, a flat surface) and, even for large finite R, subtracts two
// close-to-equal large numbers and loses precision catastrophically. The c-form has no such cancellation: as
// c -> 0 the numerator c*h^2 -> 0 while the denominator stays near 2, so it is exact and stable for near-flat
// surfaces without any special-casing. `sag.test.ts` checks this directly (surface.test.ts, "near-flat surfaces").
//
// The sag's radial derivative (needed for the normal and for Newton's method in `intersect`) has the closed form
//   dz/dh = c h / sqrt(1 - (1+k) c^2 h^2)
// which is derived from the c-form above (see the comment above `sagSlope` for the algebra); it is likewise
// evaluated in the stable c-form.

import type { Doe, Ray, TraceSurface, Vec3 } from './types';

// ---- small Vec3 helpers (shared with trace.ts) -----------------------------------------------------------------
// types.ts defines Vec3 as a plain [number, number, number] tuple (not a typed-array/flat buffer), so these
// necessarily allocate a small tuple per call; see docs/engine/e1a.md "Known limits" for why a fully
// allocation-free hot loop is not reachable without a change to that shared type.

export function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
export function add3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
export function sub3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
export function scale3(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}
export function length3(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}
export function normalize3(a: Vec3): Vec3 {
  const l = length3(a);
  return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
}

// ---- sag and its radial slope ------------------------------------------------------------------------------------

/** Local sag (displacement from the vertex plane) at radial height h >= 0, mm. See the module header. */
export function sag(s: TraceSurface, h: number): number {
  const disc = 1 - (1 + s.k) * s.c * s.c * h * h;
  const u = disc > 0 ? Math.sqrt(disc) : 0; // domain guard: only reachable outside the surface's valid radius
  // (an ellipse-type conic's real half-extent), which trace.ts already vignettes well before via sd.
  let z = (s.c * h * h) / (1 + u);
  for (let j = 0; j < s.a.length; j++) {
    if (s.a[j] !== 0) z += s.a[j] * Math.pow(h, 4 + 2 * j);
  }
  return z;
}

/**
 * dz/dh at radial height h. Derivation of the conic term: let u = sqrt(1 - (1+k)c^2h^2), so z = c h^2/(1+u).
 * du/dh = -(1+k)c^2 h / u. Differentiating z and using (1+k)c^2h^2 = 1-u^2 = (1-u)(1+u) to simplify collapses the
 * (1+u)^2 denominator, leaving the standard closed form dz/dh = c h / u (Spencer & Murty 1962, cited above).
 */
export function sagSlope(s: TraceSurface, h: number): number {
  const disc = 1 - (1 + s.k) * s.c * s.c * h * h;
  const u = disc > 0 ? Math.sqrt(disc) : 0;
  let slope = u > 1e-12 ? (s.c * h) / u : 0;
  for (let j = 0; j < s.a.length; j++) {
    const p = 4 + 2 * j;
    if (s.a[j] !== 0) slope += s.a[j] * p * Math.pow(h, p - 1);
  }
  return slope;
}

/** Unit surface normal at a point (x, y) already known to lie on the surface (its z is not needed). Points with a
 *  positive z-component for the usual case of a surface slope under 1 (i.e., generally "forward," +z-ish); refract
 *  and reflect below do not depend on which of the two normal signs is returned. */
export function normalAt(s: TraceSurface, x: number, y: number): Vec3 {
  const h = Math.hypot(x, y);
  if (h < 1e-12) return [0, 0, 1]; // on-axis: normal is along the axis by rotational symmetry
  const slope = sagSlope(s, h);
  const dzdx = slope * (x / h);
  const dzdy = slope * (y / h);
  return normalize3([-dzdx, -dzdy, 1]);
}

// ---- ray/surface intersection --------------------------------------------------------------------------------

function isPureSphere(s: TraceSurface): boolean {
  return s.k === 0 && s.a.every((v) => v === 0);
}

// SEQUENTIAL semantics (lead correction, 09/28/2026). A sequential lens tracer meets each surface in the order
// listed, on the surface's own cap (the part of its base sphere that contains the vertex), whatever the sign of the
// ray parameter t. Patent prescriptions rely on this: zero gaps (p50 puts a flare-cut stop at t = 0 after a lens
// surface) and negative gaps (a stop or a surface whose vertex lies behind the previous one) are ordinary, and
// Zemax and CODE V trace them as "virtual" propagation. An earlier forward-only rule (t > 0, from an adversarial
// review that assumed ray-casting semantics) made the axial ray of p50 "miss" its zero-gap stop. What is a miss:
// no real crossing at all (the ray line never meets the base sphere), or crossings only on the far cap.

/** Ray/plane intersection with the flat surface z = s.z (any sign of t), or null if the ray runs parallel to it. */
function planeT(s: TraceSurface, ray: Ray): number | null {
  if (Math.abs(ray.d[2]) < 1e-14) return null;
  return (s.z - ray.o[2]) / ray.d[2];
}

/**
 * Closed-form ray/sphere intersection for a surface's base sphere (center on-axis at z = s.z + 1/s.c, radius
 * |1/s.c|). The standard quadratic a*t^2+b*t+c=0 (a=1, ray.d is unit) has two roots. Only a FORWARD root (t >
 * T_MIN, see above) is ever a valid hit: a ray does not reach a crossing point that lies behind where it
 * currently is, no matter how mathematically real that crossing is. If neither root is forward, there is no hit
 * (null). If exactly one is forward, that one is unambiguously the answer -- no heuristic needed. If BOTH are
 * forward, either can still be the physically correct (near) one depending on the sign of the curvature, so —
 * rather than a sign-of-c case split — we take whichever lands closest to the ray's intersection with the
 * surface's own vertex plane (t0 below). That vertex-plane guess is exact for a flat surface and a good local
 * guess for any curved one, since sequential-trace rays are expected to strike near the vertex, not clear on the
 * far side of the sphere; it is sign-of-curvature-agnostic by construction, and confirmed correct whenever both
 * roots are forward by a 500,000-case randomized search over realistic lens-scale geometry (see
 * e1a.verify.test.ts's header) -- the near/far branch choice was never the defect, only the missing forward check
 * below was.
 */
function sphereIntersect(s: TraceSurface, ray: Ray): number | null {
  if (s.c === 0) return planeT(s, ray);
  const R = 1 / s.c;
  const cz = s.z + R;
  const ox = ray.o[0];
  const oy = ray.o[1];
  const oz = ray.o[2] - cz;
  const dx = ray.d[0];
  const dy = ray.d[1];
  const dz = ray.d[2];
  const b = 2 * (dx * ox + dy * oy + dz * oz);
  const c = ox * ox + oy * oy + oz * oz - R * R;
  const disc = b * b - 4 * c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  const t1 = (-b - sq) / 2;
  const t2 = (-b + sq) / 2;
  // The vertex cap: the vertex sits at z = s.z = cz - R, so points on its cap satisfy (z - cz) * R < 0.
  const onCap1 = (ray.o[2] + t1 * dz - cz) * R < 0;
  const onCap2 = (ray.o[2] + t2 * dz - cz) * R < 0;
  if (!onCap1 && !onCap2) return null; // the line meets only the far cap: not this surface
  if (onCap1 !== onCap2) return onCap1 ? t1 : t2;
  // both on the cap (a chord across it): the one nearer the vertex-plane crossing
  const t0 = Math.abs(dz) > 1e-14 ? (s.z - ray.o[2]) / dz : Math.abs(t1) < Math.abs(t2) ? t1 : t2;
  return Math.abs(t1 - t0) <= Math.abs(t2 - t0) ? t1 : t2;
}

const NEWTON_MAX_ITER = 50;
const NEWTON_TOL = 1e-9; // mm, residual on z - (s.z + sag(h)) and on the step size

/**
 * Ray parameter t (P(t) = ray.o + t*ray.d) where the ray meets the surface, or null if it misses (including a
 * Newton iteration that fails to converge — see the module doc's "failure status" note: for aspheres/conics the
 * absence of a value IS the failure status, there being no separate status channel in this signature) or that
 * converges to a point behind the ray (t <= T_MIN; see the comment above T_MIN — only a forward crossing is ever
 * a valid hit for a sequential trace).
 * - Pure sphere (k = 0, no asphere terms): closed form, see sphereIntersect.
 * - Conic (k != 0) or even asphere (any a[i] != 0): Newton's method on f(t) = z(t) - (s.z + sag(h(t))), started
 *   from the base sphere's closed-form intersection (or, failing that, the vertex-plane guess) -- both of which
 *   are themselves already forward-filtered, so a starting guess is used only when it is itself ahead of the ray.
 */
export function intersect(s: TraceSurface, ray: Ray): number | null {
  if (isPureSphere(s)) return sphereIntersect(s, ray);

  const sphereGuess = sphereIntersect(s, ray);
  const vertexGuess = planeT(s, ray);
  // NaN (not null) when both guesses are null, so `t` below is plainly `number` -- the Number.isFinite check
  // covers that case (and rejects it) just the same, but without TS re-widening `t` to `number | null` on every
  // read inside the loop below, which reassigns it each iteration.
  let t: number = sphereGuess ?? vertexGuess ?? NaN;
  if (!Number.isFinite(t)) return null;

  for (let i = 0; i < NEWTON_MAX_ITER; i++) {
    const x = ray.o[0] + t * ray.d[0];
    const y = ray.o[1] + t * ray.d[1];
    const z = ray.o[2] + t * ray.d[2];
    const h = Math.hypot(x, y);
    const f = z - (s.z + sag(s, h));

    const dh_dt = h > 1e-12 ? (x * ray.d[0] + y * ray.d[1]) / h : 0;
    const fPrime = ray.d[2] - sagSlope(s, h) * dh_dt;
    if (Math.abs(fPrime) < 1e-14) return null; // degenerate derivative, cannot step

    const tNext = t - f / fPrime;
    if (!Number.isFinite(tNext)) return null;
    const step = Math.abs(tNext - t);
    t = tNext;
    if (step < NEWTON_TOL && Math.abs(f) < NEWTON_TOL) return t; // any sign: sequential semantics, see planeT
  }
  return null; // did not converge within NEWTON_MAX_ITER: failure
}

// ---- direction changes ---------------------------------------------------------------------------------------

/**
 * Vector Snell's law. `d` is the unit incident direction (direction of travel), `n` a unit surface normal in
 * EITHER orientation (the sign is resolved internally so callers need not track it), n1 and n2 the refractive
 * indices before and after the surface. Returns the unit refracted direction, or null on total internal
 * reflection (n1 > n2 beyond the critical angle).
 *
 * Standard vector form, e.g. https://en.wikipedia.org/wiki/Snell%27s_law#Vector_form or Glassner (ed.), "An
 * Introduction to Ray Tracing," Academic Press 1989, sec. 2: with the normal oriented against the incident ray
 * (cosI = -dot(n, d) > 0) and eta = n1/n2,
 *   sin2T = eta^2 (1 - cosI^2);  if sin2T > 1, TIR.
 *   cosT = sqrt(1 - sin2T);  refracted = eta*d + (eta*cosI - cosT)*n.
 */
export function refract(d: Vec3, n: Vec3, n1: number, n2: number): Vec3 | null {
  let nn = n;
  let cosI = -dot3(n, d);
  if (cosI < 0) {
    nn = scale3(n, -1);
    cosI = -cosI;
  }
  const eta = n1 / n2;
  const sin2T = eta * eta * (1 - cosI * cosI);
  if (sin2T > 1) return null; // total internal reflection
  const cosT = Math.sqrt(1 - sin2T);
  return normalize3(add3(scale3(d, eta), scale3(nn, eta * cosI - cosT)));
}

/** Mirror reflection of unit direction `d` about unit normal `n` (either sign of n gives the same result). */
export function reflect(d: Vec3, n: Vec3): Vec3 {
  const k = 2 * dot3(d, n);
  return normalize3(sub3(d, scale3(n, k)));
}

// ---- diffractive (Phase Fresnel / DOE) surfaces --------------------------------------------------------------

/**
 * dphi/dh (rad/mm) of a Doe's phase difference function phi(h) = (2*pi/lambda0) * sum_i coeffs[i] * h^(2*(i+1)),
 * at radial height h >= 0 mm. See types.ts's `Doe` doc and docs/engine/doe.md for the convention and derivation.
 */
export function doeGradPhi(doe: Doe, h: number): number {
  const lambda0Mm = doe.lambda0Nm / 1e6;
  const k = (2 * Math.PI) / lambda0Mm;
  let g = 0;
  for (let i = 0; i < doe.coeffs.length; i++) {
    const c = doe.coeffs[i];
    if (c === 0) continue;
    const p = 2 * (i + 1); // 2, 4, 6, ...
    g += k * c * p * Math.pow(h, p - 1);
  }
  return g;
}

/**
 * Refraction AT a diffractive surface: ordinary vector Snell's law (see `refract` above) plus the diffraction
 * grating's angular kick, combined in one step since both act on the same tangential wavevector. `d` is the unit
 * incident direction, `n` a unit surface normal in either orientation, `n1`/`n2` the refractive indices before and
 * after the surface's substrate, `(x, y)` the point of incidence (for the radial height and grating direction),
 * `doe` the phase profile, `nm` the ray's own (not lambda0's) wavelength in nm.
 *
 * Derivation (docs/engine/doe.md has the full derivation and citations, e.g. the vector grating equation as given
 * in Zemax's "Binary 2" surface documentation, or O'Shea, Suleski, Kathman & Prather, *Diffractive Optics: Design,
 * Fabrication, and Test*, SPIE Press, 2004, ch. 2-3): tangential-wavevector conservation with an added grating
 * term,
 *   n2 * d2_t = n1 * d1_t + m * (lambda / (2*pi)) * grad(phi)(h),
 * where d1_t/d2_t are the tangential (in the local surface tangent plane) parts of the unit incident/outgoing
 * directions, m is the diffraction order, lambda is the ray's wavelength (mm) and grad(phi) is the radially
 * directed grating vector `doeGradPhi(doe, h)` above, projected into the surface's local tangent plane (exact for
 * a flat or nearly flat DOE substrate — the case every Nikon Phase Fresnel patent this engine models actually
 * uses; a strongly curved DOE substrate would need the grating vector computed intrinsically on the curved
 * surface, not this plane projection — see docs/engine/doe.md, "Known limits"). Reduces exactly to `refract`
 * when `doe.coeffs` are all zero (grad(phi) = 0 everywhere).
 *
 * Returns null when the required tangential magnitude exceeds 1 (ordinary TIR at the substrate, OR an evanescent
 * diffraction order that the grating cannot actually launch — both report the same failure since neither is a
 * real transmitted ray; see docs/engine/doe.md).
 */
export function diffract(d: Vec3, n: Vec3, n1: number, n2: number, x: number, y: number, doe: Doe, nm: number): Vec3 | null {
  let nn = n;
  let cosI = -dot3(n, d);
  if (cosI < 0) {
    nn = scale3(n, -1);
    cosI = -cosI;
  }
  const dTan = add3(d, scale3(nn, cosI)); // d - dot(d,nn)*nn, since dot(d,nn) = -cosI here

  const h = Math.hypot(x, y);
  let gTan: Vec3 = [0, 0, 0];
  if (h > 1e-12) {
    const dphidh = doeGradPhi(doe, h);
    if (dphidh !== 0) {
      const g: Vec3 = [dphidh * (x / h), dphidh * (y / h), 0];
      gTan = sub3(g, scale3(nn, dot3(g, nn))); // project onto the tangent plane (see the doc comment above)
    }
  }

  const lambdaMm = nm / 1e6;
  const kick = (doe.order * lambdaMm) / (2 * Math.PI);
  const d2t: Vec3 = scale3(add3(scale3(dTan, n1), scale3(gTan, kick)), 1 / n2);

  const sin2T = dot3(d2t, d2t);
  if (sin2T > 1) return null; // TIR at the substrate, or an evanescent diffraction order
  const cosT = Math.sqrt(1 - sin2T);
  return normalize3(sub3(d2t, scale3(nn, cosT)));
}
