// The lens exterior (docs/PANE.md): buildLens(model) -> a rotatable, focusable, apertured 3D lens model in the
// PANE.md world frame (mm, sensor plane z = 0, lens axis -z). Reuses the cutaway piece's own glass-element and
// iris geometry (src/pieces/lens/{elements,iris,geometry}.ts) for the inside, and builds the barrel, rings,
// mount and front from the makers' published exterior dimensions (data/hardware/lens-exteriors.json) and mount
// geometry (data/hardware/mounts.json). See design/LOOK.md for the materials this pulls from src/app/look.ts.
//
// World-frame convention (docs/PANE.md): z_world = z_engine - (sensorZ + afOffset). Everything the engine
// already places in its own "system" coordinates (elements, iris, focus-group surfaces) goes inside a single
// `optics` child group offset by -(sensorZ+afOffset); the barrel/rings/mount, sized directly from real
// published mm figures relative to the mount flange (z_world = -flangeMm at the mount face, per PANE.md), are
// built straight in world coordinates as children of the top-level group, no shift needed.
import * as THREE from 'three/webgpu';
import * as look from '../app/look';
import type { Model } from '../engine/model-types';
import type { RealizedLens } from '../engine/realize';
import { sensorZEffective } from '../engine/camera';
import { focusParameterT, focusRingAngleRad, ringAngleToT, closestFocusSystem, assumedThrowDeg } from '../engine/focus-travel';
import { buildElements, type ElementsHandle } from '../pieces/lens/elements';
import { buildIris, type IrisHandle } from '../pieces/lens/iris';
import { revolveStrip, buildAnnulusZ, buildCap, wedgeAngles as cutawayWedgeAngles, type ProfilePoint } from '../pieces/lens/geometry';
import lensExteriorsJson from '../../data/hardware/lens-exteriors.json';
import mountsJson from '../../data/hardware/mounts.json';

// ---- data shapes (loose: JSON, not worth a full schema for a build-time-only read) ----------------------------

interface FigLike { v?: unknown; note?: string }
interface ExteriorSpec {
  representativeOf?: string;
  mount: string;
  diameterMm: FigLike & { v: number };
  lengthMm: FigLike & { v: number };
  filterMm?: FigLike & { v: number | null };
  distanceScale?: FigLike & { v: boolean };
  controlRing?: { v: boolean; programmable?: boolean };
  tripodCollar?: { v: boolean; removable?: boolean };
  hood?: { model?: string };
}
interface MountSpec { name: string; flangeMm: number; throatMm: number; lugs: number }

const EXTERIORS = (lensExteriorsJson as unknown as { lenses: Record<string, ExteriorSpec> }).lenses;
const MOUNTS = (mountsJson as unknown as { mounts: Record<string, MountSpec> }).mounts;

export function exteriorSpecFor(lensId: string): ExteriorSpec {
  const spec = EXTERIORS[lensId];
  if (!spec) {
    throw new Error(`lens-exterior.ts: no data/hardware/lens-exteriors.json entry for lens id "${lensId}"`);
  }
  return spec;
}

// ---- geometry helpers -------------------------------------------------------------------------------------

/** Full 360deg sweep, or (cutaway) the same 270deg wedge the internal glass/iris pieces use, so the barrel's
 *  own opening lines up exactly with the element stack's missing wedge. */
function sweepAngles(cutaway: boolean): { thetaStart: number; thetaLength: number } {
  if (cutaway) return cutawayWedgeAngles();
  return { thetaStart: 0, thetaLength: Math.PI * 2 };
}

