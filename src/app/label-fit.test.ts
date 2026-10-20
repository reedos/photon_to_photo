import { describe, expect, it } from 'vitest';
import { fitLabel, wrapWords, type FitInput } from './label-fit';

// Score loop r5: Play the shot's labels ran past the right edge of a 320 to 390 px phone canvas. fitLabel is the geometry
// that keeps every label's padded box inside the canvas; the browser gate (tools/test-shot-player.mjs) checks the same
// thing on the drawn frames at 320, 360 and 390 px.
const CHAR = 7; // a fixed-width stand-in for ctx.measureText
const measure = (s: string) => s.length * CHAR;
const base: FitInput = { value: '', x: 0, y: 0, align: 'left', measure, lineHeight: 16, lo: 3, hi: 997, top: 2, bottom: 558, ascent: 11, descent: 3, padX: 6, padY: 3 };
const inside = (r: ReturnType<typeof fitLabel>, p: FitInput) => r.lines.every((l) => l.x - p.padX >= p.lo - 0.01 && l.x + l.w + p.padX <= p.hi + 0.01);

describe('fitLabel', () => {
  it('leaves a label that fits where it was asked for', () => {
    const p = { ...base, value: 'PHOTODIODE', x: 275, y: 244 };
    const r = fitLabel(p);
    expect(r.adjusted).toBe(false);
    expect(r.outside).toBe(false);
    expect(r.lines).toEqual([{ text: 'PHOTODIODE', x: 275, y: 244, w: 70 }]);
  });
  it('slides a label that runs past the right edge back inside', () => {
    const p = { ...base, value: 'BUILDING THE PHOTO', x: 900, y: 70 };
    const r = fitLabel(p);
    expect(r.adjusted).toBe(true);
    expect(inside(r, p)).toBe(true);
    expect(r.lines).toHaveLength(1);
  });
  it('keeps a right-aligned label at the right edge', () => {
    const p = { ...base, value: 'THE PHOTODIODE’S CHARGE STORE', x: 1010, y: 128, align: 'right' as const };
    const r = fitLabel(p);
    expect(inside(r, p)).toBe(true);
    expect(r.lines[0].x + r.lines[0].w).toBeLessThanOrEqual(997 - 6 + 0.01);
  });
  it('wraps a label wider than the canvas at word breaks and stacks it upward from a low baseline', () => {
    const p = { ...base, value: 'Sensor samples illustrated from the JPEG · not the original RAW', x: 45, y: 540, hi: 300 };
    const r = fitLabel(p);
    expect(r.lines.length).toBeGreaterThan(1);
    expect(r.lines.at(-1)!.y).toBeLessThanOrEqual(540);
    expect(r.lines.map((l) => l.text).join(' ')).toBe(p.value);
    expect(inside(r, p)).toBe(true);
    expect(r.outside).toBe(false);
  });
  it('stacks a wrapped label downward from a high baseline and keeps the block above the bottom edge', () => {
    const top = fitLabel({ ...base, value: 'one two three four five six seven eight', x: 20, y: 30, hi: 160 });
    expect(top.lines[0].y).toBe(30);
    expect(top.lines[1].y).toBeGreaterThan(30);
    const low = fitLabel({ ...base, value: 'one two three four five six seven eight', x: 20, y: 556, hi: 160 });
    expect(low.lines.at(-1)!.y + base.descent + base.padY).toBeLessThanOrEqual(558 + 0.01);
  });
  it('reports a single word wider than the canvas as outside rather than hiding it', () => {
    const r = fitLabel({ ...base, value: 'A'.repeat(200), x: 10, y: 100 });
    expect(r.outside).toBe(true);
  });
  it('wrapWords breaks greedily and never returns an empty list', () => {
    expect(wrapWords('aa bb cc dd', measure, 5 * CHAR)).toEqual(['aa bb', 'cc dd']);
    expect(wrapWords('', measure, 50)).toEqual(['']);
  });
});
