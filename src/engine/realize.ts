// From a patent prescription to the lens as the camera uses it (lead, 09/28/2026).
//
// loadLens() reproduces the patent: its tests check EFL, back focus and glasses against the patent's own numbers.
// Three things a patent table does not give, and a working lens needs, are added here:
//
// 1. Autofocus offset. Patents place the image at the paraxial focus (or omit the back focus entirely). With
//    spherical aberration the best focus of a fast lens sits a little ahead of that, and autofocus puts the best
//    focus on the sensor. afOffset is the shift from the paraxial infinity image to the plane of minimum
//    polychromatic RMS spot radius on axis at full aperture (F, d and C lines). Evidence: derived.
// 2. Clear apertures. No patent in data/lenses lists them; the transcribers estimated them paraxially, which clips
//    real rays at the rims and cuts every off-axis bundle. Here each surface's clear semi-diameter is the largest
//    real-ray height it must pass: the full pupil on axis, and at each field fraction f of the design's half field
//    a pupil disk of radius v(f) = 1 - (1 - CORNER_PUPIL) * f^2 centered on the real chief ray. CORNER_PUPIL, the
//    fraction of the pupil diameter a fast prime passes at the corner wide open, is an ASSUMED design target: real
//    fast primes lose roughly 1.5 to 2.5 EV at the corner wide open, part of it cos^4 and part this mechanical
//    vignetting, which is also what turns corner bokeh into a cat's eye. The stop's own semi-diameter is the iris
//    wide open. Evidence: derived from the real-ray trace, with the corner fraction assumed.
//    Autofocus does this at every distance, not only at infinity (score loop r4, 10/12/2026): a fast lens wide open
//    at close range has best focus up to 0.1 mm or more from where its infinity offset would put it, so the
//    recorded disk of the point in focus came out 2 to 3.6 times the CoC. afShift is the table of that change with
//    distance, solved the same way (on-axis minimum RMS plane, F, d and C, wide open), and lens.ts's systemAt
//    follows it. afOffset is still measured from the patent's summed back focus (sensorZ); systemAt measures the
//    finite-focus target from the lens's own paraxial infinity image instead (lens.ts paraxialInfinityOffset).
// 3. Reachable closest focus. The focus gaps in a patent reach a stated close-focus condition; the product's
//    minimum focus (focus.minFocusM) can be closer. closestFocusMm is the larger of the two.
// 4. Clear apertures capped at the physical barrel (F6, 09/30/2026, Astra-6 review). (2)'s corner-pupil survey
//    can ask for glass wider than the lens's own published outer diameter allows (z800's front element came out
//    at 91.5 mm realized semi-diameter against a 140 mm max product diameter -- physically impossible: the front
//    element cannot be wider than the barrel it sits in). data/hardware/lens-exteriors.json's diameterMm gives
//    that outer diameter per lens id; every realized semi-diameter here is capped at diameterMm/2 - WALL_MM (an
//    assumed mechanical wall thickness between the clear aperture and the barrel's outside), and any survey ray
//    that needed more than the cap is counted as mechanically vignetted rather than allowed to enlarge the glass.
// 5. Clear apertures capped at physical edges (R-L6/LF-03, 10/11/2026 aperture review). The survey in (2) knows
//    nothing about glass being solid: on about 50 element pairs it asked for glass past where an element's two
//    surfaces meet or where it runs into its neighbor. edges.ts caps every sd so each element keeps a MIN_EDGE_MM
//    edge and MIN_AIR_MM of air to its neighbors (both assumed, documented there), at infinity and at the closest
//    focus, and lists each capped surface with its before and after value in Realization.capped. The cap never
//    touches the stop. Evidence: derived, with the two minimums assumed.

import type { AfShiftTable, ResolvedLens } from './lens';
import { paraxialInfinityOffset, systemAt } from './lens';
import { stopRadiusFor } from './iris';
import { cardinal, imageOf, objectForImage } from './paraxial';
import { FRAUNHOFER_D_NM } from './glass';
import { aimRay, traceRay, type Field } from './trace';
import type { TraceSystem } from './types';
import { capToPhysicalEdges, type CappedSurface } from './edges';
import lensExteriorsJson from '../../data/hardware/lens-exteriors.json';

