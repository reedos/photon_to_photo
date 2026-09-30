// Tests the adapter's wiring, not the physics (that is src/engine/**'s own job, already tested there): every
// number compute() returns should be traceable to a real engine call, scenario normalization should actually
// clamp, and the three request-shaped exports should return the right shape for a piece to draw.
import { describe, expect, it } from 'vitest';
import { compute, DEFAULT_LENS_ID, distanceForRingAngle, focusRingAngle, focusRingThrow, LENS_IDS, PANE_LENS_IDS, lensFans, lensSummary, normalizeScenario, pointBundle, renderImage } from './engine-api';
import { ev100 } from '../engine/exposure';
import { airyRadius } from '../engine/diffraction';
import d850Json from '../../data/d850.json';
import z8Json from '../../data/z8.json';

describe('LENS_IDS', () => {
  it('lists all 12 primes, ascending by focal length', () => {
    expect(LENS_IDS.length).toBe(12);
    const focalLengths = LENS_IDS.map((id) => lensSummary(id).focalLength);
    expect(focalLengths).toEqual([...focalLengths].sort((a, b) => a - b));
    expect(focalLengths).toEqual([20, 24, 28, 35, 50, 85, 105, 135, 200, 300, 400, 500]);
  });

  it('DEFAULT_LENS_ID is a lineup lens (docs/PANE.md: the one pane opens on the camera, not the free-form primes)', () => {
    expect(PANE_LENS_IDS).toContain(DEFAULT_LENS_ID);
  });
});

describe('normalizeScenario', () => {
  it('fills every field with a default for an empty input', () => {
    const s = normalizeScenario({});
    expect(PANE_LENS_IDS).toContain(s.lens);
    expect(s.fno).toBeGreaterThan(0);
    expect(s.iso).toBeGreaterThanOrEqual(100);
    expect(s.format).toBe('ff');
  });

  it('clamps fno up to the chosen lens design max aperture, never lets it request a faster stop', () => {
    const summary = lensSummary('p50');
    const s = normalizeScenario({ lens: 'p50', fno: 0.5 });
    expect(s.fno).toBeGreaterThanOrEqual(summary.maxFno);
  });

  it('clamps fno down to f/22 at most', () => {
    const s = normalizeScenario({ lens: 'p50', fno: 500 });
    expect(s.fno).toBeLessThanOrEqual(22);
  });

  it('clamps shutter and iso to their documented ranges', () => {
    const s = normalizeScenario({ shutter: 999, iso: 999999 });
    expect(s.shutter).toBeLessThanOrEqual(30);
    expect(s.iso).toBeLessThanOrEqual(51200);
  });

  it('falls back to the default lens for an unknown id, rather than throwing', () => {
    const s = normalizeScenario({ lens: 'not-a-real-lens' });
    expect(PANE_LENS_IDS).toContain(s.lens);
  });

  it('preserves an explicit null focusM (infinity)', () => {
    const s = normalizeScenario({ focusM: null });
    expect(s.focusM).toBeNull();
  });
});

