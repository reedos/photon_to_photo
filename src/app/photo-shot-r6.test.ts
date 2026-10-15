import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Example } from './examples';
import { photoShotStages, isoSentence, apertureSentence, openingWidthMm } from './photo-shot';
import { glossSegments } from './glossary';

const examples = JSON.parse(readFileSync('public/examples/examples.json', 'utf8')).examples as Example[];

// Score loop r6 (teaching): the aperture has its own sentence, and the ISO sentence compares against a stated reference.
describe('the aperture and ISO sentences', () => {
  const flycatcher = examples.find((e) => e.id === 'flycatcher')!;
  it('computes the opening width from the recorded focal length and f-number', () => {
    expect(openingWidthMm(flycatcher)).toBeCloseTo(500 / 5.6, 6);
    expect(apertureSentence(flycatcher)).toMatch(/f\/5\.6 on a 500 mm lens makes it about 89 mm wide/);
    const bears = examples.find((e) => e.id === 'bears')!;
    expect(apertureSentence(bears)).toMatch(/about 32 mm wide/);
  });
  it('puts the aperture into the exposure chapter, ahead of the shutter', () => {
    for (const ex of examples) {
      const text = photoShotStages(ex)[2].text;
      expect(text.indexOf('aperture')).toBeGreaterThanOrEqual(0);
      expect(text.indexOf('aperture')).toBeLessThan(text.indexOf('shutter'));
      expect(text).toMatch(/each row saw light for only that long/);
    }
  });
  it('states what "fewer photons" is measured against, and never says it of a long exposure', () => {
    expect(isoSentence(flycatcher)).toMatch(/about 32 times fewer photons than 1\/125 s/);
    const chipmunk = examples.find((e) => e.id === 'chipmunk')!;
    expect(isoSentence(chipmunk)).toMatch(/about 2\.6 times fewer photons than 1\/125 s/);
    expect(isoSentence({ ...chipmunk, shutter: 1 / 60 })).toMatch(/collects more photons/);
    expect(isoSentence({ ...chipmunk, shutter: 1 / 60 })).not.toMatch(/fewer/);
  });
  it('opens notes for the f-number, the aperture and RAW the first time they appear', () => {
    const linked = (t: string) => glossSegments(t).filter((s) => s.term).map((s) => s.term);
    expect(linked('The aperture is the opening: f/5.6 on a 500 mm lens.')).toEqual(['Aperture', 'F-number']);
    expect(linked('A bigger f-number means less light.')).toEqual(['F-number']);
    expect(linked('The original RAW data is unavailable.')).toEqual(['RAW']);
  });
});
