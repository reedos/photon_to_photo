// How the page writes numbers (design/LOOK.md, round-0 UI-17): µm not "um", × not x, superscript powers, focus in m.
import { describe, expect, it } from 'vitest';
import { fmtDims, fmtDistance, fmtFno, fmtPitch, fmtPow10, fmtRange, fmtSci, fmtShutter, upperKeepMicro } from './units';
import { splitTitle } from './ui';

describe('units', () => {
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

  it('uppercases captions without turning µ into a Greek capital', () => {
    expect(upperKeepMicro('4.35 µm pitch')).toBe('4.35 µM PITCH');
  });
});

describe('card titles', () => {
  it('moves a parenthetical provenance to its own line and drops a trailing "lens"', () => {
    expect(splitTitle('50 mm f/1.8 lens (generic, after the Nikon AF-S NIKKOR 50mm f/1.8G)')).toEqual({
      title: '50 mm f/1.8', sub: 'Generic, after the Nikon AF-S NIKKOR 50mm f/1.8G' });
    expect(splitTitle('f/2.8')).toEqual({ title: 'f/2.8', sub: null });
  });
});
