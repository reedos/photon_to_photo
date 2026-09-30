import { describe, it, expect } from 'vitest';
import {
  j0,
  j1,
  J1_FIRST_ZERO,
  airyRadius,
  airyIntensity,
  encircledEnergy,
  mtfDiffraction,
  diffractionLimitFNumber,
  diffractionLimitFNumber2px,
  diffractionLimitFNumber1_5px,
  psfOnPixels,
} from './diffraction';

// Independent reference for J0/J1, computed in this test file (not imported from diffraction.ts): the integral
// representation J_n(x) = (1/pi) INT_0^pi cos(n*theta - x*sin(theta)) d(theta) (DLMF 10.9.2), numerically
// integrated by composite Simpson's rule. N=2000 was checked by hand (against N=200000) to already match to 10
// decimal digits at the x values this suite uses, so it is more than enough to catch a real implementation bug.
function besselQuadrature(order: 0 | 1, x: number, N = 2000): number {
  const h = Math.PI / N;
  let sum = 0;
  for (let i = 0; i <= N; i++) {
    const theta = i * h;
    const f = Math.cos(order * theta - x * Math.sin(theta));
    const w = i === 0 || i === N ? 1 : i % 2 === 0 ? 2 : 4;
    sum += w * f;
  }
  return (sum * (h / 3)) / Math.PI;
}

describe('j1/j0 against an independent quadrature reference', () => {
  it('j1 matches the quadrature reference to within 1e-6 across x in [0.01, 60]', () => {
    let maxErr = 0;
    for (let x = 0.01; x <= 60; x += 0.7) {
      const err = Math.abs(j1(x) - besselQuadrature(1, x));
      if (err > maxErr) maxErr = err;
    }
    expect(maxErr).toBeLessThan(1e-6);
  });

  it('j0 matches the quadrature reference to within 1e-6 across x in [0.01, 60]', () => {
    let maxErr = 0;
    for (let x = 0.01; x <= 60; x += 0.7) {
      const err = Math.abs(j0(x) - besselQuadrature(0, x));
      if (err > maxErr) maxErr = err;
    }
    expect(maxErr).toBeLessThan(1e-6);
  });

  it('the error is largest right around the series/asymptotic crossover (x=15), not somewhere unbounded', () => {
    const errAtCrossover = Math.abs(j1(15) - besselQuadrature(1, 15));
    const errFarAbove = Math.abs(j1(45) - besselQuadrature(1, 45));
    const errFarBelow = Math.abs(j1(2) - besselQuadrature(1, 2));
    expect(errAtCrossover).toBeGreaterThan(errFarAbove);
    expect(errAtCrossover).toBeGreaterThan(errFarBelow);
  });

  it('j1 is odd and j0 is even', () => {
    expect(j1(-2.5)).toBeCloseTo(-j1(2.5), 9);
    expect(j0(-2.5)).toBeCloseTo(j0(2.5), 9);
  });

  it('j0(0) = 1 and j1(0) = 0 exactly', () => {
    expect(j0(0)).toBe(1);
    expect(j1(0)).toBe(0);
  });

  it('J1_FIRST_ZERO is really a zero of j1 (to the tested error bound)', () => {
    expect(Math.abs(j1(J1_FIRST_ZERO))).toBeLessThan(1e-6);
  });

  it('the first zero of j0 is at the well-known 2.4048255577 (DLMF Table 10.6 / A&S Table 9.5)', () => {
    expect(Math.abs(j0(2.4048255577))).toBeLessThan(1e-6);
  });

  it('landmark tabulated values: j1(1), j1(2), j1(3) (DLMF/A&S Bessel function tables)', () => {
    expect(j1(1)).toBeCloseTo(0.4400505857, 6);
    expect(j1(2)).toBeCloseTo(0.5767248078, 6);
    expect(j1(3)).toBeCloseTo(0.3390589585, 6);
  });
});

describe('airyRadius (golden)', () => {
  it('550 nm at f/8 gives a 5.37 um Airy radius', () => {
    // Hand calc: 1.22 * 550e-9 m * 8 = 5.368e-6 m = 5.368 um.
    const radiusMm = airyRadius(550, 8);
    expect(radiusMm * 1000).toBeCloseTo(5.368, 2);
    expect(radiusMm * 1000).toBeCloseTo(5.37, 1);
  });

  it('scales linearly with both wavelength and f-number', () => {
    expect(airyRadius(550, 16)).toBeCloseTo(2 * airyRadius(550, 8), 9);
    expect(airyRadius(1100, 8)).toBeCloseTo(2 * airyRadius(550, 8), 9);
  });
});

