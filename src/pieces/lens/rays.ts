// The live spectral ray fan (BRIEF.md set piece 2): drawn surface by surface as fat lines in physics colors,
// straight from lensFans()'s own trace points -- "pieces never compute physics; they draw engine output." A ray
// blocked by the iris or a clear aperture simply has fewer points (RayPath.pts already stops there); a ray that
// reaches the image plane already ends there, since TraceSystem's last surface IS the image/sensor plane
// (trace.ts), so "rays continue from the last surface to the sensor plane" needs no extra segment here.
import * as THREE from 'three/webgpu';
import { BlendedLineMaterial } from '../blended-line-material';
import { LineSegments2 } from 'three/addons/lines/webgpu/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import type { FanSet } from '../../engine/model-types';
import type { RayStatus } from '../../engine/types';
import type * as look from '../../app/look';

export interface RaySample {
  field: number;
  nm: number;
  status: RayStatus;
  /** World-space points as actually written into the drawn line buffer (mm) -- identical numbers to the engine's
   *  own RayPath.pts by construction (this module applies no transform), kept alongside for the accuracy gate. */
  world: [number, number, number][];
}

export interface RaysHandle {
  mesh: LineSegments2;
  /** A second LineSegments2 instance sharing this handle's geometry/material (Three.js resources, unlike scene
   *  membership, can be reused by more than one Object3D) -- the detail inset (inset.ts) renders its own small
   *  scene from this, so the sensor plate's opaque full-format plane (sensor.ts) does not fill its close-up
   *  frame the way it would if the inset just reused the main scene wholesale. */
  insetMesh: LineSegments2;
  samples: RaySample[];
  /** Rebuilds the line geometry from a fresh lensFans() result. Called on every model update (LOOK.md: ray
   *  updates are instant, never eased -- "the rays update at once since they are the physics"). */
  update(fans: FanSet[]): void;
  dispose(): void;
}

const LAST_NM = 500; // the bin drawn on top where bins coincide (see update())

export function buildRays(lookMod: typeof look): RaysHandle {
  const geometry = new LineSegmentsGeometry();
  // A degenerate single zero-length segment so the material/renderer has a valid (non-empty) buffer before the
  // first update() call -- LineSegmentsGeometry throws on setPositions([]) with zero segments.
  geometry.setPositions(new Float32Array(6));
  geometry.setColors(new Float32Array(6));
  const material = new BlendedLineMaterial({ vertexColors: true, linewidth: 1.6, toneMapped: false });
  const mesh = new LineSegments2(geometry, material);
  mesh.frustumCulled = false;
  mesh.name = 'lens-ray-fan';
  const insetMesh = new LineSegments2(geometry, material);
  insetMesh.frustumCulled = false;
  insetMesh.name = 'lens-ray-fan-inset';

  const samples: RaySample[] = [];

  return {
    mesh,
    insetMesh,
    samples,
    update(fans) {
      const positions: number[] = [];
      const colors: number[] = [];
      samples.length = 0;
      // The 16 wavelength bins of one ray run on top of each other until the glass splits them, and an opaque
      // line shows whichever bin was drawn last. The bins are drawn from the ends of the spectrum inward, the
      // bin nearest 500 nm last, so a shared stretch shows a clear cyan-green bin color (never a near-black
      // deep-red one, and never a yellow that could pass for the amber UI accent, design/LOOK.md), and each
      // bin's own color shows where dispersion pulls it clear. Only the draw order changes; every vertex and
      // every color is the engine's.
      const paths: { nm: number; pts: [number, number, number][]; color: THREE.Color; order: number }[] = [];
      for (const set of fans) {
        for (const path of set.paths) {
          const color = lookMod.wavelengthToThreeColor(path.nm);
          const world: [number, number, number][] = path.pts.map((p) => [p[0], p[1], p[2]]);
          samples.push({ field: set.field, nm: path.nm, status: path.status, world });
          // A ray the front element's own rim stops never enters the lens: its whole path is one segment ending
          // in the air in front of the barrel, which drew as loose stubs below the lens. It stays in `samples`
          // (and so in the accuracy probe, with its engine status); only its line is left out.
          if (path.status !== 'ok' && world.length <= 2) continue;
          paths.push({ nm: path.nm, pts: world, color, order: -Math.abs(path.nm - LAST_NM) });
        }
      }
      paths.sort((a, b) => a.order - b.order);
      for (const path of paths) {
        const color = path.color;
        for (let i = 0; i < path.pts.length - 1; i++) {
          const a = path.pts[i];
          const b = path.pts[i + 1];
          positions.push(a[0], a[1], a[2], b[0], b[1], b[2]);
          colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
        }
      }
      if (positions.length === 0) {
        geometry.setPositions(new Float32Array(6));
        geometry.setColors(new Float32Array(6));
        mesh.visible = false;
        insetMesh.visible = false;
        return;
      }
      mesh.visible = true;
      insetMesh.visible = true;
      geometry.setPositions(new Float32Array(positions));
      geometry.setColors(new Float32Array(colors));
      geometry.computeBoundingSphere();
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
