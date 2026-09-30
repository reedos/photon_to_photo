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
// 3. Reachable closest focus. The focus gaps in a patent reach a stated close-focus condition; the product's
//    minimum focus (focus.minFocusM) can be closer. closestFocusMm is the larger of the two.
// 4. Clear apertures capped at the physical barrel (F6, 09/30/2026, Astra-6 review). (2)'s corner-pupil survey
//    can ask for glass wider than the lens's own published outer diameter allows (z800's front element came out
//    at 91.5 mm realized semi-diameter against a 140 mm max product diameter -- physically impossible: the front
//    element cannot be wider than the barrel it sits in). data/hardware/lens-exteriors.json's diameterMm gives
//    that outer diameter per lens id; every realized semi-diameter here is capped at diameterMm/2 - WALL_MM (an
//    assumed mechanical wall thickness between the clear aperture and the barrel's outside), and any survey ray
//    that needed more than the cap is counted as mechanically vignetted rather than allowed to enlarge the glass.

import type { ResolvedLens } from './lens';
import { systemAt } from './lens';
import { stopRadiusFor } from './iris';
import { cardinal, objectForImage } from './paraxial';
import { FRAUNHOFER_D_NM } from './glass';
import { aimRay, traceRay, type Field } from './trace';
import type { TraceSystem } from './types';
import lensExteriorsJson from '../../data/hardware/lens-exteriors.json';

export const CORNER_PUPIL = 0.55; // assumed, see (2) above
const AF_LINES = [486.1327, 587.5618, 656.2725]; // F, d, C
const SD_MARGIN_REL = 1.01;
const SD_MARGIN_ABS = 0.05; // mm

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
  sdRealized: number[];        // what the camera traces with
  closestFocusMm: number;      // from the sensor
  closestFocusSource: 'focus.minFocusM' | 'focus.gaps at their close condition';
  cornerPupil: number;
  fieldRaysBlockedGeometrically: number; // fraction of the clear-aperture survey rays no real lens could pass
}

export interface RealizedLens extends ResolvedLens {
  realization: Realization;
}

function fib(n: number, i: number): [number, number] {
  const r = Math.sqrt((i + 0.5) / n), a = i * 2.399963229728653; // golden angle
  return [r * Math.cos(a), r * Math.sin(a)];
}

function withStopSd(sys: TraceSystem, sd: number): TraceSystem {
  return { ...sys, surfaces: sys.surfaces.map((s) => (s.kind === 'stop' ? { ...s, sd } : s)) };
}

/** Polychromatic RMS radius (mm) of a bundle's crossings with the plane z = zPlane. */
function rmsOnPlane(ends: { p: number[]; d: number[] }[], zPlane: number): number {
  let sx = 0, sy = 0;
  const xs: number[] = [], ys: number[] = [];
  for (const { p, d } of ends) {
    const t = (zPlane - p[2]) / d[2];
    const x = p[0] + t * d[0], y = p[1] + t * d[1];
    xs.push(x); ys.push(y); sx += x; sy += y;
  }
  const n = xs.length, cx = sx / n, cy = sy / n;
  let s = 0;
  for (let i = 0; i < n; i++) s += (xs[i] - cx) ** 2 + (ys[i] - cy) ** 2;
  return Math.sqrt(s / n);
}

