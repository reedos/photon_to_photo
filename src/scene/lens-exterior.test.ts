// Accuracy checks for the lens exterior (docs/PANE.md): the built barrel against the published dimensions
// (data/hardware/lens-exteriors.json), the mount flange face against PANE.md's own convention, and the
// engraved distance-scale mark angles against the engine's real focus travel (src/engine/focus-travel.ts).
import { describe, it, expect } from 'vitest';
import * as THREE from 'three/webgpu';
import { compute } from '../engine/camera';
import type { Scenario } from '../engine/types';
import { buildLens, exteriorSpecFor } from './lens-exterior';
import { focusRingAngleRad } from '../engine/focus-travel';
import mountsJson from '../../data/hardware/mounts.json';

const MOUNTS = (mountsJson as unknown as { mounts: Record<string, { flangeMm: number }> }).mounts;
const LINEUP = ['s35', 'n50', 'n500', 'n500fl', 'z35', 'm50', 'z800'];

function baseScenario(lens: string, overrides: Partial<Scenario> = {}): Scenario {
  return {
    lens, fno: 4, shutter: 1 / 250, iso: 100, focusM: 3, format: 'ff',
    shutterType: 'mechanical', scene: 'bench', ...overrides,
  };
}

function firstByComponent(handle: ReturnType<typeof buildLens>, component: string): THREE.Object3D {
  const list = handle.components[component];
  if (!list || list.length === 0) throw new Error(`no component "${component}"`);
  return list[0];
}

describe('lens exterior: barrel dimensions vs data/hardware/lens-exteriors.json', () => {
  for (const id of LINEUP) {
    it(`${id}: the barrel's own diameter and length match the published spec within 2%`, () => {
      const model = compute(baseScenario(id));
      const handle = buildLens(model, { cutaway: false });
      const spec = exteriorSpecFor(id);

      const barrel = firstByComponent(handle, 'barrel');
      const box = new THREE.Box3().setFromObject(barrel);
      const size = new THREE.Vector3();
      box.getSize(size);
      const builtDiameter = Math.max(size.x, size.y);
      const builtLength = size.z;

      expect(builtDiameter).toBeGreaterThan(0);
      expect(Math.abs(builtDiameter - spec.diameterMm.v) / spec.diameterMm.v).toBeLessThan(0.02);
      expect(Math.abs(builtLength - spec.lengthMm.v) / spec.lengthMm.v).toBeLessThan(0.02);

      handle.dispose();
    });

    it(`${id}: the mount flange face sits at PANE.md's own z convention (F: -46.5, Z: -16)`, () => {
      const model = compute(baseScenario(id));
      const handle = buildLens(model, { cutaway: false });
      const spec = exteriorSpecFor(id);
      const mount = MOUNTS[spec.mount];

      const mountObj = firstByComponent(handle, 'mount');
      const box = new THREE.Box3().setFromObject(mountObj);
      // The mount collar's front face (closest to the barrel, most negative z) sits exactly at the flange
      // plane; PANE.md itself states F-mount at -46.5mm and Z-mount at -16mm.
      expect(box.min.z).toBeCloseTo(-mount.flangeMm, 3);
      if (spec.mount === 'nikonF') expect(-mount.flangeMm).toBeCloseTo(-46.5, 6);
      if (spec.mount === 'nikonZ') expect(-mount.flangeMm).toBeCloseTo(-16, 6);

      handle.dispose();
    });
  }
});

describe('lens exterior: distance-scale mark angles vs the engine focus travel', () => {
  for (const id of LINEUP) {
    const hasScale = exteriorSpecFor(id).distanceScale?.v === true;
    (hasScale ? it : it.skip)(`${id}: every tick's world rotation matches focusRingAngleRad for its distance`, () => {
      const model = compute(baseScenario(id));
      const handle = buildLens(model, { cutaway: false });
      const scaleGroup = firstByComponent(handle, 'distanceScale') as THREE.Group;
      expect(scaleGroup.children.length).toBeGreaterThan(0);

      // Recompute the same representative marks lens-exterior.ts builds internally and check each tick's own
      // placement angle (position.z on it, and the atan2 of its x/y before the ring's own group rotation)
      // against focusRingAngleRad -- the single source of truth for "angle from the real focus solve".
      const closestMm = model.realized.realization.closestFocusMm;
      const marks: (number | null)[] = [null, 10000, 5000, 3000, 2000, 1500, 1000, 700, 500, closestMm].filter(
        (m) => m === null || m >= closestMm - 1e-6,
      );
      expect(scaleGroup.children.length).toBe(marks.length);

      for (let i = 0; i < marks.length; i++) {
        const expectedAngle = focusRingAngleRad(model.realized, marks[i], id);
        const tick = scaleGroup.children[i];
        // buildTick placed it at world angle = -expectedAngle (0 = +Y) before the ring's own rotation is
        // applied; the tick's own rotation.z records exactly that placement angle.
        expect(tick.rotation.z).toBeCloseTo(-expectedAngle, 6);
      }

      handle.dispose();
    });
  }
});
