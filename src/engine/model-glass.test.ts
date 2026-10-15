// Model glasses that reproduce a source-stated partial dispersion theta_g,F (lens.ts, pdQ / modelIndexAt), added in
// score loop r3 (10/11/2026) after the z800 PF model showed achromat-level blue focus: its SR-type L18 glass
// (nd 1.66382, vd 27.35, no catalog match) borrowed a normal flint's dispersion shape (theta_g,F 0.599) although
// the patent's Table 26 states theta_g,F = 0.6319 for it.
import { describe, it, expect } from 'vitest';
import cat from '../../data/glass/catalog.json';
import z800 from '../../data/lenses/z800.json';
import m500 from '../../data/lenses/m500.json';
import {
  makeCatalog, indexAt, FRAUNHOFER_C_NM, FRAUNHOFER_D_NM, FRAUNHOFER_F_NM, FRAUNHOFER_G_NM,
} from './glass';
import { loadLens, modelIndexAt, modelThetaGF, pdQ, systemAt } from './lens';
import { cardinal } from './paraxial';
import type { GlassEntry, LensDesign } from './lens-types';

const catalog = makeCatalog(cat as GlassEntry[]);
const D = FRAUNHOFER_D_NM, F = FRAUNHOFER_F_NM, C = FRAUNHOFER_C_NM, G = FRAUNHOFER_G_NM;

describe('model glass with a stated theta_g,F', () => {
  for (const [design, idx, theta] of [[z800, 15, 0.6319], [m500, 14, 0.6291]] as [LensDesign, number, number][]) {
    it(`${design.id} surface ${idx}: reproduces the patent nd, vd and theta_g,F exactly`, () => {
      const lens = loadLens(design, catalog);
      const res = lens.glassResolutions.find((r) => r.surfaceIndex === idx)!;
      expect(res.kind).toBe('model');
      expect(res.thetaGF).toBe(theta);
      const m = lens.models.get(res.resolvedKey)!;
      const n = (nm: number) => modelIndexAt(m, nm);
      const s = design.surfaces[idx];
      expect(n(D)).toBeCloseTo(s.nd!, 10);
      expect((n(D) - 1) / (n(F) - n(C))).toBeCloseTo(s.vd!, 8);
      expect(modelThetaGF(m)).toBeCloseTo(theta, 10);
    });
  }

  it('a thetaGF without its source is refused', () => {
    const bad = structuredClone(z800) as LensDesign;
    delete bad.surfaces[15].thetaGFSource;
    expect(() => loadLens(bad, catalog)).toThrow(/thetaGFSource/);
  });

  // The correction's shape (a change of curvature in 1/lambda^2) checked against real glasses: every catalog glass
  // whose theta_g,F sits at least 0.012 off the normal line is rebuilt from its nearest normal catalog glass, given
  // only its own nd, vd and theta_g,F, and the rebuilt n(lambda) - nd is compared with the real one from 420 to
  // 700 nm (in units of nF - nC, the quantity that sets longitudinal color).
  it('rebuilding anomalous catalog glasses from a normal neighbor: the curvature term cuts the error about 9x', () => {
    const traceable = (e: GlassEntry) => { try { indexAt(e, 420); indexAt(e, 700); return true; } catch { return false; } };
    const gl = (cat as GlassEntry[]).filter(traceable).map((e) => {
      const n = (nm: number) => indexAt(e, nm);
      const nd = n(D), dFC = n(F) - n(C), vd = (nd - 1) / dFC, th = (n(G) - n(F)) / dFC;
      return { e, n, nd, vd, th, dev: th - (0.6438 - 0.001682 * vd) }; // SCHOTT's normal line (TIE-29)
    });
    const errNone: number[] = [], errModel: number[] = [];
    for (const t of gl) {
      if (Math.abs(t.dev) < 0.012) continue;
      let best: (typeof gl)[number] | null = null, bd = Infinity;
      for (const b of gl) {
        if (b === t || Math.abs(b.dev) > 0.006) continue;
        const d = Math.hypot((t.nd - b.nd) / 0.5, (t.vd - b.vd) / 70);
        if (d < bd) { bd = d; best = b; }
      }
      if (!best || bd > 0.06) continue;
      const dFC = (t.nd - 1) / t.vd;
      const scale = dFC / (best.n(F) - best.n(C));
      const base = { key: 'x', nd: t.nd, vd: t.vd, base: best.e, baseNd: best.nd, scale };
      const thBase = modelThetaGF(base);
      const gq = ((t.th - thBase) * dFC) / (pdQ(G) - pdQ(F));
      const model = { ...base, gq, thetaGF: t.th };
      let eNone = 0, eModel = 0;
      for (let nm = 420; nm <= 700; nm += 5) {
        const real = t.n(nm) - t.nd;
        eNone = Math.max(eNone, Math.abs(modelIndexAt(base, nm) - t.nd - real) / dFC);
        eModel = Math.max(eModel, Math.abs(modelIndexAt(model, nm) - t.nd - real) / dFC);
      }
      errNone.push(eNone); errModel.push(eModel);
    }
    const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
    expect(errModel.length).toBeGreaterThan(50);
    expect(median(errModel)).toBeLessThan(0.004); // measured 10/11/2026: 0.0026 (78 glasses)
    expect(median(errNone)).toBeGreaterThan(0.015); // measured: 0.0239
    expect(errModel.filter((e, i) => e < errNone[i]).length / errModel.length).toBeGreaterThan(0.9);
  });

  // The patent's own longitudinal-aberration figure for Example 6 is an image in the patent PDF, not text, and was
  // not read; this pins the paraxial secondary spectrum the corrected model gives, against the 1.385 mm g-line
  // shift the borrowed shape produced. A well-corrected 780 mm PF design: every Fraunhofer line within 0.25 mm.
  it('z800 at infinity: g, F and C focus within 0.25 mm of the d line (was g +1.385 mm before theta_g,F)', () => {
    const sys = systemAt(loadLens(z800 as LensDesign, catalog), null);
    const zd = cardinal(sys, D).F2;
    for (const nm of [G, F, C]) expect(Math.abs(cardinal(sys, nm).F2 - zd), `${nm} nm`).toBeLessThan(0.25);
  });
});