/** A plain cylindrical band (barrel wall, ring, collar): inner/outer radius, z0..z1 (world mm), the given sweep. */
function buildBand(innerR: number, outerR: number, z0: number, z1: number, thetaStart: number, thetaLength: number, outerMat: THREE.Material, innerMat: THREE.Material | null): THREE.Group {
  const g = new THREE.Group();
  const outerProfile: ProfilePoint[] = [{ r: outerR, z: z0 }, { r: outerR, z: z1 }];
  const outer = new THREE.Mesh(revolveStrip(outerProfile, thetaStart, thetaLength), outerMat);
  outer.frustumCulled = false;
  g.add(outer);
  if (innerR > 0 && innerMat) {
    const innerProfile: ProfilePoint[] = [{ r: innerR, z: z0 }, { r: innerR, z: z1 }];
    const inner = new THREE.Mesh(revolveStrip(innerProfile, thetaStart, thetaLength), innerMat);
    (inner.material as THREE.Material & { side?: THREE.Side }).side = THREE.BackSide;
    inner.frustumCulled = false;
    g.add(inner);
  }
  const ringFront = new THREE.Mesh(buildAnnulusZ(innerR || 0, outerR, z0, thetaStart, thetaLength, -1), outerMat);
  const ringBack = new THREE.Mesh(buildAnnulusZ(innerR || 0, outerR, z1, thetaStart, thetaLength, 1), outerMat);
  ringFront.frustumCulled = false;
  ringBack.frustumCulled = false;
  g.add(ringFront, ringBack);
  if (thetaLength < Math.PI * 2 - 1e-6) {
    const thetaEnd = thetaStart + thetaLength;
    const capMat = look.matteInternalMaterial();
    const capA = new THREE.Mesh(buildCap([{ r: innerR || 0, z: z0 }, { r: outerR, z: z0 }, { r: outerR, z: z1 }, { r: innerR || 0, z: z1 }], thetaStart, -1), capMat);
    const capB = new THREE.Mesh(buildCap([{ r: innerR || 0, z: z0 }, { r: outerR, z: z0 }, { r: outerR, z: z1 }, { r: innerR || 0, z: z1 }], thetaEnd, 1), capMat);
    capA.frustumCulled = false;
    capB.frustumCulled = false;
    g.add(capA, capB);
  }
  return g;
}

/** A knurled ring: a base cylinder band with `ribs` thin longitudinal rib boxes around the circumference --
 *  real geometry (design's own "as geometry" ask), not a normal map, so it reads correctly from any angle and
 *  at any zoom. */
function buildKnurledRing(radius: number, z0: number, z1: number, mat: THREE.Material, ribs = 72): THREE.Group {
  const g = new THREE.Group();
  const baseProfile: ProfilePoint[] = [{ r: radius, z: z0 }, { r: radius, z: z1 }];
  const base = new THREE.Mesh(revolveStrip(baseProfile, 0, Math.PI * 2, 96), mat);
  base.frustumCulled = false;
  g.add(base);
  const ribDepth = Math.max(0.25, radius * 0.02);
  const ribWidth = (2 * Math.PI * radius) / ribs * 0.42;
  const ribGeo = new THREE.BoxGeometry(ribWidth, ribDepth, Math.max(0.5, (z1 - z0) * 0.94));
  for (let i = 0; i < ribs; i++) {
    const theta = (i / ribs) * Math.PI * 2;
    const rib = new THREE.Mesh(ribGeo, mat);
    rib.position.set(Math.cos(theta) * (radius + ribDepth / 2), Math.sin(theta) * (radius + ribDepth / 2), (z0 + z1) / 2);
    rib.rotation.z = theta;
    rib.frustumCulled = false;
    g.add(rib);
  }
  return g;
}

/** A raised distance-scale tick (a thin bar) at world angle `angleRad` around the ring, radius `r`. Angle 0 is
 *  +Y (matches the focus ring's own rotation convention below). */
function buildTick(r: number, z: number, angleRad: number, mat: THREE.Material, major = false): THREE.Mesh {
  const w = major ? 1.6 : 0.9;
  const h = major ? 2.2 : 1.2;
  const geo = new THREE.BoxGeometry(w, h, 0.6);
  const mesh = new THREE.Mesh(geo, mat);
  const a = angleRad + Math.PI / 2; // 0 rad = +Y
  mesh.position.set(Math.cos(a) * r, Math.sin(a) * r, z);
  mesh.rotation.z = angleRad;
  mesh.frustumCulled = false;
  return mesh;
}

