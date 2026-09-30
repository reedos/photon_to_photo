// Paraxial (first-order, "y-nu") ray tracing on a TraceSystem: cardinal points, pupils and finite-conjugate
// imaging. This is a separate, much simpler trace from the real sequential ray tracer (E1a's trace.ts): it
// carries a ray as a height y and a reduced angle nu = n*u through flat/spherical surfaces treated at their
// paraxial (small-angle) approximation, using only each surface's curvature c = 1/r, not its full sag or conic/
// asphere terms (those only matter for real ray tracing, not first-order properties).
//
// Core recursion (paraxial refraction + transfer), standard in every optical design text, e.g. Warren J. Smith,
// "Modern Optical Engineering", 4th ed. (McGraw-Hill, 2007), ch. 2 "Paraxial Optics", and Rudolf Kingslake &
// R. Barry Johnson, "Lens Design Fundamentals", 2nd ed. (Academic Press, 2010), ch. 2:
//   refraction:  n' u' = n u - y c (n' - n)          i.e.  nu' = nu - y c (n' - n)
//   transfer:    y_next = y + t u'                    (u' = nu'/n', t = axial separation to the next surface)
// Sign convention matches lens-types.ts and types.ts: z along the optical axis, light travels +z, r (hence c)
// positive when the center of curvature lies to the +z side of the vertex, u = dy/dz (positive when the ray is
// heading toward +y as it advances in +z).
//
// All formulas in this file were re-derived from that single recursion and cross-checked by hand against the
// classic thick-lens formulas before being encoded (see docs/engine/e1b.md, "Derivations", for the worked
// example); the golden tests in lens.test.ts and paraxial.test.ts check the results against those closed forms
// independently of this code.

import type { Cardinal, Doe, Pupil, TraceSystem, TraceSurface } from './types';

interface Elem {
  z: number;
  c: number;
  mediumAfter: string;
  doe?: Doe;
}

/**
 * Paraxial optical power (mm^-1) a Doe surface contributes at wavelength nm, order doe.order:
 *   K = -2 * m * C2 * (lambda / lambda0)
 * with C2 = doe.coeffs[0] (the h^2 term). Derivation (docs/engine/doe.md has the full derivation and citations,
 * e.g. Buralli, D. A., and Morris, G. M., "Effective Abbe number for diffractive optical elements," Appl. Opt. 28,
 * 3006-3007 (1989), and O'Shea et al., *Diffractive Optics*, SPIE Press, 2004, ch. 2): the phase profile that
 * brings a collimated beam to an ideal focus at f0 at lambda0, order m=1, is phi(h) = -(2*pi/lambda0)*h^2/(2*f0),
 * i.e. C2 = -1/(2*f0), so K(lambda0, m=1) = 1/f0 = -2*C2. The grating equation's deflection scales linearly in
 * m*lambda (see `diffract` in surface.ts), so the power at any other wavelength/order scales the same way:
 * K(lambda, m) = -2*C2*m*(lambda/lambda0). Higher-order coefficients (C4, C6, ...) contribute no PARAXIAL power
 * (their h^2 Taylor term is zero at h=0) -- exactly like a refractive surface's asphere terms, which is why
 * `cardinal`'s Petzval/pupil geometry only ever needs curvature `c`, not the asphere coefficients either.
 */
function doePower(doe: Doe | undefined, nm: number): number {
  if (!doe || doe.coeffs.length === 0) return 0;
  const C2 = doe.coeffs[0];
  return -2 * doe.order * C2 * (nm / doe.lambda0Nm);
}

/** One step of the y-nu recursion, from a starting (z, y, u, n) through a straight-line gap into element e. */
function stepThrough(z: number, y: number, u: number, n: number, e: Elem, indexFn: (m: string, nm: number) => number, nm: number) {
  const yAtSurface = y + (e.z - z) * u; // straight line through the gap (uniform medium)
  const nPrime = indexFn(e.mediumAfter, nm);
  const dn = nPrime - n;
  const nu = n * u;
  const nuPrime = nu - yAtSurface * (e.c * dn + doePower(e.doe, nm));
  const uPrime = nuPrime / nPrime;
  return { z: e.z, y: yAtSurface, u: uPrime, n: nPrime };
}

interface RayState {
  z: number;
  y: number;
  u: number; // real angle, dy/dz
  n: number; // index of the medium the ray is now in
}

