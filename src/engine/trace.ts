// Sequential ray tracing through a TraceSystem (types.ts): one ray at a time, surface by surface, plus ray aiming
// from a field point, meridional fans, and pupil-sampling spots. Pure math, no Three.js, no DOM. Workstream E1a
// (engine/optics-trace).
//
// types.ts owns TraceSystem/TraceSurface/Ray/RayPath/Pupil and does not (yet) define a field-point or
// pupil-sampling-pattern type, so `Field`, `TraceOptions`, `AimOptions` and `PupilGrid`/`SpotResult` below are
// local to this module (see needs_from_lead in the workstream report: promoting them to types.ts would let E1b's
// paraxial.ts and E4's render.ts share them instead of redeclaring).

import type { Pupil, Ray, RayPath, TraceSystem, Vec2, Vec3 } from './types';
import { diffract, intersect, normalAt, normalize3, refract, sag, sub3 } from './surface';

export interface TraceOptions {
  /** Skip the sd (clear-aperture) and iris tests, so the geometric path continues 'ok' to the image plane
   *  wherever the surfaces are actually crossed (TIR and a geometric miss still stop the trace). Used internally
   *  by aimRay's real-ray-aiming search (which needs to see where a ray lands even outside the current aperture),
   *  and useful standalone for inspecting an otherwise-vignetted ray. */
  ignoreVignetting?: boolean;
}

/**
 * Sequentially trace one ray through every surface of `sys` in order: intersect, vignette against that surface's
 * sd (and, at the stop, `sys.iris` if given — see the comment above 'stop' below), refract, repeat, until the
 * image surface (recorded, not refracted) or a failure. `pts[0]` is `ray.o`; `pts[i+1]` is the point reached on
 * `sys.surfaces[i]`, for every surface actually reached (including the one a non-'ok' path was blocked or lost
 * at, so a renderer can draw exactly how far the ray got). `dirOut` is set only for a status-'ok' path (the
 * direction the ray was travelling in when it reached the image plane); for 'vignetted'/'iris'/'tir'/'missed'
 * there is no valid "after" direction for a ray that didn't continue, so it is left undefined.
 *
 * A surface carrying `doe` (a diffractive/Phase Fresnel phase profile, see types.ts's `Doe`) is refracted with
 * `surface.ts`'s `diffract()` instead of plain `refract()`: the vector grating equation on top of ordinary
 * Snell's law (see `diffract`'s doc and docs/engine/doe.md). A `null` result there — ordinary TIR at the
 * substrate, or an evanescent diffraction order — is reported the same way as any other TIR: status `'tir'`.
 *
 * Vignetting: every surface's `sd` is a hard circular clear-aperture limit (the element's or the stop housing's
 * mechanical edge) — checked first, regardless of surface kind. At a surface of kind 'stop', `sys.iris` (if
 * present) is an ADDITIONAL test in the stop plane's own x/y, for the current (possibly stopped-down, possibly
 * non-circular blade) opening; per types.ts, an absent `sys.iris` means "a circular stop of the stop's sd", which
 * is exactly the sd check already applied to every surface, so no extra test is needed in that case.
 */
export function traceRay(sys: TraceSystem, ray: Ray, opts?: TraceOptions): RayPath {
  const ignoreVignetting = opts?.ignoreVignetting ?? false;
  const pts: Vec3[] = [ray.o];
  let cur: Ray = ray;
  let medium = 'air';

  for (let i = 0; i < sys.surfaces.length; i++) {
    const surf = sys.surfaces[i];
    const t = intersect(surf, cur);
    if (t === null) {
      return { nm: ray.nm, pts, status: 'missed', blockedAt: i };
    }

    const x = cur.o[0] + t * cur.d[0];
    const y = cur.o[1] + t * cur.d[1];
    const z = cur.o[2] + t * cur.d[2];
    const p: Vec3 = [x, y, z];
    const h = Math.hypot(x, y);

    // relative tolerance: a marginal ray aimed exactly at a rim (px = 1) must not be lost to rounding
    if (!ignoreVignetting && h > surf.sd * (1 + 1e-9) + 1e-12) {
      pts.push(p);
      return { nm: ray.nm, pts, status: 'vignetted', blockedAt: i };
    }
    if (!ignoreVignetting && surf.kind === 'stop' && sys.iris && !sys.iris(x, y)) {
      pts.push(p);
      return { nm: ray.nm, pts, status: 'iris', blockedAt: i };
    }

    pts.push(p);

    if (surf.kind === 'image') {
      return { nm: ray.nm, pts, status: 'ok', dirOut: cur.d };
    }

    const n1 = sys.index(medium, ray.nm);
    const n2 = sys.index(surf.mediumAfter, ray.nm);
    const normal = normalAt(surf, x, y);
    const outDir = surf.doe
      ? diffract(cur.d, normal, n1, n2, x, y, surf.doe, ray.nm)
      : refract(cur.d, normal, n1, n2);
    if (outDir === null) {
      return { nm: ray.nm, pts, status: 'tir', blockedAt: i };
    }
    cur = { o: p, d: outDir, nm: ray.nm };
    medium = surf.mediumAfter;
  }

  // A well-formed TraceSystem always ends with an 'image' surface; this is a defensive fallback for one that
  // doesn't, not the expected path.
  return { nm: ray.nm, pts, status: 'ok', dirOut: cur.d };
}

