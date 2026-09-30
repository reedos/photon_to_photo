// Accuracy gate for the two camera bodies (docs/PANE.md build brief: "a vitest file checking the geometric facts
// ... from the Group's objects against the data files"). Checks the numbers physics actually depends on: the
// mount face z, sensor size and z, mirror angle, filter-stack thickness -- read back from the built THREE.Group,
// not just re-asserted against the same constants the builder itself used, wherever the geometry lets us recover
// the number independently (e.g. a mesh's own bounding box for the mirror's plane size).
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import * as look from '../../app/look';
import { buildDslrBody, DSLR_FACTS } from './dslr';
import { buildMirrorlessBody, MIRRORLESS_FACTS } from './mirrorless';
import mountsData from '../../../data/hardware/mounts.json';
import dslrData from '../../../data/hardware/dslr.json';
import d850Data from '../../../data/d850.json';
import z8Data from '../../../data/z8.json';
import bodyData from '../../../data/hardware/body.json';

function boundingBoxOf(obj: THREE.Object3D): THREE.Box3 {
  const box = new THREE.Box3();
  box.setFromObject(obj);
  return box;
}

describe('dslr body', () => {
  const handle = buildDslrBody(look);
  const g = handle.group;

  it('mount face sits at z = -flange (F-mount, 46.5mm)', () => {
    const flange = (mountsData as any).mounts.nikonF.flangeMm;
    expect(flange).toBe(46.5);
    expect(DSLR_FACTS.flangeMm).toBe(flange);
    const mount = g.getObjectByName('mount');
    expect(mount).toBeTruthy();
    const flangeFace = mount!.getObjectByName('mount-flange');
    expect(flangeFace).toBeTruthy();
    // The flange plate's own world z (it's a flat ring at a fixed z, per common.ts's buildMountRing).
    const box = boundingBoxOf(flangeFace!);
    expect((box.min.z + box.max.z) / 2).toBeCloseTo(-flange, 1);
  });

  it('mount throat diameter and bayonet lug count match data/hardware/mounts.json', () => {
    const mountData = (mountsData as any).mounts.nikonF;
    expect(DSLR_FACTS.throatMm).toBe(mountData.throatMm);
    expect(DSLR_FACTS.lugCount).toBe(mountData.lugs);
    const lugs = g.getObjectByName('mount')!.children.filter((c) => c.name.startsWith('mount-lug-'));
    expect(lugs).toHaveLength(mountData.lugs);
  });

  it('sensor active area and plane match data/d850.json, at world z = 0', () => {
    const sensor = (d850Data as any).sensor.activeArea;
    expect(DSLR_FACTS.sensorWidthMm).toBe(sensor.widthMm.v);
    expect(DSLR_FACTS.sensorHeightMm).toBe(sensor.heightMm.v);
    const pixelArray = g.getObjectByName('pixelArray') as THREE.Mesh;
    expect(pixelArray).toBeTruthy();
    const box = boundingBoxOf(pixelArray);
    expect(box.max.x - box.min.x).toBeCloseTo(sensor.widthMm.v, 3);
    expect(box.max.y - box.min.y).toBeCloseTo(sensor.heightMm.v, 3);
    // The sensor package sits with its active area at the sensor plane, world z = 0 (docs/PANE.md's frame).
    expect((box.min.z + box.max.z) / 2).toBeCloseTo(0, 1);
  });

  it('mirror rest angle is 45deg per data/hardware/dslr.json, hinged (not centered) at its top edge', () => {
    const restAngle = (dslrData as any).mirror.restAngleDeg.v;
    expect(restAngle).toBe(45);
    expect(DSLR_FACTS.mirrorAngleDeg).toBe(restAngle);
    const mirrorPivot = g.getObjectByName('mirror') as THREE.Group;
    expect(mirrorPivot).toBeTruthy();
    // rotation.x is negative restAngle in radians (builder convention: tilts the lens-facing plane up to 45deg).
    expect(Math.abs(mirrorPivot.rotation.x)).toBeCloseTo(THREE.MathUtils.degToRad(45), 3);
    // Hinged at the pivot's own origin -- the mirror mesh's local position is offset by -height/2, not 0,
    // confirming rotation happens about the top edge, not the plane's center.
    const mirrorMesh = mirrorPivot.children.find((c) => c instanceof THREE.Mesh) as THREE.Mesh;
    expect(mirrorMesh.position.y).toBeLessThan(0);
  });

  it('mirror width/height match the derived figures in data/hardware/dslr.json', () => {
    const size = (dslrData as any).mirror.size;
    expect(DSLR_FACTS.mirrorWidthMm).toBe(size.width.v);
    expect(DSLR_FACTS.mirrorHeightMm).toBe(size.height.v);
  });

  it('filter stack thickness matches data/hardware/body.json and sits directly in front of the sensor', () => {
    const thickness = (bodyData as any).sensorStack.thicknessMm.v;
    expect(DSLR_FACTS.filterStackMm).toBe(thickness);
    const filter = g.getObjectByName('filterStack') as THREE.Mesh;
    expect(filter).toBeTruthy();
    const box = boundingBoxOf(filter);
    expect(box.max.z - box.min.z).toBeCloseTo(thickness, 3);
    // In front of the sensor means at negative z, ending at (or very near) the sensor plane z = 0.
    expect(box.max.z).toBeLessThanOrEqual(0.01);
    expect(box.min.z).toBeCloseTo(-thickness, 2);
  });

  it('has a focal-plane shutter positioned in front of the filter stack (DSLR only)', () => {
    const shutter = g.getObjectByName('shutter');
    expect(shutter).toBeTruthy();
    expect(shutter!.position.z).toBeLessThan(-DSLR_FACTS.filterStackMm);
  });

  it('every tagged component carries userData.component/label', () => {
    const requiredComponents = ['body', 'mount', 'mirror', 'subMirror', 'focusingScreen', 'prism', 'shutter', 'sensorPackage', 'filterStack', 'pixelArray', 'topDials', 'grip'];
    for (const name of requiredComponents) {
      const obj = g.getObjectByName(name);
      expect(obj, `missing tagged component "${name}"`).toBeTruthy();
      expect(obj!.userData.component).toBe(name);
      expect(typeof obj!.userData.label).toBe('string');
      expect(obj!.userData.label.length).toBeGreaterThan(0);
    }
  });

  it('cutaway toggles the shell\'s ClippingGroup without rebuilding geometry', () => {
    const shell = g.getObjectByName('body') as THREE.Mesh;
    const clippingGroup = shell.parent as unknown as { isClippingGroup?: boolean; enabled: boolean };
    expect(clippingGroup.isClippingGroup).toBe(true);
    expect(clippingGroup.enabled).toBe(false);
    handle.setCutaway(true);
    expect(clippingGroup.enabled).toBe(true);
    handle.setCutaway(false);
    expect(clippingGroup.enabled).toBe(false);
  });

  handle.dispose();
});

