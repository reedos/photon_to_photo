// Builds and repositions the element/plate glass bodies (BRIEF.md set piece 2, "the lens as glass you can see
// into") from model.realized.elements and model.realized.plates, using geometry.ts's lathe builders. Never
// rebuilds vertex buffers on a focus change: each body's shape is fixed (an element's own two-surface thickness
// does not move with focus, only the air gaps between elements do -- see geometry.ts's module doc), so update()
// only repositions each body's Group.position.z to the current model.system.surfaces[frontIndex].z.
import * as THREE from 'three/webgpu';
import type { Model } from '../../engine/model-types';
import type * as look from '../../app/look';
import { buildBodyProfile, buildCap, revolveStrip, wedgeAngles, type BodyProfile } from './geometry';

interface Body {
  group: THREE.Group;
  outline: THREE.LineSegments;
  frontSurfaceIndex: number;
  glassFront: THREE.Mesh;
  glassBack: THREE.Mesh;
  edgeRim: THREE.Mesh;
  capA: THREE.Mesh;
  capB: THREE.Mesh;
  od: number;
  kind: 'element' | 'plate';
  elementIndex: number | null; // 1-based Element.index, for the front-element probe
}

export interface ElementsHandle {
  group: THREE.Group; // add this to the piece's group
  bodies: Body[];
  /** Repositions every body at the model's current focus. Rebuild (dispose + build) only on a lens-id change. */
  reposition(model: Model): void;
  /** The largest OD across every body -- the barrel's inner radius depends on it. */
  maxOd(): number;
  dispose(): void;
}

/** The element's section outline on both cut faces: the profile a maker's cutaway drawing inks, so each
 *  element's real shape reads at a glance even where the glass itself is nearly invisible against the dark
 *  inside of the barrel. Nudged a hair toward the viewer (-x) so it never fights the cap face for depth. */
function buildOutline(loop: { r: number; z: number }[], mat: THREE.Material): THREE.LineSegments {
  const pts: number[] = [];
  for (const sign of [1, -1]) {
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i], b = loop[(i + 1) % loop.length];
      pts.push(-0.04, sign * a.r, a.z, -0.04, sign * b.r, b.z);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const line = new THREE.LineSegments(geo, mat);
  line.frustumCulled = false;
  line.renderOrder = 4;
  return line;
}

/** The cut face of an element: the glass shown in section, a pale, slightly blue-green tint (a thick crown
 *  glass seen edge-on) at low opacity, so it reads as glass in a cutaway without hiding the rays or the far
 *  half of the stack. Not the element's optical surface -- that keeps the real transmissive material. */
function sectionGlassMaterial(dense: boolean): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: dense ? 0xd6e2cf : 0xc4dce6, metalness: 0, roughness: 0.18, transmission: 0,
    transparent: true, opacity: 0.2, clearcoat: 1, clearcoatRoughness: 0.08, side: THREE.DoubleSide, depthWrite: false,
  });
}

function buildOneBody(profile: BodyProfile, glassMat: THREE.Material, edgeMat: THREE.Material, capMat: THREE.Material): {
  glassFront: THREE.Mesh; glassBack: THREE.Mesh; edgeRim: THREE.Mesh; capA: THREE.Mesh; capB: THREE.Mesh;
} {
  const { thetaStart, thetaLength } = wedgeAngles();
  const thetaEnd = thetaStart + thetaLength;
  const fullLoop = [...profile.front, ...profile.rim, ...profile.back];

  const glassFront = new THREE.Mesh(revolveStrip(profile.front, thetaStart, thetaLength), glassMat);
  const glassBack = new THREE.Mesh(revolveStrip(profile.back, thetaStart, thetaLength), glassMat);
  const edgeRim = new THREE.Mesh(revolveStrip(profile.rim, thetaStart, thetaLength), edgeMat);
  const capA = new THREE.Mesh(buildCap(fullLoop, thetaStart, -1), capMat);
  const capB = new THREE.Mesh(buildCap(fullLoop, thetaEnd, 1), capMat);
  for (const m of [glassFront, glassBack, edgeRim, capA, capB]) m.frustumCulled = false;
  return { glassFront, glassBack, edgeRim, capA, capB };
}

function disposeBody(b: Body): void {
  for (const m of [b.glassFront, b.glassBack, b.edgeRim, b.capA, b.capB]) {
    m.geometry.dispose();
    (m.material as THREE.Material).dispose();
  }
  b.outline.geometry.dispose();
}