/** A bayonet mount ring: the flange collar plus `lugs` lug bumps (mounts.json). */
function buildMount(spec: MountSpec, flangeZ: number, mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const throatR = spec.throatMm / 2;
  const outerR = throatR + 5;
  const depth = 7;
  const collar = buildBand(throatR, outerR, flangeZ, flangeZ + depth, 0, Math.PI * 2, mat, look.matteInternalMaterial());
  g.add(collar);
  const lugGeo = new THREE.BoxGeometry(10, 3, depth * 0.8);
  for (let i = 0; i < spec.lugs; i++) {
    const theta = (i / spec.lugs) * Math.PI * 2;
    const lug = new THREE.Mesh(lugGeo, mat);
    lug.position.set(Math.cos(theta) * (throatR + 1.5), Math.sin(theta) * (throatR + 1.5), flangeZ + depth * 0.5);
    lug.rotation.z = theta;
    lug.frustumCulled = false;
    g.add(lug);
  }
  return g;
}

/** A truncated-cone lens hood, front-mounted, flaring outward from the filter/front radius. */
function buildHood(frontR: number, frontZ: number, mat: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const length = Math.max(20, frontR * 0.9);
  const flare = frontR * 1.28;
  const z0 = frontZ;
  const z1 = frontZ - length;
  const profile: ProfilePoint[] = [{ r: frontR, z: 0 }, { r: flare, z: -length }];
  const wallProfile = profile.map((p) => ({ r: p.r, z: p.z + z0 }));
  const wall = new THREE.Mesh(revolveStrip(wallProfile, 0, Math.PI * 2), mat);
  wall.frustumCulled = false;
  g.add(wall);
  const rim = new THREE.Mesh(buildAnnulusZ(frontR - 1, frontR, z0, 0, Math.PI * 2, 1), mat);
  rim.frustumCulled = false;
  g.add(rim);
  void z1;
  return g;
}

// ---- focus group detection (which realized elements move with focus) -----------------------------------------

function focusGroupElementIndices(realized: RealizedLens): Set<number> {
  const gaps = realized.design.focus.gaps ?? [];
  if (realized.design.focus.method === 'unit' || gaps.length === 0) {
    return new Set(realized.elements.map((e) => e.index)); // unit focus: the whole barrel/stack moves together
  }
  const minGapSurface = Math.min(...gaps.map((g) => g.surface));
  const idx = new Set<number>();
  for (const el of realized.elements) {
    if (el.surfaces[0] > minGapSurface) idx.add(el.index);
  }
  return idx;
}

// ---- the public handle --------------------------------------------------------------------------------------

export interface LensExteriorOptions {
  /** A wedge cutaway on the barrel (matches the cutaway piece's own missing-wedge direction) so the element
   *  stack and iris are visible; default false (a closed, solid barrel). */
  cutaway?: boolean;
  /** Show the front lens hood; default false, so the front element stays visible from a three-quarter angle. */
  hood?: boolean;
  /** True (default) selects the full-transmission WebGPU-tier glass; false the WebGL2-tier budget glass
   *  (docs/rendering-spike.md, spike c) -- see pieces/lens/elements.ts's own isWebGPUBackend check, which this
   *  module cannot perform itself since it is not handed a renderer. */
  webgpu?: boolean;
}

