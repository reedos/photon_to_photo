// Autofocus at every focus distance (score loop r4, 10/12/2026). A camera's autofocus puts the BEST focus on the
// sensor at each distance. Expected values come from that definition, not from the code under test: the on-axis
// minimum-RMS plane (F, d, C, wide open) must sit on the sensor wherever the lens is focused, and the finite-focus
// solve must keep the infinity relation between the paraxial image and the sensor.
import { describe, it, expect } from 'vitest';
import { getRealizedLens, lensIds } from './data';
import { systemAt, afShiftAt, paraxialInfinityOffset } from './lens';
import { cardinal, imageOf } from './paraxial';
import { aimRay, traceRay, type Field } from './trace';
import { FRAUNHOFER_D_NM } from './glass';
import { compute, pointBundle } from './camera';
import { traceableBins } from '../pieces/lens/valid-bins';
import type { Scenario } from './types';

const AF = [486.1327, 587.5618, 656.2725];
const LINEUP = ['s35', 'n50', 'n500', 'n500fl', 'z35', 'm50', 'z800'];

function fib(n: number, i: number): [number, number] {
  const r = Math.sqrt((i + 0.5) / n), a = i * 2.399963229728653;
  return [r * Math.cos(a), r * Math.sin(a)];
}

function rmsAt(ends: { p: number[]; d: number[] }[], z: number): number {
  const xs: number[] = [], ys: number[] = [];
  for (const { p, d } of ends) {
    const t = (z - p[2]) / d[2];
    xs.push(p[0] + t * d[0]); ys.push(p[1] + t * d[1]);
  }
  const n = xs.length, cx = xs.reduce((a, b) => a + b, 0) / n, cy = ys.reduce((a, b) => a + b, 0) / n;
  let s = 0;
  for (let i = 0; i < n; i++) s += (xs[i] - cx) ** 2 + (ys[i] - cy) ** 2;
  return Math.sqrt(s / n);
}

/** Where the on-axis, wide-open, F/d/C bundle focuses best relative to the sensor (um), and its RMS radius (um) at
 *  the sensor and at best focus, for a lens focused at focusMm (null = infinity). */
function onAxisAtSensor(id: string, focusMm: number | null): { bestMinusSensorUm: number; rmsSensorUm: number; rmsBestUm: number } {
  const lens = getRealizedLens(id);
  const sr = lens.realization.stopRadius;
  const focus = focusMm === null ? null : Math.max(focusMm, lens.realization.closestFocusMm);
  const base = systemAt(lens, focus, { clamp: true });
  const sys = { ...base, surfaces: base.surfaces.map((s) => (s.kind === 'stop' ? { ...s, sd: sr } : s)) };
  const c = cardinal(sys, FRAUNHOFER_D_NM, sr);
  const zS = sys.surfaces[sys.surfaces.length - 1].z;
  const field: Field = focus === null ? { kind: 'angle', ax: 0, ay: 0 } : { kind: 'object', o: [0, 0, zS - focus] };
  const ends: { p: number[]; d: number[] }[] = [];
  for (const nm of AF) {
    for (let i = 0; i < 100; i++) {
      const [px, py] = fib(100, i);
      const path = traceRay(sys, aimRay(sys, c.ep, field, px, py, nm, { realAim: true }), { ignoreVignetting: true });
      if (path.status === 'ok') ends.push({ p: path.pts[path.pts.length - 1], d: path.dirOut! });
    }
  }
  let best = 0, bestR = rmsAt(ends, zS);
  for (let step = 0.05, lo = -1, hi = 1; step >= 0.0005; step /= 10) {
    for (let dz = lo; dz <= hi + 1e-12; dz += step) {
      const r = rmsAt(ends, zS + dz);
      if (r < bestR) { bestR = r; best = dz; }
    }
    lo = best - step; hi = best + step;
  }
  return { bestMinusSensorUm: best * 1000, rmsSensorUm: rmsAt(ends, zS) * 1000, rmsBestUm: bestR * 1000 };
}

function sensorMinusParaxialUm(id: string, focusMm: number | null): number {
  const lens = getRealizedLens(id);
  const sys = systemAt(lens, focusMm, { clamp: true });
  const zS = sys.surfaces[sys.surfaces.length - 1].z;
  const par = focusMm === null ? cardinal(sys, FRAUNHOFER_D_NM).F2 : imageOf(sys, FRAUNHOFER_D_NM, zS - focusMm).z;
  return (zS - par) * 1000;
}

