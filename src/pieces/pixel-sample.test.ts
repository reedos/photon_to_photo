import { describe, expect, it } from 'vitest';
import { compute } from '../engine/camera';
import { sampleNeutralPixel } from './pixel-sample';

describe('independent neutral pixel sample', () => {
  const model = compute({ lens: 'n50', fno: 4, shutter: 1 / 250, iso: 100, focusM: 3, format: 'ff', scene: 'bench', shutterType: 'mechanical' });

  it('samples the real sensor pipeline without a rendered frame', () => {
    const pixel = sampleNeutralPixel(model, 17);
    expect(pixel.x).toBe(Math.floor(model.sensor.widthPx / 2));
    expect(pixel.y).toBe(Math.floor(model.sensor.heightPx / 2));
    expect(pixel.photonsByBin).toHaveLength(16);
    expect(pixel.photonsMean).toBeCloseTo(model.exposure.photonsMidGray, 8);
    expect(pixel.electrons).toBeGreaterThanOrEqual(0);
    expect(pixel.electrons).toBeLessThanOrEqual(pixel.fullWell);
    expect(pixel.sample.reflectance).toBe(0.18);
    expect(pixel.sample.lux).toBe(model.exposure.sceneLux);
    expect(pixel.sample.cctK).toBe(5500);
    expect(pixel.depthMm).toBe(model.focus.distanceMm);
  });

  it('is reproducible for the same live camera settings and seed', () => {
    expect(sampleNeutralPixel(model, 93)).toEqual(sampleNeutralPixel(model, 93));
  });

  it('responds to shutter and ISO changes', () => {
    const brighter = compute({ ...model.scenario, shutter: model.scenario.shutter * 2 });
    const higherIso = compute({ ...model.scenario, iso: model.scenario.iso * 2 });
    expect(sampleNeutralPixel(brighter).photonsMean).toBeCloseTo(model.exposure.photonsMidGray * 2, 8);
    expect(sampleNeutralPixel(higherIso).readNoise).not.toBe(sampleNeutralPixel(model).readNoise);
  });
});