export function realize(lens: ResolvedLens): RealizedLens {
  const d = lens.design;
  const stopIdx = lens.raw.findIndex((r) => r.kind === 'stop');
  if (stopIdx < 0) throw new Error(`realize.ts: ${d.id} has no stop surface`);
  const stopRadius = stopRadiusFor(lens, d.maxFno);
  const sys0 = withStopSd(systemAt(lens, null), stopRadius);
  const c = cardinal(sys0, FRAUNHOFER_D_NM, stopRadius);

  // (1) autofocus offset: on-axis, full aperture, F/d/C, vignetting ignored (the clear apertures come next)
  const ends: { p: number[]; d: number[] }[] = [];
  const onAxis: Field = { kind: 'angle', ax: 0, ay: 0 };
  for (const nm of AF_LINES) {
    for (let i = 0; i < 160; i++) {
      const [px, py] = fib(160, i);
      const path = traceRay(sys0, aimRay(sys0, c.ep, onAxis, px, py, nm, { realAim: true }), { ignoreVignetting: true });
      if (path.status === 'ok') ends.push({ p: path.pts[path.pts.length - 1], d: path.dirOut! });
    }
  }
  if (ends.length < 400) throw new Error(`realize.ts: ${d.id}: only ${ends.length}/480 on-axis rays reach the image`);
  const zPar = sys0.surfaces[sys0.surfaces.length - 1].z; // paraxial image (afOffset not applied yet)
  let best = 0, bestRms = rmsOnPlane(ends, zPar);
  for (let step = 0.05, lo = -2, hi = 2; step >= 0.0005; step /= 10) {
    for (let dz = lo; dz <= hi + 1e-12; dz += step) {
      const r = rmsOnPlane(ends, zPar + dz);
      if (r < bestRms) { bestRms = r; best = dz; }
    }
    lo = best - step; hi = best + step;
  }
  const afOffset = best;

  // (3, computed first because the survey below uses it) closest focus the design can reach
  let closestFocusMm = d.focus.minFocusM * 1000;
  let closestFocusSource: Realization['closestFocusSource'] = 'focus.minFocusM';
  const gaps = d.focus.gaps ?? [];
  // (a design that extrapolates its gap table, focus.extrapolate, reaches minFocusM by construction)
  if (d.focus.method !== 'unit' && gaps.length && !d.focus.extrapolate) {
    // the system at t = 1, then the object distance whose paraxial image lands on the paraxial sensor plane
    const at1 = { ...lens, raw: lens.raw.map((r, i) => {
      const g = gaps.find((gg) => gg.surface === i);
      return g ? { ...r, t: g.atClose * d.scale } : r;
    }) };
    const sys1 = systemAt(at1, null);
    // the sensor: the fixed sensorZ, or, when the table moves the back focus itself, the system's own image surface
    // (the same rule as systemAt's focus solve)
    const movesBackFocus = gaps.some((g) => g.surface === lens.raw.length - 1);
    const target = movesBackFocus ? sys1.surfaces[sys1.surfaces.length - 1].z - (lens.afOffset ?? 0) : lens.sensorZ;
    // F4 (09/30/2026, Astra-6 review): this used to bisect imageOf(objZ).z - target between two fixed brackets
    // (z=-1e6, z=-1) and skip the solve outright whenever f(lo) and f(hi) had the same sign -- which is exactly
    // what a bracket straddling imageOf's own conjugate pole looks like (the residual runs through +-Infinity
    // there, not through 0), not evidence that no root exists in between. p200's true root sat in exactly that
    // situation, so the search silently never ran and closestFocusMm fell back to the unrelated minFocusM spec.
    // objectForImage inverts the same paraxial imaging relation directly (a closed-form Mobius inverse — see its
    // own doc in paraxial.ts), with no bracket to miss and no pole to fall into.
    const objZ = objectForImage(sys1, FRAUNHOFER_D_NM, target);
    const fromSensor = target + afOffset - objZ;
    if (fromSensor > closestFocusMm) { closestFocusMm = fromSensor; closestFocusSource = 'focus.gaps at their close condition'; }
  }

  // (2) clear apertures from real rays over the field, at infinity focus and at the closest focus
  const halfFieldDeg = d.stated.halfFieldDeg ?? (Math.atan((d.stated.imageHeight ?? d.imageCircleMm / 2) / c.efl) * 180) / Math.PI;
  const need = lens.raw.map(() => 0);
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
  const focused = withStopSd(systemAt({ ...lens, afOffset }, closestFocusMm, { clamp: true }), stopRadius);
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
            if (barrelCapMm !== null && h > barrelCapMm) exceedsBarrel = true;
          }
          if (exceedsBarrel) { failed++; if (f === 0) failedOnAxis++; }
        }
      }
    }
  }
  if (failedOnAxis > 0) throw new Error(`realize.ts: ${d.id}: ${failedOnAxis} on-axis rays failed geometrically or exceeded the physical barrel`);
  const sdData = lens.raw.map((r) => r.sd);
  const sdRealized = need.map((h, s) => {
    const raw = s === stopIdx ? stopRadius : h * SD_MARGIN_REL + SD_MARGIN_ABS;
    return barrelCapMm !== null ? Math.min(raw, barrelCapMm) : raw;
  });

  const realized: RealizedLens = {
    ...lens,
    raw: lens.raw.map((r, s) => ({ ...r, sd: sdRealized[s] })),
    afOffset,
    realization: {
      afOffset, onAxisRmsUm: bestRms * 1000, stopRadius, halfFieldDeg, sdData, sdRealized,
      fieldRaysBlockedGeometrically: failed / traced,
      closestFocusMm, closestFocusSource, cornerPupil: CORNER_PUPIL,
    },
  };
  return realized;
}
