import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Example } from './examples';
import { compute } from './engine-api';
import { photoShotScenario, photoShotStats, photoShotStages, photoSubject, keepUnits, isoSentence, SHOT_RECAP } from './photo-shot';
import { chapterDwellSeconds } from './shot-model';

const examples = JSON.parse(readFileSync('public/examples/examples.json', 'utf8')).examples as Example[];
describe('real photo journeys', () => {
  for (const ex of examples) it(`${ex.id}: keeps recorded metadata distinct from the illustration`, () => {
    const scenario = photoShotScenario(ex), model = compute(scenario);
    expect(scenario.motion?.speedMps).toBe(0);
    expect(scenario.sensor).toBeUndefined();
    const stats = photoShotStats(ex, model, 3);
    expect(stats[2][0]).toBe(`ISO ${ex.iso}`);
    expect(stats.map(s => s[1]).every(label => label.startsWith('recorded'))).toBe(true);
    expect(photoShotStages(ex).map(s => [s.start, s.end])).toEqual([[0,4],[4,8],[8,12],[12,16],[16,20],[20,28]]);
    expect(photoShotStages(ex)[4].note).toContain('not this photograph');
    expect(photoShotStages(ex)[5].note).toContain('finished JPEG');
    const anchor=photoSubject(ex);
    expect(anchor.x).toBeGreaterThan(0); expect(anchor.x).toBeLessThan(1);
    expect(anchor.y).toBeGreaterThan(0); expect(anchor.y).toBeLessThan(1);
  });
});

// Score loop r5 (teaching): pacing, captions that a reader can finish, and the wording slips the reviewers found.
describe('Play the shot captions and pacing', () => {
  const words = (t: string) => t.trim().split(/\s+/).length;
  it('holds each chapter on screen for the time its caption takes to read (3 words a second)', () => {
    for (const ex of examples) {
      const stages = photoShotStages(ex);
      stages.forEach((st, i) => {
        const dwell = chapterDwellSeconds(i, words(st.text));
        expect(dwell).toBeGreaterThanOrEqual(st.end - st.start);
        expect(dwell).toBeGreaterThanOrEqual(words(st.text) / 3 - 1e-9);
        // the focus chapter's caption was 70 words; chapters 1 to 5 now stay under 56. The last is the photo's own note plus the recap.
        expect(words(st.text), `${ex.id} chapter ${i + 1}`).toBeLessThan(i === 5 ? 75 : 56);
      });
    }
  });
  it('keeps the focus chapter to about 40 words and moves the f-number lesson to the modeling note', () => {
    const flycatcher = examples.find((e) => e.id === 'flycatcher')!;
    const stage = photoShotStages(flycatcher)[1];
    expect(words(stage.text)).toBeLessThanOrEqual(45);
    expect(stage.text).not.toMatch(/f-number/);
    expect(stage.note).toMatch(/smaller f-number means a wider opening/);
  });
  it('says plainly when the lens is not modeled or the focus is not recorded', () => {
    const bears = examples.find((e) => e.id === 'bears')!;
    expect(bears.modelMatch).toBe(false);
    const text = photoShotStages(bears)[1].text;
    expect(text).toMatch(/not modeled, so this shows a generic design/);
    expect(text).toMatch(/assumed focus distance/);
    const matched = examples.find((e) => e.id === 'flycatcher')!;
    expect(photoShotStages(matched)[1].text).not.toMatch(/not modeled/);
    expect(photoShotStages(matched)[1].text).not.toMatch(/assumed focus/);
  });
  it('ties the last chapter back to the whole chain, and names the setting that shaped the photo in the first', () => {
    for (const ex of examples) {
      const stages = photoShotStages(ex);
      expect(stages[5].text.endsWith(SHOT_RECAP)).toBe(true);
      expect(stages[0].text).toMatch(/the chapters follow how each setting shaped the photo/);
    }
    expect(SHOT_RECAP).toBe('Photons, glass, charge, numbers, color: that chain made this photo.');
  });
  it('does not say "It adds no light" and does not say a base-ISO photo is amplified afterward', () => {
    for (const ex of examples) {
      const sentence = isoSentence(ex);
      expect(sentence).not.toMatch(/It adds no light/);
      expect(sentence).toMatch(/ISO adds no light/);
      if (ex.iso <= 200) expect(sentence).toMatch(/low gain/);
      if (ex.iso <= 200) expect(sentence).not.toMatch(/amplifies that signal afterward/);
    }
  });
  it('keeps a unit with its number (a no-break space) in generated captions', () => {
    expect(keepUnits('1/4000 s is 0.25 ms at 8.91 m and 500 mm')).toBe('1/4000 s is 0.25 ms at 8.91 m and 500 mm');
    expect(keepUnits('ISO 1400 and 3 stops')).toBe('ISO 1400 and 3 stops');
    const flycatcher = examples.find((e) => e.id === 'flycatcher')!;
    expect(photoShotStages(flycatcher)[2].text).toContain('1/4000 s');
  });
});
