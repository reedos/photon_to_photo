import { describe, expect, it } from 'vitest';
import type { Scenario } from '../engine/types';
import { formatComparisonCaption } from './comparison-caption';

const scenario = (overrides: Partial<Scenario> = {}): Scenario => ({
  lens: 'n50', fno: 5.75019, shutter: 1 / 250, iso: 100, focusM: 3,
  format: 'ff', shutterType: 'mechanical', scene: 'bench', ...overrides,
});

describe('formatComparisonCaption', () => {
  it('uses the readable lens, scene, aperture and exposure formats without changing engine values', () => {
    const shot = scenario();
    expect(formatComparisonCaption(shot)).toBe('50 mm f/1.8 · Tabletop · f/5.6 · 1/250 s · ISO 100 · focus 3.00 m');
    expect(shot.fno).toBe(5.75019);
  });

  it('names every scene and reports infinity focus plainly', () => {
    expect(formatComparisonCaption(scenario({ scene: 'flight', focusM: null }))).toContain(' · Bird glide · ');
    expect(formatComparisonCaption(scenario({ scene: 'field' }))).toContain(' · Field · ');
    expect(formatComparisonCaption(scenario({ scene: 'dusk' }))).toContain(' · Low light · ');
    expect(formatComparisonCaption(scenario({ focusM: null })).endsWith('focus infinity')).toBe(true);
  });
});
