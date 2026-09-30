// The generic full-frame mirrorless body (Z8-style geometry), per docs/PANE.md: "The mirrorless body has a
// shutter-less sensor stack and an EVF." Same frame as dslr.ts: mm, sensor plane at z = 0, lens axis along -z,
// y up, x to the camera's right as seen from behind.
//
// Data sources: data/z8.json (sensor active area, body envelope, EVF), data/hardware/mounts.json (nikonZ: flange
// 16mm, throat 55mm, 4 lugs, 11 contacts), data/hardware/body.json (generic sensor filter-stack thickness/index --
// no maker publishes an exact Z8 figure, so both bodies share this project's one assumed representative value,
// same as dslr.ts). The Z8 itself has no mechanical shutter at all (data/z8.json body.shutter.mechanicalShutter:
// "none"), so unlike the DSLR this body has no shutter curtains -- only the sensor stack directly behind the
// mount, per docs/PANE.md's "shutter-less."
import * as THREE from 'three/webgpu';
import type * as look from '../../app/look';
import mountsData from '../../../data/hardware/mounts.json';
import z8Data from '../../../data/z8.json';
import bodyData from '../../../data/hardware/body.json';
import {
  buildDial,
  buildFilterStack,
  buildMountRing,
  buildReleaseButton,
  buildRearScreen,
  buildSensorPackage,
  buildStrapLug,
  makeCutawayGroup,
  roundedBox,
  rubberGripMaterial,
  satinBodyMaterial,
  tagged,
} from './common';

const Z_MOUNT = (mountsData as any).mounts.nikonZ as { flangeMm: number; throatMm: number; lugs: number; contacts: number };
const SENSOR = (z8Data as any).sensor as { activeArea: { widthMm: { v: number }; heightMm: { v: number } } };
const Z8_BODY = (z8Data as any).body as {
  dimensionsMm: { width: number; height: number; depth: number };
  viewfinder: { magnification: { v: number } };
};
const FILTER_STACK_MM = (bodyData as any).sensorStack.thicknessMm.v as number;

export const MIRRORLESS_FACTS = {
  flangeMm: Z_MOUNT.flangeMm,
  throatMm: Z_MOUNT.throatMm,
  lugCount: Z_MOUNT.lugs,
  contactCount: Z_MOUNT.contacts,
  sensorWidthMm: SENSOR.activeArea.widthMm.v,
  sensorHeightMm: SENSOR.activeArea.heightMm.v,
  filterStackMm: FILTER_STACK_MM,
  bodyWidthMm: Z8_BODY.dimensionsMm.width,
  bodyHeightMm: Z8_BODY.dimensionsMm.height,
  bodyDepthMm: Z8_BODY.dimensionsMm.depth,
  evfMagnification: Z8_BODY.viewfinder.magnification.v,
} as const;

export interface MirrorlessBodyOptions {
  cutaway?: boolean;
}

export interface MirrorlessBodyHandle {
  group: THREE.Group;
  setCutaway(on: boolean): void;
  dispose(): void;
}

