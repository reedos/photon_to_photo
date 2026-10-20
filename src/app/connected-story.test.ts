import { describe, expect, it } from 'vitest';
import examples from '../../public/examples/examples.json';
import n500 from '../../data/lenses/n500.json';
import d850 from '../../data/d850.json';
import { connectedStory, STORY_ARTWORK, STORY_CHAPTERS } from './connected-story';
import { exampleSmallest } from './image-variants';

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
    // the artwork shows the supplied photo (its smallest copy since score loop r1: the panels are 236 px wide)
    expect(STORY_ARTWORK.photo).toContain(exampleSmallest(examples.examples.find(example => example.id === 'flycatcher')!.image));
    expect(STORY_ARTWORK.final).toContain(exampleSmallest(examples.examples.find(example => example.id === 'flycatcher')!.image));
    expect(STORY_ARTWORK.light).toContain('REFLECTED LIGHT');
    expect(STORY_ARTWORK.lens).toContain('Curved glass groups');
    expect(STORY_ARTWORK.focus).toContain('Nearer point:');
    expect(STORY_ARTWORK.focus).toContain('blur disk');
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
    // score loop r2: the headline figure applies to this photo (its camera's sensor rows), not the electronic scan
    expect(byId.readout.figureValue).toBe(`${d850.sensor.pixelCount.effectiveV.v.toLocaleString('en-US')} rows`);
    expect(byId.readout.note).toContain(`${d850.sensor.readout.electronicFullFrameMs.v} ms`);
    expect(byId.readout.note).toMatch(/metadata identifies a Nikon D850/i);
    expect(byId.readout.note).toMatch(/may not apply to this photograph/i);
    // the figure label itself says the pixel count is a test, not this photo (score loop r1)
    expect(byId.pixel.figureLabel).toMatch(/not this photo/i);
    expect(byId.lens.figureLabel).not.toMatch(/\bn500\b/);
    // score loop r3: the result's figure is the JPEG's own pixel count, each from one filtered sample, and the copy
    // recaps the whole chain; the exposure chapter says why ISO was raised
    expect(byId.final.figureValue).toBe(`${(photo.width * photo.height / 1e6).toFixed(1)} million pixels`);
    expect(byId.final.figureLabel).toContain(`${d850.sensor.pixelCount.effectiveH.v.toLocaleString('en-US')} × ${d850.sensor.pixelCount.effectiveV.v.toLocaleString('en-US')}`);
    expect(byId.final.copy).toMatch(/light from the bird → .* → this JPEG/i);
    // score loop r4: the 19 elements belong to the patent example, and the copy says so
    expect(byId.final.copy).toContain(`about ${n500.elements} elements (a published design of this type)`);
    expect(byId.final.figureLabel).toMatch(/estimated from one measured red, green or blue sample plus its neighbors/);
    expect(byId.exposure.copy).not.toMatch(/\bfew photons\b/);
    expect(byId.light.copy).toMatch(/Light arrives as photons/);
    expect(byId.exposure.copy).toContain(`ISO ${photo.iso}`);
    expect(byId.exposure.copy).toMatch(/adds no light/);
    expect(STORY_ARTWORK.final).toContain('BAYER SAMPLES');
    expect(STORY_ARTWORK.final).not.toContain('RGB DISPLAY CHANNELS');
    expect(connectedStory()).toContain('class="figure story-figure"');
  });

  // score loop r4: the labels were 6.9 px on a 390 px phone (5.8 px for the small ones). Every label is a tag: text in the
  // drawing where the figure is wide, a numbered badge and a line of page text where it is narrow.
  it('gives every diagram label a badge and a key line of the same number, in reading order', () => {
    for (const id of ['photo', 'light', 'lens', 'focus', 'exposure', 'readout', 'final'] as const) {
      const art = STORY_ARTWORK[id];
      const texts = [...art.matchAll(/<text class="story-svg-(?:label|small)"/g)].length;
      const badges = [...art.matchAll(/<g class="story-badge"><circle[^>]*\/><text[^>]*>(\d+)<\/text>/g)].map(m => Number(m[1]));
      const keys = [...art.matchAll(/<li>([^<]+)<\/li>/g)].map(m => m[1]);
      expect(texts, id).toBeGreaterThan(2);
      expect(badges, id).toEqual(badges.map((_, i) => i + 1));
      expect(badges.length, id).toBe(texts);
      expect(keys.length, id).toBe(texts);
      expect(art, id).not.toMatch(/<text class="story-svg-small" x="\d+" y="\d+">/);
    }
  });

  it('draws the Focus chapter as two bundles: one meeting at the sensor, a nearer point landing as a disk', () => {
    const art = STORY_ARTWORK.focus;
    expect(art).toContain('Focused point:');
    expect(art).toContain('Nearer point: its rays would meet behind the sensor, so they land as a blur disk');
    expect(art).toContain('stroke-dasharray="7 5"');
    expect(art).not.toContain('Background blur');
    expect(art).not.toContain('Larger blur');
  });

  it('says how the story, Play the shot and the tour relate', () => {
    const html = connectedStory();
    expect(html).toContain('Light → Lens → Focus → Exposure → Pixel → Readout → Photo');
    expect(html).toContain('8 chapters');
    expect(html).toContain('6 chapters');
    expect(html).toContain('10 stops');
    expect(STORY_CHAPTERS.find(c => c.id === 'photo')!.action).toBe('Play the shot with this photo');
  });
});
