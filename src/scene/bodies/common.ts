// Shared helpers for the camera body builders (src/scene/bodies/dslr.ts, mirrorless.ts), per docs/PANE.md's
// "One pane" plan. World units mm, sensor plane at z = 0, lens axis along -z (front of the lens/body at negative
// z), y up, x to the camera's right as seen from behind -- the same frame the lens/cone/loupe pieces' engine
// mapping uses (docs/PANE.md: "The scene").
//
// Every named sub-object a caller might want to select carries userData: { component, label }. `tagged()` is the
// one place that contract is written so both body builders stay consistent.
import * as THREE from 'three/webgpu';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type * as look from '../../app/look';

export interface ComponentUserData {
  component: string;
  label: string;
}

/** Tags a mesh/group with the selection contract (docs/PANE.md: "named sub-objects for selection ... each
 *  carrying userData { component, label }") and gives it a matching Three.js `name` for easy inspection. */
export function tagged<T extends THREE.Object3D>(obj: T, component: string, label: string): T {
  obj.name = component;
  obj.userData = { ...obj.userData, component, label } satisfies ComponentUserData;
  return obj;
}

/** A per-component pin anchor in the body group's LOCAL space -- consumed by the stage/selection layer the way
 *  src/pieces/types.ts's PieceProbe.anchor is (docs/PANE.md: "an anchor for a pin"). */
export interface ComponentAnchor {
  component: string;
  label: string;
  anchor: THREE.Vector3;
}

/** A rounded rectangular box, bevel-first (docs/PANE.md build brief: "rounded, beveled forms ... rounded-box
 *  helpers"). `radius` is the corner/edge fillet in mm, `segments` the bevel's smoothness. */
export function roundedBox(width: number, height: number, depth: number, radius: number, segments = 4): THREE.BufferGeometry {
  const r = Math.min(radius, width / 2 - 0.01, height / 2 - 0.01, depth / 2 - 0.01);
  return new RoundedBoxGeometry(width, height, depth, segments, Math.max(0.05, r));
}

/** A procedural knurl bump map (repeating diamond/crosshatch pitch) for dial edges and grip texture -- "a rubber
 *  texture (normal or bump detail made procedurally)" and "knurled edges" per the brief. Generated once per call
 *  onto a small canvas and reused as a tiling normal map; no external texture files. */
const hasDom = typeof document !== 'undefined';

export function knurlNormalMap(pitchPx = 8, size = 128): THREE.CanvasTexture | null {
  if (!hasDom) return null; // the accuracy-gate vitest run has no DOM; geometry/material still builds, just flat
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  // Flat normal (pointing +Z, i.e. rgb 128,128,255) as the base, then a crosshatch of two diagonal ridge sets --
  // a cheap approximation of a knurled/machined surface's diamond pattern without a real height-field bake.
  ctx.fillStyle = 'rgb(128,128,255)';
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = 'rgb(190,190,255)';
  ctx.lineWidth = 1.4;
  for (let x = -size; x < size * 2; x += pitchPx) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + size, size);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, size);
    ctx.lineTo(x + size, 0);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** A procedural bump/normal map standing in for a pebbled rubber grip surface -- random small dimples rather
 *  than the knurl's regular ridges. */
export function rubberNormalMap(size = 128, density = 900): THREE.CanvasTexture | null {
  if (!hasDom) return null;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = 'rgb(128,128,255)';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < density; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const rad = 0.6 + Math.random() * 1.6;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, rad);
    grad.addColorStop(0, 'rgb(150,150,255)');
    grad.addColorStop(1, 'rgb(110,110,240)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Satin rubber grip material -- same MeshPhysicalMaterial family as look.ts's other materials, added here
 *  since look.ts (lens/sensor focused) doesn't carry a rubber token yet (docs/PANE.md build brief: "Materials
 *  from look.ts plus satin/rubber materials in the same family (add them in your own module if look.ts lacks
 *  them)"). */
export function rubberGripMaterial(): THREE.MeshPhysicalMaterial {
  const normalMap = rubberNormalMap();
  normalMap?.repeat.set(6, 6);
  return new THREE.MeshPhysicalMaterial({
    color: 0x0c0c0e,
    roughness: 0.92,
    metalness: 0,
    normalMap,
    normalScale: new THREE.Vector2(0.6, 0.6),
    clearcoat: 0.05,
    clearcoatRoughness: 0.8,
  });
}

/** Satin (less anodized, less specular than the lens barrel's ring) body-shell paint -- the main exterior panels,
 *  distinct from anodizedBarrelMaterial's bare-metal bezels. */
export function satinBodyMaterial(color: number): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({ color, roughness: 0.55, metalness: 0.25, clearcoat: 0.08, clearcoatRoughness: 0.5 });
}

