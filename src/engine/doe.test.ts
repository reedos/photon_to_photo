// Golden tests for diffractive (Phase Fresnel / DOE) surfaces: types.ts's `Doe`, surface.ts's `doeGradPhi`/
// `diffract`, paraxial.ts's DOE power term, and lens.ts's `scaleDoe`. See docs/engine/doe.md for the derivations
// and citations this file's expected values come from.

import { describe, it, expect } from 'vitest';
import type { Doe, TraceSurface, TraceSystem } from './types';
import { cardinal } from './paraxial';
import { diffract, doeGradPhi, refract, normalAt } from './surface';
import { traceRay } from './trace';
import { FRAUNHOFER_D_NM, FRAUNHOFER_F_NM, FRAUNHOFER_C_NM } from './glass';

const LAMBDA_D = FRAUNHOFER_D_NM;
const LAMBDA_F = FRAUNHOFER_F_NM;
const LAMBDA_C = FRAUNHOFER_C_NM;

function surf(z: number, c: number, sd: number, mediumAfter: string, opts: Partial<TraceSurface> = {}): TraceSurface {
  return { z, c, k: 0, a: [], sd, kind: 'refract', mediumAfter, ...opts };
}

function airSystem(surfaces: TraceSurface[]): TraceSystem {
  return { surfaces, index: (m) => (m === 'air' ? 1 : 1.5) };
}

// ---- a pure DOE lens on a flat substrate, f = 100 mm at lambda0 --------------------------------------------------

describe('DOE golden — flat-substrate kinoform lens, f = 100 mm at lambda0', () => {
  // phi(h) = (2*pi/lambda0) * C2 * h^2 brings a collimated beam to focus at f0 when C2 = -1/(2*f0) (m=1, lambda0);
  // see doePower's doc in paraxial.ts and docs/engine/doe.md. f0 = 100 mm -> C2 = -1/200 = -0.005 mm^-1.
  const lambda0Nm = 550;
  const f0 = 100;
  const doe: Doe = { convention: 'nikon-phase-diff-mm', lambda0Nm, order: 1, coeffs: [-1 / (2 * f0)] };
  // flat substrate (c=0), air both sides: only the grating has any power.
  const sysFixed: TraceSystem = airSystem([
    surf(0, 0, 30, 'air', { doe }),
    { z: 500, c: 0, k: 0, a: [], sd: 40, kind: 'image', mediumAfter: 'air' },
  ]);

  it('f = 100 mm exactly at lambda0 (m=1)', () => {
    expect(cardinal(sysFixed, lambda0Nm).efl).toBeCloseTo(f0, 9);
  });

  it('f = 100 * lambda0 / lambda at other wavelengths (the diffractive dispersion)', () => {
    for (const nm of [LAMBDA_F, LAMBDA_D, LAMBDA_C, 400, 700]) {
      const expected = (f0 * lambda0Nm) / nm;
      expect(cardinal(sysFixed, nm).efl).toBeCloseTo(expected, 6);
    }
  });

  it('a real (non-paraxial) on-axis marginal ray also converges to f = 100 * lambda0/lambda', () => {
    // Independent check by real ray tracing rather than the paraxial recursion under test in the previous case:
    // a ray at a small height h, parallel to the axis, should cross the axis at z = h / tan(deflection) ~= f for
    // small h (paraxial regime), matching the same closed form.
    const h = 0.05; // mm, small enough that the small-angle approximation is accurate to the tolerance below
    for (const nm of [LAMBDA_F, LAMBDA_D, LAMBDA_C]) {
      const ray = { o: [h, 0, -10] as [number, number, number], d: [0, 0, 1] as [number, number, number], nm };
      const path = traceRay(sysFixed, ray, { ignoreVignetting: true });
      expect(path.status).toBe('ok');
      const dir = path.dirOut!;
      // axis crossing from the surface point (h, 0, 0): z = 0 - h / (dx/dz)
      const zCross = 0 - h / (dir[0] / dir[2]);
      const expected = (f0 * lambda0Nm) / nm;
      expect(zCross).toBeCloseTo(expected, 1);
    }
  });
});

// ---- a ray at height h is deviated by exactly the grating angle --------------------------------------------------

