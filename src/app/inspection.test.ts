import { describe, expect, it } from 'vitest';
import { Store, queryFromState, scenarioFromQuery } from './store';

describe('camera inspection context', () => {
  it('returns to the selected aperture after inspecting its optics, with the exact shot intact', () => {
    const store = new Store({ scenario: { lens: 'n50', fno: 2.8, focusM: 1.5 } });
    const shot = store.get().scenario;
    store.setCameraPart('iris');
    store.setPiece('lens');
    expect(store.get()).toMatchObject({ piece: 'lens', cameraPart: 'iris' });
    store.setPiece('camera');
    expect(store.get()).toMatchObject({ piece: 'camera', cameraPart: 'iris' });
    expect(store.get().scenario).toBe(shot);
  });

  it('shares a detail and its camera return destination', () => {
    const store = new Store({ piece: 'lens', cameraPart: 'iris', scenario: { lens: 'z35', fno: 4 } });
    const reopened = new Store(scenarioFromQuery(queryFromState(store.get())));
    expect(reopened.get()).toEqual(store.get());
    reopened.setPiece('camera');
    expect(reopened.get().cameraPart).toBe('iris');
  });

  it('gives legacy inspection links the appropriate camera context, ignores unknown parts', () => {
    for (const [piece, part] of [['lens', 'glass'], ['cone', 'focusRing'], ['loupe', 'sensor']]) {
      const store = new Store(scenarioFromQuery(`?piece=${piece}&part=bad-input`));
      expect(store.get().cameraPart).toBe(part);
    }
    expect(new Store(scenarioFromQuery('?piece=camera&part=bad-input')).get().cameraPart).toBeNull();
  });

  it('switches inspection context and can deliberately return to the overview', () => {
    const store = new Store({ piece: 'cone' });
    store.setPiece('loupe');
    expect(store.get().cameraPart).toBe('sensor');
    store.set({ iso: 1600 });
    expect(store.get().cameraPart).toBe('sensor');
    store.showCameraOverview();
    expect(store.get()).toMatchObject({ piece: 'camera', cameraPart: null, scenario: { iso: 1600 } });
    expect(queryFromState(store.get())).not.toContain('part=');
  });
});
