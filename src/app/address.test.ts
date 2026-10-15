import { describe, expect, it } from 'vitest';
import { cleanSearch, TOUR_STOP_COUNT } from './address';
import { TOUR } from './learning-model';

describe('cleanSearch', () => {
  it('keeps the tour count in step with the tour', () => {
    expect(TOUR_STOP_COUNT).toBe(TOUR.length);
  });
  it('leaves a clean address alone', () => {
    expect(cleanSearch('?piece=lens&lens=n50&tour=4')).toBe('?piece=lens&lens=n50&tour=4');
    expect(cleanSearch('')).toBe('');
    expect(cleanSearch('?shot=flycatcher')).toBe('?shot=flycatcher');
  });
  it('clamps a tour past the last stop and drops one that is not a stop', () => {
    expect(cleanSearch('?lens=n50&tour=77')).toBe(`?lens=n50&tour=${TOUR.length}`);
    expect(cleanSearch('?tour=0&lens=n50')).toBe('?lens=n50');
    expect(cleanSearch('?tour=abc')).toBe('');
    expect(cleanSearch('?tour=')).toBe('');
    expect(cleanSearch('?tour=2.5')).toBe('');
  });
  it('drops a shot that is not an id', () => {
    expect(cleanSearch('?shot=&lens=n50')).toBe('?lens=n50');
    expect(cleanSearch('?shot=a%20b')).toBe('');
  });
});
