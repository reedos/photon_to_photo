import { describe, it, expect } from 'vitest';
import { compute, airyIntensity } from '../app/engine-api';
import { diffractionPattern, DIFFRACTION_SIZE } from './diffraction-pattern';

describe('diffraction pattern on a fixed sensor grid', () => {
  it('increases first-minimum radius with aperture and decreases central collected energy', () => {
    const a = diffractionPattern(compute({ lens:'n50', fno:4 }), 550);
    const b = diffractionPattern(compute({ lens:'n50', fno:16 }), 550);
    expect(b.radiusMm / a.radiusMm).toBeCloseTo(b.workingFno / a.workingFno, 9);
    expect(b.radiusRaster / a.radiusRaster).toBeCloseTo(4, 8);
    expect(b.centerFraction).toBeLessThan(a.centerFraction / 3);
    expect(b.spanMm).toBe(a.spanMm);
    expect(b.radiusMm).toBeCloseTo(1.22 * 550e-6 * b.workingFno, 12);
    expect(b.radiusPx).toBeCloseTo(b.radiusMm / b.pitchMm, 10);
  });
  it('raster samples match the independent engine intensity at physical pixel locations', () => {
    const p = diffractionPattern(compute({ lens:'n50', fno:11 }), 650);
    for (const [x,y] of [[204,204],[214,205],[240,204],[280,230]]) {
      const r = Math.hypot(x + .5 - DIFFRACTION_SIZE / 2, y + .5 - DIFFRACTION_SIZE / 2) / DIFFRACTION_SIZE * p.spanMm;
      const expected = airyIntensity(r,p.nm,p.workingFno) / airyIntensity(0,p.nm,p.workingFno);
      expect(Math.abs(p.intensity[y * DIFFRACTION_SIZE + x] - expected)).toBeLessThan(2e-5);
    }
    expect(p.pixels.totalFraction).toBeGreaterThan(.95);
    expect(p.pixels.totalFraction).toBeLessThan(1.001);
    expect(p.pixels.cells).toHaveLength(17 * 17);
  });
  it('uses the active sensor pitch and selected wavelength without changing the sensor scale', () => {
    const m = compute({ lens:'n50', fno:8 });
    const blue = diffractionPattern(m,450), red = diffractionPattern(m,650);
    expect(red.radiusRaster / blue.radiusRaster).toBeCloseTo(650 / 450, 10);
    expect(red.pitchMm * 1000).toBe(m.sensor.pitchUm);
    expect(red.spanMm).toBe(blue.spanMm);
  });
});
