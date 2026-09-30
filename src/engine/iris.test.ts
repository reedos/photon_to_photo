import { describe, it, expect } from 'vitest';
import { stopRadiusFor, irisOutline, irisTest, bladeShapes } from './iris';
import { makeCatalog } from './glass';
import { loadLens } from './lens';
import type { GlassEntry, LensDesign, Surface } from './lens-types';

function flatGlass(key: string, nd: number, vd: number): GlassEntry {
  return { key, catalog: 'TEST', name: key, nd, vd, formula: 'sellmeier3', coef: [nd * nd - 1, 0, 0, 1, 0, 2], range: [0.3, 2.5], source: 'synthetic', accessed: '9/28/2026' };
}
const BK7 = flatGlass('TEST:BK7', 1.5, 64.17);
const catalog = makeCatalog([BK7]);

describe('stopRadiusFor: golden — matches efl/(2 fno) when the stop IS the entrance pupil', () => {
  // Single thin element with the stop immediately at the lens (no front group): entrance pupil == stop exactly,
  // so stopRadiusFor(lens, fno) must equal efl/(2 fno) directly, the textbook definition of f-number.
  it('single-element design, stop in front of the lens (empty front group)', () => {
    const surfaces: Surface[] = [
      { r: null, t: 0, medium: 'air', sd: 20, stop: true }, // stop first: entrance pupil == the stop, trivially
      { r: 50, t: 0, medium: 'TEST:BK7', nd: 1.5, vd: 64.17, sd: 20 },
      { r: -50, t: 50, medium: 'air', sd: 20 },
    ];
    const design: LensDesign = {
      id: 'p50', focalLength: 50, maxFno: 1.4, name: 'test',
      source: { kind: 'representative', ref: 'synthetic', url: '', accessed: '9/28/2026', location: 'n/a' },
      scale: 1, surfaces,
      stated: { f: 50, fno: 1.4, bf: 50 },
      focus: { method: 'unit', minFocusM: 0.5, minFocusSource: 'assumed' },
      iris: { blades: 9, rounded: true, source: 'assumed', ev: 'assumed' },
      elements: 1, groups: 1, imageCircleMm: 43.27,
    };
    const lens = loadLens(design, catalog);
    const r = stopRadiusFor(lens, 2.8);
    expect(r).toBeCloseTo(50 / (2 * 2.8), 6);
  });

  it('throws for a non-positive f-number', () => {
    const surfaces: Surface[] = [
      { r: null, t: 0, medium: 'air', sd: 20, stop: true },
      { r: 50, t: 0, medium: 'TEST:BK7', nd: 1.5, vd: 64.17, sd: 20 },
      { r: -50, t: 50, medium: 'air', sd: 20 },
    ];
    const design: LensDesign = {
      id: 'p50', focalLength: 50, maxFno: 1.4, name: 'test',
      source: { kind: 'representative', ref: 'synthetic', url: '', accessed: '9/28/2026', location: 'n/a' },
      scale: 1, surfaces,
      stated: { f: 50, fno: 1.4, bf: 50 },
      focus: { method: 'unit', minFocusM: 0.5, minFocusSource: 'assumed' },
      iris: { blades: 9, rounded: true, source: 'assumed', ev: 'assumed' },
      elements: 1, groups: 1, imageCircleMm: 43.27,
    };
    const lens = loadLens(design, catalog);
    expect(() => stopRadiusFor(lens, 0)).toThrow(/positive/);
    expect(() => stopRadiusFor(lens, -2)).toThrow(/positive/);
  });
});

describe('irisOutline: straight blades — regular polygon', () => {
  it('n vertices, all at the given circumradius, evenly spaced', () => {
    const pts = irisOutline(6, 10, false, 0);
    expect(pts.length).toBe(6);
    for (const [x, y] of pts) expect(Math.hypot(x, y)).toBeCloseTo(10, 9);
    // vertex 0 at rotation=0 -> angle 0 -> (10,0)
    expect(pts[0][0]).toBeCloseTo(10, 9);
    expect(pts[0][1]).toBeCloseTo(0, 9);
    // vertex i at angle i*2pi/6
    expect(Math.atan2(pts[2][1], pts[2][0])).toBeCloseTo((2 * Math.PI * 2) / 6, 9);
  });

  it('rotation shifts every vertex by the same angle', () => {
    const rot = Math.PI / 4;
    const pts = irisOutline(5, 8, false, rot);
    expect(Math.atan2(pts[0][1], pts[0][0])).toBeCloseTo(rot, 9);
  });

  it('rejects fewer than 3 blades and a non-positive radius', () => {
    expect(() => irisOutline(2, 10, false, 0)).toThrow(/blades/);
    expect(() => irisOutline(6, 0, false, 0)).toThrow(/radius/);
    expect(() => irisOutline(6, -1, false, 0)).toThrow(/radius/);
  });
});