/** Traces a single paraxial ray from (startZ, y0, u0) in medium n0 through a list of elements, in order. */
function traceParaxialRay(
  startZ: number,
  y0: number,
  u0: number,
  n0: number,
  elems: Elem[],
  indexFn: (m: string, nm: number) => number,
  nm: number,
): RayState {
  let state: RayState = { z: startZ, y: y0, u: u0, n: n0 };
  for (const e of elems) {
    state = stepThrough(state.z, state.y, state.u, state.n, e, indexFn, nm);
  }
  return state;
}

/** Where a ray with this final (y, u) at z crosses the axis (y=0), extended as a straight line. Infinity if u=0. */
function axisCrossing(y: number, u: number, z: number): number {
  if (u === 0) return y === 0 ? z : (y > 0 ? Infinity : -Infinity);
  return z - y / u;
}

/**
 * Mirrors a sub-system so tracing it forward is equivalent to tracing the original sub-system backward. Under
 * z~ = -z, a surface's curvature (defined relative to the direction of travel) negates, c~ = -c, and the medium
 * a backward-traveling ray meets after crossing a surface is whatever the forward system had BEFORE it. See
 * docs/engine/e1b.md, "Derivations: the reverse trace", for the coordinate argument and a worked numeric check
 * against the thick-lens formula (front principal plane and front focal point of a biconvex singlet).
 */
function mirrorElems(elems: Elem[], mediumBeforeFirst: string): { list: Elem[]; startMedium: string } {
  const k = elems.length;
  const mediumBefore = (i: number) => (i === 0 ? mediumBeforeFirst : elems[i - 1].mediumAfter);
  const list: Elem[] = new Array(k);
  for (let j = 0; j < k; j++) {
    const oi = k - 1 - j;
    // c negates under z~ = -z (curvature is defined relative to direction of travel); a Doe's power does NOT --
    // it is an intrinsic, direction-independent property of the physical grating (a converging kinoform converges
    // whichever way it is traced), so it carries over unchanged. See the module header's mirrorElems doc.
    list[j] = { z: -elems[oi].z, c: -elems[oi].c, mediumAfter: mediumBefore(oi), doe: elems[oi].doe };
  }
  return { list, startMedium: k === 0 ? mediumBeforeFirst : elems[k - 1].mediumAfter };
}

function refractingElems(sys: TraceSystem): { elems: Elem[]; surfaces: TraceSurface[] } {
  const surfaces = sys.surfaces.filter((s) => s.kind !== 'image');
  if (surfaces.length === 0) throw new Error('paraxial.ts: TraceSystem has no non-image surfaces to trace');
  return { elems: surfaces.map((s) => ({ z: s.z, c: s.c, mediumAfter: s.mediumAfter, doe: s.doe })), surfaces };
}

/** Images the point (startZ, y=0) and the point (startZ, y=radius, u=0) through elems, in the order given. */
function subImage(
  startZ: number,
  startMedium: number,
  radius: number,
  elems: Elem[],
  indexFn: (m: string, nm: number) => number,
  nm: number,
): Pupil {
  if (elems.length === 0) return { z: startZ, r: radius };
  const axial = traceParaxialRay(startZ, 0, 1, startMedium, elems, indexFn, nm);
  const zImg = axisCrossing(axial.y, axial.u, axial.z);
  const edge = traceParaxialRay(startZ, radius, 0, startMedium, elems, indexFn, nm);
  const rImg = edge.y + (zImg - edge.z) * edge.u;
  return { z: zImg, r: rImg };
}

/**
 * Cardinal points and pupils of sys at wavelength nm. stopRadius overrides the radius used at the stop surface
 * (sys.surfaces with kind === 'stop'); it defaults to that surface's own sd. Object and image space are assumed
 * to be air (true for every camera lens this engine models — light starts and ends outside glass), read via
 * sys.index('air', nm) rather than hardcoded, so a non-unity "air" would still be honored.
 *
 * When sys has no stop surface, ep/xp/pupilMag/fno are returned as NaN (there is nothing to locate a pupil
 * against) rather than thrown, so callers that only need efl/bfd/principal planes on a stopless synthetic system
 * (as several golden tests do) are not forced to fabricate one. See docs/engine/e1b.md, "Known limits".
 */
