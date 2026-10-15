import { describe, expect, it } from 'vitest';
import catalog from '../../public/examples/examples.json';
import { PHOTO_ALT } from './examples';

describe('gallery photo alt text', () => {
  it('describes every photograph in a sentence, not just its title (score loop r4)', () => {
    for (const example of catalog.examples) {
      const alt = PHOTO_ALT[example.id];
      expect(alt, example.id).toBeTruthy();
      expect(alt.length, example.id).toBeGreaterThan(example.title.length + 20);
      expect(alt.length, example.id).toBeLessThan(160);
    }
  });
});
