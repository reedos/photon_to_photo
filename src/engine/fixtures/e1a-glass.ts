// Hand-built glass/index helpers for workstream E1a's fixtures and golden tests. This is NOT the real glass
// catalog (that's E1b's glass.ts reading data/glass/catalog.json) — just enough dispersion to build small
// TraceSystems by hand and trace rays through them without depending on E1b's code.

import type { TraceSystem } from '../types';

/**
 * N-BK7 (SCHOTT), 3-term Sellmeier dispersion formula, wavelength in micrometers:
 *   n(lambda)^2 = 1 + sum_i Bi * lambda^2 / (lambda^2 - Ci)
 * Coefficients from the SCHOTT Optical Glass Datasheet N-BK7 (media.schott.com/api/public/content/
 * 41e799d0bf874807a0bb8e702fbb75b5, "Dispersion formula" section), cross-checked against the same values
 * tabulated at refractiveindex.info's SCHOTT collection (schott_2017-01-20.pdf); confirmed 2026-09-28. Valid
 * (per the datasheet) roughly 0.3-2.5 um; every Fraunhofer line this workstream tests against is well inside that.
 * nd and vd are the catalog's own reference-wavelength values, kept here only for a sanity check against the
 * Sellmeier evaluation (see e1a-glass.test.ts), not used by sellmeierIndex itself.
 */
export const N_BK7_SELLMEIER = {
  B: [1.03961212, 0.231792344, 1.01046945],
  C: [0.00600069867, 0.0200179144, 103.560653], // um^2
  nd: 1.5168,
  vd: 64.17,
};

export function sellmeierIndex(coef: { B: number[]; C: number[] }, nm: number): number {
  const lamUm = nm / 1000;
  const l2 = lamUm * lamUm;
  let n2 = 1;
  for (let i = 0; i < coef.B.length; i++) {
    n2 += (coef.B[i] * l2) / (l2 - coef.C[i]);
  }
  return Math.sqrt(n2);
}

/** A constant-index (no dispersion) medium map, for golden tests that check a closed-form formula which itself
 *  assumes a single fixed index — e.g. the thick-lens EFL check, which is independent of wavelength by
 *  construction only if the glass has none. `medium` 'air' always resolves to 1 regardless of `map`. */
export function constantIndex(map: Record<string, number>): TraceSystem['index'] {
  return (medium: string, _nm: number) => (medium === 'air' ? 1 : (map[medium] ?? 1));
}

/** N-BK7 dispersion behind every non-air medium name, for tests that care about real chromatic behavior. */
export function bk7Index(): TraceSystem['index'] {
  return (medium: string, nm: number) => (medium === 'air' ? 1 : sellmeierIndex(N_BK7_SELLMEIER, nm));
}
