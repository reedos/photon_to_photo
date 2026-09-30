import { describe, it, expect } from 'vitest';
import { makeCatalog, indexAt } from './glass';
import { loadLens, systemAt, sensorZ } from './lens';
import { cardinal, imageOf } from './paraxial';
import type { GlassEntry, LensDesign, Surface } from './lens-types';

// Constant-index (non-dispersive) fixture glasses: C1=0 makes the first Sellmeier term wavelength-independent
// (n^2 = 1+B1 exactly, at every wavelength) — see glass.test.ts's "schott" fixture for the same trick applied to
// the other formula. Keeps every geometry check in this file a one-number hand calculation.
function flatGlass(key: string, nd: number, vd: number): GlassEntry {
  return { key, catalog: 'TEST', name: key, nd, vd, formula: 'sellmeier3', coef: [nd * nd - 1, 0, 0, 1, 0, 2], range: [0.3, 2.5], source: 'synthetic', accessed: '9/28/2026' };
}
const BK7 = flatGlass('TEST:BK7', 1.5, 64.17);
const SF11 = flatGlass('TEST:SF11', 1.7847, 25.76);
const catalog = makeCatalog([BK7, SF11]);
const NM = 587.5618;

function baseDesign(surfaces: Surface[], overrides: Partial<LensDesign> = {}): LensDesign {
  return {
    id: 'test', focalLength: 50, maxFno: 2, name: 'test lens',
    source: { kind: 'representative', ref: 'synthetic', url: '', accessed: '9/28/2026', location: 'n/a' },
    scale: 1,
    surfaces,
    stated: { f: 50, fno: 2, bf: 50 },
    focus: { method: 'unit', minFocusM: 0.5, minFocusSource: 'assumed' },
    iris: { blades: 9, rounded: true, source: 'assumed', ev: 'assumed' },
    elements: 1, groups: 1, imageCircleMm: 43.27,
    ...overrides,
  };
}

describe('loadLens: geometry, scale, elements and groups', () => {
  // Cemented doublet (2 elements, 1 group) followed by an air-spaced singlet (1 element, its own group).
  const surfaces: Surface[] = [
    { r: 40, t: 5, medium: 'TEST:BK7', nd: 1.5, vd: 64.17, sd: 15 },
    { r: -30, t: 2, medium: 'TEST:SF11', nd: 1.7847, vd: 25.76, sd: 15 }, // cemented face: no air between
    { r: -80, t: 10, medium: 'air', sd: 15 },
    { r: 60, t: 3, medium: 'TEST:BK7', nd: 1.5, vd: 64.17, sd: 12 },
    { r: -60, t: 40, medium: 'air', sd: 12 }, // last t = BFD at infinity
  ];
  const design = baseDesign(surfaces, { elements: 3, groups: 2 });

  it('resolves explicit glass keys directly (dnd=dvd=0 for a matching key)', () => {
    const lens = loadLens(design, catalog);
    expect(lens.raw.map((r) => r.mediumAfter)).toEqual(['TEST:BK7', 'TEST:SF11', 'air', 'TEST:BK7', 'air']);
    expect(lens.glassResolutions.every((g) => g.dnd === 0 && g.dvd === 0)).toBe(true);
  });

  it('counts 3 elements in 2 cemented groups', () => {
    const lens = loadLens(design, catalog);
    expect(lens.elements.length).toBe(3);
    expect(lens.groups.length).toBe(2);
    expect(lens.groups[0].elements).toEqual([1, 2]); // cemented doublet
    expect(lens.groups[0].surfaces).toEqual([0, 2]);
    expect(lens.groups[1].elements).toEqual([3]);
    expect(lens.groups[1].surfaces).toEqual([3, 4]);
  });

  it('scale multiplies r, t and sd (efl scales linearly with a pure size scale)', () => {
    const lens1 = loadLens(design, catalog);
    const lens2 = loadLens(baseDesign(surfaces, { elements: 3, groups: 2, scale: 2 }), catalog);
    const c1 = cardinal(systemAt(lens1, null), NM);
    const c2 = cardinal(systemAt(lens2, null), NM);
    expect(c2.efl).toBeCloseTo(c1.efl * 2, 6);
    expect(sensorZ(lens2)).toBeCloseTo(sensorZ(lens1) * 2, 6);
  });

  it('coating defaults: air-glass surfaces coated, the cemented face is not', () => {
    const lens = loadLens(design, catalog);
    expect(lens.raw[0].coated).toBe(true); // air -> BK7
    expect(lens.raw[1].coated).toBe(false); // BK7 -> SF11, cemented
    expect(lens.raw[2].coated).toBe(true); // SF11 -> air
    expect(lens.raw[3].coated).toBe(true); // air -> BK7
    expect(lens.raw[4].coated).toBe(true); // BK7 -> air
  });

  it('an explicit surface.coated overrides the default', () => {
    const explicit = surfaces.map((s, i) => (i === 0 ? { ...s, coated: false } : s));
    const lens = loadLens(baseDesign(explicit, { elements: 3, groups: 2 }), catalog);
    expect(lens.raw[0].coated).toBe(false);
  });

  it('sensorZ is the cumulative z of every t, ending with the stated BFD', () => {
    const lens = loadLens(design, catalog);
    expect(sensorZ(lens)).toBeCloseTo(5 + 2 + 10 + 3 + 40, 9);
  });
});

