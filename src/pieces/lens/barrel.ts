// The procedural anodized barrel around the element stack (BRIEF.md set piece 2): "a procedural anodized tube
// around the stack (inner radius just outside the largest element) ... cut on the same wedge; matte black
// interior. Schematic, and the part card says so." Built once per lens (its extent depends only on the design,
// not focus), from the SAME wedge angles as every element body (geometry.ts's wedgeAngles()).
import * as THREE from 'three/webgpu';
import type * as look from '../../app/look';
import { buildAnnulusZ, buildWedgeWallCap, revolveStrip, wedgeAngles, type ProfilePoint } from './geometry';

export interface BarrelHandle {
  group: THREE.Group;
  dispose(): void;
}

/** `maxOd` is the largest element/plate OD (world mm, absolute-z coordinates already -- the barrel is built once
 *  in absolute/world space, unlike the elements, since it does not move with focus). `z0`/`z1` are the absolute
 *  z of the barrel's front and back openings. */
export function buildBarrel(maxOd: number, z0: number, z1: number, lookMod: typeof look): BarrelHandle {
  const innerR = maxOd * 1.08 + 0.6;
  const outerR = innerR * 1.16 + 1.2;
  const { thetaStart, thetaLength } = wedgeAngles();
  const thetaEnd = thetaStart + thetaLength;

  const group = new THREE.Group();
  group.name = 'lens-barrel';

  const outerProfile: ProfilePoint[] = [{ r: outerR, z: z0 }, { r: outerR, z: z1 }];
  const innerProfile: ProfilePoint[] = [{ r: innerR, z: z0 }, { r: innerR, z: z1 }];

  const outerMat = lookMod.anodizedBarrelMaterial(false);
  const innerMat = lookMod.matteInternalMaterial();
  (innerMat as THREE.MeshStandardMaterial).side = THREE.BackSide; // seen from inside the bore, looking outward

  const outerWall = new THREE.Mesh(revolveStrip(outerProfile, thetaStart, thetaLength), outerMat);
  const innerWall = new THREE.Mesh(revolveStrip(innerProfile, thetaStart, thetaLength), innerMat);

  const wedgeMat = lookMod.matteInternalMaterial();
  const wedgeCapA = new THREE.Mesh(buildWedgeWallCap(innerR, outerR, z0, z1, thetaStart, -1), wedgeMat);
  const wedgeCapB = new THREE.Mesh(buildWedgeWallCap(innerR, outerR, z0, z1, thetaEnd, 1), wedgeMat);

  const ringMat = lookMod.anodizedBarrelMaterial(true);
  const ringFront = new THREE.Mesh(buildAnnulusZ(innerR, outerR, z0, thetaStart, thetaLength, -1), ringMat);
  const ringBack = new THREE.Mesh(buildAnnulusZ(innerR, outerR, z1, thetaStart, thetaLength, 1), ringMat);

  const parts = [outerWall, innerWall, wedgeCapA, wedgeCapB, ringFront, ringBack];
  for (const m of parts) m.frustumCulled = false;
  group.add(...parts);

  return {
    group,
    dispose() {
      for (const m of parts) m.geometry.dispose();
      outerMat.dispose();
      innerMat.dispose();
      wedgeMat.dispose();
      ringMat.dispose();
    },
  };
}