export function cardinal(sys: TraceSystem, nm: number, stopRadius?: number): Cardinal {
  const { elems, surfaces } = refractingElems(sys);
  const nAir = sys.index('air', nm);
  const y0 = 1;

  // Forward marginal ray from object space at infinity: gives EFL, BFD, rear principal plane and focal point.
  const fwd = traceParaxialRay(elems[0].z, y0, 0, nAir, elems, sys.index, nm);
  if (fwd.u === 0) throw new Error('paraxial.ts: cardinal: system is afocal (parallel ray stays parallel)');
  const efl = -y0 / fwd.u;
  const bfd = -fwd.y / fwd.u;
  const F2 = fwd.z + bfd;
  const P2 = F2 - efl;

  // Reverse marginal ray (mirrored system, traced forward): gives the front principal plane and focal point.
  const mirrored = mirrorElems(elems, 'air');
  const nImageOriginal = mirrored.startMedium === 'air' ? nAir : sys.index(mirrored.startMedium, nm);
  const rev = traceParaxialRay(mirrored.list[0].z, y0, 0, nImageOriginal, mirrored.list, sys.index, nm);
  if (rev.u === 0) throw new Error('paraxial.ts: cardinal: system is afocal (reverse parallel ray stays parallel)');
  const revFfd = -rev.y / rev.u;
  const revEfl = -y0 / rev.u;
  const zTildeCross = rev.z + revFfd;
  const F = -zTildeCross;
  const PTildeRear = rev.z + revFfd - revEfl;
  const P = -PTildeRear;
  const ffd = F - elems[0].z;

  // Petzval sum, over refracting surfaces only (the stop, c=0 in the usual case, contributes nothing anyway).
  let petzvalSum = 0;
  {
    let n = nAir;
    for (const e of elems) {
      const nPrime = sys.index(e.mediumAfter, nm);
      if (e.c !== 0) petzvalSum += (e.c * (nPrime - n)) / (n * nPrime);
      n = nPrime;
    }
  }
  const nImageFinal = fwd.n;
  const petzvalRadius = petzvalSum === 0 ? Infinity : -nImageFinal / petzvalSum;

  // Pupils: the stop imaged through the elements before it (entrance, traced backward) and after it (exit,
  // traced forward). "trace the stop backward/forward paraxially" per docs/ENGINE.md. ep.r/xp.r are reported as
  // non-negative sizes (as "radius, mm" in types.ts implies), even though the underlying paraxial imaging is
  // signed and can invert (e.g. a stop exactly 2f behind a single positive element images with magnitude-1
  // inversion): the sign there indicates image orientation, not a meaningful pupil "size," so it is discarded
  // here rather than leaking into fno and pupilMag as an arbitrary sign flip.
  const stopIdx = surfaces.findIndex((s) => s.kind === 'stop');
  let ep: Pupil = { z: NaN, r: NaN };
  let xp: Pupil = { z: NaN, r: NaN };
  if (stopIdx >= 0) {
    const stopZ = surfaces[stopIdx].z;
    const radius = stopRadius ?? surfaces[stopIdx].sd;
    const front = elems.slice(0, stopIdx);
    const rear = elems.slice(stopIdx + 1);
    const stopMediumBefore = stopIdx === 0 ? 'air' : elems[stopIdx - 1].mediumAfter;

    const frontMirrored = mirrorElems(front, 'air');
    const stopMediumIdx = stopMediumBefore === 'air' ? nAir : sys.index(stopMediumBefore, nm);
    const epTilde = subImage(-stopZ, stopMediumIdx, radius, frontMirrored.list, sys.index, nm);
    ep = { z: -epTilde.z, r: Math.abs(epTilde.r) };

    const xpRaw = subImage(stopZ, stopMediumIdx, radius, rear, sys.index, nm);
    xp = { z: xpRaw.z, r: Math.abs(xpRaw.r) };
  }
  const pupilMag = ep.r === 0 || Number.isNaN(ep.r) ? NaN : xp.r / ep.r;
  const fno = Number.isNaN(ep.r) ? NaN : efl / (2 * ep.r);

  return { nm, efl, bfd, ffd, P, P2, F, F2, ep, xp, pupilMag, fno, petzvalRadius };
}

/**
 * The paraxial image of an on-axis object point at objectZ: the axial position its image forms at, and the
 * transverse magnification for a small object height there. Uses two rays through the same object point (one
 * arbitrary nonzero angle for the image position, one parallel at unit height for the magnification) — valid
 * because paraxial imaging is linear, so every ray from one object point crosses the axis at the same image
 * point, and a ray from an off-axis point at that object plane maps to the conjugate image plane regardless of
 * its own starting angle.
 */
