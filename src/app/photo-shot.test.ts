import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Example } from './examples';
import { compute } from './engine-api';
import { photoShotScenario, photoShotStats, photoShotStages, photoSubject } from './photo-shot';

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
