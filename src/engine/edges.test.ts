/// <reference types="vite/client" />
// Physical edges (edges.ts, the 10/11/2026 aperture review, R-L6 / LF-03). Expected values come from the geometry
// itself, not from the code under test: a scan of the realized surfaces that shares nothing with edges.ts, and a
// closed-form case for one biconvex element.
import { describe, it, expect } from 'vitest';
import { makeCatalog } from './glass';
import { loadLens, systemAt, type ResolvedLens } from './lens';
import { realize } from './realize';
import { capToPhysicalEdges, MIN_EDGE_MM, MIN_AIR_MM } from './edges';
import type { GlassEntry, LensDesign } from './lens-types';
import type { TraceSurface, TraceSystem } from './types';
import catalogJson from '../../data/glass/catalog.json';

const lensModules = import.meta.glob('../../data/lenses/*.json', { eager: true }) as Record<string, { default: LensDesign }>;
const catalog = makeCatalog(catalogJson as GlassEntry[]);

function sagOf(s: TraceSurface, h: number): number {
  // the even asphere, written out again here
  const c = s.c, k = s.k;
  let z = (c * h * h) / (1 + Math.sqrt(Math.max(0, 1 - (1 + k) * c * c * h * h)));
  s.a.forEach((a, j) => { z += a * h ** (4 + 2 * j); });
  return z;
}

describe('capToPhysicalEdges, one biconvex element (closed form)', () => {
  // R1 = +50, R2 = -50, 4 mm thick at the center. Thickness t(h) = 4 - 2 (50 - sqrt(2500 - h^2)), so a 0.5 mm edge
  // is at 50 - sqrt(2500 - h^2) = 1.75, h = sqrt(2500 - 48.25^2) = 13.1125 mm. Asking for sd 20 must give that.
  const surf = (z: number, c: number, medium: string): TraceSurface => ({ z, c, k: 0, a: [], sd: 20, kind: 'refract', mediumAfter: medium });
  const sys: TraceSystem = { surfaces: [surf(0, 1 / 50, 'G'), surf(4, -1 / 50, 'air'), { ...surf(50, 0, 'air'), kind: 'image', sd: 1e9 }], index: () => 1.5 };
  const lens = { elements: [{ index: 1, surfaces: [0, 1], groupId: 0 }], plates: [] } as unknown as ResolvedLens;
  const expected = Math.sqrt(2500 - (50 - (4 - MIN_EDGE_MM) / 2) ** 2);

  it(`caps both surfaces at the ${MIN_EDGE_MM} mm edge radius (${expected.toFixed(4)} mm)`, () => {
    const { sd, capped } = capToPhysicalEdges(lens, [sys], [20, 20]);
    expect(sd[0]).toBeCloseTo(expected, 2);
    expect(sd[1]).toBeCloseTo(expected, 2);
    expect(sd[0]).toBeLessThanOrEqual(expected);
    expect(capped.map((c) => [c.surface, c.before, c.rule])).toEqual([[0, 20, 'edge'], [1, 20, 'edge']]);
  });

  it('leaves a smaller aperture alone', () => {
    const { sd, capped } = capToPhysicalEdges(lens, [sys], [10, 12]);
    expect(sd).toEqual([10, 12]);
    expect(capped).toEqual([]);
  });

  it('holds the on-axis bundle where the glass is still physical (knife edge at 14 mm), and says so', () => {
    // the edge reaches 0 where 50 - sqrt(2500 - h^2) = 2: h = sqrt(2500 - 48^2) = 14 mm
    const { sd, capped } = capToPhysicalEdges(lens, [sys], [20, 20], [13.5, 13.5]);
    expect(sd[0]).toBeCloseTo(13.5, 6);
    expect(capped[0].relaxed).toBe(true);
    expect(capped[0].axialCut).toBe(false);
    const cut = capToPhysicalEdges(lens, [sys], [20, 20], [14.5, 14.5]);
    expect(cut.sd[0]).toBeLessThan(14);
    expect(cut.capped[0].axialCut).toBe(true);
  });
});

