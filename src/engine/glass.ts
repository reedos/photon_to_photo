// Glass dispersion and catalog matching. Pure functions; no data import here — the caller builds a catalog from
// entries it supplies (see makeCatalog). The lead wires data/glass/catalog.json to this after the merge.
//
// Conventions: see types.ts header. Wavelengths in nm everywhere in the engine's public API; the Sellmeier and
// Schott dispersion formulas are conventionally written with lambda in micrometers, so indexAt() converts
// internally and keeps nm at the boundary.

import type { GlassEntry } from './lens-types';

// Fraunhofer line wavelengths (nm), the standard set used to report nd/vd in optical glass catalogs. Same values
// ENGINE.md assigns to the (not-yet-built) spectrum.ts; duplicated here as local constants so glass.ts has no
// dependency on workstream E1a. Source: the standard Fraunhofer line list as published by glass makers (e.g.
// SCHOTT "TIE-29: Refractive Index and Dispersion", Table 1) and reproduced in optics references (Hecht, Optics).
const FRAUNHOFER_D_NM = 587.5618; // He d line
const FRAUNHOFER_F_NM = 486.1327; // H F line
const FRAUNHOFER_C_NM = 656.2725; // H C line
const FRAUNHOFER_G_NM = 435.8343; // Hg g line, used for partial dispersion P_g,F

/** A glass catalog: entries keyed as data/glass/catalog.json would key them (GlassEntry.key). */
export interface GlassCatalog {
  get(key: string): GlassEntry | undefined;
  keys(): string[];
  entries(): GlassEntry[];
}

/** Builds a catalog from entries the caller supplies. Engine modules never import data/ JSON directly. */
export function makeCatalog(entries: GlassEntry[]): GlassCatalog {
  const byKey = new Map<string, GlassEntry>();
  for (const e of entries) {
    if (byKey.has(e.key)) throw new Error(`glass.ts: makeCatalog: duplicate glass key "${e.key}"`);
    byKey.set(e.key, e);
  }
  return {
    get: (key: string) => byKey.get(key),
    keys: () => Array.from(byKey.keys()),
    entries: () => Array.from(byKey.values()),
  };
}

/**
 * Refractive index of a glass entry at a wavelength (nm), by the dispersion formula the entry carries.
 *
 * sellmeier3: the three-term Sellmeier equation,
 *   n(lambda)^2 = 1 + B1*lambda^2/(lambda^2-C1) + B2*lambda^2/(lambda^2-C2) + B3*lambda^2/(lambda^2-C3)
 * with lambda in micrometers and coef = [B1, C1, B2, C2, B3, C3]. This is the formula SCHOTT, OHARA and most
 * modern optical glass catalogs fit and publish (e.g. SCHOTT "TIE-29: Refractive Index and Dispersion", section 2;
 * the coefficient convention matches refractiveindex.info's SCHOTT/OHARA database entries).
 *
 * schott: the older "Schott formula" (a.k.a. the Sellmeier-derived polynomial form some pre-1990s Schott sheets
 * and legacy catalogs still list),
 *   n(lambda)^2 = a0 + a1*lambda^2 + a2*lambda^-2 + a3*lambda^-4 + a4*lambda^-6 + a5*lambda^-8
 * with lambda in micrometers and coef = [a0, a1, a2, a3, a4, a5]. Source: SCHOTT TIE-29, section 2, "old Schott
 * formula".
 *
 * Throws outside the entry's stated valid wavelength range (entry.range, um) rather than silently extrapolating,
 * and throws for a formula this function does not implement ('other') rather than guessing.
 */
export function indexAt(entry: GlassEntry, nm: number): number {
  const um = nm / 1000;
  const [lo, hi] = entry.range;
  if (um < lo || um > hi) {
    throw new Error(
      `glass.ts: indexAt: ${nm} nm (${um.toFixed(4)} um) is outside ${entry.key}'s stated valid range ` +
        `[${lo}, ${hi}] um`,
    );
  }
  const um2 = um * um;
  if (entry.formula === 'sellmeier3') {
    if (entry.coef.length !== 6) {
      throw new Error(`glass.ts: indexAt: ${entry.key} is sellmeier3 but has ${entry.coef.length} coefficients, want 6`);
    }
    const [B1, C1, B2, C2, B3, C3] = entry.coef;
    const n2 = 1 + (B1 * um2) / (um2 - C1) + (B2 * um2) / (um2 - C2) + (B3 * um2) / (um2 - C3);
    if (!(n2 > 0)) throw new Error(`glass.ts: indexAt: ${entry.key} at ${nm} nm gave n^2 = ${n2} (near a pole)`);
    return Math.sqrt(n2);
  }
  if (entry.formula === 'schott') {
    if (entry.coef.length !== 6) {
      throw new Error(`glass.ts: indexAt: ${entry.key} is schott but has ${entry.coef.length} coefficients, want 6`);
    }
    const [a0, a1, a2, a3, a4, a5] = entry.coef;
    const n2 = a0 + a1 * um2 + a2 / um2 + a3 / um2 ** 2 + a4 / um2 ** 3 + a5 / um2 ** 4;
    if (!(n2 > 0)) throw new Error(`glass.ts: indexAt: ${entry.key} at ${nm} nm gave n^2 = ${n2} (near a pole)`);
    return Math.sqrt(n2);
  }
  if (entry.formula === 'other') {
    // refractiveindex.info "formula 3", stored raw (research/glass-sources.md, conversion policy item 3):
    //   n^2 = c0 + sum_i a_i * lambda^e_i,  coef = [c0, a1, e1, a2, e2, ...], lambda in um.
    // The catalog uses 'other' for exactly this shape (181 HIKARI extended-range glasses) and nothing else.
    const c = entry.coef;
    if (c.length < 3 || c.length % 2 !== 1) {
      throw new Error(`glass.ts: indexAt: ${entry.key} is 'other' (RII formula 3) but has ${c.length} coefficients, want 1 + 2k`);
    }
    let n2 = c[0];
    for (let i = 1; i < c.length; i += 2) n2 += c[i] * um ** c[i + 1];
    if (!(n2 > 0)) throw new Error(`glass.ts: indexAt: ${entry.key} at ${nm} nm gave n^2 = ${n2}`);
    return Math.sqrt(n2);
  }
  throw new Error(
    `glass.ts: indexAt: formula "${entry.formula}" for ${entry.key} is not implemented (only sellmeier3, schott ` +
      `and other = RII formula 3 are); add it here rather than guessing`,
  );
}

