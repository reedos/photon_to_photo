// Verification tests for workstream E1a's intersect(): SEQUENTIAL semantics.
//
// History: the adversarial review of commit 8ca246f reported that intersect() accepted crossings behind the ray
// (t <= 0) and the fixer made intersections forward-only. That is ray-casting semantics. A sequential lens tracer
// meets every listed surface in order, on the cap that contains the vertex, whatever the sign of t: patents give
// zero and negative gaps (p50 has a stop at t = 0 after a lens surface), and Zemax/CODE V trace them as virtual
// propagation. With forward-only hits the axial ray of p50 "missed" that stop (lead, 09/28/2026). These tests pin
// the sequential behavior; the independent expectations are hand-derived below.

import { intersect } from './surface';
import { traceRay } from './trace';
import type { Ray, TraceSurface, TraceSystem } from './types';
import { constantIndex } from './fixtures/e1a-glass';

describe('e1a.verify: sequential intersections (vertex cap, any sign of t)', () => {
  it('a flat surface behind the origin is met virtually: t = (z_s - z_o) / d_z = -5', () => {
    const s: TraceSurface = { z: 5, c: 0, k: 0, a: [], sd: 20, kind: 'refract', mediumAfter: 'glass' };
    const ray: Ray = { o: [0, 0, 10], d: [0, 0, 1], nm: 550 };
    expect(intersect(s, ray)).toBeCloseTo(-5, 12);
  });

  it('a zero gap is a hit at t = 0 (two surfaces at the same vertex)', () => {
    const s: TraceSurface = { z: 3, c: 0, k: 0, a: [], sd: 20, kind: 'stop', mediumAfter: 'air' };
    const ray: Ray = { o: [0, 0, 3], d: [0, 0, 1], nm: 550 };
    expect(intersect(s, ray)).toBe(0);
  });

  it('a curved surface: the axial ray meets the vertex, never the far cap', () => {
    // R = +20 (center at z = 20 when the vertex is at 0): the axial line crosses the sphere at z = 0 (vertex cap)
    // and z = 40 (far cap). From an origin at z = -10 the vertex hit is t = 10; from z = 5 (past the vertex) it is
    // t = -5, still the vertex, not the far cap at t = 35.
    const s: TraceSurface = { z: 0, c: 1 / 20, k: 0, a: [], sd: 10, kind: 'refract', mediumAfter: 'glass' };
    expect(intersect(s, { o: [0, 0, -10], d: [0, 0, 1], nm: 550 })).toBeCloseTo(10, 12);
    expect(intersect(s, { o: [0, 0, 5], d: [0, 0, 1], nm: 550 })).toBeCloseTo(-5, 12);
  });

  it('a line that never meets the base sphere is a miss', () => {
    const s: TraceSurface = { z: 0, c: 1 / 10, k: 0, a: [], sd: 8, kind: 'refract', mediumAfter: 'glass' };
    expect(intersect(s, { o: [0, 15, -5], d: [0, 0, 1], nm: 550 })).toBeNull(); // h = 15 > |R| = 10
  });

  it('traceRay through a zero-gap stop passes the axial ray to the image', () => {
    const surfaces: TraceSurface[] = [
      { z: 0, c: 1 / 50, k: 0, a: [], sd: 10, kind: 'refract', mediumAfter: 'glass' },
      { z: 5, c: 0, k: 0, a: [], sd: 10, kind: 'refract', mediumAfter: 'air' },
      { z: 5, c: 0, k: 0, a: [], sd: 6, kind: 'stop', mediumAfter: 'air' },   // t = 0 after the lens
      { z: 100, c: 0, k: 0, a: [], sd: 1e9, kind: 'image', mediumAfter: 'air' },
    ];
    const sys: TraceSystem = { surfaces, index: constantIndex({ glass: 1.5 }) };
    const path = traceRay(sys, { o: [0, 0, -10], d: [0, 0, 1], nm: 550 });
    expect(path.status).toBe('ok');
    expect(path.pts.length).toBe(5);
  });
});
