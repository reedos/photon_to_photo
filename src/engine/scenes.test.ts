import { describe, it, expect } from 'vitest';
import { getScene, sceneFor, sceneIds, sceneDefaultLux, sceneDefaultCctK, sceneSubjectDistanceMm, daylightAt, colorCheckerBillboard, siemensStarBillboard, pointHighlight, BENCH_LUX, DUSK_LUX, FIELD_LUX, FIELD_SUBJECT_DISTANCE_MM } from './scenes';
import { radiance } from './scene';
import { BINS, CMF, V_LAMBDA } from './data';
import { compute } from './camera';
import { renderSetup, renderImage, projectToRenderedPixel } from './render';
import { exitPupilBlurDiameterMm } from './camera';
import type { Scenario } from './types';

describe('scene ids', () => {
  it('lists bench, dusk and field', () => {
    expect(sceneIds().sort()).toEqual(['bench', 'dusk', 'field']);
  });

  it('default lux matches each scene', () => {
    expect(sceneDefaultLux('bench')).toBe(BENCH_LUX);
    expect(sceneDefaultLux('dusk')).toBe(DUSK_LUX);
    expect(sceneDefaultLux('field')).toBe(FIELD_LUX);
  });

  it('an unknown scene id throws', () => {
    expect(() => getScene('nope')).toThrow();
    expect(() => sceneDefaultLux('nope')).toThrow();
    expect(() => sceneSubjectDistanceMm('nope')).toThrow();
  });

  it('every named scene shares the same illuminant CCT', () => {
    expect(sceneDefaultCctK('bench')).toBe(sceneDefaultCctK('dusk'));
    expect(sceneDefaultCctK('bench')).toBe(sceneDefaultCctK('field'));
  });

  it('each scene names its own subject distance (SHARED CONTRACT)', () => {
    expect(sceneSubjectDistanceMm('bench')).toBe(3000);
    expect(sceneSubjectDistanceMm('dusk')).toBe(3000);
    expect(sceneSubjectDistanceMm('field')).toBe(FIELD_SUBJECT_DISTANCE_MM);
  });
});

describe('field scene geometry', () => {
  const field = getScene('field');

  it('has a subject, a branch, a background and a foreground', () => {
    expect(field.billboards.map((b) => b.id).sort()).toEqual(['field-background', 'field-branch', 'field-foreground', 'field-subject'].sort());
  });

  it('is lit at 20,000 lux daylight', () => {
    expect(field.illuminant.lux).toBe(FIELD_LUX);
  });

  it('carries background sun-glint highlights for bokeh disks', () => {
    expect((field.pointHighlights?.length ?? 0)).toBeGreaterThan(0);
  });

  it('names its bird subject as the moving billboard (SHARED CONTRACT)', () => {
    expect(field.movingBillboardIds).toEqual(['field-subject']);
  });

  it('the subject sits at 30 m, the background well beyond it, the foreground well in front of it', () => {
    const subject = field.billboards.find((b) => b.id === 'field-subject')!;
    const background = field.billboards.find((b) => b.id === 'field-background')!;
    const foreground = field.billboards.find((b) => b.id === 'field-foreground')!;
    expect(subject.center[2]).toBe(FIELD_SUBJECT_DISTANCE_MM);
    expect(background.center[2]).toBeGreaterThan(subject.center[2] * 2);
    expect(foreground.center[2]).toBeLessThan(subject.center[2] / 2);
  });

  it('a ray straight down the optical axis hits the subject, sharp, with a plausible plumage reflectance', () => {
    const hit = radiance(field, [0, 0, 0], [0, 0, 1], BINS, V_LAMBDA);
    expect(hit.hitId).toBe('field-subject');
    expect(hit.depthMm).toBeCloseTo(FIELD_SUBJECT_DISTANCE_MM, -1);
  });
});

