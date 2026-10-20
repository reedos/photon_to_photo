import { describe, expect, it } from 'vitest';
import { evidenceIndex, evidenceSearch, evidenceDisplay, EVIDENCE_NAMES, readerLocator, readerUnits } from './evidence-index';

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
  // score loop r2: the page shows what the source says by default and keeps how it was fetched in Retrieval notes
  it('moves retrieval provenance out of the reader-facing summary and keeps the original as notes', () => {
    const loc = "series 'Nikon D850_14', Highcharts series option `fwc` -- extracted via curl + bracket-balanced JS-literal parse, same method as data/read-noise.json";
    const r = readerLocator(loc);
    expect(r.summary).toBe("series 'Nikon D850_14', chart field: full-well capacity");
    expect(r.notes).toBe(loc);
    const patent = readerLocator('JP 2015-215560 A, Example 1 · Table 1. Application JP2014-099625, filed 5/13/2014 (priority date); granted as JP6344044B2 on 6/20/2018. Machine-translated English text read via https://r.jina.ai/https://patents.google.com/x (Google Patents itself returned HTTP 503 on direct fetch).');
    expect(patent.summary).toContain('granted as JP6344044B2 on 6/20/2018');
    expect(patent.summary).not.toMatch(/jina|503|fetch/);
  });
  it('shows a quotation inside a quotation with curly quotes, not backslash escapes (score loop r3)', () => {
    const r = readerLocator('Bill Claff: "FWC and \\"measured ISO\\" can then be used to compute Quantum Efficiency (QE)."');
    expect(r.summary).toBe('Bill Claff: "FWC and ‘measured ISO’ can then be used to compute Quantum Efficiency (QE)."');
    expect(r.summary + r.notes).not.toContain('\\');
  });
  it('leaves a plain locator alone and normalizes units and dates for display', () => {
    expect(readerLocator('infobox, "Sensor" row: "35.9 x 23.9 mm"')).toEqual({ summary: 'infobox, "Sensor" row: "35.9 x 23.9 mm"', notes: '' });
    expect(readerUnits('pixel pitch 4.35 um, retrieved 2026-09-28')).toBe('pixel pitch 4.35 µm, retrieved 9/28/2026');
  });

  // score loop r4: rows were headed with file names (M50, N500FL, READ-NOISE)
  it('names each record in plain words and groups it by camera or lens', () => {
    for (const id of ['D850', 'Z8', 'READ-NOISE', 'S35', 'Z35', 'N50', 'M50', 'N500', 'N500FL', 'Z800']) {
      const { name, group } = evidenceDisplay(id);
      expect(name, id).not.toBe(id);
      expect(['Cameras', 'Lenses']).toContain(group);
    }
    expect(evidenceDisplay('N500FL')).toEqual({ name: '500 mm f/4 fluorite telephoto lens · patent example', group: 'Lenses' });
    expect(evidenceDisplay('SOMETHING')).toEqual({ name: 'SOMETHING', group: 'Other records' });
    expect(Object.keys(EVIDENCE_NAMES)).toHaveLength(10);
    const [source] = evidenceIndex({ 'data/lenses/n500fl.json': { source: { src: 'https://example.org/p' } } });
    expect(evidenceSearch(source)).toContain('fluorite telephoto');
  });
});
