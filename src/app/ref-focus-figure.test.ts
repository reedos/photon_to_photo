import { describe, expect, it } from 'vitest';
import { FIG, FOCUSED_DO, SLIDER, focusGeometry, RAY_FIG_HTML } from './ref-focus-figure';

describe('the Method page thin-lens figure', () => {
  it('is exactly sharp at the distance the sensor is set for, by 1/f = 1/do + 1/di', () => {
    expect(1 / FIG.focal).toBeCloseTo(1 / FOCUSED_DO + 1 / FIG.sensorD, 10);
    const g = focusGeometry(FOCUSED_DO);
    expect(g.state).toBe('sharp');
    expect(g.blur).toBe(0);
    expect(g.imageX).toBeCloseTo(g.sensorX, 6);
  });

  it('puts the image behind the sensor for a nearer point and in front of it for a farther one', () => {
    const near = focusGeometry(SLIDER.min), far = focusGeometry(SLIDER.max);
    expect(near.state).toBe('long');
    expect(near.imageX).toBeGreaterThan(near.sensorX);
    expect(far.state).toBe('short');
    expect(far.imageX).toBeLessThan(far.sensorX);
  });

  it('grows the disk with the distance from focus, by similar triangles', () => {
    const a = focusGeometry(SLIDER.min), b = focusGeometry(SLIDER.min + 40);
    expect(a.blur).toBeGreaterThan(b.blur);
    expect(a.blur).toBeCloseTo((2 * FIG.halfAperture * (a.imageD - FIG.sensorD)) / a.imageD, 8);
  });

  it('keeps the whole slider range inside the picture and its text at the 10.5 px floor on a 340 px figure', () => {
    for (const d of [SLIDER.min, FOCUSED_DO, SLIDER.max]) {
      const g = focusGeometry(d);
      expect(g.objectX).toBeGreaterThan(0);
      expect(g.imageX).toBeLessThan(FIG.w);
    }
    const sizes = [...RAY_FIG_HTML.matchAll(/font-size="(\d+)"/g)].map((m) => Number(m[1]));
    expect(Math.min(...sizes) * (340 / FIG.w)).toBeGreaterThanOrEqual(10.5);
  });
});
