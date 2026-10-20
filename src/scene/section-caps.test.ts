import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { capCutParts, findCapTriangles, sectionCapMaterial, splitSectionCap } from './section-caps';

/** A box whose -x face lies on the cut plane x = 0.05, like a cutaway half: 10 mm in x, 4 in y, 6 in z. */
function half(): THREE.Mesh {
  const g = new THREE.BoxGeometry(10, 4, 6);
  g.translate(5.05, 0, 0);
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ name: 'BrushedChrome', color: 0xffffff }));
  m.updateMatrixWorld(true);
  return m;
}

describe('cut-face caps (score loop r4)', () => {
  it('finds exactly the two triangles of the face on the cut plane', () => {
    expect(findCapTriangles(half())).toHaveLength(2);
  });

  it('does not take the faces that stand across the cut or the face at the far end', () => {
    const m = half();
    const caps = new Set(findCapTriangles(m));
    const pos = m.geometry.getAttribute('position');
    const index = m.geometry.getIndex()!;
    for (const t of caps) {
      for (let k = 0; k < 3; k++) expect(pos.getX(index.getX(t + k))).toBeCloseTo(0.05, 6);
    }
  });

  it('moves the cap into a child mesh with the section material and leaves the other ten triangles', () => {
    const m = half();
    const cap = splitSectionCap(m, sectionCapMaterial(m.material as THREE.Material));
    expect(cap).not.toBeNull();
    expect(cap!.geometry.getIndex()!.count).toBe(6);
    expect(m.geometry.getIndex()!.count).toBe(36 - 6);
    expect(cap!.parent).toBe(m);
    expect(cap!.userData.cutCap).toBe(true);
    // both halves share the original vertex buffers: nothing is copied
    expect(cap!.geometry.getAttribute('position')).toBe(m.geometry.getAttribute('position'));
  });

  it('holds a pale part to the cap peak and leaves a dark one as it is', () => {
    const pale = sectionCapMaterial(new THREE.MeshStandardMaterial({ color: 0xffffff }), 0.16);
    expect(Math.max(pale.color.r, pale.color.g, pale.color.b)).toBeCloseTo(0.16, 6);
    const dark = sectionCapMaterial(new THREE.MeshStandardMaterial({ color: 0x242526 }), 0.16);
    expect(dark.color.getHex()).toBe(new THREE.Color(0x242526).getHex());
    expect(pale.metalness).toBeGreaterThan(0.3);
  });

  it('caps only the cutaway halves of a model, once, and never its glass', () => {
    const root = new THREE.Group();
    const cutPart = half(); cutPart.userData.cutaway = 'half'; root.add(cutPart);
    const whole = half(); whole.userData.cutaway = 'full'; root.add(whole);
    const glass = half(); glass.userData.cutaway = 'half'; (glass.material as THREE.Material).name = 'lensGlass'; root.add(glass);
    capCutParts(root);
    expect(cutPart.children).toHaveLength(1);
    expect(whole.children).toHaveLength(0);
    expect(glass.children).toHaveLength(0);
    capCutParts(root);
    expect(cutPart.children).toHaveLength(1);
  });

  it('gives the cut shell a paint copy without the clearcoat', () => {
    const root = new THREE.Group();
    const shell = half();
    shell.userData.component = 'shellCut';
    const paint = new THREE.MeshPhysicalMaterial({ name: 'SatinBlackPaint', color: 0x242526, clearcoat: 0.25, roughness: 0.42 });
    shell.material = paint;
    root.add(shell);
    capCutParts(root);
    const m = shell.material as THREE.MeshPhysicalMaterial;
    expect(m).not.toBe(paint);
    expect(m.clearcoat).toBe(0);
    expect(m.roughness).toBeGreaterThanOrEqual(0.6);
    expect(paint.clearcoat).toBe(0.25);
  });
});
