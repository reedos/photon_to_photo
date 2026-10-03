import { describe, expect, it } from 'vitest';
import { compute, PANE_LENS_IDS, renderImage } from './engine-api';
import { apertureSteps } from './stops';
import { sensorFor } from '../engine/data';
import { renderSetup } from '../engine/render';

describe('audit: distinct scenarios retain their physics', () => {
  it.each(['ff', 'apsc', 'mft'] as const)('%s: preview samples stay inside the active sensor', format => {
    const model = compute({ lens: 'n50', format });
    const setup = renderSetup(model, 600, 400);
    expect(setup.blockPitchMm * 600).toBeLessThanOrEqual(model.sensor.widthPx * model.sensor.pitchUm / 1000 + 1e-9);
    expect(setup.blockPitchMm * 400).toBeLessThanOrEqual(model.sensor.heightPx * model.sensor.pitchUm / 1000 + 1e-9);
    // Equal physical spacing preserves geometry. One sensor dimension is fully used; the other is centered.
    expect(Math.min(setup.offsetX, setup.offsetY)).toBeCloseTo(0, 8);
    const rendered = renderImage(model, { width: 600, height: 400, seed: 1 });
    for (const [x, y] of [[0, 0], [599, 0], [0, 399], [599, 399]]) {
      const pixel = rendered.pixel(x, y);
      expect(pixel.x).toBeGreaterThanOrEqual(0); expect(pixel.x).toBeLessThan(model.sensor.widthPx);
      expect(pixel.y).toBeGreaterThanOrEqual(0); expect(pixel.y).toBeLessThan(model.sensor.heightPx);
    }
  });
  it('bounds shared illumination overrides to the supported daylight model', () => {
    expect(compute({ cct: 3500 }).scenario.cct).toBe(4000);
    expect(compute({ cct: 30000 }).scenario.cct).toBe(25000);
    expect(compute({ lux: -5, cct: NaN }).exposure.photonsMidGray).toBeGreaterThan(0);
    expect(compute({ lux: 0 }).exposure.photonsMidGray).toBe(0);
  });
  it('changing only subject distance moves the rendered scene and motion calculation', () => {
    const a = compute({ lens: 'n50', subjectM: 3, focusM: 3, motion: { speedMps: 1 } });
    const b = compute({ ...a.scenario, subjectM: 9 });
    expect(b).not.toBe(a);
    expect(b.scenario.subjectM).toBe(9);
    const pixels = (m: typeof a) => renderImage(m, { width: 48, height: 32, seed: 1 }).rgba;
    expect(pixels(b)).not.toEqual(pixels(a));
    expect(compute({ ...a.scenario, subjectM: 3 })).toBe(a);
  });

  it.each(['full-frame-d850', 'full-frame-z8'])('%s: format cache isolates metadata and crops sensor geometry', sensor => {
    const full = sensorFor('ff', 160, sensor), crop = sensorFor('mft', 160, sensor), apsc = sensorFor('apsc', 160, sensor);
    expect(full.info.format.id).toBe('ff'); expect(crop.info.format.id).toBe('mft'); expect(apsc.info.format.id).toBe('apsc');
    expect(crop.spec.pitchUm).toBe(full.spec.pitchUm);
    expect(crop.info.fullWellE).toBe(full.info.fullWellE);
    expect(crop.info.readNoiseE).toBe(full.info.readNoiseE);
    expect(crop.info.widthPx * crop.info.pitchUm / 1000).toBeCloseTo(17.3, 1);
    expect(crop.info.heightPx * crop.info.pitchUm / 1000).toBeCloseTo(13, 1);
    expect(apsc.info.widthPx * apsc.info.pitchUm / 1000).toBeCloseTo(23.5, 1);
    expect(full.info.widthPx).toBeGreaterThan(apsc.info.widthPx);
    // Check the reverse request order at another ISO too.
    sensorFor('mft', 200, sensor);
    expect(sensorFor('ff', 200, sensor).info.format.id).toBe('ff');
  });

  it.each(PANE_LENS_IDS)('%s: the dial can return to the actual widest aperture', lens => {
    const model = compute({ lens, fno: 1 });
    const steps = apertureSteps(model.lens.maxFno);
    expect(steps[0]).toBe(model.lens.maxFno);
    expect(steps.at(-1)).toBe(22);
    expect(steps.every((n, i) => i === 0 || n > steps[i - 1])).toBe(true);
    const returned = compute({ ...model.scenario, fno: steps[0] });
    expect(returned.exposure.photonsMidGray).toBe(model.exposure.photonsMidGray);
  });
});