// ---- ray aiming ----------------------------------------------------------------------------------------------

/** A field point to aim rays at: either a chief-ray angle pair for an object at infinity, or a finite object
 *  point in the same (x, y, z) frame as the surfaces. `ay` is the usual meridional (vertical, y-z plane) field
 *  angle; `ax` the sagittal (horizontal, x-z plane) one. For 'angle', the incoming parallel bundle's direction is
 *  normalize([tan(ax), tan(ay), 1]) — exact whenever one of ax/ay is zero (the meridional-only case every golden
 *  test here uses), and a standard small-angle-safe generalization to a full 2D field otherwise. */
export type Field = { kind: 'angle'; ax: number; ay: number } | { kind: 'object'; o: Vec3 };

export interface AimOptions {
  /** Iterate the aim point on the entrance-pupil plane until the traced ray actually crosses the system's stop
   *  surface at (px, py) * stop.sd, correcting for pupil aberration: the paraxial entrance pupil `ep` is only a
   *  first-order stand-in for where a real (non-paraxial) ray crosses the stop, and that gap grows with field
   *  angle. A 2D Newton search on a finite-difference Jacobian, <=20 iterations, 1e-9 mm convergence tolerance.
   *  No-op if `sys` has no surface of kind 'stop', or if the search ray fails geometrically (TIR/miss) before
   *  reaching it, in which case the last valid aim point (or the paraxial guess) is kept. See ENGINE.md and the
   *  "chief ray of an aimed fan crosses the stop center" golden test. */
  realAim?: boolean;
}

/** A plane in front of everything the system can intersect: the first surface's vertex minus its largest sag
 *  magnitude over its clear aperture, minus a margin. Rays from a field at infinity start here (lead fix,
 *  09/28/2026: real lenses put the entrance pupil INSIDE the element stack, so a ray starting at the pupil point
 *  began behind the first surfaces and missed them once intersect() rejected behind-the-ray hits). */
export function entryPlaneZ(sys: TraceSystem): number {
  const s0 = sys.surfaces[0];
  let front = s0.z;
  for (let k = 0; k <= 8; k++) front = Math.min(front, s0.z + sag(s0, (s0.sd * k) / 8));
  return front - 1;
}

function rayThroughPupilPoint(field: Field, ep: Pupil, ux: number, uy: number, nm: number, zStart: number): Ray {
  const pupilPoint: Vec3 = [ux, uy, ep.z];
  if (field.kind === 'angle') {
    const d = normalize3([Math.tan(field.ax), Math.tan(field.ay), 1]);
    // walk back along -d from the pupil point to the entry plane; the ray still passes through the pupil point
    const back = (ep.z - Math.min(zStart, ep.z - 1)) / d[2];
    return { o: [pupilPoint[0] - d[0] * back, pupilPoint[1] - d[1] * back, pupilPoint[2] - d[2] * back], d, nm };
  }
  const d = normalize3(sub3(pupilPoint, field.o));
  return { o: field.o, d, nm };
}

function stopIndex(sys: TraceSystem): number {
  return sys.surfaces.findIndex((s) => s.kind === 'stop');
}

/**
 * Build a ray from `field` (an infinite conjugate's angle, or a finite object point) aimed through normalized
 * pupil coordinates (px, py) in [-1, 1] on the paraxial entrance pupil `ep` (an input here — E1b's paraxial.ts
 * computes it). With `opts.realAim`, refines the aim so the ray actually crosses the stop at the equivalent
 * normalized stop coordinates instead of merely the paraxial entrance pupil (see AimOptions).
 */
