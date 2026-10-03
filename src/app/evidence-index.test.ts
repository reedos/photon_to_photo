import { describe, expect, it } from 'vitest';
import { evidenceIndex, evidenceSearch } from './evidence-index';

describe('recorded evidence index', () => {
  it('keeps separate parameter uses of a shared source, including conflicting evidence types', () => {
    const [source] = evidenceIndex({ 'data/body.json': { sensor: {
      fullWellE: { ev: 'reported', src: 'https://example.org/chart', loc: 'Table one' },
      readNoiseE: { ev: 'derived', src: 'https://example.org/chart', loc: 'Table two' },
    } } });
    expect(source.uses).toHaveLength(2);
    expect(source.uses.map(use => use.path)).toEqual(['sensor.fullWellE', 'sensor.readNoiseE']);
    expect(evidenceSearch(source)).toContain('read Noise E');
    expect(evidenceSearch(source)).toContain('Table two');
  });
  it('retains patent locators and de-duplicates URL aliases within one record', () => {
    const [source] = evidenceIndex({ 'lens.json': { source: { src: 'https://example.org/patent',
      url: 'https://example.org/patent', ref: 'Example 7', location: 'Table 7' } } });
    expect(source.uses).toEqual([{ path: 'source', evidence: '', evidencePath: '', locator: 'Example 7 · Table 7' }]);
  });
  it('identifies the enclosing evidence record for source arrays without inventing a source rating', () => {
    const [source] = evidenceIndex({ 'body.json': { chip: { ev: 'reported', srcs: [{ src: 'https://example.org/chip' }] } } });
    expect(source.uses[0]).toMatchObject({ path: 'chip.srcs[0]', evidence: 'reported', evidencePath: 'chip' });
  });
  it('does not parse prose URLs or expose non-web or malformed source links', () => {
    expect(evidenceIndex({ 'body.json': { note: 'See https://example.org', src: 'javascript:alert(1)', nested: { url: 'https://' } } })).toEqual([]);
  });
});