describe('airyIntensity', () => {
  it('is finite and positive at r = 0 (the peak)', () => {
    const I0 = airyIntensity(0, 550, 8);
    expect(I0).toBeGreaterThan(0);
    expect(Number.isFinite(I0)).toBe(true);
  });

  it('is (numerically) zero at the first dark ring', () => {
    const r1 = airyRadius(550, 8);
    // airyRadius uses the rounded 1.22 convention; the true zero is at J1_FIRST_ZERO/pi * lambda * N, close but
    // not identical, so check near rather than exactly at r1.
    const trueZeroMm = (J1_FIRST_ZERO / Math.PI) * (550e-6) * 8;
    expect(airyIntensity(trueZeroMm, 550, 8)).toBeCloseTo(0, 6);
    expect(r1).toBeCloseTo(trueZeroMm, 4);
  });

  it('decreases monotonically from the center out to the first dark ring', () => {
    const N = 8,
      nm = 550;
    const r0 = airyIntensity(0, nm, N);
    const rMid = airyIntensity(airyRadius(nm, N) * 0.5, nm, N);
    const rZero = airyIntensity(airyRadius(nm, N), nm, N);
    expect(r0).toBeGreaterThan(rMid);
    expect(rMid).toBeGreaterThan(rZero);
  });
});

describe('encircledEnergy (golden: 83.8% at the first dark ring)', () => {
  it('EE at the true first zero of J1 is 0.838 (textbook figure)', () => {
    const rTrueZeroMm = (J1_FIRST_ZERO / Math.PI) * (550e-6) * 8;
    const EE = encircledEnergy(rTrueZeroMm, 550, 8);
    expect(EE).toBeCloseTo(0.838, 3);
  });

  it('is 0 at the center and approaches 1 far from it', () => {
    expect(encircledEnergy(0, 550, 8)).toBeCloseTo(0, 9);
    const rFar = airyRadius(550, 8) * 10;
    expect(encircledEnergy(rFar, 550, 8)).toBeGreaterThan(0.98);
  });

  it('is monotonically non-decreasing in r (it is a cumulative energy fraction)', () => {
    const nm = 550,
      N = 8;
    let prev = 0;
    for (let i = 1; i <= 20; i++) {
      const r = (airyRadius(nm, N) * i) / 4;
      const EE = encircledEnergy(r, nm, N);
      expect(EE).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = EE;
    }
  });
});

describe('mtfDiffraction', () => {
  it('is 1 at zero frequency and 0 at and beyond the cutoff frequency', () => {
    expect(mtfDiffraction(0, 8, 550)).toBeCloseTo(1, 9);
    const nuC = 1 / (550e-6 * 8);
    expect(mtfDiffraction(nuC, 8, 550)).toBeCloseTo(0, 6);
    expect(mtfDiffraction(nuC * 2, 8, 550)).toBe(0);
  });

  it('matches a hand-computed value at half the cutoff frequency', () => {
    // Hand calc at s=0.5: (2/pi)(acos(0.5) - 0.5*sqrt(0.75)) = (2/pi)(1.047198 - 0.433013) = 0.391002
    const nuC = 1 / (550e-6 * 8);
    expect(mtfDiffraction(nuC * 0.5, 8, 550)).toBeCloseTo(0.391, 3);
  });

  it('is monotonically decreasing with spatial frequency', () => {
    const N = 8,
      nm = 550;
    const nuC = 1 / (nm * 1e-6 * N);
    let prev = 1;
    for (let s = 0.1; s <= 0.9; s += 0.1) {
      const m = mtfDiffraction(nuC * s, N, nm);
      expect(m).toBeLessThan(prev);
      prev = m;
    }
  });

  it('a smaller f-number (larger aperture) pushes the cutoff frequency higher, raising MTF at a fixed frequency', () => {
    const nu = 100; // cycles/mm
    const mtfWide = mtfDiffraction(nu, 2.8, 550);
    const mtfNarrow = mtfDiffraction(nu, 16, 550);
    expect(mtfWide).toBeGreaterThan(mtfNarrow);
  });
});

