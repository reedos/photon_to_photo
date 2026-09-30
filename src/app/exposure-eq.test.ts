// Equal exposure (docs/PANE.md, "Light and exposure"): one stop of aperture traded for one stop of shutter must leave
// the engine's photon count per pixel where it was, while the depth of field changes. The claim is checked against
// the engine itself (compute), not against the step function's own arithmetic.
import { describe, expect, it } from 'vitest';
import { compute } from './engine-api';
import { equalExposureStep, EQ_LIMITS } from './exposure-eq';

describe('equalExposureStep', () => {
  it('closing one stop multiplies the f-number by sqrt 2 and doubles the time', () => {
    const next = equalExposureStep({ fno: 4, shutter: 1 / 250 }, 1.8, 1)!;
    expect(next.fno).toBeCloseTo(4 * Math.SQRT2, 10);
    expect(next.shutter).toBeCloseTo(2 / 250, 12);
  });

  it('opening one stop divides the f-number by sqrt 2 and halves the time', () => {
    const next = equalExposureStep({ fno: 4, shutter: 1 / 250 }, 1.8, -1)!;
    expect(next.fno).toBeCloseTo(4 / Math.SQRT2, 10);
    expect(next.shutter).toBeCloseTo(1 / 500, 12);
  });

  it('refuses to open past the lens, close past f/22, or leave 1/8000 s to 30 s', () => {
    expect(equalExposureStep({ fno: 1.8, shutter: 1 / 250 }, 1.8, -1)).toBeNull();
    expect(equalExposureStep({ fno: 22, shutter: 1 / 250 }, 1.8, 1)).toBeNull();
    expect(equalExposureStep({ fno: 4, shutter: EQ_LIMITS.minShutter }, 1.8, -1)).toBeNull();
    expect(equalExposureStep({ fno: 4, shutter: EQ_LIMITS.maxShutter }, 1.8, 1)).toBeNull();
  });

  for (const lens of ['n50', 'm50', 'z800', 's35']) {
    it(`${lens}: the engine's photons per pixel stay put both ways while the depth of field changes`, () => {
      const base = compute({ lens, fno: 8, shutter: 1 / 250, focusM: 3 });
      for (const dir of [1, -1] as const) {
        const step = equalExposureStep(base.scenario, base.lens.maxFno, dir);
        if (!step) continue;
        const next = compute({ ...base.scenario, ...step });
        expect(next.scenario.fno).toBeCloseTo(step.fno!, 9);           // the engine took the exact value
        const rel = Math.abs(next.exposure.photonsMidGray - base.exposure.photonsMidGray) / base.exposure.photonsMidGray;
        expect(rel).toBeLessThan(1e-6);
        const dofBase = base.focus.farMm - base.focus.nearMm, dofNext = next.focus.farMm - next.focus.nearMm;
        if (dir === 1) expect(dofNext).toBeGreaterThan(dofBase); else expect(dofNext).toBeLessThan(dofBase);
      }
    });
  }
});
