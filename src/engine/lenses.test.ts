/// <reference types="vite/client" />
// Integration golden test: every real lens design in data/lenses/*.json, checked against its own patent-stated
// numbers (design.stated) and the design's own declared element/group counts. Data lands after the E1-E3 merge
// (other workstreams are writing data/glass/catalog.json and data/lenses/*.json in the main checkout as this is
// written); import.meta.glob resolves to an empty set today, so this file skips with a clear, named test rather
// than failing or silently passing. Nothing under data/ is ever `git add`ed from this workstream — the lead
// brings the real files in at the merge.

import { describe, it, expect } from 'vitest';
import { makeCatalog, type GlassCatalog, FRAUNHOFER_D_NM } from './glass';
import { loadLens, systemAt } from './lens';
import { cardinal } from './paraxial';
import { stopRadiusFor } from './iris';
import type { GlassEntry, LensDesign } from './lens-types';

const lensModules = import.meta.glob('../../data/lenses/*.json', { eager: true }) as Record<
  string, { default: LensDesign } | LensDesign
>;
const catalogModules = import.meta.glob('../../data/glass/catalog.json', { eager: true }) as Record<
  string, { default: unknown } | unknown
>;

function unwrap<T>(m: { default: T } | T): T {
  return (m as { default?: T }).default !== undefined ? (m as { default: T }).default : (m as T);
}

/** Adapts whatever shape catalog.json turns out to have to GlassEntry[], since another workstream owns that
 * file's exact layout. Accepts a bare array (the shape lens-types.ts most directly implies), or an object
 * carrying the array under a plausible key. Anything else is reported rather than guessed further. */
function adaptCatalogShape(raw: unknown): GlassEntry[] {
  if (Array.isArray(raw)) return raw as GlassEntry[];
  if (raw && typeof raw === 'object') {
    for (const key of ['glasses', 'entries', 'catalog']) {
      const v = (raw as Record<string, unknown>)[key];
      if (Array.isArray(v)) return v as GlassEntry[];
    }
  }
  throw new Error(
    'lenses.test.ts: data/glass/catalog.json is neither a bare array nor an object with a glasses/entries/' +
      'catalog array — report this shape to the lead rather than guessing further',
  );
}

const lensEntries = Object.entries(lensModules).map(([path, m]) => [path, unwrap(m)] as [string, LensDesign]);
const catalogPath = Object.keys(catalogModules)[0];

if (lensEntries.length === 0) {
  it.skip('no data/lenses/*.json files found yet — skipping (expected until data/ lands after the E1-E3 merge)', () => {});
} else if (!catalogPath) {
  it.skip('data/glass/catalog.json not found yet — skipping (expected until data/ lands after the E1-E3 merge)', () => {});
} else {
  const catalog: GlassCatalog = makeCatalog(adaptCatalogShape(unwrap(catalogModules[catalogPath])));


  for (const [path, design] of lensEntries) {
    describe(`${design.id} (${path})`, () => {
      // Built lazily inside the tests, so one lens's failure shows as that lens's failed tests instead of a
      // collection error that hides every other lens.
      let cache: { lens: ReturnType<typeof loadLens>; c: ReturnType<typeof cardinal> } | null = null;
      const get = () => {
        if (!cache) {
          const lens = loadLens(design, catalog);
          const sys = systemAt(lens, null);
          const stopR = stopRadiusFor(lens, design.maxFno);
          cache = { lens, c: cardinal(sys, FRAUNHOFER_D_NM, stopR) };
        }
        return cache;
      };

      it('loads without error', () => { expect(() => get()).not.toThrow(); });

      it(`efl within 0.5% of stated.f (${design.stated.f} mm)`, () => {
        // stated values are the patent's raw numbers; the engine works at the lens's real size (raw * scale)
        const f = design.stated.f * design.scale;
        const tol = Math.abs(f) * 0.005;
        expect(Math.abs(get().c.efl - f)).toBeLessThanOrEqual(tol);
      });

      if (design.stated.bf !== undefined) {
        it(`bfd within 1% or 0.2 mm of stated.bf (${design.stated.bf} mm)`, () => {
          const bf = design.stated.bf! * design.scale;
          const tol = Math.max(Math.abs(bf) * 0.01, 0.2);
          expect(Math.abs(get().c.bfd - bf)).toBeLessThanOrEqual(tol);
        });
      }

      it(`maxFno is the patent's own stated F-number (${design.stated.fno})`, () => {
        expect(design.maxFno).toBe(design.stated.fno);
      });

      it('the stop radius for maxFno gives that F-number and fits inside the stop clear aperture', () => {
        // Not circular: stopRadiusFor inverts the paraxial pupil imaging; cardinal() re-derives the f-number from
        // the resulting entrance pupil. The fit check catches a stop sd too small for the design's own aperture.
        const { lens, c } = get();
        expect(Math.abs(c.fno - design.maxFno) / design.maxFno).toBeLessThan(1e-6);
        const stop = design.surfaces.findIndex((s) => s.stop);
        const r = stopRadiusFor(lens, design.maxFno);
        expect(r, `stop radius ${r.toFixed(3)} vs sd ${lens.raw[stop].sd}`).toBeLessThanOrEqual(lens.raw[stop].sd * 1.001);
      });

      it('every glass reproduces the patent nd and vd (exact catalog match or model glass)', () => {
        const { lens } = get();
        for (const r of lens.glassResolutions) {
          const nd = lens.index(r.resolvedKey, FRAUNHOFER_D_NM);
          const nF = lens.index(r.resolvedKey, 486.1327), nC = lens.index(r.resolvedKey, 656.2725);
          const tolNd = r.kind === 'model' ? 1e-9 : 5e-5, tolVd = r.kind === 'model' ? 1e-6 : 0.06;
          expect(Math.abs(nd - r.nd), `surface ${r.surfaceIndex} ${r.resolvedKey} nd`).toBeLessThanOrEqual(tolNd);
          expect(Math.abs((nd - 1) / (nF - nC) - r.vd), `surface ${r.surfaceIndex} ${r.resolvedKey} vd`).toBeLessThanOrEqual(tolVd);
        }
      });

      it(`element count matches the file (${design.elements}; plates are not elements)`, () => {
        expect(get().lens.elements.length).toBe(design.elements);
      });

      it(`group count matches the file (${design.groups}; plates are not groups)`, () => {
        expect(get().lens.groups.length).toBe(design.groups);
      });
    });
  }
}
