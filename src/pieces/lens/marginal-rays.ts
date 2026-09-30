// Makes the ray fan actually show marginal rays clipping against a closing iris (design/LOOK.md, set piece 2:
// "the ray fan's marginal rays visibly clip against the closing blades -- that clipping is real geometry
// intersecting real rays, not a separate vignette effect layered on top").
//
// Why this needs its own module: engine-api.ts's lensFans() aims every ray at normalized pupil coordinates
// [-1, 1] relative to the CURRENT model's own entrance pupil radius (model.cardinal.ep.r), which is itself sized
// to the CURRENT f-number (src/engine/iris.ts stopRadiusFor()). So a ray requested at the pupil's edge (px = 1)
// always lands exactly on whatever the CURRENT stop's edge is -- stopping down re-fits every sampled ray inside
// the new, smaller opening instead of ever placing one outside it. Traced this way, no ray can ever be blocked
// by the iris test itself (TraceSystem.iris), which is why a straight lensFans(model, ...) call at two different
// f-numbers keeps drawing the same ray count: needs_from_lead, filed in docs/pieces/lens.md, that FanRequest/fan()
// take an explicit pupil radius (or a second model to borrow one from) so a piece can ask for a FIXED physical
// pupil sampling independent of the model passed in.
//
// The workaround here uses only engine functions, on their own outputs, the same way this piece's iris.ts
// already reuses bladeShapes() to animate: trace the fan once through a WIDE-OPEN variant of the model (every
// surface except the stop's own sd is identical regardless of f-number, since f-number only changes the stop's
// opening -- lens-types.ts/realize.ts), then re-test each ray's own already-traced crossing point at the stop
// plane against the CURRENT (possibly smaller) iris outline via engine/iris.ts's irisTest() -- the exact same
// test traceRay() applies internally, just applied here to a point traced through a wider aperture so it can
// actually fall outside the current one. A ray that fails is truncated at the stop plane (status 'iris'), same
// as a real one traceRay() would report; a ray that passes reuses its wide-open trace unchanged, since every
// surface after the stop is geometrically identical to what the current model would have traced anyway.
import type { Model, FanSet } from '../../engine/model-types';
import type { RayPath } from '../../engine/types';
import { compute, lensFans } from '../../app/engine-api';
import { irisTest } from '../../engine/iris';

export function marginalAwareFans(model: Model, fields: number[], nms: number[], rays: number): FanSet[] {
  const stopIndex = model.system.surfaces.findIndex((s) => s.kind === 'stop');
  if (stopIndex < 0 || model.scenario.fno <= model.lens.maxFno + 1e-9) {
    // Already wide open (or no stop found, which realize.ts guarantees can't happen): nothing to re-clip.
    return lensFans(model, { fields, nms, rays });
  }

  const wideModel = compute({ ...model.scenario, fno: model.lens.maxFno });
  const wideFans = lensFans(wideModel, { fields, nms, rays });
  const test = irisTest(model.lens.blades, model.iris.radius, model.lens.rounded, model.iris.rotation);

  return wideFans.map((set) => ({
    ...set,
    paths: set.paths.map((path): RayPath => {
      const stopPt = path.pts[stopIndex + 1];
      if (!stopPt) return path; // never reached the stop plane in the wide-open trace either
      if (test(stopPt[0], stopPt[1])) return path; // passes the current (possibly smaller) opening too
      // Blocked by the current iris: truncate exactly at the stop plane, same shape traceRay() itself returns
      // for an 'iris' status (pts up to and including the blocking surface, no dirOut).
      return { nm: path.nm, pts: path.pts.slice(0, stopIndex + 2), status: 'iris', blockedAt: stopIndex };
    }),
  }));
}