/** Glass for the WebGL2 tier: transmission costs ~42 ms/frame per element there (docs/rendering-spike.md, spike
 *  c) -- a lens with a dozen-plus elements would blow the frame budget many times over. look.ts's glassMaterial()
 *  always sets transmission:1 (it has no cheap-tier branch), so this piece builds its own budget material for
 *  that tier instead: a Fresnel-ish rim via a low-opacity, higher-reflectivity MeshPhysicalMaterial with
 *  transmission off, same ior/tint inputs, so it still reads as "this element's own glass" rather than a flat
 *  fallback color. */
function cheapGlassMaterial(ior: number, dense: boolean): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: dense ? 0xe4ead8 : 0xdce9f0,
    transmission: 0,
    opacity: 0.14,
    transparent: true,
    roughness: 0.06,
    metalness: 0,
    ior,
    reflectivity: 0.9,
    side: THREE.DoubleSide,
  });
}

type PieceRenderer = { backend?: { isWebGPUBackend?: boolean } };

function isWebGPUBackend(renderer: PieceRenderer): boolean {
  return Boolean(renderer.backend?.isWebGPUBackend);
}

export function buildElements(model: Model, lookMod: typeof look, renderer: PieceRenderer): ElementsHandle {
  const group = new THREE.Group();
  group.name = 'lens-elements';
  const realized = model.realized;
  const system = model.system.surfaces;
  const bodies: Body[] = [];
  const webgpu = isWebGPUBackend(renderer);
  const outlineMat = new THREE.LineBasicMaterial({ color: 0xd4e4ec, transparent: true, opacity: 0.62 });

  const specs: { frontIdx: number; backIdx: number; kind: 'element' | 'plate'; elementIndex: number | null }[] = [];
  for (const el of realized.elements) specs.push({ frontIdx: el.surfaces[0], backIdx: el.surfaces[1], kind: 'element', elementIndex: el.index });
  for (const pl of realized.plates) specs.push({ frontIdx: pl.surfaces[0], backIdx: pl.surfaces[1], kind: 'plate', elementIndex: null });
  specs.sort((a, b) => a.frontIdx - b.frontIdx);

  for (const spec of specs) {
    const frontSurf = system[spec.frontIdx];
    const backSurf = system[spec.backIdx];
    const intraThickness = backSurf.z - frontSurf.z;
    const label = `${model.lens.id} surfaces ${spec.frontIdx}-${spec.backIdx}`;
    const profile = buildBodyProfile(frontSurf, backSurf, intraThickness, label);

    const nd = model.realized.design.surfaces[spec.frontIdx].nd ?? 1.52;
    const dense = nd > 1.65;
    // Transmission glass is WebGPU-tier only (docs/PROTOTYPE.md: ~42 ms/frame per element on WebGL2, spike c) --
    // look.ts's glassMaterial() has no cheap-tier branch of its own, so this piece picks the material here.
    const glassMat = webgpu
      ? lookMod.glassMaterial({ ior: nd, thickness: intraThickness, dense })
      : cheapGlassMaterial(nd, dense);
    const edgeMat = lookMod.edgeBlackMaterial();
    // The cut face is still the element's own glass (its true cross-section, not a paint) -- but it is an
    // artist's-cutaway convention, not a real polished air-glass surface, so it never got an AR coating; a
    // second material with iridescence off (rather than glassMat's iridescence:1) keeps it from mirror-catching
    // the PMREM's bright band as one flat, uniformly-lit wedge -- the "uniform glow" look-cheap smell
    // (design/RUBRIC.md) this piece hit at exactly this camera angle before the fix.
    const capMat = sectionGlassMaterial(dense);
    const { glassFront, glassBack, edgeRim, capA, capB } = buildOneBody(profile, glassMat, edgeMat, capMat);

    const bodyGroup = new THREE.Group();
    bodyGroup.name = spec.kind === 'element' ? `element-${spec.elementIndex}` : `plate-${spec.frontIdx}`;
    bodyGroup.position.z = frontSurf.z;
    const outline = buildOutline([...profile.front, ...profile.rim, ...profile.back], outlineMat);
    bodyGroup.add(glassFront, glassBack, edgeRim, capA, capB, outline);
    group.add(bodyGroup);

    bodies.push({
      group: bodyGroup, outline, frontSurfaceIndex: spec.frontIdx, glassFront, glassBack, edgeRim, capA, capB,
      od: profile.od, kind: spec.kind, elementIndex: spec.elementIndex,
    });
  }

  return {
    group,
    bodies,
    reposition(m) {
      for (const b of bodies) b.group.position.z = m.system.surfaces[b.frontSurfaceIndex].z;
    },
    maxOd() {
      return bodies.reduce((max, b) => Math.max(max, b.od), 0);
    },
    dispose() {
      for (const b of bodies) disposeBody(b);
      outlineMat.dispose();
    },
  };
}
