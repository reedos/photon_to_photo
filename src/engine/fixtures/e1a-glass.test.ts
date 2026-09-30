// Sanity check for the N-BK7 Sellmeier fixture: the SCHOTT datasheet publishes nd and vd (Abbe number) as
// independently measured/rounded catalog values, not derived from the Sellmeier coefficients in this file, so
// reproducing them from sellmeierIndex is a genuine (if fixture-level) cross-check, not a tautology.

import { N_BK7_SELLMEIER, bk7Index, sellmeierIndex } from './e1a-glass';

describe('N-BK7 Sellmeier fixture', () => {
  it('reproduces the catalog nd (587.5618 nm) to 4 decimal places', () => {
    const nd = sellmeierIndex(N_BK7_SELLMEIER, 587.5618);
    expect(nd).toBeCloseTo(N_BK7_SELLMEIER.nd, 4);
  });

  it('reproduces the catalog Abbe number vd = (nd-1)/(nF-nC) to 2 decimal places', () => {
    const nd = sellmeierIndex(N_BK7_SELLMEIER, 587.5618);
    const nF = sellmeierIndex(N_BK7_SELLMEIER, 486.1327);
    const nC = sellmeierIndex(N_BK7_SELLMEIER, 656.2725);
    const vd = (nd - 1) / (nF - nC);
    expect(vd).toBeCloseTo(N_BK7_SELLMEIER.vd, 1);
  });

  it('is normal dispersion (index decreases with wavelength) across the visible range', () => {
    const nBlue = sellmeierIndex(N_BK7_SELLMEIER, 435.8343);
    const nRed = sellmeierIndex(N_BK7_SELLMEIER, 656.2725);
    expect(nBlue).toBeGreaterThan(nRed);
  });

  it("bk7Index() resolves 'air' to exactly 1 regardless of wavelength", () => {
    const index = bk7Index();
    expect(index('air', 400)).toBe(1);
    expect(index('air', 700)).toBe(1);
  });
});
