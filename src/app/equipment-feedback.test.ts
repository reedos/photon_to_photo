import { describe, expect, it } from 'vitest';
import type { Scenario } from '../engine/types';
import type { AppState } from './store';
import { apertureClampNotice } from './equipment-feedback';

const state = (lens: string, fno: number): AppState => ({
  scenario: {
    lens, fno, shutter: 1 / 250, iso: 100, focusM: 3, format: 'ff', shutterType: 'mechanical', scene: 'bench',
  } satisfies Scenario,
  piece: 'camera', cameraPart: null,
});

describe('apertureClampNotice', () => {
  it('explains a real lens-switch clamp while preserving the requested and modeled values', () => {
    const before = state('n50', 4), after = state('n500', 5.75019);
    expect(apertureClampNotice(before, after)).toBe(
      'Aperture limited from requested f/4 to model limit f/5.75. This 500 mm lens is marked f/5.6 wide open.',
    );
    expect(before.scenario.fno).toBe(4);
    expect(after.scenario.fno).toBe(5.75019);
  });

  it('does not notify for the initial render, other settings, or equipment changes that do not raise the f-number', () => {
    expect(apertureClampNotice(null, state('n50', 4))).toBeNull();
    expect(apertureClampNotice(state('n50', 4), state('n50', 5.6))).toBeNull();
    expect(apertureClampNotice(state('n500', 5.75019), state('n50', 4))).toBeNull();
    expect(apertureClampNotice(state('n50', 4), state('p50', 4))).toBeNull();
  });
});
