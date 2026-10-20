import { describe, expect, it } from 'vitest';
import { insetCaption, WORDED_MIN_W } from './inset';

// Score loop r5: "Edge, magnified 690×" was one 130 px unbreakable word in a 101 px frame and the magnification ran off the
// view. A narrow frame now gets a short form that fits; a wide one keeps the words and may wrap.
describe('insetCaption', () => {
  const nb = String.fromCharCode(0xa0);
  it('gives a frame narrower than the worded minimum the short form, and keeps the dot with the number', () => {
    for (const w of [96, 108, 117, 129, 149]) {
      const c = insetCaption('690×', w, true);
      expect(c).toBe(`Edge ·${nb}690×`);
      // mono capitals at 10.5-11 px with tracking take about 6.6-7 px a glyph; the caption has to fit the frame less its padding
      expect(c.length * 7).toBeLessThanOrEqual(w - 16);
    }
  });
  it('keeps the worded caption on wider frames, with spaces that may break', () => {
    const compact = insetCaption('690×', WORDED_MIN_W, true);
    expect(compact).toBe('Edge, 690×');
    expect(compact).not.toContain(nb);
    expect(insetCaption('420×', 198, false)).toBe('Edge of frame, 420× larger than drawn');
  });
});
