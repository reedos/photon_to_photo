// Small TraceSystems built by hand for workstream E1a's golden tests. None of these are real lens prescriptions
// (that is E1b's data/lenses/*.json + lens.ts) — just enough geometry to independently check surface.ts and
// trace.ts against closed-form optics. Curvature sign convention matches lens-types.ts: r (and so c = 1/r) is
// positive when the center of curvature is to the right (+z, the image side) of the vertex. So a simple biconvex
// lens (both faces bulging outward) has r1 > 0, r2 < 0.

import type { TraceSurface, TraceSystem } from '../types';
import { constantIndex } from './e1a-glass';

/** Flat front (r1 = infinity), convex rear (r2 < 0 to bulge toward +z) singlet in constant-index glass `n`,
 *  starting at z = 0, center thickness `t`, clear semi-aperture `sd`, image plane at `imageZ`. */
export function planoConvexSinglet(opts: { r2: number; t: number; n: number; sd: number; imageZ: number }): TraceSystem {
  const surfaces: TraceSurface[] = [
    { z: 0, c: 0, k: 0, a: [], sd: opts.sd, kind: 'refract', mediumAfter: 'glass', label: 'L1 front (flat)' },
    { z: opts.t, c: 1 / opts.r2, k: 0, a: [], sd: opts.sd, kind: 'refract', mediumAfter: 'air', label: 'L1 rear' },
    { z: opts.imageZ, c: 0, k: 0, a: [], sd: opts.sd * 5, kind: 'image', mediumAfter: 'air', label: 'image' },
  ];
  return { surfaces, index: constantIndex({ glass: opts.n }) };
}

/** Symmetric-or-not biconvex singlet: front r1 (> 0 for the usual outward bulge) and rear r2 (< 0), constant
 *  index `n`, center thickness `t`, clear semi-aperture `sd`, image plane at `imageZ`. */
export function biconvexSinglet(opts: { r1: number; r2: number; t: number; n: number; sd: number; imageZ: number }): TraceSystem {
  const surfaces: TraceSurface[] = [
    { z: 0, c: 1 / opts.r1, k: 0, a: [], sd: opts.sd, kind: 'refract', mediumAfter: 'glass', label: 'L1 front' },
    { z: opts.t, c: 1 / opts.r2, k: 0, a: [], sd: opts.sd, kind: 'refract', mediumAfter: 'air', label: 'L1 rear' },
    { z: opts.imageZ, c: 0, k: 0, a: [], sd: opts.sd * 5, kind: 'image', mediumAfter: 'air', label: 'image' },
  ];
  return { surfaces, index: constantIndex({ glass: opts.n }) };
}

/** A flat parallel plate (a cover glass / filter stand-in): two flat surfaces `t` mm apart in constant index `n`,
 *  front vertex at `z0`, image plane at `imageZ`. */
export function flatPlate(opts: { z0: number; t: number; n: number; sd: number; imageZ: number }): TraceSystem {
  const surfaces: TraceSurface[] = [
    { z: opts.z0, c: 0, k: 0, a: [], sd: opts.sd, kind: 'refract', mediumAfter: 'glass', label: 'plate front' },
    { z: opts.z0 + opts.t, c: 0, k: 0, a: [], sd: opts.sd, kind: 'refract', mediumAfter: 'air', label: 'plate rear' },
    { z: opts.imageZ, c: 0, k: 0, a: [], sd: opts.sd * 5, kind: 'image', mediumAfter: 'air', label: 'image' },
  ];
  return { surfaces, index: constantIndex({ glass: opts.n }) };
}

/**
 * A curved front group (two refracting surfaces) followed by a stop and an image plane. The curved group exists
 * purely to give an off-axis ray real pupil aberration (so its paraxial-entrance-pupil aim point and its actual
 * stop crossing differ by much more than a golden test's tolerance), for exercising `aimRay`'s `realAim` search
 * and the sd/iris vignetting tests. Not a plausible lens design. Curved enough to need real-ray aiming at a
 * ~20 deg field, but not so strongly curved (relative to its clear aperture and the field angles this workstream
 * tests) that the pupil-to-stop mapping stops being monotonic within the pupil — see the "aimRay real-ray
 * aiming" test for why that matters: a plain-Newton search is not expected to find a good root through a fold.
 */
export function frontGroupWithStop(opts: { n: number; stopSd: number; imageZ: number }): TraceSystem {
  const surfaces: TraceSurface[] = [
    { z: 0, c: 1 / 60, k: 0, a: [], sd: 15, kind: 'refract', mediumAfter: 'glass', label: 'G1 front' },
    { z: 4, c: -1 / 60, k: 0, a: [], sd: 15, kind: 'refract', mediumAfter: 'air', label: 'G1 rear' },
    { z: 12, c: 0, k: 0, a: [], sd: opts.stopSd, kind: 'stop', mediumAfter: 'air', label: 'stop' },
    { z: opts.imageZ, c: 0, k: 0, a: [], sd: 30, kind: 'image', mediumAfter: 'air', label: 'image' },
  ];
  return { surfaces, index: constantIndex({ glass: opts.n }) };
}
