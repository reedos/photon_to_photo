import { describe, expect, it } from 'vitest';
import { shouldShowPhotoOpening } from './photo-opening';

describe('photo opening entry routing', () => {
  it('welcomes a fresh bare visit, including the brand top anchor', () => {
    expect(shouldShowPhotoOpening('', '', false)).toBe(true);
    expect(shouldShowPhotoOpening('', '#top', false)).toBe(true);
  });
  it('never intercepts a scenario, tour, photo, lesson, or unknown query', () => {
    for (const query of ['?piece=lens&part=glass', '?tour=1', '?photo=flycatcher', '?lesson=readout', '?lens=n500', '?gl=webgl2', '?future=1']) {
      expect(shouldShowPhotoOpening(query, '', false)).toBe(false);
    }
  });
  it('keeps anchored and returning visitors in the workspace', () => {
    expect(shouldShowPhotoOpening('', '#rp-card', false)).toBe(false);
    expect(shouldShowPhotoOpening('', '#stage-section', false)).toBe(false);
    expect(shouldShowPhotoOpening('', '', true)).toBe(false);
  });
});
