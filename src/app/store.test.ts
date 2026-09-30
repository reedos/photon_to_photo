import { describe, expect, it } from 'vitest';
import { Store, formatShutter, queryFromState, scenarioFromQuery } from './store';

describe('scenarioFromQuery', () => {
  it('reads every field the URL contract documents', () => {
    const { scenario, piece } = scenarioFromQuery('?lens=p85&fno=2.8&focus=1.5&shutter=1%2F500&iso=800&format=apsc&piece=cone');
    expect(scenario).toMatchObject({ lens: 'p85', fno: 2.8, focusM: 1.5, shutter: 1 / 500, iso: 800, format: 'apsc' });
    expect(piece).toBe('cone');
  });

  it('reads "inf" as infinity focus (null)', () => {
    const { scenario } = scenarioFromQuery('?focus=inf');
    expect(scenario.focusM).toBeNull();
  });

  it('is empty for an empty query string, so normalizeScenario supplies every default', () => {
    const { scenario, piece } = scenarioFromQuery('');
    expect(scenario).toEqual({});
    expect(piece).toBeUndefined();
  });

  it('ignores an unknown piece id rather than accepting it', () => {
    const { piece } = scenarioFromQuery('?piece=not-a-piece');
    expect(piece).toBeUndefined();
  });

  it('ignores a garbage numeric field rather than producing NaN', () => {
    const { scenario } = scenarioFromQuery('?fno=not-a-number');
    expect(scenario.fno).toBeUndefined();
  });
});

describe('formatShutter', () => {
  it('formats sub-second times as a fraction', () => {
    expect(formatShutter(1 / 250)).toBe('1/250');
  });
  it('formats one second and above as a decimal', () => {
    expect(formatShutter(2)).toBe('2');
    expect(formatShutter(1)).toBe('1');
  });
});

describe('queryFromState and scenarioFromQuery round-trip', () => {
  it('reproduces the same normalized scenario after a full round trip', () => {
    const store = new Store({ scenario: { lens: 'p85', fno: 2.8, focusM: 1.5, shutter: 1 / 500, iso: 800, format: 'apsc' } });
    const qs = queryFromState(store.get());
    const back = scenarioFromQuery(qs);
    const roundTripped = new Store({ scenario: back.scenario });
    expect(roundTripped.get().scenario).toEqual(store.get().scenario);
  });

  it('round-trips an infinity focus', () => {
    const store = new Store({ scenario: { focusM: null } });
    const qs = queryFromState(store.get());
    expect(qs).toContain('focus=inf');
    const back = scenarioFromQuery(qs);
    expect(back.scenario.focusM).toBeNull();
  });
});

describe('Store', () => {
  it('normalizes on construction and on every set()', () => {
    const store = new Store({ scenario: { lens: 'p50', fno: 0.5 } });
    expect(store.get().scenario.fno).toBeGreaterThanOrEqual(1); // clamped up to the lens's own max aperture
  });

  it('notifies subscribers immediately, then again on every change', () => {
    const store = new Store();
    const seen: number[] = [];
    const unsubscribe = store.subscribe((s) => seen.push(s.scenario.iso));
    expect(seen.length).toBe(1);
    store.set({ iso: 800 });
    expect(seen.length).toBe(2);
    expect(seen[1]).toBe(800);
    unsubscribe();
    store.set({ iso: 1600 });
    expect(seen.length).toBe(2); // no further calls after unsubscribe
  });

  it('setPiece switches the active piece without touching the scenario', () => {
    const store = new Store();
    const before = store.get().scenario;
    store.setPiece('loupe');
    expect(store.get().piece).toBe('loupe');
    expect(store.get().scenario).toEqual(before);
  });

  it('setPiece is a no-op (no extra notify) when the piece does not change', () => {
    const store = new Store({ piece: 'cone' });
    let calls = 0;
    store.subscribe(() => { calls += 1; });
    expect(calls).toBe(1);
    store.setPiece('cone');
    expect(calls).toBe(1);
  });
});
