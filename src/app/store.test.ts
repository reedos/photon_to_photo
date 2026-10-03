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

  it('reads scene= and motion= (SHARED CONTRACT)', () => {
    const { scenario } = scenarioFromQuery('?scene=field&motion=5.5');
    expect(scenario.scene).toBe('field');
    expect(scenario.motion).toEqual({ speedMps: 5.5 });
  });

  it('ignores a garbage motion= value rather than producing NaN', () => {
    const { scenario } = scenarioFromQuery('?motion=not-a-number');
    expect(scenario.motion).toBeUndefined();
  });
});

describe('formatShutter', () => {
  it('formats sub-second times as a fraction', () => {
    expect(formatShutter(1 / 250)).toBe('1/250');
    expect(formatShutter(0.6)).toBe('0.6');
    expect(formatShutter(0.8)).toBe('0.8');
    expect(formatShutter(16 / 60)).toBe('0.267');
  });
  it('formats one second and above as a decimal', () => {
    expect(formatShutter(2)).toBe('2');
    expect(formatShutter(1)).toBe('1');
  });
});

describe('queryFromState and scenarioFromQuery round-trip', () => {
  it('retains exact exposure, distances, sensor and illumination overrides', () => {
    const original = new Store({ scenario: { lens: 'm50', fno: 2 ** (5 / 6), shutter: 16 / 60,
      iso: 123.5, focusM: 3.123456789, subjectM: 8.123456789, shutterType: 'electronic',
      sensor: 'full-frame-d850', lux: 987.654, cct: 5456.78 } });
    const restored = new Store(scenarioFromQuery(queryFromState(original.get())));
    expect(restored.get()).toEqual(original.get());
  });
  it('ignores an invalid sensor rather than breaking startup', () => {
    expect(scenarioFromQuery('?sensor=not-a-sensor&shutterType=invalid&lux=NaN&cct=-10').scenario).toEqual({});
  });
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

  it('round-trips an explicit scene (SHARED CONTRACT: scene=)', () => {
    const store = new Store({ scenario: { lens: 'p500', scene: 'bench' } });
    const qs = queryFromState(store.get());
    expect(qs).toContain('scene=bench');
    const back = scenarioFromQuery(qs);
    expect(back.scenario.scene).toBe('bench');
    const roundTripped = new Store({ scenario: back.scenario });
    expect(roundTripped.get().scenario).toEqual(store.get().scenario);
  });

  it('round-trips a motion speed (SHARED CONTRACT: motion=<m/s>)', () => {
    const store = new Store({ scenario: { motion: { speedMps: 8 } } });
    const qs = queryFromState(store.get());
    expect(qs).toContain('motion=8');
    const back = scenarioFromQuery(qs);
    expect(back.scenario.motion).toEqual({ speedMps: 8 });
    const roundTripped = new Store({ scenario: back.scenario });
    expect(roundTripped.get().scenario).toEqual(store.get().scenario);
  });

  it('omits motion= from the URL when the scenario is still (no motion field to reproduce)', () => {
    const store = new Store({ scenario: { lens: 'p50' } });
    const qs = queryFromState(store.get());
    expect(qs).not.toContain('motion=');
  });
});

describe('Store', () => {
  it('ignores repeated normalized settings and retains shot identity on navigation', () => {
    const store = new Store({ scenario: { fno: 22, motion: { speedMps: 2 } } });
    const before = store.get();
    let calls = 0;
    store.subscribe(() => calls++);
    for (let i = 0; i < 60; i++) store.set({ fno: 25 + i, motion: { speedMps: 2 } });
    expect(calls).toBe(1);
    expect(store.get()).toBe(before);
    store.set({ fno: 22 }, 'loupe');
    expect(calls).toBe(2);
    expect(store.get().piece).toBe('loupe');
    expect(store.get().scenario).toBe(before.scenario);
    store.set({ motion: { speedMps: 3 } });
    expect(calls).toBe(3);
    expect(store.get().scenario.motion?.speedMps).toBe(3);
  });

  it('keeps a supplied subject distance when reselecting the same lens or scene', () => {
    const store = new Store({ scenario: { lens: 'n500', scene: 'field', subjectM: 8.9 } });
    const before = store.get();
    store.set({ lens: 'n500', scene: 'field' });
    expect(store.get()).toBe(before);
  });
  it('changes the physical sensor with the camera body, retaining explicit overrides', () => {
    const store = new Store({ scenario: { lens: 'n50' } });
    expect(store.get().scenario.sensor).toBe('full-frame-d850');
    store.set({ lens: 'm50' });
    expect(store.get().scenario.sensor).toBe('full-frame-z8');
    store.set({ lens: 'z800' });
    expect(store.get().scenario.sensor).toBe('full-frame-z8');
    store.set({ lens: 'n50', sensor: 'full-frame-z8' });
    expect(store.get().scenario.sensor).toBe('full-frame-z8');
    store.set({ lens: 'p50' });
    expect(store.get().scenario.sensor).toBeUndefined();
  });
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

describe('a subject distance travels with its lens', () => {
  it('survives the URL, and a new lens or scene without one drops it', () => {
    const store = new Store({ scenario: { lens: 'n500', focusM: 8.9, subjectM: 8.9 } });
    expect(store.get().scenario.subjectM).toBe(8.9);
    expect(scenarioFromQuery(queryFromState(store.get())).scenario.subjectM).toBe(8.9);
    store.set({ fno: 8 });
    expect(store.get().scenario.subjectM).toBe(8.9);
    store.set({ lens: 'n50' });
    expect(store.get().scenario.subjectM).toBeUndefined();
    store.set({ lens: 'n500', subjectM: 10 });
    expect(store.get().scenario.subjectM).toBe(10);
    store.set({ scene: 'bench' });
    expect(store.get().scenario.subjectM).toBeUndefined();
  });
});