/** A knurled metal dial material (top-plate command/mode dials) -- brushed aluminum with the knurl normal map. */
export function knurledDialMaterial(lookMod: typeof look): THREE.MeshPhysicalMaterial {
  const normalMap = knurlNormalMap();
  normalMap?.repeat.set(1, 10); // ridges run around the dial's circumference
  return new THREE.MeshPhysicalMaterial({
    color: lookMod.MATERIAL_COLORS.metalCool,
    roughness: 0.38,
    metalness: 1,
    normalMap,
    normalScale: new THREE.Vector2(0.5, 0.9),
    clearcoat: 0.15,
    clearcoatRoughness: 0.3,
  });
}

/** A ring of small detent notches around a dial's rim -- cheap boxes rather than a boolean cut, in keeping with
 *  the brief's "detents" ask without pulling in a CSG library. */
export function addDetents(parent: THREE.Object3D, radius: number, count: number, notchW: number, notchH: number, y: number, material: THREE.Material): void {
  const geo = new THREE.BoxGeometry(notchW, notchH, notchW * 0.8);
  for (let i = 0; i < count; i++) {
    const theta = (i / count) * Math.PI * 2;
    const m = new THREE.Mesh(geo, material);
    m.position.set(Math.cos(theta) * radius, y, Math.sin(theta) * radius);
    m.rotation.y = -theta;
    parent.add(m);
  }
}

/** A bayonet mount ring: an outer flange plate with `lugCount` lugs (short radial tabs) protruding inward from
 *  the throat, plus a ring of small electrical contact pads -- docs/PANE.md's "the mount ring with its bayonet
 *  lugs and contacts." `faceZ` is the world z of the flange face (== -flange per the frame convention), the ring
 *  sits just behind it (toward the body, +z direction) so the lugs read as protruding into the throat opening. */
export function buildMountRing(opts: {
  throatDiameter: number;
  flangeOuterDiameter: number;
  lugCount: number;
  contactCount: number;
  faceZ: number;
  lookMod: typeof look;
}): THREE.Group {
  const { throatDiameter, flangeOuterDiameter, lugCount, contactCount, faceZ, lookMod } = opts;
  const throatR = throatDiameter / 2;
  const outerR = flangeOuterDiameter / 2;
  const group = new THREE.Group();

  // The flange sits proud of the body shell by a couple mm (real mounts are a raised, precision-machined ring,
  // never flush with the surrounding shell) -- the cosmetic raised collar is a separate mesh from the true
  // flange-face datum plane below, which stays exactly at z = faceZ (== -flange) for the accuracy gate.
  const proudZ = faceZ - 2;

  const metal = lookMod.anodizedBarrelMaterial(true);
  const ringDepth = 4;
  // The true flange face: a thin plate at the exact datum z (data/hardware/mounts.json's flangeMm) -- what the
  // accuracy gate measures.
  const flangeFace = new THREE.Mesh(new THREE.RingGeometry(throatR, outerR, 48), metal);
  flangeFace.position.z = faceZ;
  group.add(tagged(flangeFace, 'mount-flange', 'Mount flange face'));

  // A cosmetic raised collar just in front of the true flange plane, purely so the mount reads as a machined,
  // proud ring rather than a flat decal on the shell (no physics figure attached to this mesh).
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(outerR, outerR, 1.6, 48), metal);
  collar.rotation.x = Math.PI / 2;
  collar.position.z = proudZ + 0.8;
  group.add(collar);

  // The throat: a dark, slightly recessed disc (the opening into the mirror box/sensor throat) plus its short
  // cylindrical wall, receding into the body.
  const throatCap = new THREE.Mesh(new THREE.CircleGeometry(throatR, 48), lookMod.matteInternalMaterial());
  throatCap.position.z = proudZ - 0.05;
  group.add(throatCap);
  const throatWall = new THREE.Mesh(
    new THREE.CylinderGeometry(throatR, throatR, ringDepth, 48, 1, true),
    lookMod.matteInternalMaterial(),
  );
  throatWall.rotation.x = Math.PI / 2;
  throatWall.position.z = proudZ + ringDepth / 2 + 0.5;
  group.add(throatWall);

  // Bayonet lugs: short radial tabs just behind the flange face, protruding inward from the throat wall.
  const lugMat = lookMod.anodizedBarrelMaterial(true);
  const lugW = (2 * Math.PI * throatR) / (lugCount * 3.2); // arc width, leaves gaps between lugs
  const lugDepth = 2.2;
  const lugThickness = 3;
  for (let i = 0; i < lugCount; i++) {
    const theta = (i / lugCount) * Math.PI * 2;
    const lug = new THREE.Mesh(new THREE.BoxGeometry(lugW, lugThickness, lugDepth), lugMat);
    const r = throatR - lugThickness / 2 + 0.3;
    lug.position.set(Math.cos(theta) * r, Math.sin(theta) * r, proudZ + lugDepth / 2 + 0.3);
    lug.rotation.z = theta;
    group.add(tagged(lug, `mount-lug-${i}`, 'Bayonet lug'));
  }

  // Electrical contact pads, a small arc of gold-ish pads set into the flange face along its lower edge (real
  // bayonet mounts cluster their contacts in one arc, not spread all the way around).
  const contactMat = new THREE.MeshPhysicalMaterial({ color: 0xcda44a, roughness: 0.35, metalness: 1 });
  const contactR = (throatR + outerR) / 2;
  for (let i = 0; i < contactCount; i++) {
    const theta = -Math.PI * 0.62 + (i / Math.max(1, contactCount - 1)) * Math.PI * 0.5; // an arc at the bottom
    const pad = new THREE.Mesh(new THREE.BoxGeometry(3, 1.4, 0.6), contactMat);
    pad.position.set(Math.cos(theta) * contactR, Math.sin(theta) * contactR, proudZ + 1.7);
    group.add(pad);
  }

  return tagged(group, 'mount', 'Lens mount');
}