describe('DOE golden — a ray is deviated by exactly the grating angle', () => {
  const lambda0Nm = 550;
  const doe: Doe = { convention: 'nikon-phase-diff-mm', lambda0Nm, order: 1, coeffs: [-0.004, 2e-6] };
  const flat = surf(0, 0, 30, 'air', { doe });

  it("diffract()'s output tangential wavevector matches the grating equation exactly (on-axis-normal incidence)", () => {
    // Ray straight down +z (no incident tangential component at a flat surface -> the entire post-surface
    // tangential wavevector is the grating's kick alone): n2*d2_t = m*(lambda/2pi)*grad(phi)(h).
    const h = 3;
    const nm = 486.1327;
    const n = normalAt(flat, h, 0);
    const out = diffract([0, 0, 1], n, 1, 1, h, 0, doe, nm)!;
    expect(out).not.toBeNull();
    const gradPhi = doeGradPhi(doe, h);
    const expectedTangential = (doe.order * (nm / 1e6) * gradPhi) / (2 * Math.PI); // n2 = 1
    expect(out[0]).toBeCloseTo(expectedTangential, 12);
    expect(out[1]).toBeCloseTo(0, 12);
    expect(out[0] * out[0] + out[1] * out[1] + out[2] * out[2]).toBeCloseTo(1, 12);
  });

  it('reduces exactly to refract() when every coefficient is zero', () => {
    const zeroDoe: Doe = { convention: 'nikon-phase-diff-mm', lambda0Nm: 550, order: 1, coeffs: [0, 0, 0] };
    const d: [number, number, number] = [0.1, 0.02, Math.sqrt(1 - 0.1 * 0.1 - 0.02 * 0.02)];
    const n: [number, number, number] = [0, 0, 1];
    const a = diffract(d, n, 1, 1.5168, 4, 1, zeroDoe, 550)!;
    const b = refract(d, n, 1, 1.5168)!;
    expect(a[0]).toBeCloseTo(b[0], 12);
    expect(a[1]).toBeCloseTo(b[1], 12);
    expect(a[2]).toBeCloseTo(b[2], 12);
  });

  it('an evanescent order (too strong a grating for the available angle budget) reports null, like TIR', () => {
    const strong: Doe = { convention: 'nikon-phase-diff-mm', lambda0Nm: 400, order: 5, coeffs: [-2] };
    const n: [number, number, number] = [0, 0, 1];
    const out = diffract([0, 0, 1], n, 1, 1, 50, 0, strong, 700);
    expect(out).toBeNull();
  });
});

// ---- effective Abbe number of a diffractive element ---------------------------------------------------------

describe('DOE golden — effective Abbe number is about -3.45', () => {
  // Buralli, D. A., and Morris, G. M., "Effective Abbe number for diffractive optical elements," Appl. Opt. 28,
  // 3006-3007 (1989): V_DOE = lambda_d / (lambda_F - lambda_C), using the same Fraunhofer d/F/C lines every glass
  // in this engine is characterized by (glass.ts's abbe()). Because DOE power K(lambda) = K_d * (lambda/lambda_d)
  // is exactly linear in lambda (see paraxial.ts's doePower), this ratio is independent of C2/f0/lambda0 -- it is
  // a property of the d/F/C wavelengths alone, exactly like a refractive glass's vd is a property of its
  // dispersion curve alone. Computed directly from a traced system below (not hand-derived from the wavelengths
  // in isolation) so the test also exercises paraxial.ts's DOE power path end to end.
  const lambda0Nm = 550;
  const f0 = 200;
  const doe: Doe = { convention: 'nikon-phase-diff-mm', lambda0Nm, order: 1, coeffs: [-1 / (2 * f0)] };
  const sysFixed: TraceSystem = airSystem([
    surf(0, 0, 30, 'air', { doe }),
    { z: 1000, c: 0, k: 0, a: [], sd: 40, kind: 'image', mediumAfter: 'air' },
  ]);

  it('V_DOE = f_d / (f_F - f_C) matches lambda_d / (lambda_F - lambda_C) ~= -3.45', () => {
    const Kd = 1 / cardinal(sysFixed, LAMBDA_D).efl;
    const KF = 1 / cardinal(sysFixed, LAMBDA_F).efl;
    const KC = 1 / cardinal(sysFixed, LAMBDA_C).efl;
    const vDoe = Kd / (KF - KC);
    const expected = LAMBDA_D / (LAMBDA_F - LAMBDA_C);
    expect(expected).toBeCloseTo(-3.4535, 3);
    expect(vDoe).toBeCloseTo(expected, 6);
    expect(vDoe).toBeCloseTo(-3.4535, 3);
  });
});

// ---- DOE + refractive achromat hybrid reduces the F-C focal shift vs. a refractive singlet -----------------------

