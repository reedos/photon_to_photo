import { describe, expect, it } from 'vitest';
import { compute } from './engine-api';
import { dimReference, rainExperiment, rainSnapshot, poissonPmf, RAIN_PIXELS } from './photon-rain-model';

describe('controlled photon arrival experiment', () => {
  const source = compute({ lens: 'n50', fno: 4, shutter: 1 / 250, lux: 10000 });
  const dim = dimReference(source);
  it('retains capture geometry and explicitly changes only the reference light and motion', () => {
    expect(dim.scenario.fno).toBe(source.scenario.fno);
    expect(dim.scenario.shutter).toBe(source.scenario.shutter);
    expect(dim.scenario.sensor).toBe(source.scenario.sensor);
    expect(dim.exposure.photonsMidGray).toBeCloseTo(6, 8);
    expect(source.scenario.lux).toBe(10000);
  });
  it('responds to real exposure arithmetic, without changing photons when ISO changes', () => {
    const photonMean = (patch: object) => compute({ ...dim.scenario, ...patch }).exposure.photonsMidGray;
    expect(photonMean({ shutter: dim.scenario.shutter / 2 })).toBeCloseTo(3, 8);
    expect(photonMean({ lux: dim.scenario.lux! * 16 })).toBeCloseTo(96, 8);
    expect(photonMean({ fno: 8 })).toBeCloseTo(1.5, 6);
    expect(photonMean({ iso: 1600 })).toBeCloseTo(6, 8);
  });
  it('replays exact arrivals deterministically and never shows future photons as collected', () => {
    const a = rainExperiment(dim), b = rainExperiment(dim);
    expect(a).toEqual(b);
    expect(rainSnapshot(a, 0).counts).toEqual(Array(RAIN_PIXELS).fill(0));
    const half = rainSnapshot(a, .5), full = rainSnapshot(a, 1);
    half.counts.forEach((value, i) => expect(value).toBeLessThanOrEqual(full.counts[i]));
    expect(full.counts).toEqual(a.samples.map(times => times.length));
    expect(full.histogram.reduce((sum, value) => sum + value, 0)).toBe(RAIN_PIXELS);
  });
  it('has the predicted Poisson mean/variance over seeded independent pixels', () => {
    const counts = Array.from({ length: 20 }, (_, seed) => rainSnapshot(rainExperiment(dim, seed), 1).counts).flat();
    const mean = counts.reduce((sum, value) => sum + value, 0) / counts.length;
    const variance = counts.reduce((sum, value) => sum + (value - mean) ** 2, 0) / counts.length;
    expect(mean).toBeCloseTo(6, 0); expect(variance).toBeCloseTo(6, 0);
  });
  it.each([0, 6, 96, 800])('normalizes the expected distribution at mean %s', mean => {
    const pmf = poissonPmf(mean, Math.ceil(mean + 10 * Math.sqrt(mean) + 10));
    expect(pmf.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 7);
    expect(pmf.reduce((sum, value, count) => sum + value * count, 0)).toBeCloseTo(mean, 6);
  });
});