describe('loadLens: glass resolution via "glass" (nearest match)', () => {
  it('resolves to the nearest catalog entry and records dnd/dvd', () => {
    const surfaces: Surface[] = [
      { r: 40, t: 5, medium: 'glass', nd: 1.503, vd: 63.9, sd: 15 }, // close to BK7 (1.5, 64.17)
      { r: -40, t: 45, medium: 'air', sd: 15 },
    ];
    const lens = loadLens(baseDesign(surfaces), catalog);
    const res = lens.glassResolutions[0];
    expect(res.matched).toBe(true);
    expect(res.baseKey).toBe('TEST:BK7');
    expect(res.dnd).toBeCloseTo(1.503 - 1.5, 9);
    expect(res.dvd).toBeCloseTo(63.9 - 64.17, 9);
  });

  // Lead, 09/28/2026: a stated nd/vd with no exact catalog match gets a model glass on the nearest entry, which
  // reproduces the stated nd and vd exactly and takes its dispersion shape from that entry. Needs a dispersive
  // glass: SCHOTT N-BK7 Sellmeier coefficients (SCHOTT datasheet; also in glass.test.ts).
  const NBK7: GlassEntry = {
    key: 'TEST:N-BK7', catalog: 'TEST', name: 'N-BK7', nd: 1.5168, vd: 64.17, formula: 'sellmeier3',
    coef: [1.03961212, 0.00600069867, 0.231792344, 0.0200179144, 1.01046945, 103.560653],
    range: [0.3, 2.5], source: 'SCHOTT N-BK7 datasheet', accessed: '9/28/2026',
  };
  const dispersive = makeCatalog([NBK7]);

  it('builds a model glass that reproduces a non-catalog nd/vd exactly', () => {
    const surfaces: Surface[] = [
      { r: 40, t: 5, medium: 'glass', nd: 1.52, vd: 63.0, sd: 15 },
      { r: -40, t: 45, medium: 'air', sd: 15 },
    ];
    const lens = loadLens(baseDesign(surfaces), dispersive);
    const res = lens.glassResolutions[0];
    expect(res.kind).toBe('model');
    expect(res.baseKey).toBe('TEST:N-BK7');
    expect(lens.raw[0].mediumAfter).toBe(res.resolvedKey);
    const nd = lens.index(res.resolvedKey, 587.5618);
    const vd = (nd - 1) / (lens.index(res.resolvedKey, 486.1327) - lens.index(res.resolvedKey, 656.2725));
    expect(nd).toBeCloseTo(1.52, 12);
    expect(vd).toBeCloseTo(63.0, 9);
  });

  it('uses the named catalog glass when the stated nd/vd match its evaluated values', () => {
    const nd = indexAt(NBK7, 587.5618);
    const vd = (nd - 1) / (indexAt(NBK7, 486.1327) - indexAt(NBK7, 656.2725));
    const surfaces: Surface[] = [
      { r: 40, t: 5, medium: 'glass', nd: +nd.toFixed(5), vd: +vd.toFixed(2), sd: 15 },
      { r: -40, t: 45, medium: 'air', sd: 15 },
    ];
    const lens = loadLens(baseDesign(surfaces), dispersive);
    expect(lens.glassResolutions[0].kind).toBe('catalog');
    expect(lens.raw[0].mediumAfter).toBe('TEST:N-BK7');
  });

  it('fails loudly when nothing in the catalog is close', () => {
    const surfaces: Surface[] = [
      { r: 40, t: 5, medium: 'glass', nd: 2.2, vd: 15, sd: 15 }, // far from both fixture glasses
      { r: -40, t: 45, medium: 'air', sd: 15 },
    ];
    expect(() => loadLens(baseDesign(surfaces), catalog)).toThrow(/too far/);
  });
});

