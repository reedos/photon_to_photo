import { adjacentPart, insideView } from './part-navigation';

describe('part navigation', () => {
  it('includes overview and wraps symmetrically without skipping the last part', () => {
    const ids = ['lens', 'iris', 'sensor'];
    let current: string | null = null;
    const route = [null, 'lens', 'iris', 'sensor', null];
    for (const stop of route.slice(1)) { current = adjacentPart(ids, current, 1); expect(current).toBe(stop); }
    for (const stop of [...route].reverse().slice(1)) { current = adjacentPart(ids, current, -1); expect(current).toBe(stop); }
    expect(adjacentPart([], null, 1)).toBeNull();
    expect(adjacentPart(['iris'], 'old-part', 1)).toBe('iris');
  });
  it('offers only implemented inspections with the appropriate camera parent', () => {
    expect(insideView('iris')).toBe('lens');
    expect(insideView('glass')).toBe('lens');
    expect(insideView('focusRing')).toBe('cone');
    expect(insideView('sensor')).toBe('loupe');
    for (const part of ['mount', 'shutter', 'viewfinder', null] as const) expect(insideView(part)).toBeNull();
  });
});