export const CORNER_PUPIL = 0.55; // assumed, see (2) above
const AF_LINES = [486.1327, 587.5618, 656.2725]; // F, d, C
const SD_MARGIN_REL = 1.01;
const SD_MARGIN_ABS = 0.05; // mm
const AXIAL_MARGIN_MM = 0.01; // (5) keeps this much glass beyond the on-axis marginal ray when a minimum is relaxed

// Assumed mechanical wall thickness between the widest realized clear aperture and the lens's published outer
// diameter (barrel wall, retaining ring, etc.) -- see (4) above. Evidence: assumed.
export const BARREL_WALL_MM = 3;

/** The physical semi-diameter cap (mm) this lens's clear apertures may not exceed, or null when
 *  data/hardware/lens-exteriors.json has no exterior record for it (see (4) above). */
function barrelCapMmFor(lensId: string): number | null {
  const entry = (lensExteriorsJson as { lenses: Record<string, { diameterMm?: { v: number } } | undefined> }).lenses[lensId];
  const diameterMm = entry?.diameterMm?.v;
  return typeof diameterMm === 'number' ? diameterMm / 2 - BARREL_WALL_MM : null;
}

export interface Realization {
  afOffset: number;            // mm, +z = away from the lens
  onAxisRmsUm: number;         // polychromatic RMS spot radius at the sensor, full aperture, after afOffset
  stopRadius: number;          // mm, the iris wide open (design maxFno)
  halfFieldDeg: number;        // the field the clear apertures cover
  sdData: number[];            // the transcribed (estimated) semi-diameters, kept for audit
  sdSurveyed: number[];        // what the real-ray survey (2) and the barrel cap (4) asked for, before (5)
  sdRealized: number[];        // what the camera traces with: sdSurveyed capped to physical edges (5)
  capped: CappedSurface[];     // every surface (5) made smaller, with its before and after sd
  afShift: AfShiftTable;       // autofocus shift of the best focus against focus distance (see (1) above)
  closestFocusMm: number;      // from the sensor
  closestFocusSource: 'focus.minFocusM' | 'focus.gaps at their close condition';
  cornerPupil: number;
  fieldRaysBlockedGeometrically: number; // fraction of the clear-aperture survey rays no real lens could pass
}

export interface RealizedLens extends ResolvedLens {
  realization: Realization;
}

const AF_NODES = 8;           // autofocus shift nodes between the closest focus and infinity
const AF_RAYS_FINITE = 48;   // pupil rays per wavelength when solving the autofocus shift at a finite distance

/** Minimum polychromatic RMS plane (F, d, C, full aperture) of an on-axis bundle: the plane z of least RMS spot
 *  radius (analytic, see below), that radius (mm) and how many of the rays reached the image. zStart only sets the
 *  reference plane the rays are extended to. */
function bestFocusPlane(sys: TraceSystem, ep: { z: number; r: number }, field: Field, perLine: number, zStart: number): { z: number; rms: number; rays: number } {
  const ends: { p: number[]; d: number[] }[] = [];
  for (const nm of AF_LINES) {
    for (let i = 0; i < perLine; i++) {
      const [px, py] = fib(perLine, i);
      const path = traceRay(sys, aimRay(sys, ep, field, px, py, nm, { realAim: true }), { ignoreVignetting: true });
      if (path.status === 'ok') ends.push({ p: path.pts[path.pts.length - 1], d: path.dirOut! });
    }
  }
  if (ends.length === 0) return { z: zStart, rms: Infinity, rays: 0 };
  // Beyond the last surface every ray is a straight line, so a ray's position on the plane zStart + zr is
  // u + zr * s (u: where it crosses zStart, s: its slope) and the spot's variance is exactly quadratic in zr:
  // Var(u) + 2 zr Cov(u, s) + zr^2 Var(s), summed over x and y. Its minimum is analytic (no search, no step size).
  const n = ends.length;
  const u: number[] = [], v: number[] = [], sx: number[] = [], sy: number[] = [];
  for (const { p, d } of ends) {
    const kx = d[0] / d[2], ky = d[1] / d[2];
    u.push(p[0] + (zStart - p[2]) * kx); v.push(p[1] + (zStart - p[2]) * ky); sx.push(kx); sy.push(ky);
  }
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / n;
  const mu = mean(u), mv = mean(v), msx = mean(sx), msy = mean(sy);
  let varU = 0, varS = 0, cov = 0;
  for (let i = 0; i < n; i++) {
    varU += (u[i] - mu) ** 2 + (v[i] - mv) ** 2;
    varS += (sx[i] - msx) ** 2 + (sy[i] - msy) ** 2;
    cov += (u[i] - mu) * (sx[i] - msx) + (v[i] - mv) * (sy[i] - msy);
  }
  varU /= n; varS /= n; cov /= n;
  const zr = varS > 0 ? -cov / varS : 0;
  const bestRms = Math.sqrt(Math.max(0, varU + 2 * zr * cov + zr * zr * varS));
  return { z: zStart + zr, rms: bestRms, rays: n };
}