describe('loadLens: edge cases', () => {
  const okSurfaces: Surface[] = [
    { r: 40, t: 5, medium: 'TEST:BK7', nd: 1.5, vd: 64.17, sd: 15 },
    { r: -40, t: 45, medium: 'air', sd: 15 },
  ];

  it('throws on an unknown explicit glass key', () => {
    const surfaces: Surface[] = [
      { r: 40, t: 5, medium: 'NOPE:GLASS', nd: 1.5, vd: 64.17, sd: 15 },
      { r: -40, t: 45, medium: 'air', sd: 15 },
    ];
    expect(() => loadLens(baseDesign(surfaces), catalog)).toThrow(/unknown glass key/);
  });

  it('throws when nd/vd are missing on a non-air surface', () => {
    const surfaces: Surface[] = [
      { r: 40, t: 5, medium: 'TEST:BK7', sd: 15 } as Surface,
      { r: -40, t: 45, medium: 'air', sd: 15 },
    ];
    expect(() => loadLens(baseDesign(surfaces), catalog)).toThrow(/nd\/vd/);
  });

  // A wrong count is a documentation problem: the lens still loads, with a warning (lenses.test.ts fails on it).
  it('warns when the design states the wrong element count', () => {
    const lens = loadLens(baseDesign(okSurfaces, { elements: 5 }), catalog);
    expect(lens.warnings.join(' ')).toMatch(/elements/);
  });

  it('warns when the design states the wrong group count', () => {
    const lens = loadLens(baseDesign(okSurfaces, { groups: 5 }), catalog);
    expect(lens.warnings.join(' ')).toMatch(/groups/);
  });

  it('throws on a non-positive scale', () => {
    expect(() => loadLens(baseDesign(okSurfaces, { scale: 0 }), catalog)).toThrow(/scale/);
  });

  it('throws on an empty surface list', () => {
    expect(() => loadLens(baseDesign([]), catalog)).toThrow();
  });
});

describe('systemAt: infinity focus', () => {
  it('null gives back the same geometry loadLens built, sensor at sensorZ', () => {
    const surfaces: Surface[] = [
      { r: 40, t: 5, medium: 'TEST:BK7', nd: 1.5, vd: 64.17, sd: 15 },
      { r: -40, t: 45, medium: 'air', sd: 15 },
    ];
    const lens = loadLens(baseDesign(surfaces), catalog);
    const sys = systemAt(lens, null);
    expect(sys.surfaces[0].z).toBe(0);
    expect(sys.surfaces[1].z).toBeCloseTo(5, 9);
    expect(sys.surfaces[2]).toMatchObject({ z: 50, kind: 'image' });
    expect(sensorZ(lens)).toBeCloseTo(50, 9);
  });
});

describe('systemAt: unit focus — golden f^2/(s-f) construction', () => {
  // Same construction as paraxial.test.ts's thin-lens conjugate check, routed through loadLens/systemAt this
  // time: back-construct the object's fixed (sensor-relative) position from the textbook extension so the
  // self-consistent Newton solve (object truly fixed in space, lens barrel moves) has a known-exact answer. See
  // docs/engine/e1b.md, "Derivations: unit focus," for why the object position must be built this way rather
  // than simply placing the object at a fixed distance from the lens's infinity position.
  it('extension matches f^2/(s-f) where s is the object distance at the focused position', () => {
    const f = 50;
    const surfaces: Surface[] = [
      { r: 50, t: 0, medium: 'TEST:BK7', nd: 1.5, vd: 64.17, sd: 20 },
      { r: -50, t: 50, medium: 'air', sd: 20 },
    ];
    const lens = loadLens(baseDesign(surfaces), catalog);
    const s = 1000;
    const e0 = (f * f) / (s - f);
    const objectZ = -e0 - s;
    const focusFromSensorMm = sensorZ(lens) - objectZ;
    const sys = systemAt(lens, focusFromSensorMm);
    const solvedE = -sys.surfaces[0].z;
    expect(solvedE).toBeCloseTo(e0, 6);
    // and the object really does land on the sensor at that extension
    const img = imageOf(sys, NM, objectZ);
    expect(img.z).toBeCloseTo(sensorZ(lens), 6);
  });
});

describe('systemAt: minimum focus clamps', () => {
  it('a focus distance closer than minFocusM gives the same system as minFocusM itself', () => {
    const surfaces: Surface[] = [
      { r: 50, t: 0, medium: 'TEST:BK7', nd: 1.5, vd: 64.17, sd: 20 },
      { r: -50, t: 50, medium: 'air', sd: 20 },
    ];
    const lens = loadLens(baseDesign(surfaces, { focus: { method: 'unit', minFocusM: 1, minFocusSource: 'assumed' } }), catalog);
    const atMin = systemAt(lens, 1000);
    const closerThanMin = systemAt(lens, 300); // would need more extension than the design allows
    expect(closerThanMin.surfaces[0].z).toBeCloseTo(atMin.surfaces[0].z, 9);
  });
});