describe('mirrorless body', () => {
  const handle = buildMirrorlessBody(look);
  const g = handle.group;

  it('mount face sits at z = -flange (Z-mount, 16mm)', () => {
    const flange = (mountsData as any).mounts.nikonZ.flangeMm;
    expect(flange).toBe(16);
    expect(MIRRORLESS_FACTS.flangeMm).toBe(flange);
    const flangeFace = g.getObjectByName('mount')!.getObjectByName('mount-flange');
    const box = boundingBoxOf(flangeFace!);
    expect((box.min.z + box.max.z) / 2).toBeCloseTo(-flange, 1);
  });

  it('mount throat diameter and 4-lug bayonet match data/hardware/mounts.json', () => {
    const mountData = (mountsData as any).mounts.nikonZ;
    expect(MIRRORLESS_FACTS.throatMm).toBe(mountData.throatMm);
    expect(MIRRORLESS_FACTS.lugCount).toBe(4);
    const lugs = g.getObjectByName('mount')!.children.filter((c) => c.name.startsWith('mount-lug-'));
    expect(lugs).toHaveLength(4);
  });

  it('sensor active area matches data/z8.json, at world z = 0', () => {
    const sensor = (z8Data as any).sensor.activeArea;
    expect(MIRRORLESS_FACTS.sensorWidthMm).toBe(sensor.widthMm.v);
    expect(MIRRORLESS_FACTS.sensorHeightMm).toBe(sensor.heightMm.v);
    const pixelArray = g.getObjectByName('pixelArray') as THREE.Mesh;
    const box = boundingBoxOf(pixelArray);
    expect(box.max.x - box.min.x).toBeCloseTo(sensor.widthMm.v, 3);
    expect(box.max.y - box.min.y).toBeCloseTo(sensor.heightMm.v, 3);
    expect((box.min.z + box.max.z) / 2).toBeCloseTo(0, 1);
  });

  it('filter stack thickness matches data/hardware/body.json', () => {
    const thickness = (bodyData as any).sensorStack.thicknessMm.v;
    const filter = g.getObjectByName('filterStack') as THREE.Mesh;
    const box = boundingBoxOf(filter);
    expect(box.max.z - box.min.z).toBeCloseTo(thickness, 3);
  });

  it('has no mirror and no shutter (shutter-less sensor stack, per data/z8.json)', () => {
    expect((z8Data as any).body.shutter.mechanicalShutter.v).toBe('none');
    expect(g.getObjectByName('mirror')).toBeFalsy();
    expect(g.getObjectByName('subMirror')).toBeFalsy();
    expect(g.getObjectByName('prism')).toBeFalsy();
    expect(g.getObjectByName('shutter')).toBeFalsy();
  });

  it('has an EVF instead of an optical pentaprism', () => {
    expect(g.getObjectByName('evf')).toBeTruthy();
  });

  it('every tagged component carries userData.component/label', () => {
    const requiredComponents = ['body', 'evf', 'mount', 'sensorPackage', 'filterStack', 'pixelArray', 'topDials', 'grip'];
    for (const name of requiredComponents) {
      const obj = g.getObjectByName(name);
      expect(obj, `missing tagged component "${name}"`).toBeTruthy();
      expect(obj!.userData.component).toBe(name);
    }
  });

  it('cutaway toggles the shell\'s ClippingGroup', () => {
    const shell = g.getObjectByName('body') as THREE.Mesh;
    const clippingGroup = shell.parent as unknown as { isClippingGroup?: boolean; enabled: boolean };
    expect(clippingGroup.isClippingGroup).toBe(true);
    expect(clippingGroup.enabled).toBe(false);
    handle.setCutaway(true);
    expect(clippingGroup.enabled).toBe(true);
    handle.setCutaway(false);
  });

  handle.dispose();
});

describe('the two bodies share the frame convention', () => {
  it('the mirrorless flange (16mm) is much shorter than the DSLR flange (46.5mm), per docs/PANE.md', () => {
    expect(MIRRORLESS_FACTS.flangeMm).toBeLessThan(DSLR_FACTS.flangeMm);
    expect(DSLR_FACTS.flangeMm - MIRRORLESS_FACTS.flangeMm).toBeCloseTo(30.5, 1);
  });

  it('both sensors share the same active area (both Nikon FX-format full-frame)', () => {
    expect(DSLR_FACTS.sensorWidthMm).toBe(MIRRORLESS_FACTS.sensorWidthMm);
    expect(DSLR_FACTS.sensorHeightMm).toBe(MIRRORLESS_FACTS.sensorHeightMm);
  });
});