describe('field scene: its sun-glint highlights actually land inside the rendered frame (regression: ' +
  'round-1 shipped glints that projected entirely outside [0,600)x[0,400) for both real lenses that ' +
  'default into this scene, so the bokeh disks the scene doc comment promises never rendered)', () => {
  function fieldScenario(lens: string): Scenario {
    return {
      lens,
      fno: 5.6,
      shutter: 1 / 1000,
      iso: 400,
      focusM: 30,
      format: 'ff',
      shutterType: 'mechanical',
      scene: 'field',
    };
  }

  it('every glint in the field scene projects inside a 600x400 render, for both n500 (500mm) and ' +
    'z800 (800mm) -- the >=200mm rule\'s only two lineup members that default into \'field\'', () => {
    const field = getScene('field');
    const glints = field.pointHighlights ?? [];
    expect(glints.length).toBeGreaterThan(0);

    for (const lens of ['n500', 'z800']) {
      const model = compute(fieldScenario(lens));
      const setup = renderSetup(model, 600);
      for (const glint of glints) {
        const [x, y, z] = glint.position;
        const { bx, by } = projectToRenderedPixel(setup.efl, setup.blockPitchMm, 600, 400, x, y, z);
        expect(bx, `${lens} ${glint.id} bx`).toBeGreaterThanOrEqual(0);
        expect(bx, `${lens} ${glint.id} bx`).toBeLessThan(600);
        expect(by, `${lens} ${glint.id} by`).toBeGreaterThanOrEqual(0);
        expect(by, `${lens} ${glint.id} by`).toBeLessThan(400);
      }
    }
  });

  it('a glint actually reads as a bright disc, not just a landed but invisible point: its rendered pixel ' +
     'is measurably brighter than an unrelated background pixel at the same rendered image, for both n500 ' +
     'and z800 (a landed-in-frame highlight that never beats the background it sits on would be just as ' +
     'invisible as one that missed the frame entirely)', () => {
    const field = getScene('field');
    const glints = field.pointHighlights ?? [];
    const bgPixel: [number, number] = [500, 50]; // plain dappled background, away from every glint and the subject

    for (const lens of ['n500', 'z800']) {
      const model = compute(fieldScenario(lens));
      const setup = renderSetup(model, 600);
      const res = renderImage(model, { width: 600, height: 400, seed: 1 });
      const bgIdx = bgPixel[1] * 600 + bgPixel[0];
      const bgLuma = res.rgba[bgIdx * 4] + res.rgba[bgIdx * 4 + 1] + res.rgba[bgIdx * 4 + 2];

      for (const glint of glints) {
        const [x, y, z] = glint.position;
        const { bx, by } = projectToRenderedPixel(setup.efl, setup.blockPitchMm, 600, 400, x, y, z);
        const gx = Math.round(bx), gy = Math.round(by);
        const gIdx = gy * 600 + gx;
        const glintLuma = res.rgba[gIdx * 4] + res.rgba[gIdx * 4 + 1] + res.rgba[gIdx * 4 + 2];
        expect(glintLuma, `${lens} ${glint.id} luma vs background`).toBeGreaterThan(bgLuma * 1.2);
      }
    }
  }, 120_000); // two full 600x400 renders: a few seconds here, 34 s on a GitHub runner (09/30/2026)
});

