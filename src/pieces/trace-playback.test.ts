import { it, expect } from 'vitest';
import { prepareTrail, clippedTrail } from './trace-playback';

it('keeps an animated tail on each side of a refracting surface without cutting the corner', () => {
  const trail = prepareTrail([[0, 0, 0], [0, 0, 10], [0, 10, 10]]);
  expect(clippedTrail(trail, .25, .75)).toEqual([[[0, 0, 5], [0, 0, 10]], [[0, 0, 10], [0, 5, 10]]]);
});
it('ends at the actual terminal surface and handles coincident and zero-length vertices', () => {
  const trail = prepareTrail([[0, 0, 0], [0, 0, 0], [0, 0, 2]]);
  expect(clippedTrail(trail, .5, 2)).toEqual([[[0, 0, 1], [0, 0, 2]]]);
  expect(clippedTrail(trail, 1, 1)).toEqual([]);
  expect(clippedTrail(prepareTrail([[0, 0, 0]]), 0, 1)).toEqual([]);
});
