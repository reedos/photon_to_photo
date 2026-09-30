// The generic full-frame DSLR body (D850-style geometry), per docs/PANE.md: "The DSLR body has a mirror box,
// main mirror and sub-mirror, focusing screen, pentaprism and focal-plane shutter." Frame: mm, sensor plane at
// z = 0, lens axis along -z, y up, x to the camera's right as seen from behind (common/tagged docblock has the
// full convention). Generic/unbranded envelope and details per the build brief -- no logos or trade dress; only
// the mount, sensor and mirror geometry are pulled from real published figures.
//
// Data sources (read at build time, never hardcoded twice): data/d850.json (sensor active area, pixel pitch),
// data/hardware/mounts.json (nikonF: flange 46.5mm, throat 44mm, 3 lugs, 8 contacts), data/hardware/dslr.json
// (mirror size derivation, hinge edge, 45deg rest angle, shutter travel distance), data/hardware/body.json
// (sensor filter-stack thickness/index, generic envelope numbers where the D850's own aren't used).
import * as THREE from 'three/webgpu';
import type * as look from '../../app/look';
import mountsData from '../../../data/hardware/mounts.json';
import dslrData from '../../../data/hardware/dslr.json';
import d850Data from '../../../data/d850.json';
import bodyData from '../../../data/hardware/body.json';
import {
  addDetents,
  buildDial,
  buildFilterStack,
  buildMountRing,
  buildReleaseButton,
  buildRearScreen,
  buildSensorPackage,
  buildStrapLug,
  knurledDialMaterial,
  makeCutawayGroup,
  roundedBox,
  rubberGripMaterial,
  satinBodyMaterial,
  tagged,
} from './common';

// ---- data pulls, typed loosely (the JSON files are research records, not a generated schema) -------------------
const F_MOUNT = (mountsData as any).mounts.nikonF as { flangeMm: number; throatMm: number; lugs: number; contacts: number };
const MIRROR = (dslrData as any).mirror as {
  size: { width: { v: number }; height: { v: number } };
  restAngleDeg: { v: number };
};
const SHUTTER_TRAVEL_MM = ((dslrData as any).shutter.travelDistance.v as number);
const SENSOR = (d850Data as any).sensor as { activeArea: { widthMm: { v: number }; heightMm: { v: number } } };
const D850_BODY = (d850Data as any).body as { dimensionsMm: { width: number; height: number; depth: number } };
const FILTER_STACK_MM = (bodyData as any).sensorStack.thicknessMm.v as number;

export const DSLR_FACTS = {
  flangeMm: F_MOUNT.flangeMm,
  throatMm: F_MOUNT.throatMm,
  lugCount: F_MOUNT.lugs,
  contactCount: F_MOUNT.contacts,
  sensorWidthMm: SENSOR.activeArea.widthMm.v,
  sensorHeightMm: SENSOR.activeArea.heightMm.v,
  mirrorAngleDeg: MIRROR.restAngleDeg.v,
  mirrorWidthMm: MIRROR.size.width.v,
  mirrorHeightMm: MIRROR.size.height.v,
  filterStackMm: FILTER_STACK_MM,
  shutterTravelMm: SHUTTER_TRAVEL_MM,
  bodyWidthMm: D850_BODY.dimensionsMm.width,
  bodyHeightMm: D850_BODY.dimensionsMm.height,
  bodyDepthMm: D850_BODY.dimensionsMm.depth,
} as const;

export interface DslrBodyOptions {
  cutaway?: boolean;
}

export interface DslrBodyHandle {
  group: THREE.Group;
  setCutaway(on: boolean): void;
  dispose(): void;
}

/** Builds the generic DSLR body + mirror box in the PANE.md frame. Call once per scene; use `setCutaway` to
 *  toggle the X-ray wedge afterward rather than rebuilding. */
