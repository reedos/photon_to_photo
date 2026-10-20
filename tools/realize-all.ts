// Build-time: realize() for every lens design, run by vite.config.ts (p2p-realizations) through Vite's module runner.
// The app hands these numbers to the engine at startup (primeRealizations), so a phone does not run each lens's
// real-ray survey on its main thread (score loop r3). Same code, same inputs: the result is what the browser would
// compute; src/engine/realize-prime.test.ts checks that applying such numbers reproduces realize() exactly.
import { GLASS_CATALOG, lensDesign, lensIds } from '../src/engine/data';
import { loadLens } from '../src/engine/lens';
import { realize, type Realization } from '../src/engine/realize';

/** Every value is a finite number, a string, or an array or object of them: JSON carries it exactly. */
function jsonExact(v: unknown): boolean {
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v === 'string' || typeof v === 'boolean') return true;
  if (Array.isArray(v)) return v.every(jsonExact);
  if (v && typeof v === 'object') return Object.values(v).every(jsonExact);
  return false;
}

export function allRealizations(): Record<string, Realization> {
  const out: Record<string, Realization> = {};
  for (const id of lensIds()) {
    try {
      const r = realize(loadLens(lensDesign(id), GLASS_CATALOG)).realization;
      if (jsonExact(r)) out[id] = r; // anything JSON cannot carry exactly is left to the browser
    } catch { /* a lens realize() rejects is left to the browser, which reports it as before */ }
  }
  return out;
}
