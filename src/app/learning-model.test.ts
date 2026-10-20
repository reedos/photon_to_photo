import { describe, it, expect } from 'vitest';
import { pipelinePixels, rowWindow, movingEdgeFraction, TOUR, tourStop } from './learning-model';
import { compute, normalizeScenario } from './engine-api';
import { createPipelineTestSample } from './pipeline-test-sample';
import { learningInsights } from './learning-insights';

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
    expect(d850.readoutS).toBe(.064); expect(z8.readoutS).toBe(.0037);
    expect(d850.figs.readoutS.loc).toContain('directly'); expect(z8.figs.readoutS.loc).toContain('secondary');
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
    expect(stop.text).toMatch(/separate from the real photographs/i);
  });
  it('tells the story in the order the light meets each part, with a shutter stop beside the aperture', () => {
    expect(TOUR.map(s => s.id)).toEqual(['scene', 'lens', 'aperture', 'focus', 'viewfinder', 'shutter', 'pixel', 'readout', 'pipeline', 'photo']);
    expect(TOUR.find(s => s.id === 'shutter')!.part).toBe('shutter');
  });
  it('keeps every band line short enough for two phone lines, and gives More its own words', () => {
    for (const stop of TOUR) {
      expect(stop.text.length, stop.id).toBeLessThanOrEqual(120);
      expect(stop.more.length, stop.id).toBeGreaterThan(stop.text.length);
      expect(stop.more).not.toContain(stop.text);
    }
    // the misconception the pixel stop corrects must be in the band itself, not only behind More
    expect(TOUR.find(s => s.id === 'pixel')!.text).toMatch(/ISO adds no photons/);
  });
  // score loop r2 (10/11/2026)
  it('names a Phase Fresnel surface only for a lens that has one', () => {
    expect(learningInsights(compute({ lens: 'n50' })).lens.live).not.toMatch(/Fresnel/);
    expect(learningInsights(compute({ lens: 'n500' })).lens.live).toMatch(/This lens’s Phase Fresnel element/);
  });
  it('names the pixel channel, the filter-and-QE loss and both SNR figures in the pixel reading', () => {
    const m = compute({ lens: 'n50' });
    const live = learningInsights(m).pixel.live;
    expect(live).toMatch(/^Green pixel, 18% gray/);
    expect(live).toContain(Math.round(m.exposure.photonsMidGray).toLocaleString('en-US'));
    expect(live).toContain(Math.round(m.exposure.electronsMidGray).toLocaleString('en-US'));
    expect(live).toContain(`signal-to-noise ratio of ${Math.sqrt(m.exposure.electronsMidGray).toLocaleString('en-US', { maximumFractionDigits: 1 })}`);
    expect(live).toMatch(/PRNU/);
    expect(learningInsights(m).pixel.equation).toMatch(/Tλ/);
    expect(learningInsights(m).photo.live).not.toMatch(/no moving subject/);
  });
});

describe('tourStop (score loop r2)', () => {
  it('reads the stop an address names, 1-based in the URL and 0-based here', () => {
    expect(tourStop('')).toBeNull();
    expect(tourStop('?tour=1')).toBe(0);
    expect(tourStop('?tour=4')).toBe(3);
    expect(tourStop(`?tour=${TOUR.length + 5}`)).toBe(TOUR.length - 1);
    expect(tourStop('?tour=junk')).toBe(0);
    expect(tourStop('?tour=0')).toBe(0);
  });
});
