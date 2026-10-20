import { describe, expect, it } from 'vitest';
import type { Scenario } from '../engine/types';
import type { AppState } from './store';
import { apertureClampNotice, apertureModelNote, exposureDefaults, isMarkedStop, lensFocusNotice } from './equipment-feedback';

const state = (lens: string, fno: number, requestedFno?: number): AppState => ({
  scenario: {
    lens, fno, shutter: 1 / 250, iso: 100, focusM: 3, format: 'ff', shutterType: 'mechanical', scene: 'bench',
  } satisfies Scenario,
  piece: 'camera', cameraPart: null, requestedFno,
});

describe('apertureClampNotice', () => {
  it("explains a lens-switch clamp for a request the lens cannot reach, in the slider's own f-numbers", () => {
    const before = state('n50', 4), after = state('n500', 5.75019);
    // f/4 on a lens that opens to f/5.6 at most: genuinely unreachable
    const text = apertureClampNotice(before, after);
    expect(text).toContain('f/4 is wider than the 500 mm lens opens');
    expect(text).toContain('widest, f/5.6 (modeled at f/5.75)');
    expect(text).not.toContain('limited from requested');
    expect(before.scenario.fno).toBe(4);
    expect(after.scenario.fno).toBe(5.75019);
  });

  it('names the f-number the change asked for, not the previous one', () => {
    expect(apertureClampNotice(state('n50', 4), state('n500', 5.75019), 2.8)).toContain('f/2.8 is wider than the 500 mm lens opens');
    expect(apertureClampNotice(state('n50', 8), state('n500', 5.75019), 2.8)).toContain('f/2.8 is wider');
    expect(apertureClampNotice(state('n50', 2.8), state('n500', 8), 8)).toBeNull();
  });

  it("stays silent when the request is the lens's own marked stop (a photograph's recorded settings)", () => {
    // Use these settings on an f/5.6 photograph on the 500 mm f/5.6: a match, drawn at f/5.75; no refusal-style toast
    expect(apertureClampNotice(state('n50', 4), state('n500', 5.75019), 5.6)).toBeNull();
    expect(apertureClampNotice(state('n500', 8), state('n50', 1.86), 1.8)).toBeNull();
    // within a sixth of a stop of the marked stop reads the same; a third of a stop wider does not
    expect(isMarkedStop(5.6, 5.6)).toBe(true);
    expect(isMarkedStop(5.4, 5.6)).toBe(true);
    expect(isMarkedStop(5.0, 5.6)).toBe(false);
  });

  it('does not notify for the initial render, other settings, or equipment changes that do not raise the f-number', () => {
    expect(apertureClampNotice(null, state('n50', 4))).toBeNull();
    expect(apertureClampNotice(state('n50', 4), state('n50', 5.6))).toBeNull();
    expect(apertureClampNotice(state('n500', 5.75019), state('n50', 4))).toBeNull();
    expect(apertureClampNotice(state('n50', 4), state('p50', 4))).toBeNull();
  });

  // Score loop r2: setting n500 at f/8 from f/2.8 read "limited from requested f/2.8 to model limit f/8.00"; the
  // real limit is f/5.75 and f/8 was what was asked for.
  it('fires only for a clamp to the lens limit, and quotes the f-number actually requested', () => {
    expect(apertureClampNotice(state('n50', 2.8), state('n500', 8, 8))).toBeNull();
    expect(apertureClampNotice(state('n50', 1.8), state('n500', 5.75019, 1.8))).toContain('f/1.8 is wider than the 500 mm lens opens');
  });
});

describe('apertureModelNote', () => {
  it('says what the model draws while the control reads the marked stop at the widest opening', () => {
    expect(apertureModelNote('n500', 5.75019)).toBe('Marked f/5.6, the widest stop. The model draws it at its true opening, f/5.75.');
    expect(apertureModelNote('n500', 8)).toBeNull();
  });
});

describe('lensFocusNotice and exposureDefaults (score loop r5)', () => {
  const at = (lens: string, focusM: number | null): AppState => ({ ...state(lens, 5.75), scenario: { ...state(lens, 5.75).scenario, focusM } });
  it('says when a lens switch moved the focus distance', () => {
    expect(lensFocusNotice(at('n50', 3), at('n500', 15))).toBe('Focus set to 15.0 m for this lens.');
    expect(lensFocusNotice(at('n50', 3), at('n500', null))).toBe('Focus set to infinity for this lens.');
  });
  it('is silent when focus did not move, the lens did not change, or the change named the focus itself', () => {
    expect(lensFocusNotice(at('n50', 3), at('n500', 3))).toBeNull();
    expect(lensFocusNotice(at('n50', 3), at('n50', 5))).toBeNull();
    expect(lensFocusNotice(at('n50', 3), at('n500', 15), true)).toBeNull();
    expect(lensFocusNotice(null, at('n500', 15))).toBeNull();
  });
  it('restores the exposure defaults of the mounted lens', () => {
    const d = exposureDefaults('n50', 'bench');
    expect(d.shutter).toBeCloseTo(1 / 250);
    expect(d.iso).toBe(100);
    expect(d.fno).toBeGreaterThan(0);
    expect(exposureDefaults('n500', 'bench').fno).toBeGreaterThanOrEqual(exposureDefaults('n50', 'bench').fno);
  });
});
