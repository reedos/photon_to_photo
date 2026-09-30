// The aperture blades (BRIEF.md set piece 2): thin extruded steel shapes at the stop plane, closing as the
// f-number changes, "physically timed (LOOK.md motion: at most 150 ms, eased)". The blade OUTLINE geometry
// itself comes straight from the engine's own iris.ts (bladeShapes) -- the same function compute() already used
// to build model.iris.blades -- called again here only to sample the SAME schematic mechanism at intermediate
// radii while the real (bounded) motion plays out; no new physics, only asking the engine's own function for
// its shape at the animation's current radius instead of only its start and end.
import * as THREE from 'three/webgpu';
import type * as look from '../../app/look';
import { bladeShapes } from '../../engine/iris';

const CLOSE_MS = 150; // LOOK.md: "commonly well under 150ms; use that as the ceiling"
const easeOutQuint = (t: number) => 1 - Math.pow(1 - t, 5);

export interface IrisHandle {
  group: THREE.Group;
  /** Starts (or redirects) the blade animation toward a new target radius. No-op if already at that radius. */
  setTarget(radius: number, blades: number, rounded: boolean, rotation: number, z: number): void;
  /** Advances the animation; returns true if the drawn radius changed (caller should re-render). */
  tick(): boolean;
  /** The radius actually drawn right now (for the accuracy gate's hooks.probe()). */
  drawnRadius(): number;
  dispose(): void;
}

export function buildIris(lookMod: typeof look): IrisHandle {
  const group = new THREE.Group();
  group.name = 'lens-iris';
  const material = lookMod.irisSteelMaterial();
  const meshes: THREE.Mesh[] = [];
  const thickness = 0.6; // mm, schematic (LOOK.md gives no source for blade thickness)
  // LOOK.md, iris blades: "a thin bright edge highlight so overlapping blades read as distinct thin sheets, not a
  // single black disc". Each blade's own outline, on its front face, in the barrel's bare-metal tone.
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x9aa3ab, transparent: true, opacity: 0.55 });
  const edges = new THREE.LineSegments(new THREE.BufferGeometry(), edgeMat);
  edges.frustumCulled = false;
  group.add(edges);

  let blades = 9;
  let rounded = true;
  let rotation = 0;
  let fromR = 1;
  let toR = 1;
  let drawn = 1;
  let startMs = 0;
  let animating = false;

  function rebuildMeshes(radius: number) {
    for (const m of meshes.splice(0)) { group.remove(m); m.geometry.dispose(); }
    const shapes = bladeShapes(blades, radius, rounded, rotation);
    const edgePts: number[] = [];
    for (const outline of shapes) {
      for (let i = 0; i < outline.length; i++) {
        const a = outline[i], b = outline[(i + 1) % outline.length];
        edgePts.push(a[0], a[1], -thickness / 2 - 0.02, b[0], b[1], -thickness / 2 - 0.02);
      }
    }
    edges.geometry.dispose();
    edges.geometry = new THREE.BufferGeometry();
    edges.geometry.setAttribute('position', new THREE.Float32BufferAttribute(edgePts, 3));
    for (const outline of shapes) {
      const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
      const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
      geo.translate(0, 0, -thickness / 2);
      const mesh = new THREE.Mesh(geo, material);
      mesh.frustumCulled = false;
      meshes.push(mesh);
      group.add(mesh);
    }
    drawn = radius;
  }

  rebuildMeshes(1);

  return {
    group,
    setTarget(radius, bladeCount, isRounded, rot, z) {
      group.position.z = z;
      const same = radius === toR && bladeCount === blades && isRounded === rounded && rot === rotation;
      if (same) return;
      if (bladeCount !== blades || isRounded !== rounded || rot !== rotation) {
        // A lens switch or a rotation change (never happens today, but kept honest) has no "previous" shape to
        // ease from -- snap directly, matching case-1 numeric-readout treatment rather than animating a shape
        // whose blade count doesn't even match yet.
        blades = bladeCount; rounded = isRounded; rotation = rot;
        fromR = radius; toR = radius;
        rebuildMeshes(radius);
        animating = false;
        return;
      }
      fromR = drawn;
      toR = radius;
      startMs = performance.now();
      animating = true;
    },
    tick() {
      if (!animating) return false;
      // Elapsed time from performance.now() at both ends, not the rAF callback's own `now` argument: headless
      // Chromium (this project's test/gate environment) can deliver a stale/out-of-order rAF timestamp for a
      // frame queued before setTarget() last ran (docs/rendering-spike.md's own "fps is not GPU time" gotcha is
      // the same underlying clock quirk), which produced a negative elapsed time and a negative blade radius.
      const t = Math.min(1, Math.max(0, (performance.now() - startMs) / CLOSE_MS));
      const r = fromR + (toR - fromR) * easeOutQuint(t);
      rebuildMeshes(r);
      if (t >= 1) animating = false;
      return true;
    },
    drawnRadius() {
      return drawn;
    },
    dispose() {
      for (const m of meshes) m.geometry.dispose();
      material.dispose();
      edges.geometry.dispose();
      edgeMat.dispose();
    },
  };
}