describe('DOE golden — a diffractive-refractive hybrid achromat beats a refractive singlet', () => {
  // Standard achromatic-doublet power split (e.g. Hecht, Optics, 5th ed., eq. 6.9, applied with the SECOND
  // element's Abbe number replaced by the DOE's effective V; the technique itself -- pairing ordinary glass
  // dispersion against a diffractive element's strongly negative effective Abbe number to correct color with far
  // fewer elements -- is exactly the design principle behind Reed's own Nikon 500mm f/5.6E PF and the NIKKOR Z
  // 600mm f/6.3 PF lenses this workstream exists to model; textbook treatment in e.g. Wood, A. P., "Design of a
  // hybrid diffractive-refractive achromat," Appl. Opt. 31(14), 2494-2497 (1992), and O'Shea et al., *Diffractive
  // Optics*, SPIE Press, 2004, sec. 4.4, "Hybrid Optical Systems"):
  //   Phi_1/V_1 + Phi_2/V_2 = 0 (achromatic condition, F-C powers equal)  and  Phi_1 + Phi_2 = Phi_total
  //   => Phi_1 = Phi_total * V_1/(V_1-V_2),  Phi_2 = Phi_total * V_2/(V_2-V_1)
  const V1 = 64.17; // a typical crown glass (e.g. N-BK7's Abbe number), the refractive element
  const V2 = LAMBDA_D / (LAMBDA_F - LAMBDA_C); // the DOE's effective Abbe number, ~ -3.4535
  const PhiTotal = 1 / 100; // mm^-1, f = 100 mm combined
  const Phi1 = (PhiTotal * V1) / (V1 - V2);
  const Phi2 = (PhiTotal * V2) / (V2 - V1);

  // Model each element as a thin thing at z=0: the refractive one as a fixed-index (nd, matching V1 exactly by
  // construction below) thin singlet of power Phi1, the DOE with C2 chosen for Phi2 at lambda_d, order 1.
  const nd = 1.5168; // an arbitrary crown-like index; the fixture's "glass" is exact-Vd by construction, not a
  // real catalog entry (glass.test.ts covers real dispersion curves) -- this keeps the singlet's own F-C power
  // ratio exactly 1/V1 by definition, isolating the achromatic-combination arithmetic under test.
  function nAt(nmWave: number): number {
    // A glass with EXACTLY Abbe number V1 by construction: nF - nC = (nd-1)/V1, linear in wavelength between F
    // and C (close enough near d for this power-domain test, which only evaluates at d/F/C themselves).
    const dFC = (nd - 1) / V1;
    if (nmWave === LAMBDA_D) return nd;
    if (nmWave === LAMBDA_F) return nd + dFC / 2;
    if (nmWave === LAMBDA_C) return nd - dFC / 2;
    throw new Error('nAt: only d/F/C are defined for this fixture');
  }

  // Baseline: an all-refractive singlet reaching the SAME total power (f=100mm) alone. Thin lens R1=-R2=Rbase,
  // thin-lens power (n-1)*2/Rbase = PhiTotal -> Rbase = 2*(nd-1)/PhiTotal.
  const Rbase = (2 * (nd - 1)) / PhiTotal;
  function refractiveSingletSystem(): TraceSystem {
    return {
      surfaces: [
        surf(0, 1 / Rbase, 30, 'G'),
        surf(0, -1 / Rbase, 30, 'air'),
        { z: 1000, c: 0, k: 0, a: [], sd: 40, kind: 'image', mediumAfter: 'air' },
      ],
      index: (m, nmWave) => (m === 'air' ? 1 : nAt(nmWave)),
    };
  }

  // Hybrid: the refractive part carries only its achromatic share Phi1 (R1=-R2=R, thin-lens power Phi1), and a
  // flat-substrate DOE right behind it carries the rest, Phi2, at lambda_d, order 1 (Phi2 = -2*C2*lambda_d/lambda0
  // with lambda0=lambda_d -> C2 = -Phi2/2). Combined power is Phi1+Phi2 = PhiTotal by construction (same f=100mm
  // at the d line as the baseline singlet above), so only the DOE's dispersion differs between the two systems.
  const R = (2 * (nd - 1)) / Phi1;
  const C2 = -Phi2 / 2; // Phi2 at lambda_d, order 1: Phi2 = -2*C2 (lambda0=lambda_d)
  const doe: Doe = { convention: 'nikon-phase-diff-mm', lambda0Nm: LAMBDA_D, order: 1, coeffs: [C2] };
  function hybridSystem(): TraceSystem {
    return {
      surfaces: [
        surf(0, 1 / R, 30, 'G'),
        surf(0, -1 / R, 30, 'air', { doe }),
        { z: 1000, c: 0, k: 0, a: [], sd: 40, kind: 'image', mediumAfter: 'air' },
      ],
      index: (m, nmWave) => (m === 'air' ? 1 : nAt(nmWave)),
    };
  }

  it('both systems have the same efl at the d line (100 mm, by construction)', () => {
    expect(cardinal(refractiveSingletSystem(), LAMBDA_D).efl).toBeCloseTo(100, 3);
    expect(cardinal(hybridSystem(), LAMBDA_D).efl).toBeCloseTo(100, 3);
  });

  it('the hybrid all but eliminates the F-C focal (back focal distance) shift the singlet alone has', () => {
    const singletShift = Math.abs(
      cardinal(refractiveSingletSystem(), LAMBDA_F).bfd - cardinal(refractiveSingletSystem(), LAMBDA_C).bfd,
    );
    const hybridShift = Math.abs(cardinal(hybridSystem(), LAMBDA_F).bfd - cardinal(hybridSystem(), LAMBDA_C).bfd);
    expect(singletShift).toBeGreaterThan(1); // the singlet's own chromatic shift is not negligible (mm-scale)
    expect(hybridShift).toBeLessThan(singletShift / 50); // achromatized: at least ~50x smaller
    expect(hybridShift).toBeLessThan(0.05);
  });
});