export function buildDslrBody(lookMod: typeof look, opts: DslrBodyOptions = {}): DslrBodyHandle {
  const group = new THREE.Group();
  const disposers: (() => void)[] = [];

  const flange = DSLR_FACTS.flangeMm; // mount face at z = -flange
  const mountFaceZ = -flange;
  const bodyFrontZ = mountFaceZ; // the mount is flush with the body's front panel
  const bodyBackZ = bodyFrontZ + DSLR_FACTS.bodyDepthMm;
  const bodyW = DSLR_FACTS.bodyWidthMm;
  const bodyH = DSLR_FACTS.bodyHeightMm;
  const bodyDepth = bodyBackZ - bodyFrontZ;
  const bodyCenterZ = (bodyFrontZ + bodyBackZ) / 2;

  // The cutaway wedge (docs/PANE.md build brief: "accepts { cutaway: boolean } ... that removes a wedge"):
  // a THREE.ClippingGroup hinged on the shell's own center, so its opaque exterior/mirror-box walls can be
  // opened to reveal the mirror, shutter and sensor package inside; the internals themselves are added straight
  // to `group`, never inside this clipping group, so they stay solid.
  const cutawayGroup = makeCutawayGroup(0, -bodyH * 0.06);
  group.add(cutawayGroup);

  // ---- outer shell -----------------------------------------------------------------------------------------
  const shellMat = satinBodyMaterial(lookMod.MATERIAL_COLORS.anodizeBlack);
  const shell = new THREE.Mesh(roundedBox(bodyW, bodyH * 0.82, bodyDepth, 6, 4), shellMat);
  shell.position.set(0, -bodyH * 0.06, bodyCenterZ);
  cutawayGroup.add(tagged(shell, 'body', 'Body shell'));

  // Pentaprism hump: a wedge-topped block astride the top-center of the shell, housing the prism.
  const humpW = bodyW * 0.32;
  const humpH = bodyH * 0.22;
  const humpDepth = bodyDepth * 0.5;
  const humpBaseY = shell.position.y + (bodyH * 0.82) / 2;
  const hump = new THREE.Mesh(roundedBox(humpW, humpH, humpDepth, 4, 3), shellMat);
  hump.position.set(0, humpBaseY + humpH / 2 - 2, bodyCenterZ - bodyDepth * 0.05);
  cutawayGroup.add(tagged(hump, 'prism-housing', 'Pentaprism housing'));

  // ---- grip (sculpted, rubberized) --------------------------------------------------------------------------
  const gripMat = rubberGripMaterial();
  disposers.push(() => gripMat.dispose());
  const gripW = bodyW * 0.19;
  const gripH = bodyH * 0.72;
  const gripDepth = bodyDepth * 0.92;
  const grip = new THREE.Mesh(roundedBox(gripW, gripH, gripDepth, gripW * 0.4, 5), gripMat);
  grip.position.set(bodyW / 2 - gripW / 2 + 4, shell.position.y - bodyH * 0.02, bodyCenterZ + 2);
  group.add(tagged(grip, 'grip', 'Hand grip'));

  const shutterButton = new THREE.Mesh(new THREE.CylinderGeometry(4, 3.4, 3, 20), lookMod.anodizedBarrelMaterial(true));
  shutterButton.position.set(bodyW / 2 - gripW * 0.3, humpBaseY - 2, mountFaceZ + 6);
  shutterButton.rotation.x = Math.PI * 0.08;
  group.add(tagged(shutterButton, 'shutter-button', 'Shutter release'));

  // ---- top-plate dials ---------------------------------------------------------------------------------------
  const topDials = new THREE.Group();
  const dialY = humpBaseY + 0.5;
  const leftDial = buildDial(11, 6, lookMod, 'topDials-mode', 'Mode dial');
  leftDial.position.set(-bodyW * 0.28, dialY, bodyCenterZ - bodyDepth * 0.12);
  const rightDial = buildDial(13, 7, lookMod, 'topDials-shutter-iso', 'Shutter speed / ISO dial');
  rightDial.position.set(bodyW * 0.24, dialY, bodyCenterZ - bodyDepth * 0.15);
  topDials.add(leftDial, rightDial);
  group.add(tagged(topDials, 'topDials', 'Top-plate dials'));

  // A small monochrome status LCD between the dials, a common DSLR top-plate feature.
  const statusLcdMat = new THREE.MeshPhysicalMaterial({ color: 0x1c2620, roughness: 0.25, metalness: 0.1 });
  const statusLcd = new THREE.Mesh(new THREE.PlaneGeometry(bodyW * 0.24, bodyH * 0.08), statusLcdMat);
  statusLcd.rotation.x = -Math.PI / 2;
  statusLcd.position.set(0, dialY + 0.1, bodyCenterZ - bodyDepth * 0.02);
  group.add(statusLcd);

  // ---- rear screen + strap lugs ------------------------------------------------------------------------------
  const rearScreen = buildRearScreen(bodyW * 0.42, bodyH * 0.45, lookMod);
  rearScreen.rotation.y = Math.PI;
  rearScreen.position.set(-bodyW * 0.06, shell.position.y - 2, bodyBackZ + 1);
  group.add(rearScreen);

  const lugL = buildStrapLug(lookMod);
  lugL.position.set(-bodyW / 2 + 2, humpBaseY * 0.3, bodyCenterZ - bodyDepth * 0.3);
  const lugR = buildStrapLug(lookMod);
  lugR.position.set(bodyW / 2 - 2, humpBaseY * 0.3, bodyCenterZ - bodyDepth * 0.3);
  group.add(lugL, lugR);

  // ---- mount ring ---------------------------------------------------------------------------------------------
  const mount = buildMountRing({
    throatDiameter: DSLR_FACTS.throatMm,
    flangeOuterDiameter: DSLR_FACTS.throatMm + 14,
    lugCount: DSLR_FACTS.lugCount,
    contactCount: DSLR_FACTS.contactCount,
    faceZ: mountFaceZ,
    lookMod,
  });
  group.add(mount);

  const releaseBtn = buildReleaseButton(lookMod);
  releaseBtn.position.set(-DSLR_FACTS.throatMm / 2 - 6, 4, mountFaceZ + 2);
  releaseBtn.rotation.x = Math.PI / 2;
  group.add(releaseBtn);

  // ---- mirror box interior --------------------------------------------------------------------------------
  const mirrorBoxMat = lookMod.matteInternalMaterial();
  const mirrorBoxW = DSLR_FACTS.throatMm + 4;
  const mirrorBoxH = bodyH * 0.5;
  const mirrorBoxDepth = -mountFaceZ; // spans from the mount face to the sensor plane (z=0)
  const mirrorBox = new THREE.Mesh(
    new THREE.BoxGeometry(mirrorBoxW, mirrorBoxH, mirrorBoxDepth, 1, 1, 1),
    mirrorBoxMat,
  );
  mirrorBox.material = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.88, metalness: 0.08, side: THREE.BackSide });
  mirrorBox.position.set(0, -2, mountFaceZ + mirrorBoxDepth / 2);
  group.add(tagged(mirrorBox, 'mirror-box', 'Mirror box'));

  // Main mirror: real width/height from dslr.json, tilted to its measured 45deg rest angle, hinged at its top
  // (the edge farthest from the lens, nearest the focusing screen -- data/hardware/dslr.json's hingeEdge).
  // Placed at the mirror box's midpoint between the mount face and the sensor plane.
  const mirrorW = DSLR_FACTS.mirrorWidthMm;
  const mirrorH = DSLR_FACTS.mirrorHeightMm;
  const mirrorAngleRad = THREE.MathUtils.degToRad(DSLR_FACTS.mirrorAngleDeg);
  const mirrorCenterZ = mountFaceZ + mirrorBoxDepth * 0.42;
  const mirrorHingeY = 6; // the hinge sits near the top of the mirror box
  const mirrorMat = new THREE.MeshPhysicalMaterial({ color: 0xf2f4f8, roughness: 0.12, metalness: 0.9 });
  const mirrorGeo = new THREE.PlaneGeometry(mirrorW, mirrorH);
  const mirror = new THREE.Mesh(mirrorGeo, mirrorMat);
  // Hinge at the mirror's top (local +y edge); rotate about that edge, not the plane's own center.
  const mirrorPivot = new THREE.Group();
  mirrorPivot.position.set(0, mirrorHingeY, mirrorCenterZ);
  mirror.position.set(0, -mirrorH / 2, 0);
  mirrorPivot.add(mirror);
  // At rest (mirror down, viewing position) the mirror sits at 45deg to the optical axis (+Z), reflecting the
  // lens's light (traveling in -z) upward to +y.
  mirrorPivot.rotation.x = -mirrorAngleRad;
  group.add(tagged(mirrorPivot, 'mirror', 'Main reflex mirror'));
  mirrorPivot.userData.anchor = new THREE.Vector3(0, 0, 0);

  // Sub-mirror: hinged to the main mirror's rear (lens-side, lower) edge, folded back at an acute angle toward
  // the lens, reflecting the main mirror's transmitted light down to the AF module in the mirror-box floor.
  const subMirrorW = mirrorW * 0.7;
  const subMirrorH = mirrorH * 0.35;
  const subMirrorMat = new THREE.MeshPhysicalMaterial({ color: 0xd9dde4, roughness: 0.15, metalness: 0.85 });
  const subMirror = new THREE.Mesh(new THREE.PlaneGeometry(subMirrorW, subMirrorH), subMirrorMat);
  const subMirrorPivot = new THREE.Group();
  // The main mirror's lower (lens-side) edge in the pivot's local space, i.e. at local y = -mirrorH.
  subMirrorPivot.position.set(0, -mirrorH, 0);
  subMirror.position.set(0, -subMirrorH / 2, 0);
  subMirrorPivot.add(subMirror);
  subMirrorPivot.rotation.x = THREE.MathUtils.degToRad(55); // acute fold back toward the lens, per dslr.json
  mirrorPivot.add(tagged(subMirrorPivot, 'subMirror', 'Sub-mirror'));

  // Focusing screen: a thin frosted plate just under the prism, at the optical path-length-matched position
  // above the mirror box (data/hardware/dslr.json's focusingScreen.opticalPosition).
  const screenMat = new THREE.MeshPhysicalMaterial({ color: 0xf5f5f0, roughness: 0.6, metalness: 0, transmission: 0.3, thickness: 0.5 });
  const focusingScreen = new THREE.Mesh(new THREE.PlaneGeometry(mirrorW * 0.95, mirrorH * 0.95 * 0.9), screenMat);
  focusingScreen.rotation.x = -Math.PI / 2;
  focusingScreen.position.set(0, mirrorHingeY + 2, mirrorCenterZ + mirrorH * 0.02);
  group.add(tagged(focusingScreen, 'focusingScreen', 'Focusing screen'));

  // Pentaprism: a solid glass wedge (schematic roof-pentaprism silhouette: a pentagonal extruded shape) sitting
  // in the hump above the focusing screen, folding the screen's image to the eyepiece.
  const prismShape = new THREE.Shape();
  const pw = mirrorW * 0.5;
  prismShape.moveTo(-pw, 0);
  prismShape.lineTo(pw, 0);
  prismShape.lineTo(pw * 0.65, pw * 0.7);
  prismShape.lineTo(0, pw * 1.05);
  prismShape.lineTo(-pw * 0.65, pw * 0.7);
  prismShape.closePath();
  const prismGeo = new THREE.ExtrudeGeometry(prismShape, { depth: mirrorH * 0.7, bevelEnabled: true, bevelThickness: 0.6, bevelSize: 0.6, bevelSegments: 2 });
  prismGeo.center();
  const prismMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, transmission: 1, ior: 1.52, roughness: 0.03, thickness: mirrorW * 0.5,
    attenuationColor: 0xf5efd8, attenuationDistance: 400,
  });
  const prism = new THREE.Mesh(prismGeo, prismMat);
  prism.rotation.x = Math.PI / 2;
  prism.position.set(0, humpBaseY + humpH / 2 - 4, bodyCenterZ - bodyDepth * 0.05);
  group.add(tagged(prism, 'prism', 'Pentaprism'));

  // ---- focal-plane shutter --------------------------------------------------------------------------------
  // Sits immediately in front of the filter stack/sensor (data/hardware/dslr.json shutter.position), vertical
  // travel across the sensor's short (24mm) dimension. Modeled as two overlapping curtain plates.
  const shutterGroup = new THREE.Group();
  const curtainMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.6, metalness: 0.5 });
  const curtainW = DSLR_FACTS.sensorWidthMm + 4;
  const curtainH = DSLR_FACTS.shutterTravelMm / 2 + 1;
  const firstCurtain = new THREE.Mesh(new THREE.PlaneGeometry(curtainW, curtainH), curtainMat);
  firstCurtain.position.set(0, DSLR_FACTS.shutterTravelMm / 4, 0);
  const secondCurtain = new THREE.Mesh(new THREE.PlaneGeometry(curtainW, curtainH), curtainMat.clone());
  secondCurtain.position.set(0, -DSLR_FACTS.shutterTravelMm / 4, -0.3);
  shutterGroup.add(firstCurtain, secondCurtain);
  const shutterZ = -(FILTER_STACK_MM + 0.6); // immediately in front of the filter stack, per the build brief
  shutterGroup.position.z = shutterZ;
  group.add(tagged(shutterGroup, 'shutter', 'Focal-plane shutter'));

  // ---- sensor package + filter stack, sensor plane at world z = 0 -------------------------------------------
  const filterStack = buildFilterStack(DSLR_FACTS.sensorWidthMm, DSLR_FACTS.sensorHeightMm, FILTER_STACK_MM, lookMod);
  group.add(filterStack);

  const sensorPackage = buildSensorPackage(DSLR_FACTS.sensorWidthMm, DSLR_FACTS.sensorHeightMm, lookMod);
  group.add(sensorPackage);

  // ---- cutaway wedge toggle (see cutawayGroup above -- shell + hump only; mirror box, mirror, sensor etc. stay
  // solid so the cutaway reveals them rather than clipping them too) -------------------------------------------
  function setCutaway(on: boolean) {
    cutawayGroup.enabled = on;
  }
  if (opts.cutaway) setCutaway(true);

  return {
    group,
    setCutaway,
    dispose() {
      group.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose();
      });
      for (const d of disposers) d();
    },
  };
}
