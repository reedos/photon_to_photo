// Which lens GLB a screen loads (score loop r6, 10/11/2026). On a phone-width screen the lighter variant that
// blender/lens_v2.py --lite writes (half the segments round the axis, 35-40% fewer triangles, the same parts, names and
// size; z800 245k to 154k), the full file elsewhere. The Models page chose this since round 5 (models.ts lensFile); the main
// scene, the lens piece and the opening's prefetch still sent the full file to phones, which this is for.
import lensFacts from 'virtual:p2p-facts/lenses';

interface Fact { glb: string; glbLite?: string }
const LENSES = (lensFacts as unknown as { lenses: Record<string, Fact> }).lenses;

/** The width at and under which a screen counts as a phone (the app's own phone breakpoint). */
export const PHONE_QUERY = '(max-width: 760px)';

export function isPhoneWidth(): boolean {
  try { return typeof matchMedia === 'function' && matchMedia(PHONE_QUERY).matches; } catch { return false; }
}

/** The file to load for a lens fact, as a path under public/ without the `public/` prefix ("models/lenses/n50.glb"). */
export function lensGlbPath(fact: Fact, phone: boolean = isPhoneWidth()): string {
  return (phone && fact.glbLite ? fact.glbLite : fact.glb).replace(/^public\//, '');
}

/** The same choice for a path already in hand ("models/lenses/n50.glb" -> its phone variant on a phone, when one exists). */
export function lensGlbPathFor(path: string, phone: boolean = isPhoneWidth()): string {
  const m = /^models\/lenses\/([^/.]+)\.glb$/.exec(path);
  const fact = m ? LENSES[m[1]] : undefined;
  return fact ? lensGlbPath(fact, phone) : path;
}