describe('finite focus keeps the infinity reference (z35: 26 um, p85: 0.36 mm over-focus at every finite distance)', () => {
  for (const id of lensIds()) {
    it(`${id}: sensor minus paraxial image at 1e6 mm equals the infinity value within 2 um`, () => {
      expect(Math.abs(sensorMinusParaxialUm(id, 1e6) - sensorMinusParaxialUm(id, null))).toBeLessThan(2);
    });
  }
  it('paraxialInfinityOffset is the gap between the patent back focus and the true paraxial image (z35 26 um)', () => {
    expect(paraxialInfinityOffset(getRealizedLens('z35')) * 1000).toBeCloseTo(26, -1);
    expect(Math.abs(paraxialInfinityOffset(getRealizedLens('p85')) * 1000)).toBeGreaterThan(300);
  });
});

describe('autofocus puts the best focus on the sensor at every distance', () => {
  for (const id of lensIds()) {
    it(`${id}: best focus within 3 um of the sensor at 3 distances, and the sensor spot is within 5% of the best`, () => {
      const closest = getRealizedLens(id).realization.closestFocusMm;
      for (const mm of [3000, 1300, 0]) {
        const r = onAxisAtSensor(id, mm === 0 ? closest : mm);
        expect(Math.abs(r.bestMinusSensorUm), `${id} at ${mm || closest} mm`).toBeLessThan(3);
        expect(r.rmsSensorUm, `${id} at ${mm || closest} mm`).toBeLessThan(r.rmsBestUm * 1.05 + 0.3);
      }
    });
  }
  it('the table follows the solve between its nodes (n50 and z35 at distances that are not nodes)', () => {
    for (const id of ['n50', 'z35', 'm50']) {
      for (const mm of [700, 1900, 6000]) {
        const r = onAxisAtSensor(id, mm);
        expect(Math.abs(r.bestMinusSensorUm), `${id} at ${mm} mm`).toBeLessThan(3);
      }
    }
  });
});

describe('afShiftAt', () => {
  const table = { closestMm: 1000, v: [0, 0.5, 1], shiftMm: [0, 0.01, 0.04] };
  it('is 0 at infinity and without a table, and returns the node values at the nodes', () => {
    expect(afShiftAt(table, Infinity)).toBe(0);
    expect(afShiftAt(undefined, 1000)).toBe(0);
    expect(afShiftAt(table, 1000)).toBeCloseTo(0.04, 12);
    expect(afShiftAt(table, 2000)).toBeCloseTo(0.01, 12);
  });
  it('clamps distances closer than the closest focus to its value', () => {
    expect(afShiftAt(table, 500)).toBeCloseTo(0.04, 12);
  });
});

// The point at the focus distance must record about the disk it records at infinity, not 2 to 3.6 times the CoC
// (n50 f/1.86 at 0.45 m 68 um against 30.6 um at infinity before the shift; m50 at 0.40 m 104 um against 13 um).
// Aberrations do grow at close range for the real lens, so the bound is 2.1 times the infinity disk, not equality.
describe('lineup: the in-focus point records a disk near its infinity value (wide open)', () => {
  const bins = Array.from({ length: 16 }, (_, i) => 380 + 25 * (i + 0.5));
  const sc = (lens: string, focusM: number | null): Scenario => ({ lens, fno: 0.1, shutter: 1 / 250, iso: 100, focusM, format: 'ff', shutterType: 'mechanical', scene: 'bench' });
  for (const id of LINEUP) {
    it(`${id}`, () => {
      const closestM = getRealizedLens(id).realization.closestFocusMm / 1000;
      const inf = compute(sc(id, null));
      const at = (m: Scenario) => {
        const model = compute(m);
        return pointBundle(model, { pointDistMm: model.focus.distanceMm ?? 1e7, fieldFrac: 0, rays: 130, nms: traceableBins(model, bins) }).recordedDiameterMm;
      };
      const ref = pointBundle(inf, { pointDistMm: 1e7, fieldFrac: 0, rays: 130, nms: traceableBins(inf, bins) }).recordedDiameterMm;
      for (const m of [Math.max(3, closestM), Math.max(1, closestM), closestM]) {
        // the n500fl's patent state at beta = -0.153 is a worse corrector (on-axis RMS 1.0 um at infinity, 9 um at its best
        // focus at 3.6 m): its design, not focus. It must still stay inside the CoC it is judged by.
        const limit = id === 'n500fl' ? inf.focus.cocMm : 2.1 * ref + 0.002;
        expect(at(sc(id, m)), `${id} focus ${m.toFixed(2)} m`).toBeLessThan(limit);
      }
    });
  }
});