describe('bench scene names its moving billboard (SHARED CONTRACT)', () => {
  it('is the Siemens star', () => {
    expect(getScene('bench').movingBillboardIds).toEqual(['siemens-star']);
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

describe('field scene silhouettes (billboard coverage)', () => {
  // A billboard with a coverage mask is only there inside its silhouette: a ray through the bird's bounding rectangle
  // but outside its outline must reach what lies behind it, and a ray through the body must hit the bird.
  const s = getScene('field');
  const bird = s.billboards.find((b) => b.id === 'field-subject')!;
  const hitAt = (x: number, y: number) => {
    // from the origin toward a point on the bird's plane, offset from its center by (x, y) mm
    const target: [number, number, number] = [bird.center[0] + x, bird.center[1] + y, bird.center[2]];
    const n = Math.hypot(...target);
    return radiance(s, [0, 0, 0], [target[0] / n, target[1] / n, target[2] / n], BINS, () => 1).hitId;
  };
  it('a ray through the body hits the bird', () => {
    expect(hitAt(-4, -8)).toBe('field-subject');
  });
  it('a ray through the rectangle corner, outside the outline, passes behind it', () => {
    expect(hitAt(80, -115)).not.toBe('field-subject');
    expect(hitAt(-85, 110)).not.toBe('field-subject');
  });
});

describe('the field subject has synthetic spectral detail', () => {
  const field = getScene('field');
  const bird = field.billboards.find((b) => b.id === 'field-subject')!;
  const branch = field.billboards.find((b) => b.id === 'field-branch')!;
  const plumage = (x: number, y: number, nm = 550) => bird.reflectanceAt(x / bird.widthMm, y / bird.heightMm)(nm);

  it('keeps the dark eye readable against a pale cheek and the breast warmer than blue', () => {
    expect(plumage(29, 82)).toBeLessThan(plumage(30, 68) / 3);
    expect(plumage(25, -20, 650)).toBeGreaterThan(plumage(25, -20, 450));
  });

  it('has feather and bark contrast within a material, rather than uniform filled regions', () => {
    const wing = [-32, -27, -22, -17, -12].map((x) => plumage(x, 8));
    const bark = [-0.20, -0.15, -0.10, -0.05, 0, 0.05].map((u) => branch.reflectanceAt(u, 0.05)(550));
    expect(Math.max(...wing) - Math.min(...wing)).toBeGreaterThan(0.01);
    expect(Math.max(...bark) - Math.min(...bark)).toBeGreaterThan(0.01);
  });

  it('places gripping feet between the body and perch without filling the surrounding empty rectangle', () => {
    expect(bird.coverage!(7 / 180, -117 / 250)).toBe(true);
    expect(bird.coverage!(42 / 180, -117 / 250)).toBe(false);
  });

  it('is deterministic and conserves reflectance bounds across the visible spectrum', () => {
    const again = getScene('field');
    for (const material of [bird, branch]) {
      const duplicate = again.billboards.find((b) => b.id === material.id)!;
      for (let j = 0; j <= 20; j++) for (let i = 0; i <= 20; i++) {
        const u = i / 20 - 0.5, v = j / 20 - 0.5;
        if (!material.coverage!(u, v)) continue;
        for (const nm of [400, 450, 500, 550, 600, 650, 700]) {
          const r = material.reflectanceAt(u, v)(nm);
          expect(r).toBeGreaterThanOrEqual(0);
          expect(r).toBeLessThanOrEqual(1);
          expect(duplicate.reflectanceAt(u, v)(nm)).toBe(r);
        }
      }
    }
  });
});

describe('a scenario-set subject distance (sceneFor, the real-photo comparison)', () => {
  // Geometry only: every getScene call builds fresh reflectance closures, so two scenes never deep-equal whole.
  const geom = (sc: ReturnType<typeof getScene>) => ({
    billboards: sc.billboards.map((b) => ({ id: b.id, center: b.center, w: b.widthMm, h: b.heightMm })),
    highlights: (sc.pointHighlights ?? []).map((h) => ({ id: h.id, position: h.position, r: h.radiusMm })),
  });
  it('moves the near group out to the subject distance, scaled so its framing is unchanged; the far background stays', () => {
    const base = getScene('field');
    const moved = sceneFor('field', 8.9);
    const k = 8900 / FIELD_SUBJECT_DISTANCE_MM;
    for (const id of ['field-subject', 'field-branch', 'field-foreground']) {
      const a = base.billboards.find((b) => b.id === id)!, b = moved.billboards.find((x) => x.id === id)!;
      expect(b.center[2]).toBeCloseTo(a.center[2] * k, 6);
      expect(b.widthMm / b.center[2]).toBeCloseTo(a.widthMm / a.center[2], 9);  // same angular size
      expect(b.center[1] / b.center[2]).toBeCloseTo(a.center[1] / a.center[2], 9); // same place in the frame
    }
    expect(geom(moved).billboards.find((b) => b.id === 'field-background')).toEqual(geom(base).billboards.find((b) => b.id === 'field-background'));
    expect(geom(moved).highlights).toEqual(geom(base).highlights);
    expect(sceneSubjectDistanceMm('field', 8.9)).toBeCloseTo(8900, 6);
    expect(sceneFor('bench', 6.3).billboards.find((b) => b.id === 'siemens-star')!.center[2]).toBeCloseTo(6300, 6);
  });

  it('absent or nonsense leaves the scene as built, and a huge distance stays in front of the background', () => {
    expect(geom(sceneFor('field'))).toEqual(geom(getScene('field')));
    expect(geom(sceneFor('field', -3))).toEqual(geom(getScene('field')));
    const far = sceneFor('field', 10_000);
    const subjectZ = far.billboards.find((b) => b.id === 'field-subject')!.center[2];
    expect(subjectZ).toBeLessThan(far.billboards.find((b) => b.id === 'field-background')!.center[2]);
  });

  it('the subject renders sharp where the photo was focused: the flycatcher example (500 mm, f/5.6, 8.9 m)', () => {
    const scen = { lens: 'n500', fno: 5.6, shutter: 1 / 4000, iso: 1400, focusM: 8.9, format: 'ff', shutterType: 'mechanical', scene: 'field', subjectM: 8.9 } as Scenario;
    const model = compute(scen);
    const subjectZ = sceneFor('field', 8.9).billboards.find((b) => b.id === 'field-subject')!.center[2];
    expect(exitPupilBlurDiameterMm(model, subjectZ)).toBeLessThan(0.03); // inside the full-frame sharpness limit
  });

  it('a far glint past the kernel cap renders as a round disk of its true size, not a capped square ' +
     '(regression 09/30/2026: the 500 mm at 8.9 m stamped hard squares)', () => {
    const scen = { lens: 'n500', fno: 5.6, shutter: 1 / 4000, iso: 1400, focusM: 8.9, format: 'ff', shutterType: 'mechanical', scene: 'field', subjectM: 8.9 } as Scenario;
    const model = compute(scen);
    const setup = renderSetup(model, 600);
    const res = renderImage(model, { width: 600, height: 400, seed: 1 });
    const glint = getScene('field').pointHighlights![0];
    const { bx, by } = projectToRenderedPixel(setup.efl, setup.blockPitchMm, 600, 400, ...glint.position);
    const r = exitPupilBlurDiameterMm(model, glint.position[2]) / setup.blockPitchMm / 2;
    expect(r).toBeGreaterThan(30); // well past the 18 px cap, or this test proves nothing
    const luma = (x: number, y: number) => { const i = (Math.round(y) * 600 + Math.round(x)) * 4; return res.rgba[i] + res.rgba[i + 1] + res.rgba[i + 2]; };
    const bg = luma(10, 10);
    const inRim = [[0.8, 0], [-0.8, 0], [0, 0.8], [0, -0.8]].map(([dx, dy]) => luma(bx + dx * r, by + dy * r));
    const outCorner = [[0.8, 0.8], [-0.8, 0.8], [0.8, -0.8], [-0.8, -0.8]].map(([dx, dy]) => luma(bx + dx * r, by + dy * r));
    for (const v of inRim) expect(v, 'inside the disk, 0.8 r from center').toBeGreaterThan(bg + 150);
    for (const v of outCorner) expect(v, 'a square corner, outside a round disk').toBeLessThan(bg + 150);
  }, 120_000);
});
