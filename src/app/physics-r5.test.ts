// Score loop r5 (10/14/2026), physics: the clip-aware exposure figures, the diffraction caveats, one evidence rule for the
// photon / electron / SNR figures, and the evidence index's patent records.
import { describe, expect, it } from 'vitest';
import { compute } from './engine-api';
import { diffractionDofNote, partCard } from './rig-cards';
import { fmtSnr } from './units';
import { evidenceIndex } from './evidence-index';
import { learningInsights } from './learning-insights';

const rig = { body: 'dslr' as const, ringAngle: 0, elementShift: [] as number[] };

describe('clipped exposures (r5)', () => {
  it('a patch past the ADC clip is flagged clipped, with no SNR number', () => {
    // the reviewer's case: ISO 1600, 1/60 s, f/4 reads 19% of the well while the raw value sits at its maximum
    const m = compute({ lens: 'n50', fno: 4, shutter: 1 / 60, iso: 1600 });
    expect(m.exposure.limitedBy).toBe('adc');
    expect(m.exposure.usableE).toBeCloseTo(m.sensor.adcClipE, 6);
    expect(m.exposure.electronsMidGray).toBeGreaterThan(m.exposure.usableE);
    expect(m.exposure.grayClipped).toBe(true);
    expect(fmtSnr(m.exposure)).toBe('n/a (clipped)');
    const card = partCard('sensor', m, rig);
    expect(card.specs.find((r) => r.k.startsWith('Signal-to-noise'))!.v).toBe('n/a (clipped)');
    expect(card.specs.some((r) => r.k === 'Clipped at the ADC')).toBe(true);
  });
  it('a patch far past the full well is clipped too (30 s)', () => {
    const m = compute({ lens: 'n50', fno: 1.86, shutter: 30, iso: 64 });
    expect(m.exposure.grayClipped).toBe(true);
    expect(fmtSnr(m.exposure)).toBe('n/a (clipped)');
  });
  it('a patch under the limit keeps its number and no clipped row', () => {
    const m = compute({ lens: 'n50', fno: 8, shutter: 1 / 250, iso: 100 });
    expect(m.exposure.grayClipped).toBe(false);
    expect(fmtSnr(m.exposure)).toBe(m.exposure.snrMidGray.toLocaleString('en-US', { maximumFractionDigits: 1 }));
    expect(partCard('sensor', m, rig).specs.some((r) => /^Clipped at/.test(r.k))).toBe(false);
  });
  it('the usable limit is the lower of the full well and the ADC clip', () => {
    for (const iso of [64, 100, 800, 1600, 6400]) {
      const m = compute({ lens: 'n50', iso });
      expect(m.exposure.usableE).toBe(Math.min(m.sensor.fullWellE, m.sensor.adcClipE));
    }
  });
});

describe('the figures calculated from assumed inputs share one label (r5)', () => {
  it('photons, electrons, SNR, light on the sensor and scene EV are all assumed', () => {
    const m = compute({ lens: 'n50' });
    for (const k of ['photonsMidGray', 'electronsMidGray', 'snrMidGray', 'sensorLux', 'sceneEv100', 'grayRawFractionMetered']) {
      expect(m.figs[k].ev, k).toBe('assumed');
      expect(m.figs[k].src, k).toMatch(/weakest label/);
    }
  });
});

describe('diffraction is named where the geometry leaves it out (r5)', () => {
  it('the depth-of-field card carries a caveat once the Airy disk is wider than the blur criterion', () => {
    const wide = compute({ lens: 'n50', fno: 22, focusM: 0.45 });
    expect(2 * wide.diffraction.airyRadiusUm / 1000).toBeGreaterThan(wide.focus.cocMm);
    expect(diffractionDofNote(wide)).toMatch(/diffraction alone is softer/);
    expect(partCard('focusRing', wide, rig).body).toMatch(/geometric and does not include it/);
    expect(learningInsights(wide).focus.live).toMatch(/range is geometric/);
    const open = compute({ lens: 'n50', fno: 4, focusM: 3 });
    expect(diffractionDofNote(open)).toBe('');
    expect(partCard('focusRing', open, rig).body).not.toMatch(/diffraction/);
  });
});

describe('the evidence index labels a lens source block (r5)', () => {
  it('a record of kind patent counts as a published specification', () => {
    const uses = evidenceIndex({ 'x/n50.json': { source: { kind: 'patent', url: 'https://patents.google.com/patent/JP2011175123A/en', ref: 'JP 2011-175123' } } });
    expect(uses[0].uses[0].evidence).toBe('spec');
  });
});