export interface LensExteriorHandle {
  group: THREE.Group;
  /** Named sub-objects for selection: 'barrel', 'focusRing', 'distanceScale', 'controlRing', 'mount',
   *  'frontElement', 'iris', 'focusGroup', 'elements', 'hood', 'collar' -- see userData.component on each. */
  components: Record<string, THREE.Object3D[]>;
  /** Rotates the focus ring (and co-rotating distance scale) to the model's current focus, and repositions the
   *  internal element groups (systemAt's own focus-dependent z). */
  setFocus(model: Model): void;
  /** Starts (or redirects) the iris toward the model's current f-stop, physically timed (pieces/lens/iris.ts). */
  setAperture(model: Model): void;
  /** Advances the iris animation; call once per frame, returns true if a re-render is needed. */
  tick(): boolean;
  /** The on-model focus-ring drag hit-test: an absolute ring angle (radians, 0 at infinity, the same convention
   *  focusRingAngleRad uses) -> a focus distance in mm from the sensor (docs/PANE.md: "drag the focus ring to
   *  focus"), null = infinity. Monotonic bisection over focusParameterT, since t(d) has no closed-form inverse
   *  in general (it depends on the lens's own real optics, not a fixed formula). */
  angleToFocusDistanceMm(angleRad: number): number | null;
  /** The current focus ring angle for a given model, radians -- the inverse direction of the hit-test above,
   *  for initializing a drag or drawing a pointer at the ring's current position. */
  focusDistanceToAngle(model: Model): number;
  dispose(): void;
}