describe('diffractionLimitFNumber (Airy-diameter-equals-k-pixels criterion)', () => {
  it('reproduces the requested Airy diameter at the returned f-number (golden self-consistency)', () => {
    const pitch = 0.004; // 4 um pixel pitch
    const N2 = diffractionLimitFNumber2px(550, pitch);
    expect(2 * airyRadius(550, N2)).toBeCloseTo(2 * pitch, 9);
  });

  it('the 2-pixel criterion requires a larger (more stopped down) f-number than the 1.5-pixel criterion', () => {
    const pitch = 0.004;
    const N2 = diffractionLimitFNumber2px(550, pitch);
    const N15 = diffractionLimitFNumber1_5px(550, pitch);
    expect(N2).toBeGreaterThan(N15);
  });

  it('a finer pixel pitch reaches the diffraction limit at a smaller (wider-open) f-number', () => {
    const coarse = diffractionLimitFNumber(550, 0.006, 2);
    const fine = diffractionLimitFNumber(550, 0.003, 2);
    expect(fine).toBeLessThan(coarse);
  });
});

describe('psfOnPixels', () => {
  const bins = [550];
  const weights = [1];

  it('the fine grid recovers close to all of the energy when fill = 1 and the grid is wide enough', () => {
    // Use a pitch small relative to the Airy radius so several pixels are needed to capture most of the energy.
    const pitch = airyRadius(550, 8) / 3;
    const result = psfOnPixels(pitch, 8, bins, weights, [0, 0], 1, 8);
    expect(result.totalFraction).toBeGreaterThan(0.9);
    expect(result.totalFraction).toBeLessThanOrEqual(1.0 + 1e-6);
  });

  it('the centered pixel captures the most energy of any single cell (symmetric PSF, zero offset)', () => {
    const pitch = airyRadius(550, 8) / 2;
    const result = psfOnPixels(pitch, 8, bins, weights, [0, 0], 1, 4);
    const center = result.cells.find((c) => c.ix === 0 && c.iy === 0)!;
    for (const cell of result.cells) {
      if (cell.ix === 0 && cell.iy === 0) continue;
      expect(center.fraction).toBeGreaterThanOrEqual(cell.fraction);
    }
  });

  it('a smaller fill factor captures strictly less total energy than fill = 1', () => {
    const pitch = airyRadius(550, 8) / 2;
    const full = psfOnPixels(pitch, 8, bins, weights, [0, 0], 1, 5);
    const half = psfOnPixels(pitch, 8, bins, weights, [0, 0], 0.5, 5);
    expect(half.totalFraction).toBeLessThan(full.totalFraction);
  });

  it('fill = 0 captures no energy', () => {
    const pitch = airyRadius(550, 8) / 2;
    const result = psfOnPixels(pitch, 8, bins, weights, [0, 0], 0, 3);
    expect(result.totalFraction).toBeCloseTo(0, 9);
  });

  it('error estimates are small relative to the fractions they accompany (the integrand is smooth)', () => {
    const pitch = airyRadius(550, 8) / 2;
    const result = psfOnPixels(pitch, 8, bins, weights, [0, 0], 1, 3);
    expect(result.maxErrorEstimate).toBeLessThan(1e-6);
  });

  it('weights are normalized internally: doubling every weight does not change the result', () => {
    const pitch = airyRadius(550, 8) / 2;
    const a = psfOnPixels(pitch, 8, [500, 600], [1, 1], [0, 0], 1, 3);
    const b = psfOnPixels(pitch, 8, [500, 600], [2, 2], [0, 0], 1, 3);
    expect(b.totalFraction).toBeCloseTo(a.totalFraction, 9);
  });

  it('a nonzero offset shifts which pixel captures the most energy', () => {
    const pitch = airyRadius(550, 8) / 2;
    const shifted = psfOnPixels(pitch, 8, bins, weights, [pitch, 0], 1, 4);
    const center = shifted.cells.find((c) => c.ix === 0 && c.iy === 0)!;
    const neighbor = shifted.cells.find((c) => c.ix === 1 && c.iy === 0)!;
    // The PSF center is now one pixel to the +x side of the grid's (0,0) pixel, so pixel (1,0) should be at least
    // as bright as pixel (0,0).
    expect(neighbor.fraction).toBeGreaterThanOrEqual(center.fraction);
  });
});
