import { describe, it, expect } from 'vitest';
import { pipelinePixels, rowWindow, sameShot, EXPERIMENTS } from './learning-model';
import { compute, normalizeScenario } from './engine-api';
import { renderImage } from '../engine/render';
import { sensorFor } from '../engine/data';
import type { RenderView } from './render-client';

describe('sensor-to-photo lessons', () => {
  it('keeps exposure length independent of full-frame scan time, including long exposures', () => {
    for (const exposure of [1 / 8000, 1 / 30, 2]) {
      const first = rowWindow(0, 12, .064, exposure), last = rowWindow(11, 12, .064, exposure);
      expect(first.start).toBe(0); expect(last.start).toBeCloseTo(.064, 9);
      expect(last.end - last.start).toBeCloseTo(exposure, 9);
      expect(first.end).toBe(exposure);
    }
    expect(rowWindow(0, 1, .064, .01)).toEqual({ start: 0, end: .01 });
  });
  it('uses each body’s recorded scan time and retains its uncertainty', () => {
    const d850 = compute({ lens: 'n50' }).sensor, z8 = compute({ lens: 'm50' }).sensor;
    expect(d850.readoutS).toBe(.064); expect(z8.readoutS).toBe(.0036);
    expect(d850.figs.readoutS.loc).toContain('directly');
    expect(z8.figs.readoutS.loc).toContain('low');
  });
  it('shows the exact final image and stored intermediate values, with no second tone curve', () => {
    const model = compute({ lens: 'n50' });
    const result = renderImage(model, { width: 24, height: 16, seed: 1 });
    const view = { ...result, scenario: model.scenario, renderId: 1 } as RenderView;
    expect(pipelinePixels(view, 'tone')).toEqual(result.rgba);
    const wb = pipelinePixels(view, 'wb');
    for (let i = 0; i < result.raw.length; i++) {
      expect(wb[i * 4 + 3]).toBe(255);
      for (let c = 0; c < 3; c++) expect(wb[i * 4 + c]).toBe(new Uint8ClampedArray([255 * result.stages.wb[i * 3 + c]])[0]);
    }
  });
  it('subtracts raw black level and preserves RGGB channel order', () => {
    const scenario = normalizeScenario({ lens: 'n50' }), spec = sensorFor(scenario.format, scenario.iso, scenario.sensor).spec;
    const raw = new Uint16Array([spec.blackLevelDn, 2 ** spec.bitDepth - 1, 2 ** spec.bitDepth - 1, 2 ** spec.bitDepth - 1]);
    const view = { scenario, width: 2, height: 2, raw } as RenderView;
    expect([...pipelinePixels(view, 'raw')]).toEqual([0, 0, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]);
  });
  it('matches shots independent of property order but rejects stale and extra settings', () => {
    const s = normalizeScenario({});
    expect(sameShot(s, { ...s })).toBe(true);
    expect(sameShot(s, { ...s, iso: s.iso * 2 })).toBe(false);
    expect(sameShot(s, { ...s, motion: { speedMps: 1 } })).toBe(false);
  });
  it('experiments express their stated light/brightness tradeoffs', () => {
    const pair = (id: string) => { const r = EXPERIMENTS[id]; const a = normalizeScenario(r.before); return [a, normalizeScenario({ ...a, ...r.after })]; };
    const [da, db] = pair('depth');
    expect(da.shutter / da.fno ** 2).toBeCloseTo(db.shutter / db.fno ** 2, 9);
    const [na, nb] = pair('noise');
    expect(nb.shutter / na.shutter).toBe(16); expect(na.iso / nb.iso).toBe(16);
    const [ma, mb] = pair('motion');
    expect(ma.motion?.speedMps).toBe(1); expect(mb.shutter).toBeLessThan(ma.shutter);
  });
});
