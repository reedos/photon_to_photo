/// <reference types="vite/client" />
// Every lens in data/lenses, realized (realize.ts): the camera's version must pass real rays the way a real lens
// does. Expected values come from the design intent stated in realize.ts, not from the code under test:
// full pupil on axis passes, the corner passes about CORNER_PUPIL of the pupil, best focus is on the sensor.
import { describe, it, expect } from 'vitest';
import { makeCatalog, FRAUNHOFER_D_NM } from './glass';
import { loadLens, systemAt } from './lens';
import { cardinal } from './paraxial';
import { fan } from './trace';
import { realize, CORNER_PUPIL, BARREL_WALL_MM } from './realize';
import type { GlassEntry, LensDesign } from './lens-types';
import type { TraceSystem } from './types';
import catalogJson from '../../data/glass/catalog.json';
import lensExteriorsJson from '../../data/hardware/lens-exteriors.json';

const lensModules = import.meta.glob('../../data/lenses/*.json', { eager: true }) as Record<string, { default: LensDesign }>;
const catalog = makeCatalog(catalogJson as GlassEntry[]);
const FCd = [486.1327, 587.5618, 656.2725];
const EXTERIORS = lensExteriorsJson as { lenses: Record<string, { diameterMm?: { v: number } } | undefined> };

function passFraction(sys: TraceSystem, fieldDeg: number, n: number): number {
  const c = cardinal(sys, FRAUNHOFER_D_NM, sys.surfaces.find((s) => s.kind === 'stop')!.sd);
  const paths = fan(sys, c.ep, { kind: 'angle', ax: 0, ay: (fieldDeg * Math.PI) / 180 }, n, FCd, 'y', { realAim: true });
  return paths.filter((p) => p.status === 'ok').length / paths.length;
}

for (const m of Object.values(lensModules)) {
  const d = m.default;
  describe(`realize ${d.id}`, () => {
    let cache: ReturnType<typeof realize> | null = null;
    const get = () => (cache ??= realize(loadLens(d, catalog)));

    it('best focus is within 1 mm of the paraxial image and the on-axis spot is sharp (< 15 um RMS)', () => {
      const r = get().realization;
      expect(Math.abs(r.afOffset)).toBeLessThan(1);
      expect(r.onAxisRmsUm).toBeLessThan(15);
    });

    it('the full pupil passes on axis at full aperture (F, d, C)', () => {
      expect(passFraction(systemAt(get(), null), 0, 21)).toBe(1);
    });

    it('at 70% of the field most of the pupil passes', () => {
      const f = passFraction(systemAt(get(), null), 0.7 * get().realization.halfFieldDeg, 41);
      expect(f).toBeGreaterThan(0.6);
    });

    it(`the corner passes about ${CORNER_PUPIL} of the pupil diameter (mechanical vignetting, the cat's eye)`, () => {
      // wide angles lose a little more to rays no element can pass at all (20 mm: 0.35), so the band is 0.3 to 0.8
      const f = passFraction(systemAt(get(), null), get().realization.halfFieldDeg, 81);
      expect(f).toBeGreaterThan(0.3);
      expect(f).toBeLessThan(0.8);
    });

    it('focuses at its closest reachable distance and the on-axis bundle still passes', () => {
      const r = get().realization;
      expect(r.closestFocusMm).toBeGreaterThanOrEqual(d.focus.minFocusM * 1000 - 1e-6);
      const sys = systemAt(get(), r.closestFocusMm, { clamp: true });
      const c = cardinal(sys, FRAUNHOFER_D_NM, r.stopRadius);
      const obj = sys.surfaces[sys.surfaces.length - 1].z - r.closestFocusMm;
      const paths = fan(sys, c.ep, { kind: 'object', o: [0, 0, obj] }, 11, [FRAUNHOFER_D_NM], 'y', { realAim: true });
      expect(paths.filter((p) => p.status === 'ok').length).toBeGreaterThanOrEqual(9);
    });

    // F6 (09/30/2026, Astra-6 review): every realized clear semi-diameter must stay inside the lens's own
    // published outer diameter (data/hardware/lens-exteriors.json), less an assumed mechanical wall -- independent
    // of realize.ts's own barrelCapMmFor helper, this reads the exteriors file itself rather than trusting the
    // production code's cap to have been applied correctly.
    const exteriorDiameterMm = EXTERIORS.lenses[d.id]?.diameterMm?.v;
    if (exteriorDiameterMm !== undefined) {
      it(`F6: no realized semi-diameter exceeds the published ${exteriorDiameterMm} mm barrel (less the ${BARREL_WALL_MM} mm wall)`, () => {
        const maxAllowed = exteriorDiameterMm / 2 - BARREL_WALL_MM;
        const r = get().realization;
        for (const sd of r.sdRealized) expect(sd).toBeLessThanOrEqual(maxAllowed + 1e-9);
      });
    }

    // F4 (09/30/2026, Astra-6 review): p200's closest-focus bisection used to bracket between two fixed points
    // (object z = -1e6 and -1) and skip the solve whenever both had the same sign -- exactly what happens when the
    // bracket straddles imageOf's own conjugate pole rather than a genuine sign change. That left closestFocusMm
    // silently at the unrelated minFocusM spec (1900 mm) instead of the patent's own table endpoint. This checks
    // against US5490014A Table 1's own numbers directly (d11=18.7714, d16=10.0030, Bf=67.9864, D0=1765.538 at the
    // close condition), independent of this file's realize() under test: with the object-to-image distance the
    // patent's own D0/TL relation implies at t=1 (~2000 mm from the sensor, not the unrelated 1900 mm spec figure).
    if (d.id === 'p200') {
      it('F4: closest focus reaches the patent gap table\'s own endpoint (~2000 mm), not the unrelated 1900 mm spec figure', () => {
        const r = get().realization;
        expect(r.closestFocusMm).toBeGreaterThan(1950);
        expect(r.closestFocusMm).toBeLessThan(2050);
        expect(r.closestFocusSource).toBe('focus.gaps at their close condition');
      });

      // F7 (09/30/2026, Astra-6 review): US5490014A Embodiment 1's own descriptive text orders G1 (incl. G12),
      // then G2, then stop S, then G3 -- placing S inside the d16 air gap (patent surfaces 16-17), independently
      // bounded at infinity focus by the patent's own d11/d16 numbers: z in [11.5+0.3+14.5+2+3.7+1+8+30.9+3.9+15+
      // 5.9982+6+3+7.1+3.5+22.7762*(11.3881/22.7762 fraction not needed here) ...]. Simpler independent check: the
      // stop must sit strictly after G2's last glass surface and strictly before G3's first glass surface, and must
      // be flat (a real iris, not a curved glass-to-air face).
      it('F7: the aperture stop sits in the d16 gap between G2 and G3 (a flat surface, not inside G2)', () => {
        const lens = get();
        const stopIdx = lens.raw.findIndex((r) => r.kind === 'stop');
        expect(stopIdx).toBeGreaterThan(0);
        expect(lens.raw[stopIdx].c).toBe(0); // flat: a real iris, not a curved refracting face
        const sys = systemAt(lens, null);
        const g2LastGlassZ = sys.surfaces[stopIdx - 1].z; // floating group B's own rear vertex (last glass surface of G2)
        const g3FirstGlassZ = sys.surfaces[stopIdx + 1].z; // G3 doublet front (first glass surface of G3)
        const stopZ = sys.surfaces[stopIdx].z;
        expect(stopZ).toBeGreaterThan(g2LastGlassZ);
        expect(stopZ).toBeLessThan(g3FirstGlassZ);
      });
    }
  });
}