describe('irisOutline: rounded blades', () => {
  it('every sampled point is within the straight polygon\'s circumradius (bulges out, never past it)', () => {
    const radius = 10, n = 7;
    const pts = irisOutline(n, radius, true, 0, 12);
    for (const [x, y] of pts) expect(Math.hypot(x, y)).toBeLessThanOrEqual(radius + 1e-9);
  });

  it('every sampled point is beyond the straight polygon\'s inradius (does bulge out from the chord)', () => {
    const radius = 10, n = 7;
    const inradius = radius * Math.cos(Math.PI / n);
    const pts = irisOutline(n, radius, true, 0, 12);
    for (const [x, y] of pts) expect(Math.hypot(x, y)).toBeGreaterThan(inradius - 1e-9);
  });

  it('with many blades the rounded outline is nearly circular', () => {
    const radius = 10;
    const pts = irisOutline(24, radius, true, 0, 4);
    for (const [x, y] of pts) expect(Math.hypot(x, y)).toBeCloseTo(radius, 1);
  });

  it('vertex positions match the straight-blade polygon exactly (arcs meet at the same pivots)', () => {
    const straight = irisOutline(6, 10, false, 0.3);
    const rounded = irisOutline(6, 10, true, 0.3, 5);
    // the rounded outline's arc-start points should include the same 6 vertex positions
    for (const v of straight) {
      const found = rounded.some(([x, y]) => Math.hypot(x - v[0], y - v[1]) < 1e-9);
      expect(found).toBe(true);
    }
  });
});

describe('irisTest: point-in-outline', () => {
  it('center is always inside', () => {
    const test = irisTest(8, 10, false, 0);
    expect(test(0, 0)).toBe(true);
  });

  it('far outside is always outside', () => {
    const test = irisTest(8, 10, false, 0);
    expect(test(100, 100)).toBe(false);
  });

  it('a straight-blade edge midpoint sits at the inradius: just inside is in, just outside is out', () => {
    const n = 6, radius = 10;
    const inradius = radius * Math.cos(Math.PI / n);
    const test = irisTest(n, radius, false, 0);
    // edge between vertex 0 (angle 0) and vertex 1 (angle 2pi/6): its midpoint direction is at angle pi/6
    const midAngle = Math.PI / n;
    const justIn = [(inradius - 0.01) * Math.cos(midAngle), (inradius - 0.01) * Math.sin(midAngle)] as const;
    const justOut = [(inradius + 0.01) * Math.cos(midAngle), (inradius + 0.01) * Math.sin(midAngle)] as const;
    expect(test(...justIn)).toBe(true);
    expect(test(...justOut)).toBe(false);
  });

  it('a rounded outline accepts points a straight outline would reject, near an edge midpoint', () => {
    const n = 6, radius = 10;
    const inradius = radius * Math.cos(Math.PI / n);
    const midAngle = Math.PI / n;
    // a point just beyond the straight inradius but still inside the rounded (bulged) edge
    const apothemGap = radius - inradius;
    const p = [(inradius + 0.5 * apothemGap) * Math.cos(midAngle), (inradius + 0.5 * apothemGap) * Math.sin(midAngle)] as const;
    expect(irisTest(n, radius, false, 0)(...p)).toBe(false);
    expect(irisTest(n, radius, true, 0, 16)(...p)).toBe(true);
  });
});

describe('bladeShapes: schematic per-blade outlines', () => {
  it('returns one shape per blade', () => {
    const shapes = bladeShapes(9, 10, true, 0);
    expect(shapes.length).toBe(9);
  });

  it('every shape has at least 3 points and stays within the housing radius (2x opening radius)', () => {
    const radius = 10;
    const shapes = bladeShapes(9, radius, true, 0, 6);
    for (const shape of shapes) {
      expect(shape.length).toBeGreaterThanOrEqual(3);
      for (const [x, y] of shape) expect(Math.hypot(x, y)).toBeLessThanOrEqual(2 * radius + 1e-9);
    }
  });

  it('rejects fewer than 3 blades and a non-positive radius', () => {
    expect(() => bladeShapes(2, 10, false, 0)).toThrow(/blades/);
    expect(() => bladeShapes(6, 0, false, 0)).toThrow(/radius/);
  });
});