describe('compute', () => {
  it('returns a Model whose scenario is the normalized one', () => {
    const m = compute({ lens: 'p50', fno: 4, shutter: 1 / 250, iso: 400, focusM: 3, format: 'ff' });
    expect(m.scenario.lens).toBe('p50');
    expect(m.scenario.fno).toBe(4);
  });

  it('ev100 matches the engine formula exactly (the adapter must not re-derive it)', () => {
    const m = compute({ lens: 'p50', fno: 5.6, shutter: 1 / 200, iso: 800 });
    expect(m.exposure.ev100).toBeCloseTo(ev100(5.6, 1 / 200, 800), 10);
  });

  it('iris outline and blade count follow the lens design, not a fixed shape', () => {
    const m50 = compute({ lens: 'p50' });
    expect(m50.iris.blades.length).toBe(m50.lens.blades);
    expect(m50.iris.outline.length).toBeGreaterThan(0);
    const m200 = compute({ lens: 'p200' });
    // different real lenses are not guaranteed different blade counts, but the field must at least be wired
    // through faithfully in both directions
    expect(m200.iris.blades.length).toBe(m200.lens.blades);
  });

  it('depth of field brackets the focus distance, and the far limit only exceeds it', () => {
    const m = compute({ lens: 'p50', fno: 8, focusM: 3 });
    expect(m.focus.nearMm).toBeLessThan(m.focus.distanceMm!);
    expect(m.focus.farMm).toBeGreaterThan(m.focus.distanceMm!);
  });

  it('stopping down grows the hyperfocal-adjacent Airy disk radius (diffraction softens as N rises)', () => {
    const wide = compute({ lens: 'p50', fno: 2.8 });
    const narrow = compute({ lens: 'p50', fno: 16 });
    expect(narrow.diffraction.airyRadiusUm).toBeGreaterThan(wide.diffraction.airyRadiusUm);
    // cross-check against the engine's own airyRadius, at the adapter's stated representative wavelength
    expect(wide.diffraction.airyRadiusUm).toBeCloseTo(airyRadius(wide.diffraction.nm, wide.focus.workingFno) * 1000, 6);
  });

  it('the mid-gray photon estimate is invariant across an equivalent exposure (same EV, same ISO), because it ' +
    'is derived by assuming the settings are always a correctly-metered shot -- STUB, see compute()\'s comment',
  () => {
    const base = compute({ lens: 'p50', fno: 4, shutter: 1 / 250, iso: 400 });
    const stoppedDown = compute({ lens: 'p50', fno: 8, shutter: 1 / 62.5, iso: 400 }); // same EV as base
    expect(stoppedDown.exposure.photonsMidGray).toBeCloseTo(base.exposure.photonsMidGray, 6);
    expect(base.exposure.snrMidGray).toBeGreaterThan(0);
  });

  // ISO is analog gain after the well (docs/BRIEF.md): the photons a pixel collects depend on the scene, the
  // aperture and the shutter, never on ISO. (The app shell's stub assumed a metered exposure and got this backward.)
  it('ISO does not change the photons collected; halving the shutter halves them', () => {
    const base = compute({ lens: 'p50', fno: 4, shutter: 1 / 250, iso: 400 });
    const higherIso = compute({ lens: 'p50', fno: 4, shutter: 1 / 250, iso: 3200 });
    const faster = compute({ lens: 'p50', fno: 4, shutter: 1 / 500, iso: 400 });
    expect(higherIso.exposure.photonsMidGray).toBe(base.exposure.photonsMidGray);
    expect(faster.exposure.photonsMidGray / base.exposure.photonsMidGray).toBeCloseTo(0.5, 9);
  });

  it('every lens loads and realizes without throwing, for all three formats', () => {
    for (const lens of LENS_IDS) {
      for (const format of ['ff', 'apsc', 'mft'] as const) {
        const m = compute({ lens, format });
        expect(m.lens.id).toBe(lens);
        expect(m.sensor.pitchUm).toBeGreaterThan(0);
        expect(Number.isFinite(m.focus.hyperfocalMm)).toBe(true);
      }
    }
  });

  it('a focus request closer than the lens can reach is reported as clamped', () => {
    const m = compute({ lens: 'p50', focusM: 0.001 });
    expect(m.focus.clamped).toBe(true);
    expect(m.focus.distanceMm).toBeGreaterThan(1);
  });
});

describe('Finding S1 -- lineup bodies use their own sensors', () => {
  // Independent derivation: docs/PANE.md's own body assignment (DSLR mounts s35/n50/n500/n500fl on Nikon F;
  // mirrorless mounts z35/m50/z800 on Nikon Z) plus data/d850.json and data/z8.json's own published figures,
  // read directly here rather than through data.ts's sensorFor/BODY_SENSORS -- so this test still catches a
  // regression that breaks the wiring on the engine-api side (normalizeScenario) even if data.ts's own values
  // stay correct.
  const D850 = {
    id: 'full-frame-d850',
    name: 'Nikon D850',
    pitchUm: d850Json.sensor.pixelPitchUm.v,
    widthPx: d850Json.sensor.pixelCount.effectiveH.v,
    heightPx: d850Json.sensor.pixelCount.effectiveV.v,
    fullWellE: d850Json.readNoise.fwcElectrons,
    readNoiseE100: d850Json.readNoise.points.find((p) => p.iso === 100)!.readNoiseE,
  };
  const Z8 = {
    id: 'full-frame-z8',
    name: 'Nikon Z8',
    pitchUm: z8Json.sensor.pixelPitchUm.v,
    widthPx: z8Json.sensor.pixelCount.effectiveH.v,
    heightPx: z8Json.sensor.pixelCount.effectiveV.v,
    fullWellE: z8Json.readNoise.fwcElectrons,
    readNoiseE100: z8Json.readNoise.points.find((p) => p.iso === 100)!.readNoiseE,
  };
  const EXPECTED: Record<string, typeof D850> = { s35: D850, n50: D850, n500: D850, n500fl: D850, z35: Z8, m50: Z8, z800: Z8 };

  it.each(PANE_LENS_IDS)('%s resolves to its real body sensor, not the a7R IV stand-in', (lens) => {
    const expected = EXPECTED[lens];
    const m = compute({ lens, iso: 100 });
    expect(m.sensor.id).toBe(expected.id);
    expect(m.sensor.name).toBe(expected.name);
    expect(m.sensor.pitchUm).toBeCloseTo(expected.pitchUm, 6);
    expect(m.sensor.widthPx).toBe(expected.widthPx);
    expect(m.sensor.heightPx).toBe(expected.heightPx);
    expect(m.sensor.fullWellE).toBeCloseTo(expected.fullWellE, 6);
    expect(m.sensor.readNoiseE).toBeCloseTo(expected.readNoiseE100, 6);
  });

  it('an explicitly supplied scenario.sensor overrides the body default', () => {
    const s = normalizeScenario({ lens: 'n50', sensor: 'full-frame-z8' });
    expect(s.sensor).toBe('full-frame-z8');
    expect(compute({ lens: 'n50', sensor: 'full-frame-z8' }).sensor.id).toBe('full-frame-z8');
  });

  it('the free-form primes keep their existing full-frame default (unaffected by this fix)', () => {
    expect(compute({ lens: 'p50' }).sensor.id).toBe('full-frame-a7r4-imx455');
  });
});