/** The lens-release button -- a small chamfered cylinder set into the body shell beside the mount. */
export function buildReleaseButton(lookMod: typeof look): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(4.2, 4.2, 2.4, 24);
  const mat = new THREE.MeshPhysicalMaterial({ color: 0xe4e4e4, roughness: 0.5, metalness: 0.1 });
  const btn = new THREE.Mesh(geo, mat);
  return tagged(btn, 'lens-release', 'Lens release button');
}

/** A strap lug: a small metal D-ring eyelet. */
export function buildStrapLug(lookMod: typeof look): THREE.Group {
  const group = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 3, 16), lookMod.anodizedBarrelMaterial(true));
  base.rotation.x = Math.PI / 2;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(3.2, 0.7, 8, 20), lookMod.anodizedBarrelMaterial(true));
  group.add(base, ring);
  return tagged(group, 'strap-lug', 'Strap lug');
}

/** A rear LCD screen slab, flush-mounted. */
export function buildRearScreen(width: number, height: number, lookMod: typeof look): THREE.Group {
  const group = new THREE.Group();
  const bezel = new THREE.Mesh(roundedBox(width + 4, height + 4, 2, 1), lookMod.matteInternalMaterial());
  const screenMat = new THREE.MeshPhysicalMaterial({ color: 0x05070c, roughness: 0.15, metalness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.1 });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(width, height), screenMat);
  screen.position.z = 1.05;
  group.add(bezel, screen);
  return tagged(group, 'rear-screen', 'Rear screen');
}

/** A single top-plate dial: a knurled cylinder with detents, tagged and anchored for selection. */
export function buildDial(radius: number, height: number, lookMod: typeof look, component: string, label: string): THREE.Group {
  const group = new THREE.Group();
  const mat = knurledDialMaterial(lookMod);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 40), mat);
  group.add(body);
  addDetents(group, radius + 0.3, 24, 1.1, height * 0.7, 0, mat);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.85, radius * 0.85, 0.6, 40), lookMod.anodizedBarrelMaterial(false));
  cap.position.y = height / 2 + 0.3;
  group.add(cap);
  return tagged(group, component, label);
}

/** Silicon die + visible pixel-array region + CFA hint, per docs/PANE.md: "the sensor package with its filter
 *  stack and a visible pixel array" and the build brief's "sensor package with the silicon die and a visible
 *  pixel-array region." Built once, shared by both bodies. `activeW/H` are the true active area (mm); the package
 *  substrate is somewhat larger. Sits with its front (photodiode) face at local z = frontZ (caller positions it
 *  so that face lands at world z = 0, the sensor plane). */
