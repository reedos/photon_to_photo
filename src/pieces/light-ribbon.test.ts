import { describe, it, expect } from 'vitest';
import { prepareTrail } from './trace-playback';
import { ribbonTrail } from './light-ribbon';

describe('traced light ribbon', () => {
  const bent = prepareTrail([[0,0,0],[0,0,10],[0,10,10],[0,10,20]]);
  it('keeps both sides of a refraction vertex and increases emphasis toward the head', () => {
    const segments = ribbonTrail(bent, .5, .4);
    expect(segments).toHaveLength(2);
    expect(segments[0].b).toEqual([0,0,10]);
    expect(segments[1].a).toEqual([0,0,10]);
    expect(segments[1].b).toEqual([0,5,10]);
    expect(segments[0].startWeight).toBeCloseTo(.05,9);
    expect(segments[1].endWeight).toBeCloseTo(1,9);
    expect(segments[0].endWeight).toBeCloseTo(segments[1].startWeight,9);
  });
  it('stops exactly at the engine terminal point without adding a landing path', () => {
    for (const progress of [1,2]) expect(ribbonTrail(bent,progress).at(-1)?.b).toEqual([0,10,20]);
    expect(ribbonTrail(bent,0)).toEqual([]);
    expect(ribbonTrail(prepareTrail([[0,0,0],[0,0,0]]),.5)).toEqual([]);
  });
  it('produces stable geometry and weights under backward and forward scrubbing', () => {
    const once = ribbonTrail(bent,.73);
    ribbonTrail(bent,.12);ribbonTrail(bent,1);
    expect(ribbonTrail(bent,.73)).toEqual(once);
    expect(once.every(s=>s.startWeight>=.05&&s.endWeight<=1+1e-12)).toBe(true);
  });
});