describe('lensFans', () => {
  it('returns one FanSet per requested field, each with rays * wavelengths paths', () => {
    const m = compute({ lens: 'p50' });
    const sets = lensFans(m, { fields: [0, 0.7, 1], nms: [486.13, 587.56, 656.27], rays: 9 });
    expect(sets.length).toBe(3);
    for (const s of sets) expect(s.paths.length).toBe(9 * 3);
    expect(sets[2].fieldDeg).toBeCloseTo(m.realized.realization.halfFieldDeg, 6);
  });
});

describe('pointBundle', () => {
  it('returns a landing centroid inside a finite radius, and a non-negative predicted blur', () => {
    const m = compute({ lens: 'p50', fno: 2.8, focusM: 3 });
    const b = pointBundle(m, { pointDistMm: 6000, fieldFrac: 0, rays: 64, nms: [546.07] });
    expect(b.paths.length).toBe(64);
    expect(b.diameterMm).toBeGreaterThanOrEqual(0);
    expect(b.predictedBlurMm).toBeGreaterThanOrEqual(0);
    expect(b.pitchMm).toBeCloseTo(m.sensor.pitchUm / 1000, 9);
  });

  it('a defocused point (far behind focus) produces a larger disk than an in-focus one', () => {
    const m = compute({ lens: 'p50', fno: 2.8, focusM: 3 });
    const inFocus = pointBundle(m, { pointDistMm: 3000, fieldFrac: 0, rays: 64, nms: [546.07] });
    const defocused = pointBundle(m, { pointDistMm: 30000, fieldFrac: 0, rays: 64, nms: [546.07] });
    expect(defocused.diameterMm).toBeGreaterThan(inFocus.diameterMm);
  });
});

describe('renderImage', () => {
  it('returns buffers of the requested size from the real renderer', () => {
    const m = compute({ lens: 'p50' });
    const img = renderImage(m, { width: 16, height: 12, seed: 1 });
    expect(img.rgba.length).toBe(16 * 12 * 4);
    expect(img.raw.length).toBe(16 * 12);
    expect(img.meta.notes.join(' ')).not.toMatch(/STUB/);
    // pixel() describes one REAL sensor pixel inside rendered pixel (4, 4)'s block, in sensor coordinates
    const p = img.pixel(4, 4);
    expect(p.x).toBeGreaterThanOrEqual(4 * img.pixelScale);
    expect(p.x).toBeLessThan(5 * img.pixelScale);
    expect(p.fullWell).toBe(m.sensor.fullWellE);
  });
});

describe('focus ring on the model', () => {
  // Dragging the ring sets the distance whose angle the ring is at: the inverse must land back on the same distance,
  // or the scale under the index and the focus the engine uses would disagree.
  it.each(PANE_LENS_IDS)('%s: distance -> ring angle -> distance round-trips within 1 %', (lens) => {
    const closest = compute({ lens, focusM: null }).realized.realization.closestFocusMm;
    for (const d of [closest, closest * 1.5, 3000, 10000].filter((x) => x >= closest)) {
      const m = compute({ lens, focusM: d / 1000 });
      const back = distanceForRingAngle(m, focusRingAngle(m));
      expect(back).not.toBeNull();
      expect(Math.abs(back! - m.focus.distanceMm!) / m.focus.distanceMm!).toBeLessThan(0.01);
    }
    const inf = compute({ lens, focusM: null });
    expect(focusRingAngle(inf)).toBe(0);
    expect(focusRingThrow(inf)).toBeGreaterThan(0);
  });
});
