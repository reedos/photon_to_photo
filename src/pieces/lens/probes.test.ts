// The Optics focus card says when a lens's focusing motion is an extrapolation of its patent table (score loop r4,
// 10/12/2026): the n50's patent tabulates the gaps only at R = 1.70 m, the product focuses to 0.45 m.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { compute } from '../../engine/camera';
import type { Scenario } from '../../engine/types';
import { buildProbes } from './probes';

const v = () => new THREE.Vector3();
const probes = buildProbes({ frontElement: v(), iris: v(), focusGroup: v(), sensor: v(), rayFan: v(), inset: v() },
  () => ({ irisDrawnRadius: 1, insetMagnification: 1, insetSpreadMm: 0, insetColorShiftMm: 0, insetSpotMm: 0, fanSourceMm: null, fields: [0], bins: [550] }));
const focusCard = (lens: string, focusM: number | null) => {
  const sc: Scenario = { lens, fno: 4, shutter: 1 / 250, iso: 100, focusM, format: 'ff', shutterType: 'mechanical', scene: 'bench' };
  return probes.find((p) => p.id === 'focus-group')!.card!(compute(sc));
};

describe('focus card: extrapolated group motion', () => {
  it('n50 closer than the 1.7 m the patent tabulates says the motion is assumed', () => {
    const card = focusCard('n50', 0.6);
    expect(card.body).toMatch(/only down to 1\.70 m/);
    const row = card.specs.find((s) => /Group motion below/.test(s.k))!;
    expect(row.v).toBe('Extrapolated');
    expect(row.fig?.ev).toBe('assumed');
    expect(row.fig?.src).toMatch(/continue the same two-gap motion/);
  });
  it('not at 3 m or infinity, and not for a lens whose table reaches its closest focus', () => {
    for (const [lens, focusM] of [['n50', 3], ['n50', null], ['s35', 0.4], ['n500fl', 3.6]] as const) {
      const card = focusCard(lens, focusM);
      expect(card.specs.some((s) => /Group motion below/.test(s.k)), `${lens} ${focusM}`).toBe(false);
      expect(card.body).not.toMatch(/only down to/);
    }
  });
});
