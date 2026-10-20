import { describe, expect, it } from 'vitest';
import { shouldShowPhotoOpening } from './photo-opening';

describe('photo opening entry routing', () => {
  it('welcomes a fresh bare visit, including the brand top anchor', () => {
    expect(shouldShowPhotoOpening('', '', false)).toBe(true);
    expect(shouldShowPhotoOpening('', '#top', false)).toBe(true);
    expect(shouldShowPhotoOpening('?v=release', '', false)).toBe(true);
  });
  it('never intercepts a scenario, tour, photo, lesson, or unknown query', () => {
    for (const query of ['?piece=lens&part=glass', '?tour=1', '?photo=flycatcher', '?lesson=readout', '?lens=n500', '?gl=webgl2', '?future=1']) {
      expect(shouldShowPhotoOpening(query, '', false)).toBe(false);
    }
  });
  it('opens for Start here and the brand link, even after a visit', () => {
    expect(shouldShowPhotoOpening('?start=1', '', true)).toBe(true);
    expect(shouldShowPhotoOpening('?start=1', '', false)).toBe(true);
  });
  it('keeps anchored and returning visitors in the workspace', () => {
    expect(shouldShowPhotoOpening('', '#rp-card', false)).toBe(false);
    expect(shouldShowPhotoOpening('', '#stage-section', false)).toBe(false);
    expect(shouldShowPhotoOpening('', '', true)).toBe(false);
  });
});