export function imageOf(sys: TraceSystem, nm: number, objectZ: number): { z: number; magnification: number } {
  const { elems } = refractingElems(sys);
  const nAir = sys.index('air', nm);

  const axial = traceParaxialRay(objectZ, 0, 1, nAir, elems, sys.index, nm);
  const zImage = axisCrossing(axial.y, axial.u, axial.z);

  const edge = traceParaxialRay(objectZ, 1, 0, nAir, elems, sys.index, nm);
  const yAtImage = edge.y + (zImage - edge.z) * edge.u;

  return { z: zImage, magnification: yAtImage };
}

/**
 * Petzval sum and radius alone (cardinal() also computes this; exposed separately since some callers want field
 * curvature without paying for the pupil sub-traces). Same formula and source as in cardinal().
 */
export function petzvalRadius(sys: TraceSystem, nm: number): number {
  const { elems } = refractingElems(sys);
  const nAir = sys.index('air', nm);
  let n = nAir;
  let sum = 0;
  for (const e of elems) {
    const nPrime = sys.index(e.mediumAfter, nm);
    if (e.c !== 0) sum += (e.c * (nPrime - n)) / (n * nPrime);
    n = nPrime;
  }
  return sum === 0 ? Infinity : -n / sum;
}

/**
 * Inverse of `imageOf`: the object z whose paraxial image lands exactly at `targetImageZ`. F4 (09/30/2026,
 * Astra-6 review): realize.ts's closest-focus search used to bisect `imageOf(objZ).z - target` between two fixed
 * brackets (z = -1e6 and z = -1) and skip the solve whenever both endpoints happened to have the same sign -- which
 * happens whenever the true root and the bracket straddle imageOf's own conjugate POLE (u_final = 0, an object at
 * the system's front focal point, whose image is literally at infinity) rather than a sign change, since the
 * residual crosses through +-Infinity there rather than through 0. p200's true closest-focus root sat exactly in
 * that situation, so the bisection silently never ran.
 *
 * imageOf's own two-ray derivation shows exactly why this has a direct, pole-free algebraic inverse instead of
 * needing a bracketed search at all: for a fixed system, the axial ray's final (y, u) --- traced from (objectZ,
 * y0=0, u0=1) --- are each a LINEAR function of objectZ (the paraxial y-nu recursion is linear in the ray's
 * starting state, and objectZ only ever enters through that starting state's effective u0-scaled offset; see
 * `stepThrough`'s "yAtSurface = y + (e.z - z) * u" for the one place objectZ appears). Writing that as
 * y(z) = ya*z + yb, u(z) = ua*z + ub, imageOf's own `axisCrossing` computes zImage(z) = zLast - y(z)/u(z), a single
 * Mobius (linear-fractional) transform of z with no other structure -- so it inverts in closed form, in one step,
 * with no bracket to miss and no pole to fall into (the solution literally IS well-defined arithmetic on the two
 * probes below, not a root search that can straddle one).
 *
 * Two probes (objectZ = 0 and objectZ = -1) fix the four linear coefficients exactly (paraxial imaging has no
 * higher-order terms to miss), then targetImageZ = zLast - y(z)/u(z) is solved directly for z.
 */
export function objectForImage(sys: TraceSystem, nm: number, targetImageZ: number): number {
  const { elems } = refractingElems(sys);
  const nAir = sys.index('air', nm);
  const probe = (objectZ: number) => traceParaxialRay(objectZ, 0, 1, nAir, elems, sys.index, nm);
  const s0 = probe(0);
  const s1 = probe(-1);
  const zLast = s0.z; // == s1.z: both probes end at the same last surface
  const yb = s0.y, ub = s0.u;
  // Slope over deltaZ = (-1) - 0 = -1: slope = (s1.* - probe(0).*) / (-1) = probe(0).* - s1.* .
  const ya = yb - s1.y;
  const ua = ub - s1.u;
  // y(z) = ya*z + yb, u(z) = ua*z + ub. target = zLast - y(z)/u(z)  =>  (zLast - target) * u(z) = y(z).
  // Let k = zLast - target: k*(ua*z + ub) = ya*z + yb  =>  z*(k*ua - ya) = yb - k*ub
  const k = zLast - targetImageZ;
  const denom = k * ua - ya;
  if (denom === 0) {
    throw new Error('paraxial.ts: objectForImage: degenerate system (afocal, or the target sits exactly at the pole)');
  }
  return (yb - k * ub) / denom;
}

// Exported for lens.ts's focus solve (systemAt), which needs the same primitive to find where a finite object
// images without duplicating the recursion.
export { traceParaxialRay, axisCrossing, mirrorElems, refractingElems };
export type { Elem };