export interface GlassMatch {
  entry: GlassEntry;
  dnd: number; // requested nd minus the matched entry's nd (signed)
  dvd: number; // requested vd minus the matched entry's vd (signed)
}

/**
 * The catalog entry nearest (nd, vd), by a distance normalized to each quantity's spread across the catalog so nd
 * (typically 1.4-2.0) and vd (typically 20-95) contribute comparably — an unnormalized Euclidean distance would be
 * dominated by vd's much larger numeric range. Normalization: divide each axis's difference by that axis's
 * (max-min) across the supplied catalog (falling back to 1 for a degenerate single-entry or zero-spread catalog).
 * This is an engineering choice (ENGINE.md asks for "nearest by a normalized nd/vd distance" without specifying
 * the normalization), documented here rather than in a citation. dnd/dvd on the result are the raw (unnormalized)
 * differences, for the caller to judge match quality against its own tolerance.
 */
export function resolveGlass(catalog: GlassCatalog, nd: number, vd: number): GlassMatch {
  const entries = catalog.entries();
  if (entries.length === 0) throw new Error('glass.ts: resolveGlass: catalog is empty');
  let ndLo = Infinity, ndHi = -Infinity, vdLo = Infinity, vdHi = -Infinity;
  for (const e of entries) {
    if (e.nd < ndLo) ndLo = e.nd;
    if (e.nd > ndHi) ndHi = e.nd;
    if (e.vd < vdLo) vdLo = e.vd;
    if (e.vd > vdHi) vdHi = e.vd;
  }
  const ndRange = ndHi - ndLo || 1;
  const vdRange = vdHi - vdLo || 1;
  let best: GlassEntry | null = null;
  let bestDist = Infinity;
  for (const e of entries) {
    const dNd = (nd - e.nd) / ndRange;
    const dVd = (vd - e.vd) / vdRange;
    const dist = Math.sqrt(dNd * dNd + dVd * dVd);
    if (dist < bestDist) {
      bestDist = dist;
      best = e;
    }
  }
  // best is non-null: entries.length > 0 guarantees at least one iteration sets it.
  const entry = best!;
  return { entry, dnd: nd - entry.nd, dvd: vd - entry.vd };
}

/**
 * Abbe number, computed independently of whatever entry.vd states, from the entry's own dispersion formula
 * evaluated at the d, F and C Fraunhofer lines: vd = (nd - 1) / (nF - nC). Standard definition (e.g. Hecht,
 * Optics, 5th ed., section 5.5.3, "The Abbe Number"). Comparing this to entry.vd is exactly the datasheet
 * cross-check the golden tests run.
 */
export function abbe(entry: GlassEntry): number {
  const nd = indexAt(entry, FRAUNHOFER_D_NM);
  const nF = indexAt(entry, FRAUNHOFER_F_NM);
  const nC = indexAt(entry, FRAUNHOFER_C_NM);
  return (nd - 1) / (nF - nC);
}

/**
 * Partial dispersion P(g,F) = (ng - nF) / (nF - nC), the standard measure of a glass's departure from the "normal
 * line" used to predict secondary-spectrum (apochromatic) correction. Source: Hecht, Optics, 5th ed., section
 * 5.5.3; SCHOTT TIE-29, section 3 ("Partial Dispersion").
 */
export function partialDispersion(entry: GlassEntry): { PgF: number } {
  const ng = indexAt(entry, FRAUNHOFER_G_NM);
  const nF = indexAt(entry, FRAUNHOFER_F_NM);
  const nC = indexAt(entry, FRAUNHOFER_C_NM);
  return { PgF: (ng - nF) / (nF - nC) };
}

export { FRAUNHOFER_D_NM, FRAUNHOFER_F_NM, FRAUNHOFER_C_NM, FRAUNHOFER_G_NM };
