import { describe, it, expect } from 'vitest';
import { getScene, sceneIds, sceneDefaultLux, sceneDefaultCctK, daylightAt, colorCheckerBillboard, siemensStarBillboard, pointHighlight, BENCH_LUX, DUSK_LUX } from './scenes';
import { radiance } from './scene';
import { BINS, CMF } from './data';

describe('scene ids', () => {
  it('lists bench and dusk', () => {
    expect(sceneIds().sort()).toEqual(['bench', 'dusk']);
  });

  it('default lux matches each scene', () => {
    expect(sceneDefaultLux('bench')).toBe(BENCH_LUX);
    expect(sceneDefaultLux('dusk')).toBe(DUSK_LUX);
  });

  it('an unknown scene id throws', () => {
    expect(() => getScene('nope')).toThrow();
    expect(() => sceneDefaultLux('nope')).toThrow();
  });

  it('both scenes share the same illuminant CCT', () => {
    expect(sceneDefaultCctK('bench')).toBe(sceneDefaultCctK('dusk'));
  });
});

describe('bench scene geometry', () => {
  const bench = getScene('bench');

  it('has the four named billboards', () => {
    expect(bench.billboards.map((b) => b.id).sort()).toEqual(['backdrop', 'colorchecker', 'foreground', 'siemens-star'].sort());
  });

  it('has four background point highlights', () => {
    expect(bench.pointHighlights?.length).toBe(4);
  });

  it('is lit at 10,000 lux, 5500 K daylight', () => {
    expect(bench.illuminant.lux).toBe(10000);
  });
});

describe('dusk scene', () => {
  const dusk = getScene('dusk');
  it('is the same geometry at 20 lux', () => {
    expect(dusk.illuminant.lux).toBe(20);
    expect(dusk.billboards.length).toBe(getScene('bench').billboards.length);
  });
});

describe('daylightAt', () => {
  it('is positive across the visible range at 5500 K', () => {
    const spd = daylightAt(5500);
    for (const nm of [400, 500, 600, 700]) expect(spd(nm)).toBeGreaterThan(0);
  });

  it('throws outside the daylight locus range (delegated to scene.ts)', () => {
    expect(() => daylightAt(1000)).toThrow();
  });
});

describe('colorCheckerBillboard', () => {
  const cc = colorCheckerBillboard('cc', [0, 0, 3000], 600, 400);

  it('the top-left cell (dark skin) reflects less than the bottom-left cell (white)', () => {
    // top row v near +0.5, bottom row v near -0.5; column 0 near u = -0.5 + 1/12.
    const topLeft = cc.reflectanceAt(-0.42, 0.42);
    const bottomLeft = cc.reflectanceAt(-0.42, -0.42);
    expect(bottomLeft(550)).toBeGreaterThan(topLeft(550));
  });

  it('the inter-patch gap is dark', () => {
    const gapReflectance = cc.reflectanceAt(-0.5 + 1 / 6, 0.5); // a cell boundary
    expect(gapReflectance(550)).toBeLessThan(0.1);
  });
});

describe('siemensStarBillboard', () => {
  const star = siemensStarBillboard('s', [0, 0, 3000], 300, 8);

  it('takes both the high and the low reflectance value somewhere around the ring', () => {
    const values = new Set<number>();
    for (let deg = 0; deg < 360; deg += 5) {
      const rad = (deg * Math.PI) / 180;
      values.add(Math.round(star.reflectanceAt(0.3 * Math.cos(rad), 0.3 * Math.sin(rad))(550) * 100));
    }
    expect(values.has(85)).toBe(true); // STAR_HIGH
    expect(values.has(5)).toBe(true); // STAR_LOW
  });
});

describe('pointHighlight', () => {
  it('has positive radiance across the visible range and peaks in the warm end', () => {
    const h = pointHighlight('h', [0, 0, 25000]);
    let peakNm = BINS.centers[0];
    let peakV = -Infinity;
    for (const nm of BINS.centers) {
      const v = h.radianceAt(nm);
      expect(v).toBeGreaterThan(0);
      if (v > peakV) { peakV = v; peakNm = nm; }
    }
    expect(peakNm).toBeGreaterThan(500); // a 3000 K Planckian's visible-range response rises toward red
  });
});

describe('radiance() end-to-end on the bench scene', () => {
  it('a ray straight down +z from the origin hits the colorchecker billboard', () => {
    // colorchecker center is at x=-550; aim slightly off-axis to hit it (camera convention: rays travel +z).
    const bench = getScene('bench');
    const dir: [number, number, number] = [-550 / 3000, 0, 1];
    const result = radiance(bench, [0, 0, 0], dir, BINS, CMF.ybar);
    expect(result.hitId).toBe('colorchecker');
    expect(result.depthMm).not.toBeNull();
    expect(result.radianceByBin.some((v) => v > 0)).toBe(true);
  });

  it('a ray toward the on-axis background highlight hits it, not the backdrop', () => {
    const bench = getScene('bench');
    const result = radiance(bench, [0, 0, 0], [0, 0, 1], BINS, CMF.ybar);
    expect(result.hitId).toBe('bokeh-highlight-0');
  });
});
