import { describe, it, expect } from 'vitest';
import {
  makeCatalog, indexAt, resolveGlass, abbe, partialDispersion,
  FRAUNHOFER_D_NM, FRAUNHOFER_F_NM, FRAUNHOFER_C_NM,
} from './glass';
import type { GlassEntry } from './lens-types';
import catalogJson from '../../data/glass/catalog.json';

// SCHOTT N-BK7 Sellmeier coefficients, as published on the SCHOTT optical glass datasheet ("N-BK7 517642.25")
// and reproduced on refractiveindex.info's SCHOTT-BK7 page (both cite the same SCHOTT dispersion-formula
// coefficients; C in um^2). Datasheet-stated nd = 1.51680, vd (Abbe, d/F/C) = 64.17 — these are the golden,
// independently published values this test checks the formula against, not anything computed by this file.
const N_BK7: GlassEntry = {
  key: 'SCHOTT:N-BK7',
  catalog: 'SCHOTT',
  name: 'N-BK7',
  nd: 1.5168,
  vd: 64.17,
  formula: 'sellmeier3',
  coef: [1.03961212, 0.00600069867, 0.231792344, 0.0200179144, 1.01046945, 103.560653],
  range: [0.3, 2.5],
  source: 'SCHOTT optical glass data sheet N-BK7 517642.25 / refractiveindex.info SCHOTT-BK7',
  accessed: '9/28/2026',
};

describe('indexAt: golden — N-BK7 Sellmeier vs the SCHOTT datasheet', () => {
  it('nd at the d line matches the datasheet to 1e-4', () => {
    const nd = indexAt(N_BK7, FRAUNHOFER_D_NM);
    expect(nd).toBeCloseTo(1.5168, 4);
  });

  it('Abbe number computed from d/F/C indices matches the datasheet vd to 0.05', () => {
    // abbe() does not read entry.vd; it recomputes vd = (nd-1)/(nF-nC) from indexAt at the three Fraunhofer
    // lines, so this checks the dispersion formula's F/C behavior too, not just d.
    expect(abbe(N_BK7)).toBeCloseTo(64.17, 1);
  });

  it('index increases from C to F to (shorter than F) — normal dispersion', () => {
    const nC = indexAt(N_BK7, FRAUNHOFER_C_NM);
    const nD = indexAt(N_BK7, FRAUNHOFER_D_NM);
    const nF = indexAt(N_BK7, FRAUNHOFER_F_NM);
    expect(nC).toBeLessThan(nD);
    expect(nD).toBeLessThan(nF);
  });
});

describe('indexAt: schott (old) dispersion formula', () => {
  // A constant-index sanity fixture is not meaningful for this formula's shape, so instead check that a formula
  // with only a0 set (all other coefficients 0) reduces to n = sqrt(a0), which is the formula's definition at
  // any wavelength.
  it('reduces to sqrt(a0) when only the constant term is set', () => {
    const flat: GlassEntry = {
      key: 'TEST:flat-schott', catalog: 'TEST', name: 'flat', nd: 1.5, vd: 50,
      formula: 'schott', coef: [2.25, 0, 0, 0, 0, 0], range: [0.3, 2.5], source: 'synthetic', accessed: '9/28/2026',
    };
    expect(indexAt(flat, 550)).toBeCloseTo(1.5, 12);
    expect(indexAt(flat, 900)).toBeCloseTo(1.5, 12);
  });
});