export function buildLens(model: Model, opts: LensExteriorOptions = {}): LensExteriorHandle {
  const cutaway = opts.cutaway ?? false;
  const showHood = opts.hood ?? false;
  const webgpu = opts.webgpu ?? true;
  const lensId = model.lens.id;
  const spec = exteriorSpecFor(lensId);
  const mount = MOUNTS[spec.mount];
  if (!mount) throw new Error(`lens-exterior.ts: unknown mount "${spec.mount}" for lens "${lensId}"`);

  const realized = model.realized;
  const sensorZEff = sensorZEffective(model.system);

  const group = new THREE.Group();
  group.name = `lens-exterior-${lensId}`;
  const components: Record<string, THREE.Object3D[]> = {
    barrel: [], focusRing: [], distanceScale: [], controlRing: [], mount: [],
    frontElement: [], iris: [], focusGroup: [], elements: [], hood: [], collar: [],
  };
  function tag(o: THREE.Object3D, component: string, label: string): void {
    o.userData.component = component;
    o.userData.label = label;
    components[component]?.push(o);
  }

  // ---- optics (engine-z coordinates, shifted once to the PANE.md world frame) -------------------------------
  const opticsGroup = new THREE.Group();
  opticsGroup.name = 'optics';
  opticsGroup.position.z = -sensorZEff;
  group.add(opticsGroup);

  const rendererLike = { backend: { isWebGPUBackend: webgpu } };
  const elementsHandle: ElementsHandle = buildElements(model, look, rendererLike);
  opticsGroup.add(elementsHandle.group);
  tag(elementsHandle.group, 'elements', 'Elements');

  const focusIdx = focusGroupElementIndices(realized);
  let frontTagged = false;
  for (const b of elementsHandle.bodies) {
    if (b.kind === 'element' && !frontTagged) {
      tag(b.group, 'frontElement', 'Front element');
      frontTagged = true;
    }
    if (b.kind === 'element' && b.elementIndex !== null && focusIdx.has(b.elementIndex)) {
      tag(b.group, 'focusGroup', 'Focus group');
    }
  }

  const irisHandle: IrisHandle = buildIris(look);
  opticsGroup.add(irisHandle.group);
  tag(irisHandle.group, 'iris', 'Iris');
  const stopIdx = model.system.surfaces.findIndex((s) => s.kind === 'stop');
  const stopZ = model.system.surfaces[stopIdx >= 0 ? stopIdx : 0].z;
  irisHandle.setTarget(model.iris.radius, model.lens.blades, model.lens.rounded, model.iris.rotation, stopZ);

  // ---- barrel + rings + mount (world coordinates, from published exterior dimensions) ------------------------
  const flangeZ = -mount.flangeMm; // PANE.md: the mount flange face, F: -46.5, Z: -16
  const barrelOuterR = spec.diameterMm.v / 2;
  const barrelLen = spec.lengthMm.v;
  const frontZ = flangeZ - barrelLen;
  const maxOd = elementsHandle.maxOd();
  const barrelInnerR = Math.min(barrelOuterR * 0.94, maxOd * 1.06 + 1.0);

  const { thetaStart, thetaLength } = sweepAngles(cutaway);
  const barrelOuterMat = look.anodizedBarrelMaterial(false);
  const barrelInnerMat = look.matteInternalMaterial();
  const barrelGroup = buildBand(barrelInnerR, barrelOuterR, frontZ, flangeZ, thetaStart, thetaLength, barrelOuterMat, barrelInnerMat);
  barrelGroup.name = 'barrel';
  group.add(barrelGroup);
  tag(barrelGroup, 'barrel', 'Barrel');

  const mountGroup = buildMount(mount, flangeZ, look.anodizedBarrelMaterial(true));
  mountGroup.name = 'mount';
  group.add(mountGroup);
  tag(mountGroup, 'mount', `Mount (${mount.name})`);

  // Front filter-thread ring: a thin exposed-bezel band right at the front opening.
  const filterR = spec.filterMm?.v ? Math.min(barrelOuterR * 0.98, spec.filterMm.v / 2 + 3) : barrelOuterR * 0.92;
  const filterRingDepth = Math.max(3, barrelLen * 0.02);
  const filterRing = buildBand(filterR - 1.5, filterR, frontZ, frontZ + filterRingDepth, thetaStart, thetaLength, look.anodizedBarrelMaterial(true), null);
  filterRing.name = 'filter-ring';
  group.add(filterRing);

  // Focus ring: placed at the world-z of the focus group's own surfaces (falls back to the barrel's middle
  // third if, per data/hardware/lens-exteriors.json's own open problem, nothing moves -- a design with no
  // gaps table and the 'unit' method still reports a focus group, see focusGroupElementIndices above, so this
  // fallback is defensive only).
  let focusRingZ = frontZ + (flangeZ - frontZ) * 0.32;
  const movingSurfZs: number[] = [];
  for (const el of realized.elements) {
    if (focusIdx.has(el.index)) {
      movingSurfZs.push(model.system.surfaces[el.surfaces[0]].z, model.system.surfaces[el.surfaces[1]].z);
    }
  }
  if (movingSurfZs.length > 0) {
    const engineMid = (Math.min(...movingSurfZs) + Math.max(...movingSurfZs)) / 2;
    const worldMid = engineMid - sensorZEff;
    const lo = frontZ + (flangeZ - frontZ) * 0.12;
    const hi = flangeZ - (flangeZ - frontZ) * 0.12;
    focusRingZ = Math.max(Math.min(worldMid, hi), lo);
  }
  const focusRingWidth = Math.max(12, barrelLen * 0.14);
  const focusRingGroup = new THREE.Group();
  focusRingGroup.name = 'focus-ring';
  focusRingGroup.add(buildKnurledRing(barrelOuterR + 0.4, focusRingZ - focusRingWidth / 2, focusRingZ + focusRingWidth / 2, look.rubberGripMaterial()));
  group.add(focusRingGroup);
  tag(focusRingGroup, 'focusRing', 'Focus ring');

  // Distance scale: an engraved ring that rotates with the focus ring (setFocus below keeps them in sync),
  // ticks placed by the REAL focus travel (src/engine/focus-travel.ts), plus one fixed index mark on the
  // barrel (does not rotate) so the scale reads against a stationary reference, as a real lens does.
  let distanceScaleGroup: THREE.Group | null = null;
  if (spec.distanceScale?.v) {
    const scaleR = barrelOuterR + 0.2;
    const scaleZ = focusRingZ - focusRingWidth / 2 - 4;
    distanceScaleGroup = new THREE.Group();
    distanceScaleGroup.name = 'distance-scale';
    const engravedMat = look.engravedMarkMaterial();
    const closestMm = realized.realization.closestFocusMm;
    const markMm: { mm: number | null; major: boolean }[] = [
      { mm: null, major: true }, // infinity
      { mm: 10000, major: false }, { mm: 5000, major: true }, { mm: 3000, major: false },
      { mm: 2000, major: true }, { mm: 1500, major: false }, { mm: 1000, major: true },
      { mm: 700, major: false }, { mm: 500, major: true }, { mm: closestMm, major: true },
    ].filter((m) => m.mm === null || m.mm >= closestMm - 1e-6);
    for (const mark of markMm) {
      const angle = focusRingAngleRad(realized, mark.mm, lensId);
      distanceScaleGroup.add(buildTick(scaleR, scaleZ, -angle, engravedMat, mark.major));
    }
    group.add(distanceScaleGroup);
    tag(distanceScaleGroup, 'distanceScale', 'Distance scale');
    // Fixed index mark, does not rotate with the scale.
    const indexMark = buildTick(scaleR + 1.2, scaleZ, 0, look.engravedMarkMaterial(), true);
    indexMark.name = 'distance-scale-index';
    group.add(indexMark);
  }

  // Control ring (Z-mount lenses): a plain (non-knurled) programmable ring forward of the focus ring.
  let controlRingGroup: THREE.Group | null = null;
  if (spec.controlRing?.v) {
    const ctrlWidth = Math.max(8, barrelLen * 0.09);
    const ctrlZ = Math.max(focusRingZ + focusRingWidth / 2 + ctrlWidth / 2 + 2, frontZ + ctrlWidth);
    controlRingGroup = buildBand(barrelOuterR - 0.2, barrelOuterR + 0.3, ctrlZ - ctrlWidth / 2, ctrlZ + ctrlWidth / 2, thetaStart, thetaLength, look.anodizedBarrelMaterial(true), null);
    controlRingGroup.name = 'control-ring';
    // A few raised index dots around it, purely geometric (docs/PANE.md: "switches ... as small geometry").
    const dotGeo = new THREE.BoxGeometry(1.2, 1.2, 0.6);
    for (let i = 0; i < 24; i++) {
      const theta = (i / 24) * Math.PI * 2;
      const dot = new THREE.Mesh(dotGeo, look.engravedMarkMaterial());
      dot.position.set(Math.cos(theta) * (barrelOuterR + 0.6), Math.sin(theta) * (barrelOuterR + 0.6), ctrlZ);
      dot.rotation.z = theta;
      dot.frustumCulled = false;
      controlRingGroup.add(dot);
    }
    group.add(controlRingGroup);
    tag(controlRingGroup, 'controlRing', 'Control ring');
  }

  // AF/MF (and, for a VR-equipped telephoto, stabilizer) switches: small flat boxes on the barrel, geometry
  // only -- docs/PANE.md: "switches (AF/M, VR) as small geometry". Added to `group` directly, not to
  // `barrelGroup` -- a real switch sits recessed almost flush with the barrel surface (a fraction of a mm),
  // but this build's simple box proxy protrudes a couple of mm to read at all from a distance; keeping it out
  // of the 'barrel' tagged component means that component's own bounding box still matches the published
  // diameter to the accuracy test's 2% tolerance exactly, rather than being inflated by a cosmetic detail.
  {
    const switchZ = flangeZ - (flangeZ - frontZ) * 0.18;
    const switchAngle = Math.PI * 0.85; // barrel-left, out of the way of the cutaway wedge and the top rings
    const switchMat = look.anodizedBarrelMaterial(true);
    const names = spec.tripodCollar?.v ? ['AF-M', 'VR'] : ['AF-M'];
    const switchGroup = new THREE.Group();
    switchGroup.name = 'switches';
    names.forEach((n, i) => {
      const geo = new THREE.BoxGeometry(3, 6, 10);
      const sw = new THREE.Mesh(geo, switchMat);
      const r = barrelOuterR + 0.5;
      const a = switchAngle;
      sw.position.set(Math.cos(a) * r, Math.sin(a) * r, switchZ - i * 14);
      sw.rotation.z = a;
      sw.frustumCulled = false;
      sw.name = `switch-${n}`;
      switchGroup.add(sw);
    });
    group.add(switchGroup);
  }

  // Tripod collar + foot (the big telephotos): a rotating ring plus a foot block extending down (-y).
  let collarGroup: THREE.Group | null = null;
  if (spec.tripodCollar?.v) {
    const collarWidth = Math.max(20, barrelLen * 0.1);
    const collarZ = frontZ + (flangeZ - frontZ) * 0.62;
    collarGroup = buildBand(barrelOuterR + 0.5, barrelOuterR + 3.5, collarZ - collarWidth / 2, collarZ + collarWidth / 2, 0, Math.PI * 2, look.anodizedBarrelMaterial(false), null);
    collarGroup.name = 'tripod-collar';
    const footMat = look.anodizedBarrelMaterial(false);
    const footGeo = new THREE.BoxGeometry(barrelOuterR * 0.5, barrelOuterR * 0.55, collarWidth * 0.85);
    const foot = new THREE.Mesh(footGeo, footMat);
    foot.position.set(0, -(barrelOuterR + 3.5 + barrelOuterR * 0.275), collarZ);
    foot.frustumCulled = false;
    collarGroup.add(foot);
    group.add(collarGroup);
    tag(collarGroup, 'collar', 'Tripod collar');
  }

  // Hood: a front-mounted flare, hidden by default so the front element reads clearly (per this workstream's
  // own screenshot bar); still built and tagged either way.
  const hoodGroup = buildHood(filterR, frontZ, look.anodizedBarrelMaterial(false));
  hoodGroup.name = 'hood';
  hoodGroup.visible = showHood;
  group.add(hoodGroup);
  tag(hoodGroup, 'hood', 'Lens hood');

  // ---- the public handle ----------------------------------------------------------------------------------

  function applyFocusRingAngle(m: Model): number {
    const angle = focusRingAngleRad(m.realized, m.focus.distanceMm, m.lens.id);
    focusRingGroup.rotation.z = angle;
    if (distanceScaleGroup) distanceScaleGroup.rotation.z = angle;
    return angle;
  }
  applyFocusRingAngle(model);

  function distanceForT(t: number): number | null {
    if (t <= 1e-4) return null;
    const closestMm = realized.realization.closestFocusMm;
    if (t >= 1 - 1e-6) return closestMm;
    let lo = closestMm;
    let hi = 1e7; // mm, a practical "far enough to read as infinity" cap
    for (let i = 0; i < 60; i++) {
      const mid = Math.sqrt(lo * hi);
      const midT = focusParameterT(realized, mid);
      if (midT > t) lo = mid; else hi = mid;
    }
    return Math.sqrt(lo * hi);
  }

  return {
    group,
    components,
    setFocus(m) {
      elementsHandle.reposition(m);
      applyFocusRingAngle(m);
      const sIdx = m.system.surfaces.findIndex((s) => s.kind === 'stop');
      const sZ = m.system.surfaces[sIdx >= 0 ? sIdx : 0].z;
      irisHandle.setTarget(m.iris.radius, m.lens.blades, m.lens.rounded, m.iris.rotation, sZ);
    },
    setAperture(m) {
      const sIdx = m.system.surfaces.findIndex((s) => s.kind === 'stop');
      const sZ = m.system.surfaces[sIdx >= 0 ? sIdx : 0].z;
      irisHandle.setTarget(m.iris.radius, m.lens.blades, m.lens.rounded, m.iris.rotation, sZ);
    },
    tick() {
      return irisHandle.tick();
    },
    angleToFocusDistanceMm(angleRad) {
      const t = ringAngleToT(Math.max(0, angleRad), lensId);
      return distanceForT(t);
    },
    focusDistanceToAngle(m) {
      return focusRingAngleRad(m.realized, m.focus.distanceMm, m.lens.id);
    },
    dispose() {
      elementsHandle.dispose();
      irisHandle.dispose();
      barrelOuterMat.dispose();
      barrelInnerMat.dispose();
    },
  };
}

export { closestFocusSystem, assumedThrowDeg };