describe('systemAt: variable-gap (non-unit) focus method', () => {
  // Two air-spaced thin elements; the gap between them is the design's declared variable focus gap. At t=0 it
  // should reproduce the infinity-focus geometry exactly; for a finite object, the solved system must image
  // that object back onto the fixed sensor.
  it('t=0 (infinity) reproduces the base gap', () => {
    // Two 60mm-focal-length thin elements 20mm apart: combined efl=36mm, BFD from the rear element=24mm (hand
    // trace, same method as paraxial.test.ts's two-thin-lens golden test: u1=-1/60 at lens1; y at lens2 =
    // 1+20*(-1/60)=0.66667; u2=u1-y2/60=-0.027778; BFD=-y2/u2=24). The last surface's t is set to that BFD so
    // the design is self-consistent (an object truly at infinity, with the base gap, images exactly on the
    // sensor) — otherwise "a very far object" would pull the solved gap away from the base value for a reason
    // that has nothing to do with the gap-interpolation logic under test.
    const surfaces: Surface[] = [
      { r: 60, t: 0, medium: 'TEST:BK7', nd: 1.5, vd: 64.17, sd: 15 },
      { r: -60, t: 20, medium: 'air', sd: 15, label: 'group1' },
      { r: 60, t: 0, medium: 'TEST:BK7', nd: 1.5, vd: 64.17, sd: 15 },
      { r: -60, t: 24, medium: 'air', sd: 15 },
    ];
    const design = baseDesign(surfaces, {
      elements: 2, groups: 2,
      focus: {
        method: 'front-group', minFocusM: 0.5, minFocusSource: 'assumed',
        gaps: [{ surface: 1, atInfinity: 20, atClose: 15, closeObjectDistance: 500 }],
      },
    });
    const lens = loadLens(design, catalog);
    const inf = systemAt(lens, null);
    const atZero = systemAt(lens, 1e7); // very far (not literally infinite) object: solved gap ~ atInfinity
    expect(atZero.surfaces[2].z - atZero.surfaces[1].z).toBeCloseTo(inf.surfaces[2].z - inf.surfaces[1].z, 3);
  });

  it('solved gap images a finite object onto the fixed sensor', () => {
    const surfaces: Surface[] = [
      { r: 60, t: 0, medium: 'TEST:BK7', nd: 1.5, vd: 64.17, sd: 15 },
      { r: -60, t: 20, medium: 'air', sd: 15 },
      { r: 60, t: 0, medium: 'TEST:BK7', nd: 1.5, vd: 64.17, sd: 15 },
      { r: -60, t: 24, medium: 'air', sd: 15 },
    ];
    const design = baseDesign(surfaces, {
      elements: 2, groups: 2,
      focus: {
        method: 'front-group', minFocusM: 0.3, minFocusSource: 'assumed',
        gaps: [{ surface: 1, atInfinity: 20, atClose: 10, closeObjectDistance: 300 }],
      },
    });
    const lens = loadLens(design, catalog);
    const focusFromSensorMm = 2000; // 2 m, well within [minFocus, infinity)
    const sys = systemAt(lens, focusFromSensorMm);
    const objectZ = sensorZ(lens) - focusFromSensorMm;
    const img = imageOf(sys, NM, objectZ);
    expect(img.z).toBeCloseTo(sensorZ(lens), 4);
  });

  // Lead, 09/28/2026: p300/p400/p500 name inner focus but their patents list no variable gaps. They focus by unit
  // extension (schematic) with a load warning, instead of failing to focus at all.
  it('a non-unit method with no declared gaps falls back to unit focus and warns', () => {
    const surfaces: Surface[] = [
      { r: 60, t: 5, medium: 'TEST:BK7', nd: 1.5, vd: 64.17, sd: 15 },
      { r: -60, t: 45, medium: 'air', sd: 15 },
    ];
    const design = baseDesign(surfaces, { focus: { method: 'inner', minFocusM: 0.5, minFocusSource: 'assumed' } });
    const lens = loadLens(design, catalog);
    expect(lens.warnings.join(' ')).toMatch(/unit extension/);
    const sys = systemAt(lens, 1000);
    const obj = sys.surfaces[sys.surfaces.length - 1].z - 1000;
    expect(imageOf(sys, NM, obj).z).toBeCloseTo(lens.sensorZ, 4);
  });
});