describe('indexAt: edge cases', () => {
  it('throws outside the stated valid range rather than extrapolating', () => {
    const narrow: GlassEntry = { ...N_BK7, range: [0.4, 0.7] };
    expect(() => indexAt(narrow, 200)).toThrow(/range/);
    expect(() => indexAt(narrow, 5000)).toThrow(/range/);
  });

  it('accepts the range boundary itself', () => {
    const narrow: GlassEntry = { ...N_BK7, range: [0.4, 0.7] };
    expect(() => indexAt(narrow, 400)).not.toThrow();
    expect(() => indexAt(narrow, 700)).not.toThrow();
  });

  it("throws for an 'other' (RII formula 3) entry with a malformed coefficient list", () => {
    const other: GlassEntry = { ...N_BK7, formula: 'other', coef: [] };
    expect(() => indexAt(other, 550)).toThrow(/coefficients/);
  });

  it("evaluates 'other' = RII formula 3 (HIKARI E-KZFH1) to the catalog's nd and vd", () => {
    // Catalog values nd 1.61266, vd 44.461379 (HIKARI via refractiveindex.info; research/glass-sources.md hand check).
    const e = (catalogJson as GlassEntry[]).find((g) => g.key === 'HIKARI:E-KZFH1')!;
    expect(e.formula).toBe('other');
    const nd = indexAt(e, 587.5618), nF = indexAt(e, 486.1327), nC = indexAt(e, 656.2725);
    expect(nd).toBeCloseTo(1.61266, 5);
    expect((nd - 1) / (nF - nC)).toBeCloseTo(44.4614, 2);
  });

  it('throws for a malformed coefficient count', () => {
    const bad: GlassEntry = { ...N_BK7, coef: [1, 2, 3] };
    expect(() => indexAt(bad, 550)).toThrow(/coefficients/);
  });
});

describe('partialDispersion', () => {
  it('P(g,F) for N-BK7 is close to the commonly published value (~0.5349)', () => {
    // Independently known reference value for N-BK7's P(g,F), widely reproduced in glass-catalog literature
    // (e.g. SCHOTT TIE-29 worked examples). Loose tolerance since this is a secondary cross-check, not the
    // primary golden test.
    expect(partialDispersion(N_BK7).PgF).toBeCloseTo(0.5349, 2);
  });
});

describe('makeCatalog', () => {
  it('looks up by key and lists entries', () => {
    const cat = makeCatalog([N_BK7]);
    expect(cat.get('SCHOTT:N-BK7')).toBe(N_BK7);
    expect(cat.get('nope')).toBeUndefined();
    expect(cat.keys()).toEqual(['SCHOTT:N-BK7']);
    expect(cat.entries()).toEqual([N_BK7]);
  });

  it('rejects a duplicate key', () => {
    expect(() => makeCatalog([N_BK7, { ...N_BK7 }])).toThrow(/duplicate/);
  });
});

describe('resolveGlass: nearest by normalized nd/vd distance', () => {
  const F2: GlassEntry = { ...N_BK7, key: 'SCHOTT:F2', name: 'F2', nd: 1.62, vd: 36.37 };
  const SF11: GlassEntry = { ...N_BK7, key: 'SCHOTT:SF11', name: 'SF11', nd: 1.7847, vd: 25.76 };
  const cat = makeCatalog([N_BK7, F2, SF11]);

  it('finds an exact match with zero distance', () => {
    const m = resolveGlass(cat, 1.5168, 64.17);
    expect(m.entry.key).toBe('SCHOTT:N-BK7');
    expect(m.dnd).toBeCloseTo(0, 12);
    expect(m.dvd).toBeCloseTo(0, 12);
  });

  it('finds the nearer of two candidates roughly equidistant in nd alone', () => {
    // nd=1.70 sits almost exactly between F2 (1.62) and SF11 (1.7847) in nd, so vd must decide it: vd=30 is much
    // closer to SF11's 25.76 than F2's 36.37, so SF11 should win despite nd favoring neither strongly.
    const m = resolveGlass(cat, 1.70, 30);
    expect(m.entry.key).toBe('SCHOTT:SF11');
  });

  it('reports signed dnd/dvd (requested minus matched)', () => {
    const m = resolveGlass(cat, 1.52, 63);
    expect(m.entry.key).toBe('SCHOTT:N-BK7');
    expect(m.dnd).toBeCloseTo(1.52 - 1.5168, 10);
    expect(m.dvd).toBeCloseTo(63 - 64.17, 10);
  });

  it('throws on an empty catalog rather than returning a fabricated match', () => {
    expect(() => resolveGlass(makeCatalog([]), 1.5, 50)).toThrow(/empty/);
  });
});
