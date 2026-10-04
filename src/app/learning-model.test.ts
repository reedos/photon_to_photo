import { describe, it, expect } from 'vitest';
import { pipelinePixels, rowWindow, movingEdgeFraction, TOUR } from './learning-model';
import { compute, normalizeScenario } from './engine-api';
import { createPipelineTestSample } from './pipeline-test-sample';

describe('sensor-to-photo lessons', () => {
  it('integrates the moving-edge chart over each row window, keeping skew separate from exposure blur', () => {
    expect(movingEdgeFraction(.38, .03, .02, .1)).toBeCloseTo(.5, 10);
    expect(movingEdgeFraction(.38, .03, .02, .035)).toBeCloseTo(.25, 10);
    expect(movingEdgeFraction(.38, .03, .02, .02)).toBe(0);
    expect(movingEdgeFraction(.38, 0, .001, 1)).toBe(1);
    expect(movingEdgeFraction(.38, .064, .001, 1)).toBe(0);
  });
  it('keeps exposure length independent of full-frame scan time, including long exposures', () => {
    for (const exposure of [1 / 8000, 1 / 30, 2]) {
      const first = rowWindow(0, 12, .064, exposure), last = rowWindow(11, 12, .064, exposure);
      expect(first.start).toBe(0); expect(last.start).toBeCloseTo(.064, 9);
      expect(last.end - last.start).toBeCloseTo(exposure, 9); expect(first.end).toBe(exposure);
    }
    expect(rowWindow(0, 1, .064, .01)).toEqual({ start: 0, end: .01 });
  });
  it('uses each body’s recorded scan time and retains its uncertainty', () => {
    const d850 = compute({ lens: 'n50' }).sensor, z8 = compute({ lens: 'm50' }).sensor;
    expect(d850.readoutS).toBe(.064); expect(z8.readoutS).toBe(.0036);
    expect(d850.figs.readoutS.loc).toContain('directly'); expect(z8.figs.readoutS.loc).toContain('low');
  });
  it('processes an explicit controlled test chart without depending on a photo render', () => {
    const scenario = normalizeScenario({ lens: 'n50' });
    const sample = createPipelineTestSample(scenario.format, scenario.iso, scenario.sensor);
    expect(sample.width).toBe(96); expect(sample.height).toBe(64);
    expect(pipelinePixels(sample, 'tone')).toEqual(sample.rgba);
    const raw = pipelinePixels(sample, 'raw');
    expect(raw).toHaveLength(sample.width * sample.height * 4);
    expect(raw[3]).toBe(255);
    expect(raw[0]).toBeGreaterThan(0); // RGGB top-left is the red-filtered site.
    expect(raw[4 + 1]).toBeGreaterThanOrEqual(0); // Green-filtered top-right site.
    expect(pipelinePixels(sample, 'wb')[3]).toBe(255);
    const neutral = sample.stages.wb, i = (8 * sample.width + 8) * 3;
    expect(neutral[i]).toBeCloseTo(.78, 2);
    expect(neutral[i + 1]).toBeCloseTo(.78, 2);
    expect(neutral[i + 2]).toBeCloseTo(.78, 2);
  });
  it('labels the pipeline tour as an illustrative sample separate from the user photograph', () => {
    const stop = TOUR.find(s => s.lesson === 'pipeline')!;
    expect(stop.text).toMatch(/illustrative test sample/i);
    expect(stop.text).toMatch(/separate from your photograph/i);
  });
});
