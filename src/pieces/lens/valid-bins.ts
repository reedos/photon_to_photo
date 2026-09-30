// Which wavelength bins a lens can be traced at. The engine refuses (throws) to extrapolate a glass's dispersion
// past the wavelength range its catalog data states (glass.ts indexAt), and some lineup lenses carry a glass
// whose data stops short of the visible band's ends (n500: a HIKARI glass valid 400-700 nm, so the 392.5 nm bin
// cannot be traced). A piece asks the lens's own index function at each bin once and keeps the bins every glass
// in it covers; the part card says how many were drawn. No optics here: only which engine calls are valid.
import type { Model } from '../../engine/model-types';

const cache = new Map<string, number[]>();

export function traceableBins(model: Model, bins: readonly number[]): number[] {
  const media = [...new Set(model.system.surfaces.map((s) => s.mediumAfter).filter((m) => m && m !== 'air'))];
  const key = `${model.lens.id}|${media.join(',')}|${bins.join(',')}`;
  let out = cache.get(key);
  if (!out) {
    out = bins.filter((nm) => {
      try {
        for (const m of media) model.system.index(m, nm);
        return true;
      } catch {
        return false;
      }
    });
    cache.set(key, out);
  }
  return out;
}
