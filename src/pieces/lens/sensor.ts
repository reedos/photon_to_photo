// The sensor plate at the image plane (BRIEF.md set piece 2): "a thin silicon plate at the image plane with the
// format's true size (model.sensor.format), a faint image-circle ring." Rebuilt only when the format or lens
// changes (its size/position both come from model data, not focus).
import * as THREE from 'three/webgpu';
import type { Model } from '../../engine/model-types';
import type * as look from '../../app/look';

export interface SensorHandle {
  group: THREE.Group;
  update(model: Model): void;
  dispose(): void;
}

export function buildSensor(lookMod: typeof look): SensorHandle {
  const group = new THREE.Group();
  group.name = 'lens-sensor';

  const plateMat = lookMod.sensorArrayMaterial();
  // A restrained presentation fill makes the silicon read as a surface at this
  // scale; it is not a color-filter diagram or a measured reflectance claim.
  plateMat.color.set(0x3b536b);
  plateMat.emissive.set(0x122030);
  plateMat.emissiveIntensity = 0.3;
  plateMat.roughness = 0.3;
  const plate = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 0.3), plateMat);
  plate.frustumCulled = false;

  // The format's own rectangle, outlined so the plate reads as the 36 x 24 mm (or whatever format) chip it is,
  // not a dark shape lost in the void (R1-12).
  const edgeMat = new THREE.LineBasicMaterial({ color: 0xc9ced4, transparent: true, opacity: 0.5 });
  edgeMat.toneMapped = false;
  const edgeGeo = new THREE.BufferGeometry();
  const edge = new THREE.Line(edgeGeo, edgeMat);
  edge.frustumCulled = false;

  // The image circle, faint: it is context for the rectangle, not the sensor itself.
  const ringMat = new THREE.LineBasicMaterial({ color: 0x8fc3f0, transparent: true, opacity: 0.16 });
  ringMat.toneMapped = false;
  const ringGeo = new THREE.BufferGeometry();
  // THREE.Line, not LineLoop -- the WebGPU renderer does not support LineLoop (docs/pieces/lens.md's known
  // limits); the ring is closed by simply repeating its first point as the last one in update() below.
  const ring = new THREE.Line(ringGeo, ringMat);
  ring.frustumCulled = false;

  group.add(plate, edge, ring);

  let lastKey = '';

  return {
    group,
    update(model) {
      const key = `${model.sensor.format.id}:${model.lens.id}`;
      const z = model.system.surfaces[model.system.surfaces.length - 1].z;
      plate.position.z = z + 0.2;
      ring.position.z = z + 0.05;
      edge.position.z = z + 0.04;
      if (key === lastKey) return;
      lastKey = key;
      plate.scale.set(model.sensor.format.w, model.sensor.format.h, 1);
      const hw = model.sensor.format.w / 2, hh = model.sensor.format.h / 2;
      edgeGeo.setFromPoints([[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh], [-hw, -hh]].map(([x, y]) => new THREE.Vector3(x, y, 0)));

      // The LENS's own image circle (what it projects), not the sensor's diagonal -- the two differ whenever a
      // reader picks a format the lens over- or under-covers, which is exactly what this ring is for showing.
      const radius = model.realized.design.imageCircleMm / 2;
      const pts: THREE.Vector3[] = [];
      const N = 96;
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a) * radius, Math.sin(a) * radius, 0));
      }
      ringGeo.setFromPoints(pts);
    },
    dispose() {
      plate.geometry.dispose();
      plateMat.dispose();
      ringGeo.dispose();
      edgeGeo.dispose();
      edgeMat.dispose();
      ringMat.dispose();
    },
  };
}