export function buildSensorPackage(activeW: number, activeH: number, lookMod: typeof look): THREE.Group {
  const group = new THREE.Group();
  const pkgW = activeW + 14;
  const pkgH = activeH + 14;
  const pkgDepth = 3;

  const substrate = new THREE.Mesh(roundedBox(pkgW, pkgH, pkgDepth, 0.6, 3), lookMod.siliconMaterial());
  substrate.position.z = -pkgDepth / 2 - 0.05;
  group.add(tagged(substrate, 'sensor-package', 'Sensor package'));

  // The visible pixel array: a thin plane with a fine procedural grid texture standing in for individual
  // photosites at this scale (LOOK.md's fill-factor/microlens detail is rendered properly at loupe scale inside
  // the sensor set piece; here it only needs to read as "an array," per the build brief's "visible pixel-array
  // region").
  let gridTex: THREE.CanvasTexture | null = null;
  if (hasDom) {
    const gridCanvas = document.createElement('canvas');
    gridCanvas.width = 256;
    gridCanvas.height = 256;
    const gctx = gridCanvas.getContext('2d')!;
    gctx.fillStyle = '#182130';
    gctx.fillRect(0, 0, 256, 256);
    gctx.strokeStyle = 'rgba(180,200,230,0.35)';
    gctx.lineWidth = 1;
    const cell = 8;
    for (let x = 0; x <= 256; x += cell) {
      gctx.beginPath();
      gctx.moveTo(x, 0);
      gctx.lineTo(x, 256);
      gctx.stroke();
    }
    for (let y = 0; y <= 256; y += cell) {
      gctx.beginPath();
      gctx.moveTo(0, y);
      gctx.lineTo(256, y);
      gctx.stroke();
    }
    gridTex = new THREE.CanvasTexture(gridCanvas);
    gridTex.wrapS = THREE.RepeatWrapping;
    gridTex.wrapT = THREE.RepeatWrapping;
    gridTex.repeat.set(activeW / 3, activeH / 3);
  }
  const pixelMat = new THREE.MeshPhysicalMaterial({
    color: gridTex ? 0xffffff : 0x182130,
    map: gridTex,
    roughness: 0.3,
    metalness: 0.4,
    iridescence: 0.5,
    iridescenceThicknessRange: [200, 700],
  });
  const pixelArray = new THREE.Mesh(new THREE.PlaneGeometry(activeW, activeH), pixelMat);
  pixelArray.position.z = 0.02;
  group.add(tagged(pixelArray, 'pixelArray', 'Pixel array'));

  return tagged(group, 'sensorPackage', 'Sensor package');
}

/** The filter stack (IR-cut/AA/cover glass) directly in front of the sensor, per docs/PANE.md/the build brief:
 *  "the filter stack thickness in front of it" -- from data/hardware/body.json's sensorStack (thicknessMm,
 *  index). Front face at local z=0, extends toward -z (toward the lens) by `thicknessMm`. */
export function buildFilterStack(activeW: number, activeH: number, thicknessMm: number, lookMod: typeof look): THREE.Mesh {
  const w = activeW + 6;
  const h = activeH + 6;
  const geo = new THREE.BoxGeometry(w, h, thicknessMm);
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xdfe8f2,
    transmission: 0.94,
    roughness: 0.04,
    ior: 1.52,
    thickness: thicknessMm,
    attenuationColor: 0x8fb0e8,
    attenuationDistance: 40,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.z = -thicknessMm / 2;
  return tagged(mesh, 'filterStack', 'Sensor filter stack');
}

/** Removes a quarter-wedge from every descendant's visible extent for the cutaway option -- a `THREE.ClippingGroup`
 *  (the WebGPURenderer/TSL pipeline's own scene-graph clipping mechanism; per-material `.clippingPlanes` arrays,
 *  the older WebGLRenderer convention, are not read by the node-material pipeline at all -- see
 *  node_modules/three/src/objects/ClippingGroup.js's own doc comment). `clipIntersection: true` discards only
 *  where BOTH planes' half-spaces overlap, i.e. x > cornerX AND y > cornerY -- a top-front-right quadrant of the
 *  shell's cross-section, the same 90-degree "quarter removed" convention src/pieces/lens/geometry.ts's
 *  wedgeAngles() already uses for the lens barrel. Add the shell/mirror-box meshes as children of the returned
 *  group (instead of the body group directly); toggle `.enabled` for the cutaway option. `cornerX/cornerY` are in
 *  the group's local space (== world space here, since body groups sit at the scene origin) -- pass the shell's
 *  own center so the wedge opens from the middle of the body, exposing the mirror box/sensor stack inside. */
export function makeCutawayGroup(cornerX: number, cornerY: number): THREE.ClippingGroup {
  const group = new THREE.ClippingGroup();
  group.clippingPlanes = [
    new THREE.Plane(new THREE.Vector3(-1, 0, 0), cornerX),
    new THREE.Plane(new THREE.Vector3(0, -1, 0), cornerY),
  ];
  group.clipIntersection = true;
  group.enabled = false;
  return group;
}
