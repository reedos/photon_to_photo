// The claim a focus control makes: a point at the distance you focus on lands sharp. Every other focus test checks
// the solver's internals; this one checks the picture. It exists because the n50's focus table moves the back focus
// itself, the solve aimed at a fixed sensor, and the lens silently never focused (0.68 mm blur at 1 m, 24x the CoC)
// while every test stayed green (09/29/2026).
import { describe, expect, it } from 'vitest';
import { compute, pointBundle, sensorZEffective } from './camera';
import type { Scenario } from './types';

const LINEUP = ['s35', 'n50', 'n500', 'n500fl', 'z35', 'm50', 'z800'];

function scenario(lens: string, focusM: number | null): Scenario {
  return { lens, fno: 8, shutter: 1 / 250, iso: 100, focusM, format: 'ff', shutterType: 'mechanical', scene: 'bench' };
}

describe.each(LINEUP)('%s focuses where it is set', (lens) => {
  const closest = compute(scenario(lens, null)).realized.realization.closestFocusMm;
  const distances = [...new Set([20000, 10000, 3000, 1000, closest * 1.2, closest].filter((d) => d >= closest).map(Math.round))];

  it.each(distances)('a point at %i mm, focused there, blurs less than the circle of confusion', (d) => {
    const m = compute(scenario(lens, d / 1000));
    const b = pointBundle(m, { pointDistMm: m.focus.distanceMm!, fieldFrac: 0, rays: 31, nms: [550] });
    expect(b.diameterMm).toBeLessThan(m.focus.cocMm);
  });

  it('moves its glass relative to the sensor when focused closer (the ring does something)', () => {
    const far = compute(scenario(lens, null)).system.surfaces;
    const near = compute(scenario(lens, closest / 1000)).system.surfaces;
    const rel = (s: typeof far) => s.slice(0, -1).map((x) => x.z - s[s.length - 1].z);
    const moved = Math.max(...rel(far).map((z, i) => Math.abs(z - rel(near)[i])));
    expect(moved).toBeGreaterThan(0.1);
  });
});

// F3/F5 (09/30/2026, Astra-6 review): the spot-size gate above can pass at the WRONG object distance -- p35/p85's
// solved conjugate and the system's own returned image surface used to disagree by several mm (F3), and n50's
// distance was measured from the stale infinity sensor coordinate instead of its own current (back-focus-moving)
// image surface, 9.5 mm off at 0.45 m (F5). A small geometric blur alone cannot catch either bug (both still pass
// the CoC gate at the wrong distance), so this checks the actual physical claim directly: object-to-current-sensor
// distance must equal what was requested, independent of the spot the trace produces.
describe.each(['p35', 'p85', 'p200', ...LINEUP])('%s: object-to-sensor distance matches the request', (lens) => {
  const closest = compute(scenario(lens, null)).realized.realization.closestFocusMm;
  const distances = [...new Set([3000, 1000, closest * 1.2, closest].filter((d) => d >= closest).map(Math.round))];

  it.each(distances)('at %i mm requested, the traced object sits exactly that far from the current sensor', (d) => {
    const m = compute(scenario(lens, d / 1000));
    const sensorZ = sensorZEffective(m.system);
    expect(m.focus.objectZ).not.toBeNull();
    const distFromSensor = sensorZ - m.focus.objectZ!;
    expect(distFromSensor).toBeCloseTo(m.focus.distanceMm!, 3);
  });
});