for (const m of Object.values(lensModules)) {
  const d = m.default;
  describe(`physical edges ${d.id}`, () => {
    let cache: ReturnType<typeof realize> | null = null;
    const get = () => (cache ??= realize(loadLens(d, catalog)));

    it('no two consecutive glass surfaces cross inside their clear apertures, at infinity or the closest focus', () => {
      const lens = get();
      for (const sys of [systemAt(lens, null), systemAt(lens, lens.realization.closestFocusMm, { clamp: true })]) {
        const S = sys.surfaces;
        for (let i = 0; i + 1 < S.length; i++) {
          const a = S[i], b = S[i + 1];
          if (b.kind === 'image' || a.kind === 'stop' || b.kind === 'stop') continue;
          const before = i === 0 ? 'air' : S[i - 1].mediumAfter;
          if (a.mediumAfter === 'air' && (before === 'air' || b.mediumAfter === 'air')) continue; // a dummy plane
          const hMax = Math.min(a.sd, b.sd);
          for (let k = 0; k <= 200; k++) {
            const h = (hMax * k) / 200;
            expect(b.z + sagOf(b, h) - (a.z + sagOf(a, h)), `${d.id} surfaces ${i}->${i + 1} at h ${h.toFixed(2)}`).toBeGreaterThan(-1e-3);
          }
        }
      }
    });

    it(`every element keeps a ${MIN_EDGE_MM} mm edge (or holds the on-axis bundle at a thinner one, logged)`, () => {
      const lens = get();
      const r = lens.realization;
      const sys = systemAt(lens, null);
      for (const e of lens.elements) {
        const [f, b] = e.surfaces;
        const sdF = r.sdRealized[f], sdB = r.sdRealized[b], rim = Math.max(sdF, sdB);
        const t = (h: number) => sys.surfaces[b].z + sagOf(sys.surfaces[b], Math.min(h, sdB)) - sys.surfaces[f].z - sagOf(sys.surfaces[f], Math.min(h, sdF));
        const need = Math.min(MIN_EDGE_MM, t(0)) - 2e-3;
        const relaxed = r.capped.some((c) => (c.surface === f || c.surface === b) && c.relaxed);
        for (let k = 0; k <= 200; k++) {
          const h = (rim * k) / 200;
          expect(t(h), `${d.id} element ${e.index} at h ${h.toFixed(2)}`).toBeGreaterThan(relaxed ? -1e-3 : need);
        }
      }
    });

    it(`neighboring elements keep ${MIN_AIR_MM} mm of air where both have glass (or touch at most, logged)`, () => {
      const lens = get();
      const r = lens.realization;
      for (const sys of [systemAt(lens, null), systemAt(lens, r.closestFocusMm, { clamp: true })]) {
        for (let i = 0; i + 1 < lens.elements.length; i++) {
          const A = lens.elements[i], B = lens.elements[i + 1];
          if (A.surfaces[1] === B.surfaces[0]) continue; // cemented
          const ra = Math.max(r.sdRealized[A.surfaces[0]], r.sdRealized[A.surfaces[1]]);
          const rb = Math.max(r.sdRealized[B.surfaces[0]], r.sdRealized[B.surfaces[1]]);
          const sa = sys.surfaces[A.surfaces[1]], sb = sys.surfaces[B.surfaces[0]];
          const g = (h: number) => sb.z + sagOf(sb, Math.min(h, r.sdRealized[B.surfaces[0]])) - sa.z - sagOf(sa, Math.min(h, r.sdRealized[A.surfaces[1]]));
          const need = Math.min(MIN_AIR_MM, g(0)) - 2e-3;
          const relaxed = r.capped.some((c) => [...A.surfaces, ...B.surfaces].includes(c.surface) && c.relaxed);
          for (let k = 0; k <= 200; k++) {
            const h = (Math.min(ra, rb) * k) / 200;
            expect(g(h), `${d.id} elements ${A.index}/${B.index} at h ${h.toFixed(2)}`).toBeGreaterThan(relaxed ? -1e-3 : need);
          }
        }
      }
    });

    it('logs every capped surface with its before and after value, and never caps the stop', () => {
      const r = get().realization;
      const stopIdx = get().raw.findIndex((s) => s.kind === 'stop');
      expect(r.sdRealized[stopIdx]).toBe(r.stopRadius);
      r.sdRealized.forEach((sd, s) => {
        const c = r.capped.find((x) => x.surface === s);
        if (c) {
          expect(c.before).toBe(r.sdSurveyed[s]);
          expect(c.after).toBe(sd);
          expect(c.after).toBeLessThan(c.before);
          // on 10/11/2026 no lens needed glass past a knife edge on axis. Since the autofocus shift (10/12/2026) p105's
          // closest focus pushes its focus group 0.13 mm further, and its L11 and L13 glass then touch 7 um inside the
          // on-axis marginal ray (15.288 against 15.295 mm, 0.05%): the physical limit wins by under 10 um, nowhere else.
          if (c.axialCut) expect(c.axialNeed - c.after, `${d.id} surface ${s}`).toBeLessThan(0.01);
        } else {
          expect(sd).toBe(r.sdSurveyed[s]);
        }
      });
    });
  });
}
