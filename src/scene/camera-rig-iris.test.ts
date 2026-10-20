// P-07 (presentation review 10/10/2026): in the cutaway the live iris stood whole across the sectioned barrel, a
// black bar over the cut glass. The cutaway now draws only its kept half (x >= 0). The pass condition: for every
// lineup lens wide open and at f/8, the half annulus covers no point with x < 0, keeps the engine's opening clear,
// and has about half the area of the full annulus.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { compute, PANE_LENS_IDS } from '../app/engine-api';
import { halfIrisShape } from './camera-rig';

function area(pts: THREE.Vector2[]) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p.x * q.y - q.x * p.y; }
  return Math.abs(a) / 2;
}

describe('the live iris in the cutaway is sectioned with the barrel', () => {
  for (const lens of PANE_LENS_IDS) {
    for (const wide of [true, false]) {
      it(`${lens} ${wide ? 'wide open' : 'f/8'}: only the kept half, opening untouched`, () => {
        const base = compute({ lens });
        const m = wide ? base : compute({ lens, fno: Math.max(8, base.scenario.fno) });
        const rOuter = m.realized.realization.stopRadius + 2.6;
        const shape = halfIrisShape(m.iris.outline as [number, number][], rOuter);
        const pts = shape.getPoints(48);
        expect(Math.min(...pts.map((p) => p.x))).toBeGreaterThan(-1e-6);
        const full = Math.PI * rOuter * rOuter - area(m.iris.outline.map(([x, y]) => new THREE.Vector2(x, y)));
        expect(area(pts) / full).toBeGreaterThan(0.47);
        expect(area(pts) / full).toBeLessThan(0.53);
        // the axis itself (inside every opening) is never covered
        const geo = new THREE.ShapeGeometry(shape, 48);
        const pos = geo.attributes.position;
        const idx = geo.index!;
        const inTri = (px: number, py: number, a: number, b: number, c: number) => {
          const ax = pos.getX(a), ay = pos.getY(a), bx = pos.getX(b), by = pos.getY(b), cx = pos.getX(c), cy = pos.getY(c);
          const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
          const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
          const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
          return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
        };
        const probe = m.iris.radius * 0.5;
        for (let i = 0; i < idx.count; i += 3) expect(inTri(probe, 0, idx.getX(i), idx.getX(i + 1), idx.getX(i + 2))).toBe(false);
        geo.dispose();
      });
    }
  }
});
