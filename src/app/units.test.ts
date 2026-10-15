// How the page writes numbers (design/LOOK.md, round-0 UI-17): µm not "um", × not x, superscript powers, focus in m.
import { describe, expect, it } from 'vitest';
import { fmtDims, fmtDistance, fmtFno, fmtPitch, fmtPow10, fmtRange, fmtSci, fmtShutter, fmtSpanMm, upperKeepMicro } from './units';
import { splitTitle } from './ui';

describe('units', () => {
  // R-C7 (10/10/2026 correctness review): the cone inset read "0.08 mm across" for an 84.9 um span (-5.8%).
  it('writes a small sensor span in micrometers below 1 mm, keeping three significant digits', () => {
    expect(fmtSpanMm(0.0849)).toBe('85 µm');
    expect(fmtSpanMm(0.228)).toBe('228 µm');
    expect(fmtSpanMm(1.4944)).toBe('1.49 mm');
  });

  it('writes focus distances in meters, two decimals below 10 m, never flipping to mm', () => {
    expect(fmtDistance(450)).toBe('0.45 m');
    expect(fmtDistance(1500)).toBe('1.50 m');
    expect(fmtDistance(12345)).toBe('12.3 m');
    expect(fmtDistance(null)).toBe('infinity');
    expect(fmtDistance(Infinity)).toBe('infinity');
  });

  it('writes a depth-of-field range with one unit', () => {
    expect(fmtRange(1440, 1560)).toBe('1.44–1.56 m');
    expect(fmtRange(3100, Infinity)).toBe('3.10 m to infinity');
  });

  it('reads an exact root-2 f-number as the marked stop it sits on, and leaves other values alone', () => {
    expect(fmtFno(4 * Math.SQRT2)).toBe('f/5.6');
    expect(fmtFno(8 * Math.SQRT2)).toBe('f/11');
    expect(fmtFno(2.8)).toBe('f/2.8');
    expect(fmtFno(4)).toBe('f/4');
    expect(fmtFno(6.36)).toBe('f/6.3');
  });

  it('uses the micro sign, the multiplication sign and superscript powers', () => {
    expect(fmtPitch(4.35)).toBe('4.35 µm');
    expect(fmtDims(8256, 5504)).toBe('8,256 × 5,504');
    expect(fmtSci(2.4e12)).toBe('2.4 × 10¹²');
    expect(fmtSci(51876)).toBe('51,876');
    expect(fmtPow10(1e10)).toBe('10¹⁰');
    expect(fmtShutter(1 / 250)).toBe('1/250 s');
    expect(fmtShutter(2)).toBe('2 s');
    expect(fmtShutter(2 / 125)).toBe('1/60 s');
    expect(fmtShutter(1 / 1000)).toBe('1/1000 s');
    expect(fmtShutter(0.3)).toBe('0.3 s');
    expect(fmtShutter(0.6)).toBe('0.6 s');
    expect(fmtShutter(0.8)).toBe('0.8 s');
    expect(fmtShutter(16 / 60)).toBe('0.267 s');
  });

  it('uppercases captions without turning µ into a Greek capital or its unit letter into a capital', () => {
    expect(upperKeepMicro('4.35 µm pitch')).toBe('4.35 µm PITCH');
    expect(upperKeepMicro('1 square = 1 pixel · 458 µm across')).toBe('1 SQUARE = 1 PIXEL · 458 µm ACROSS');
    expect(upperKeepMicro('µs')).toBe('µs');
    expect(upperKeepMicro('no micro here')).toBe('NO MICRO HERE');
  });
});

describe('card titles', () => {
  it('moves a parenthetical provenance to its own line and drops a trailing "lens"', () => {
    expect(splitTitle('50 mm f/1.8 lens (generic, after the Nikon AF-S NIKKOR 50mm f/1.8G)')).toEqual({
      title: '50 mm f/1.8', sub: 'Generic, after the Nikon AF-S NIKKOR 50mm f/1.8G' });
    expect(splitTitle('f/2.8')).toEqual({ title: 'f/2.8', sub: null });
  });
  it('splits only a final balanced parenthetical (score loop r2: garbled "L1) · ... (patent example" subtitle)', () => {
    expect(splitTitle('Front element (L1) · 50 mm f/1.8 (patent example, Nikon standard lens)')).toEqual({
      title: 'Front element (L1) · 50 mm f/1.8', sub: 'Patent example, Nikon standard lens' });
    // nested: no clean final parenthetical, so the title stays whole rather than splitting inside the nesting
    expect(splitTitle('Lens (patent example (Nikon))')).toEqual({ title: 'Lens (patent example (Nikon))', sub: null });
    for (const t of ['Front element (L1) · 585 mm f/5.7 Phase Fresnel telephoto (Nikon patent example, representative of the Z 600 PF class)', 'A (b) c (d)']) {
      const r = splitTitle(t);
      const balanced = (x: string) => [...x].reduce((d, ch) => d < 0 ? d : d + (ch === '(' ? 1 : ch === ')' ? -1 : 0), 0) === 0;
      expect(balanced(r.title)).toBe(true);
      if (r.sub) expect(balanced(r.sub)).toBe(true);
    }
  });
});