export function aimRay(sys: TraceSystem, ep: Pupil, field: Field, px: number, py: number, nm: number, opts?: AimOptions): Ray {
  let ux = px * ep.r;
  let uy = py * ep.r;
  const zStart = entryPlaneZ(sys);

  if (opts?.realAim) {
    const si = stopIndex(sys);
    if (si >= 0) {
      const stop = sys.surfaces[si];
      const targetX = px * stop.sd;
      const targetY = py * stop.sd;

      const crossingAt = (qx: number, qy: number): Vec2 | null => {
        const ray = rayThroughPupilPoint(field, ep, qx, qy, nm, zStart);
        const path = traceRay(sys, ray, { ignoreVignetting: true });
        const p = path.pts[si + 1]; // pts[0] is the origin; pts[k+1] is the point on surfaces[k]
        return p ? [p[0], p[1]] : null;
      };

      const h = 1e-4; // mm, finite-difference step on the pupil-plane aim point
      for (let iter = 0; iter < 20; iter++) {
        const c0 = crossingAt(ux, uy);
        if (!c0) break; // the search ray failed geometrically before the stop; keep the last aim point
        const ex = c0[0] - targetX;
        const ey = c0[1] - targetY;
        if (Math.hypot(ex, ey) < 1e-9) break;

        const cx = crossingAt(ux + h, uy);
        const cy = crossingAt(ux, uy + h);
        if (!cx || !cy) break;

        const dXdu = (cx[0] - c0[0]) / h;
        const dXdv = (cy[0] - c0[0]) / h;
        const dYdu = (cx[1] - c0[1]) / h;
        const dYdv = (cy[1] - c0[1]) / h;
        const det = dXdu * dYdv - dXdv * dYdu;
        if (Math.abs(det) < 1e-12) break; // singular Jacobian: stop where we are

        // Newton step solving [dXdu dXdv; dYdu dYdv]*[du;dv] = [-ex;-ey] via the closed-form 2x2 inverse.
        const du = (dXdv * ey - dYdv * ex) / det;
        const dv = (dYdu * ex - dXdu * ey) / det;
        ux += du;
        uy += dv;
      }
    }
  }

  return rayThroughPupilPoint(field, ep, ux, uy, nm, zStart);
}

// ---- fans and spots -------------------------------------------------------------------------------------------

/**
 * n rays evenly spaced across normalized pupil coordinate [-1, 1] along `axis` ('x' or 'y'; the other pupil
 * coordinate held at 0): the meridional ray fans the lens cutaway draws (BRIEF.md set piece 2). Returns n *
 * nms.length RayPaths, wavelength outermost (n consecutive paths per wavelength; each RayPath also carries its
 * own `.nm` so a caller can regroup by filtering instead of relying on this order).
 */
export function fan(sys: TraceSystem, ep: Pupil, field: Field, n: number, nms: number[], axis: 'x' | 'y', aimOpts?: AimOptions): RayPath[] {
  const out: RayPath[] = [];
  for (const nm of nms) {
    for (let i = 0; i < n; i++) {
      const u = n === 1 ? 0 : -1 + (2 * i) / (n - 1);
      const px = axis === 'x' ? u : 0;
      const py = axis === 'y' ? u : 0;
      out.push(traceRay(sys, aimRay(sys, ep, field, px, py, nm, aimOpts)));
    }
  }
  return out;
}

/**
 * Pupil sampling patterns for `spot`.
 * - 'square': an n x n grid over [-1, 1]^2 with points outside the unit disk dropped; uniform weight (grid cells
 *   have equal area, modulo the usual boundary bias of a square grid clipped to a disk).
 * - 'hexapolar': the standard fast-converging spot-diagram pattern used by lens design tools (e.g. Zemax's
 *   "Hexapolar"/"Ring" ray-fan patterns): 1 center point plus, for ring i = 1..rings, 6i points evenly spaced in
 *   angle at radius i/rings (1 + 3*rings*(rings+1) points total). Weight is uniform PER POINT here, which is only
 *   approximately area-uniform (each ring's annular area grows faster than its point count) — for area-accurate
 *   pupil integration, prefer 'square' or 'fibonacci'.
 * - 'fibonacci': n points placed by the golden-angle spiral r_i = sqrt((i + 0.5) / n), theta_i = i * goldenAngle
 *   (goldenAngle = pi*(3 - sqrt(5)) rad), which is uniform in AREA density by construction — the sqrt spacing is
 *   exactly what makes the area element r dr uniform in i. Vogel, H., "A better way to construct the sunflower
 *   head," Mathematical Biosciences 44(3-4), 179-189 (1979). See the "Fibonacci pupil sampling has uniform
 *   density" golden test.
 */
