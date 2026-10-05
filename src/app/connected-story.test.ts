import { describe, expect, it } from 'vitest';
import examples from '../../public/examples/examples.json';
import n500 from '../../data/lenses/n500.json';
import d850 from '../../data/d850.json';
import { connectedStory, STORY_ARTWORK, STORY_CHAPTERS } from './connected-story';

describe('connected story chapter art and evidence figures', () => {
  it('gives all eight chapters distinct scene art and a sourced figure', () => {
    expect(STORY_CHAPTERS).toHaveLength(8);
    expect(new Set(Object.values(STORY_ARTWORK)).size).toBe(8);
    for (const chapter of STORY_CHAPTERS) {
      expect(chapter.figureValue.trim(), `${chapter.id} figure`).not.toBe('');
      expect(chapter.figureLabel.trim(), `${chapter.id} figure label`).not.toBe('');
      expect(chapter.evidence.trim(), `${chapter.id} evidence chip`).not.toBe('');
      const art = STORY_ARTWORK[chapter.id];
      expect(art, `${chapter.id} has a rendered image or controlled experiment`).toMatch(/<svg|<video/);
    }
    expect(STORY_ARTWORK.photo).toContain(`examples/${examples.examples.find(example => example.id === 'flycatcher')!.image}`);
    expect(STORY_ARTWORK.final).toContain(`examples/${examples.examples.find(example => example.id === 'flycatcher')!.image}`);
    expect(STORY_ARTWORK.light).toContain('REFLECTED LIGHT');
    expect(STORY_ARTWORK.lens).toContain('Curved glass groups');
    expect(STORY_ARTWORK.focus).toContain('Larger blur');
    expect(STORY_ARTWORK.exposure).toContain('CURTAIN TRAVEL');
    expect(STORY_ARTWORK.readout).toContain('ROW SCAN');
  });

  it('keeps the chapter figures tied to metadata, the cited lens design, or explicit experiments', () => {
    const photo = examples.examples.find(example => example.id === 'flycatcher')!;
    const byId = Object.fromEntries(STORY_CHAPTERS.map(chapter => [chapter.id, chapter]));
    expect(byId.photo.figureValue).toBe('500 mm');
    expect(byId.focus.figureValue).toContain(String(photo.focusM));
    expect(byId.exposure.figureValue).toBe(`${(photo.shutter * 1000).toFixed(2)} ms`);
    expect(byId.light.figureValue).toBe(`Ø ${(n500.focalLength / photo.fno).toFixed(1)} mm`);
    expect(byId.lens.figureValue).toBe(`${n500.elements} elements · ${n500.groups} groups`);
    expect(byId.pixel.evidence).toMatch(/not this photo/i);
    expect(byId.readout.figureValue).toBe(`${d850.sensor.readout.electronicFullFrameMs.v} ms`);
    expect(byId.readout.note).toMatch(/metadata identifies a Nikon D850/i);
    expect(byId.readout.note).toMatch(/do not attribute this electronic scan timing/i);
    expect(byId.final.figureValue).toBe('3 channels');
    expect(connectedStory()).toContain('class="figure story-figure"');
  });
});