/** Best focus minus the paraxial image (mm, d line) for the on-axis point at objZ, wide open: what autofocus puts on
 *  the sensor. null when fewer than 80% of the rays reach the image. */
function bestMinusParaxial(sys: TraceSystem, objZ: number, stopRadius: number, perLine: number): { delta: number; rms: number } | null {
  const c = cardinal(sys, FRAUNHOFER_D_NM, stopRadius);
  const zPar = imageOf(sys, FRAUNHOFER_D_NM, objZ).z;
  const r = bestFocusPlane(sys, c.ep, { kind: 'object', o: [0, 0, objZ] }, perLine, zPar);
  if (r.rays < 0.8 * AF_LINES.length * perLine) return null;
  return { delta: r.z - zPar, rms: r.rms };
}

function fib(n: number, i: number): [number, number] {
  const r = Math.sqrt((i + 0.5) / n), a = i * 2.399963229728653; // golden angle
  return [r * Math.cos(a), r * Math.sin(a)];
}

function withStopSd(sys: TraceSystem, sd: number): TraceSystem {
  return { ...sys, surfaces: sys.surfaces.map((s) => (s.kind === 'stop' ? { ...s, sd } : s)) };
}

export function realize(lens: ResolvedLens): RealizedLens {
  const d = lens.design;
  const stopIdx = lens.raw.findIndex((r) => r.kind === 'stop');
  if (stopIdx < 0) throw new Error(`realize.ts: ${d.id} has no stop surface`);
  const stopRadius = stopRadiusFor(lens, d.maxFno);
  const sys0 = withStopSd(systemAt(lens, null), stopRadius);
  const c = cardinal(sys0, FRAUNHOFER_D_NM, stopRadius);

  // (1) autofocus offset: on-axis, full aperture, F/d/C, vignetting ignored (the clear apertures come next)
  const onAxis: Field = { kind: 'angle', ax: 0, ay: 0 };
  const zPar = sys0.surfaces[sys0.surfaces.length - 1].z; // the patent's summed back focus (afOffset not applied yet)
  const inf = bestFocusPlane(sys0, c.ep, onAxis, 160, zPar);
  if (inf.rays < 400) throw new Error(`realize.ts: ${d.id}: only ${inf.rays}/480 on-axis rays reach the image`);
  const bestRms = inf.rms;
  const afOffset = inf.z - zPar;
  // best focus minus the lens's own paraxial infinity image: the part a finite-focus solve keeps as is
  const deltaInf = afOffset - paraxialInfinityOffset(lens);

  // (3, computed first because the survey below uses it) closest focus the design can reach
  let closestFocusMm = d.focus.minFocusM * 1000;
  let closestFocusSource: Realization['closestFocusSource'] = 'focus.minFocusM';
  const gaps = d.focus.gaps ?? [];
  // (a design that extrapolates its gap table, focus.extrapolate, reaches minFocusM by construction)
  if (d.focus.method !== 'unit' && gaps.length && !d.focus.extrapolate) {
    // the system at t = 1, then the object distance whose best focus lands on the sensor
    const at1 = { ...lens, afOffset, raw: lens.raw.map((r, i) => {
      const g = gaps.find((gg) => gg.surface === i);
      return g ? { ...r, t: g.atClose * d.scale } : r;
    }) };
    const sys1 = withStopSd(systemAt(at1, null), stopRadius);
    // the sensor: the fixed sensorZ, or, when the table moves the back focus itself, the system's own image surface
    // (the same rule as systemAt's focus solve)
    const movesBackFocus = gaps.some((g) => g.surface === lens.raw.length - 1);
    const sensor = movesBackFocus ? sys1.surfaces[sys1.surfaces.length - 1].z : lens.sensorZ + afOffset;
    // F4 (09/30/2026, Astra-6 review): this used to bisect imageOf(objZ).z - target between two fixed brackets
    // (z=-1e6, z=-1) and skip the solve outright whenever f(lo) and f(hi) had the same sign -- which is exactly
    // what a bracket straddling imageOf's own conjugate pole looks like (the residual runs through +-Infinity
    // there, not through 0), not evidence that no root exists in between. p200's true root sat in exactly that
    // situation, so the search silently never ran and closestFocusMm fell back to the unrelated minFocusM spec.
    // objectForImage inverts the same paraxial imaging relation directly (a closed-form Mobius inverse — see its
    // own doc in paraxial.ts), with no bracket to miss and no pole to fall into.
    // r4: the paraxial image the object needs is the sensor less the best-focus offset AT THAT DISTANCE, which
    // depends on the distance; two or three passes settle it (the offset moves by micrometers per pass).
    let delta = deltaInf, fromSensor = 0;
    for (let pass = 0; pass < 4; pass++) {
      const objZ = objectForImage(sys1, FRAUNHOFER_D_NM, sensor - delta);
      fromSensor = sensor - objZ;
      const next = bestMinusParaxial(sys1, objZ, stopRadius, AF_RAYS_FINITE);
      if (next === null || Math.abs(next.delta - delta) < 1e-4) { if (next) delta = next.delta; break; }
      delta = next.delta;
    }
    if (fromSensor > closestFocusMm) { closestFocusMm = fromSensor; closestFocusSource = 'focus.gaps at their close condition'; }
  }

  // (1, continued) the autofocus shift at nodes from the closest focus out to infinity (v = closest / distance)
  const lensAf: ResolvedLens = { ...lens, afOffset };
  const afShift: AfShiftTable = { closestMm: closestFocusMm, v: [0], shiftMm: [0] };
  for (let k = 1; k <= AF_NODES; k++) {
    const v = k / AF_NODES, dist = closestFocusMm / v;
    // a first guess from the nodes before it (the shift is smooth in v)
    let shift = k > 2 ? 2 * afShift.shiftMm[k - 1] - afShift.shiftMm[k - 2] : k > 1 ? 2 * afShift.shiftMm[k - 1] : 0;
    for (let pass = 0; pass < 4; pass++) {
      const sys = withStopSd(systemAt(lensAf, dist, { clamp: true, afShiftMm: shift }), stopRadius);
      const zS = sys.surfaces[sys.surfaces.length - 1].z;
      const meas = bestMinusParaxial(sys, zS - dist, stopRadius, AF_RAYS_FINITE);
      if (meas === null) break; // too few rays reach the image to measure (never on axis for a lineup lens)
      const next = meas.delta - deltaInf;
      // the measured offset hardly depends on where the paraxial image was put, so a guess within 1 um of the
      // measurement is already converged (the next pass would move it by well under 0.1 um)
      const done = Math.abs(next - shift) < 1e-3;
      shift = next;
      if (done) break;
    }
    afShift.v.push(v); afShift.shiftMm.push(shift);
  }

  // (2) clear apertures from real rays over the field, at infinity focus and at the closest focus
  const halfFieldDeg = d.stated.halfFieldDeg ?? (Math.atan((d.stated.imageHeight ?? d.imageCircleMm / 2) / c.efl) * 180) / Math.PI;
  const need = lens.raw.map(() => 0);
  const axialNeed = lens.raw.map(() => 0); // the on-axis, full-aperture bundle alone (f = 0), for (5)
  const fields = [0, 0.25, 0.5, 0.75, 0.9, 1.0];
  // pupil samples: a Fibonacci disk plus the exact rim, so the marginal rays (px = 1) set the apertures they reach
  const pupil: [number, number][] = [];
  for (let i = 0; i < 90; i++) pupil.push(fib(90, i));
  for (let k = 0; k < 24; k++) pupil.push([Math.cos((k * Math.PI) / 12), Math.sin((k * Math.PI) / 12)]);
  // Off axis, a ray that fails geometrically (passes beyond where an element's two surfaces meet, or totally
  // internally reflects in a steep meniscus) is a ray the real lens cannot pass either: it counts as vignetted and
  // sets no clear aperture. On axis nothing may fail.
  let traced = 0, failed = 0, failedOnAxis = 0;
  const barrelCapMm = barrelCapMmFor(d.id);
  const focused = withStopSd(systemAt({ ...lens, afOffset, afShift }, closestFocusMm, { clamp: true }), stopRadius);
  const cClose = cardinal(focused, FRAUNHOFER_D_NM, stopRadius);
  const objZ = focused.surfaces[focused.surfaces.length - 1].z - closestFocusMm;
  for (const [sys, pup, atClose] of [[sys0, c.ep, false], [focused, cClose.ep, true]] as const) {
    for (const f of fields) {
      const v = 1 - (1 - CORNER_PUPIL) * f * f;
      const ang = (halfFieldDeg * f * Math.PI) / 180;
      const field: Field = atClose
        ? { kind: 'object', o: [0, (objZ - pup.z) * Math.tan(ang), objZ] }
        : { kind: 'angle', ax: 0, ay: ang };
      for (const nm of AF_LINES) {
        for (const [px, py] of pupil) {
          const path = traceRay(sys, aimRay(sys, pup, field, px * v, py * v, nm, { realAim: true }), { ignoreVignetting: true });
          traced++;
          if (path.status !== 'ok') { failed++; if (f === 0) failedOnAxis++; continue; }
          // F6 (09/30/2026, Astra-6 review): a ray this corner-pupil survey traces past the physical barrel is
          // not evidence the glass must be that wide -- it is exactly what a real barrel vignettes. Count it as
          // mechanically vignetted (like a geometric trace failure just above) rather than letting it enlarge
          // need[] (and so sdRealized) past what the lens can physically hold. On axis this must never happen
          // (a real product's full aperture has to fit inside its own published diameter), so it is held to the
          // same "on axis nothing may fail" invariant as a geometric failure.
          let exceedsBarrel = false;
          for (let s = 0; s < lens.raw.length; s++) {
            const p = path.pts[s + 1];
            const h = Math.hypot(p[0], p[1]);
            need[s] = Math.max(need[s], h);
            if (f === 0) axialNeed[s] = Math.max(axialNeed[s], h);
            if (barrelCapMm !== null && h > barrelCapMm) exceedsBarrel = true;
          }
          if (exceedsBarrel) { failed++; if (f === 0) failedOnAxis++; }
        }
      }
    }
  }
  if (failedOnAxis > 0) throw new Error(`realize.ts: ${d.id}: ${failedOnAxis} on-axis rays failed geometrically or exceeded the physical barrel`);
  const sdData = lens.raw.map((r) => r.sd);
  const sdSurveyed = need.map((h, s) => {
    const raw = s === stopIdx ? stopRadius : h * SD_MARGIN_REL + SD_MARGIN_ABS;
    return barrelCapMm !== null ? Math.min(raw, barrelCapMm) : raw;
  });
  // (5) physical edges: no element thinner than MIN_EDGE_MM at its rim and none running into its neighbor, at
  // infinity and at the closest focus (edges.ts). Rays the survey needed past these caps are vignetted by them.
  const { sd: sdRealized, capped } = capToPhysicalEdges(lens, [sys0, focused], sdSurveyed, axialNeed, AXIAL_MARGIN_MM);

  return applyRealization(lens, {
    afOffset, afShift, onAxisRmsUm: bestRms * 1000, stopRadius, halfFieldDeg, sdData, sdSurveyed, sdRealized, capped,
    fieldRaysBlockedGeometrically: failed / traced,
    closestFocusMm, closestFocusSource, cornerPupil: CORNER_PUPIL,
  });
}

/** The realized lens from realize()'s own numbers. realize() ends here; the app also uses it with the numbers
 *  realize() produced at build time (vite.config.ts, p2p-realizations), so the browser skips the survey, which cost
 *  1 to 1.5 s of main thread on a 4x-throttled phone at the first view of each lens (score loop r3). */
export function applyRealization(lens: ResolvedLens, realization: Realization): RealizedLens {
  return {
    ...lens,
    raw: lens.raw.map((r, s) => ({ ...r, sd: realization.sdRealized[s] })),
    afOffset: realization.afOffset,
    afShift: realization.afShift,
    realization,
  };
}