export type PupilGrid = { kind: 'square'; n: number } | { kind: 'hexapolar'; rings: number } | { kind: 'fibonacci'; n: number };

interface PupilSample {
  px: number;
  py: number;
  weight: number; // normalized to sum to 1 over the whole grid
}

function pupilSamples(grid: PupilGrid): PupilSample[] {
  if (grid.kind === 'square') {
    const n = grid.n;
    const pts: PupilSample[] = [];
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const px = n === 1 ? 0 : -1 + (2 * i) / (n - 1);
        const py = n === 1 ? 0 : -1 + (2 * j) / (n - 1);
        if (px * px + py * py <= 1 + 1e-12) pts.push({ px, py, weight: 1 });
      }
    }
    const w = 1 / pts.length;
    return pts.map((p) => ({ ...p, weight: w }));
  }

  if (grid.kind === 'hexapolar') {
    const rings = grid.rings;
    const pts: PupilSample[] = [{ px: 0, py: 0, weight: 1 }];
    for (let ring = 1; ring <= rings; ring++) {
      const r = ring / rings;
      const count = 6 * ring;
      for (let k = 0; k < count; k++) {
        const theta = (2 * Math.PI * k) / count;
        pts.push({ px: r * Math.cos(theta), py: r * Math.sin(theta), weight: 1 });
      }
    }
    const w = 1 / pts.length;
    return pts.map((p) => ({ ...p, weight: w }));
  }

  const n = grid.n;
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const pts: PupilSample[] = [];
  for (let i = 0; i < n; i++) {
    const r = Math.sqrt((i + 0.5) / n);
    const theta = i * goldenAngle;
    pts.push({ px: r * Math.cos(theta), py: r * Math.sin(theta), weight: 1 / n });
  }
  return pts;
}

export interface SpotSample {
  px: number;
  py: number;
  weight: number;
  path: RayPath;
}

export interface SpotResult {
  nm: number;
  samples: SpotSample[];
  /** Weighted centroid of the surviving (status 'ok') landing points on the image plane, mm. [0, 0] if none survive. */
  centroid: Vec2;
  /** Weighted RMS radius about the centroid, mm. */
  rms: number;
  /** Max radius from the centroid among surviving points, mm (the "geometric" spot radius). */
  geometricRadius: number;
}

/**
 * Trace a pupil-sampling grid at one field point, for each wavelength in `nms`, and return the landing points on
 * the image plane plus weights and summary stats (feeds the bokeh disk and PSF work per ENGINE.md). Every sample
 * is kept in `samples` with its full RayPath, whether or not it reached the image plane 'ok' — a sample vignetted
 * by an element's sd nearer the field edge (the bokeh disk's cat's-eye cutoff), blocked by the iris, lost to TIR,
 * or missed geometrically is exactly as informative to a renderer as one that landed — but only 'ok' samples
 * contribute to centroid/rms/geometricRadius.
 */
export function spot(sys: TraceSystem, ep: Pupil, field: Field, grid: PupilGrid, nms: number[], aimOpts?: AimOptions): SpotResult[] {
  const base = pupilSamples(grid);
  return nms.map((nm) => {
    const samples: SpotSample[] = base.map(({ px, py, weight }) => ({
      px,
      py,
      weight,
      path: traceRay(sys, aimRay(sys, ep, field, px, py, nm, aimOpts)),
    }));

    const hits = samples.filter((s) => s.path.status === 'ok');
    const wSum = hits.reduce((a, s) => a + s.weight, 0);
    let centroid: Vec2 = [0, 0];
    let rms = 0;
    let geometricRadius = 0;

    if (wSum > 0) {
      let cx = 0;
      let cy = 0;
      for (const s of hits) {
        const p = s.path.pts[s.path.pts.length - 1];
        cx += (s.weight * p[0]) / wSum;
        cy += (s.weight * p[1]) / wSum;
      }
      centroid = [cx, cy];
      let msum = 0;
      for (const s of hits) {
        const p = s.path.pts[s.path.pts.length - 1];
        const dx = p[0] - cx;
        const dy = p[1] - cy;
        const r2 = dx * dx + dy * dy;
        msum += (s.weight * r2) / wSum;
        geometricRadius = Math.max(geometricRadius, Math.sqrt(r2));
      }
      rms = Math.sqrt(msum);
    }

    return { nm, samples, centroid, rms, geometricRadius };
  });
}