export function buildMirrorlessBody(lookMod: typeof look, opts: MirrorlessBodyOptions = {}): MirrorlessBodyHandle {
  const group = new THREE.Group();
  const disposers: (() => void)[] = [];

  const flange = MIRRORLESS_FACTS.flangeMm;
  const mountFaceZ = -flange;
  const bodyFrontZ = mountFaceZ;
  const bodyBackZ = bodyFrontZ + MIRRORLESS_FACTS.bodyDepthMm;
  const bodyW = MIRRORLESS_FACTS.bodyWidthMm;
  const bodyH = MIRRORLESS_FACTS.bodyHeightMm;
  const bodyDepth = bodyBackZ - bodyFrontZ;
  const bodyCenterZ = (bodyFrontZ + bodyBackZ) / 2;

  // The cutaway wedge, per docs/PANE.md's build brief -- see dslr.ts's own comment on why this needs a
  // THREE.ClippingGroup rather than per-material clippingPlanes on the WebGPU/TSL pipeline.
  const cutawayGroup = makeCutawayGroup(0, -bodyH * 0.05);
  group.add(cutawayGroup);

  // ---- outer shell (no mirror box, so the body reads noticeably shallower/lower than the DSLR at the same
  // sensor position -- the shell's own bodyDepth/bodyH come straight from the Z8's published envelope) ---------
  const shellMat = satinBodyMaterial(0x1b1c1f);
  const shell = new THREE.Mesh(roundedBox(bodyW, bodyH * 0.78, bodyDepth, 6, 4), shellMat);
  shell.position.set(0, -bodyH * 0.05, bodyCenterZ);
  cutawayGroup.add(tagged(shell, 'body', 'Body shell'));

  // EVF hump: a smaller central housing than the DSLR's pentaprism hump (no glass prism inside, just an OLED
  // panel and optics), per data/hardware/body.json evf.hump.
  const humpW = bodyW * 0.2;
  const humpH = bodyH * 0.16;
  const humpDepth = bodyDepth * 0.45;
  const humpBaseY = shell.position.y + (bodyH * 0.78) / 2;
  const hump = new THREE.Mesh(roundedBox(humpW, humpH, humpDepth, 3, 3), shellMat);
  hump.position.set(0, humpBaseY + humpH / 2 - 1.5, bodyCenterZ - bodyDepth * 0.15);
  cutawayGroup.add(hump);

  const evfGroup = new THREE.Group();
  const eyecupMat = new THREE.MeshPhysicalMaterial({ color: 0x060606, roughness: 0.9, metalness: 0 });
  const eyecup = new THREE.Mesh(new THREE.CylinderGeometry(9, 11, 6, 24), eyecupMat);
  eyecup.rotation.x = Math.PI / 2;
  eyecup.position.set(0, hump.position.y, bodyBackZ + 3);
  evfGroup.add(eyecup);
  const panelMat = new THREE.MeshBasicMaterial({ color: 0x0d1a24 });
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(6, 4.5), panelMat);
  panel.position.set(0, hump.position.y, bodyBackZ - 4);
  evfGroup.add(panel);
  group.add(tagged(evfGroup, 'evf', 'Electronic viewfinder'));

  // ---- grip --------------------------------------------------------------------------------------------------
  const gripMat = rubberGripMaterial();
  disposers.push(() => gripMat.dispose());
  const gripW = bodyW * 0.2;
  const gripH = bodyH * 0.68;
  const gripDepth = bodyDepth * 0.9;
  const grip = new THREE.Mesh(roundedBox(gripW, gripH, gripDepth, gripW * 0.42, 5), gripMat);
  grip.position.set(bodyW / 2 - gripW / 2 + 4, shell.position.y - bodyH * 0.02, bodyCenterZ + 2);
  group.add(tagged(grip, 'grip', 'Hand grip'));

  const shutterButton = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.1, 2.6, 20), lookMod.anodizedBarrelMaterial(true));
  shutterButton.position.set(bodyW / 2 - gripW * 0.3, humpBaseY - 2, mountFaceZ + 6);
  shutterButton.rotation.x = Math.PI * 0.08;
  group.add(tagged(shutterButton, 'shutter-button', 'Shutter release'));

  // ---- top-plate dials ---------------------------------------------------------------------------------------
  const topDials = new THREE.Group();
  const dialY = humpBaseY - 1;
  const leftDial = buildDial(10, 5.5, lookMod, 'topDials-mode', 'Mode dial');
  leftDial.position.set(-bodyW * 0.3, dialY, bodyCenterZ - bodyDepth * 0.1);
  const rightDial = buildDial(12, 6, lookMod, 'topDials-command', 'Command dial');
  rightDial.position.set(bodyW * 0.26, dialY, bodyCenterZ - bodyDepth * 0.2);
  topDials.add(leftDial, rightDial);
  group.add(tagged(topDials, 'topDials', 'Top-plate dials'));

  const statusLcdMat = new THREE.MeshPhysicalMaterial({ color: 0x1c2620, roughness: 0.25, metalness: 0.1 });
  const statusLcd = new THREE.Mesh(new THREE.PlaneGeometry(bodyW * 0.2, bodyH * 0.07), statusLcdMat);
  statusLcd.rotation.x = -Math.PI / 2;
  statusLcd.position.set(0, dialY + 0.1, bodyCenterZ - bodyDepth * 0.02);
  group.add(statusLcd);

  // ---- rear screen + strap lugs ------------------------------------------------------------------------------
  const rearScreen = buildRearScreen(bodyW * 0.4, bodyH * 0.42, lookMod);
  rearScreen.rotation.y = Math.PI;
  rearScreen.position.set(-bodyW * 0.05, shell.position.y - 2, bodyBackZ + 1);
  group.add(rearScreen);

  const lugL = buildStrapLug(lookMod);
  lugL.position.set(-bodyW / 2 + 2, humpBaseY * 0.25, bodyCenterZ - bodyDepth * 0.28);
  const lugR = buildStrapLug(lookMod);
  lugR.position.set(bodyW / 2 - 2, humpBaseY * 0.25, bodyCenterZ - bodyDepth * 0.28);
  group.add(lugL, lugR);

  // ---- mount ring ---------------------------------------------------------------------------------------------
  const mount = buildMountRing({
    throatDiameter: MIRRORLESS_FACTS.throatMm,
    flangeOuterDiameter: MIRRORLESS_FACTS.throatMm + 12,
    lugCount: MIRRORLESS_FACTS.lugCount,
    contactCount: MIRRORLESS_FACTS.contactCount,
    faceZ: mountFaceZ,
    lookMod,
  });
  group.add(mount);

  const releaseBtn = buildReleaseButton(lookMod);
  releaseBtn.position.set(-MIRRORLESS_FACTS.throatMm / 2 - 5, 4, mountFaceZ + 2);
  releaseBtn.rotation.x = Math.PI / 2;
  group.add(releaseBtn);

  // ---- shutter-less sensor stack: a short internal barrel from the mount straight back to the sensor, with
  // an IBIS carrier plate (data/hardware/body.json ibis) around the sensor package -- no mirror box, no
  // shutter curtains, per docs/PANE.md's "shutter-less sensor stack."
  const throatDepth = -mountFaceZ;
  const innerBarrel = new THREE.Mesh(
    new THREE.CylinderGeometry(MIRRORLESS_FACTS.throatMm / 2 - 1, MIRRORLESS_FACTS.throatMm / 2 - 1, throatDepth, 40, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.88, metalness: 0.08, side: THREE.BackSide }),
  );
  innerBarrel.rotation.x = Math.PI / 2;
  innerBarrel.position.z = mountFaceZ + throatDepth / 2;
  group.add(tagged(innerBarrel, 'mirror-box', 'Sensor throat (no mirror box)'));

  const ibisMat = new THREE.MeshPhysicalMaterial({ color: 0x2a2f38, roughness: 0.4, metalness: 0.7 });
  const ibisPlate = new THREE.Mesh(
    roundedBox(MIRRORLESS_FACTS.sensorWidthMm + 22, MIRRORLESS_FACTS.sensorHeightMm + 22, 6, 2, 2),
    ibisMat,
  );
  ibisPlate.position.z = -4;
  group.add(tagged(ibisPlate, 'ibis-carrier', 'IBIS sensor-shift carrier'));

  // ---- sensor package + filter stack, sensor plane at world z = 0 -------------------------------------------
  const filterStack = buildFilterStack(MIRRORLESS_FACTS.sensorWidthMm, MIRRORLESS_FACTS.sensorHeightMm, FILTER_STACK_MM, lookMod);
  group.add(filterStack);

  const sensorPackage = buildSensorPackage(MIRRORLESS_FACTS.sensorWidthMm, MIRRORLESS_FACTS.sensorHeightMm, lookMod);
  group.add(sensorPackage);

  // ---- cutaway wedge toggle (shell + EVF hump only; see cutawayGroup above) ------------------------------------
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
