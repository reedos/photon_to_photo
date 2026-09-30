// The aperture: the stop radius a given f-number needs, and a schematic blade-iris geometry for drawing and for
// TraceSystem.iris's inside test. The blade geometry here is explicitly schematic (ENGINE.md asks for the
// geometry to be documented, not derived from a real blade mechanism) — see the comments on irisOutline below
// for the exact construction and why.

import type { Vec2 } from './types';
import type { ResolvedLens } from './lens';
import { systemAt } from './lens';
import { cardinal } from './paraxial';
import { FRAUNHOFER_D_NM } from './glass';

/**
 * The stop radius (mm) that gives infinity f-number `fno` on this lens, at its infinity focus. Uses the fact
 * that the entrance pupil radius is a linear function of the stop's own radius (paraxial imaging is linear):
 * probe the front group's magnification with a unit stop radius, then scale to the entrance pupil radius the
 * target f-number needs, efl / (2 fno) — the same relation Cardinal.fno documents in types.ts.
 */
export function stopRadiusFor(lens: ResolvedLens, fno: number): number {
  if (!(fno > 0)) throw new Error(`iris.ts: stopRadiusFor: fno must be positive, got ${fno}`);
  const sys = systemAt(lens, null);
  const probe = cardinal(sys, FRAUNHOFER_D_NM, 1);
  if (!(probe.ep.r > 0)) {
    throw new Error(`iris.ts: stopRadiusFor: ${lens.design.id}: no usable entrance pupil (no stop surface?)`);
  }
  const targetEpR = probe.efl / (2 * fno);
  return targetEpR / probe.ep.r; // probe.ep.r is the pupil radius a stop radius of 1 mm would give (linear scale)
}

/**
 * The circumcenter (center, radius) of the circle through three non-collinear points. Standard closed-form
 * circumcenter formula (coordinate geometry; e.g. the determinant form given in any computational-geometry
 * reference, such as the "Circumscribed circle" construction in O'Rourke, Computational Geometry in C). Returns
 * null for (near-)collinear points, where the caller falls back to a straight edge.
 */
function circumcircle(p1: Vec2, p2: Vec2, p3: Vec2): { center: Vec2; r: number } | null {
  const [ax, ay] = p1, [bx, by] = p2, [cx, cy] = p3;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-9) return null;
  const aa = ax * ax + ay * ay, bb = bx * bx + by * by, cc = cx * cx + cy * cy;
  const ux = (aa * (by - cy) + bb * (cy - ay) + cc * (ay - by)) / d;
  const uy = (aa * (cx - bx) + bb * (ax - cx) + cc * (bx - ax)) / d;
  return { center: [ux, uy], r: Math.hypot(ax - ux, ay - uy) };
}

/** Samples the arc from p1 to p2 that passes through apex, as `segments` points including both endpoints. */
function sampleArc(p1: Vec2, apex: Vec2, p2: Vec2, segments: number): Vec2[] {
  const circ = circumcircle(p1, apex, p2);
  if (!circ) return [p1, p2]; // collinear (degenerate blade count) -> straight edge
  const { center, r } = circ;
  const ang = (p: Vec2) => Math.atan2(p[1] - center[1], p[0] - center[0]);
  const a1 = ang(p1), aApex = ang(apex), a2 = ang(p2);
  // Sweep from a1 to a2 through aApex, choosing the direction (and possibly +/- 2*pi) that passes through aApex.
  let sweep = a2 - a1;
  if (sweep > Math.PI) sweep -= 2 * Math.PI;
  if (sweep < -Math.PI) sweep += 2 * Math.PI;
  const midDirect = a1 + sweep / 2;
  const wantsOther = Math.cos(midDirect - aApex) < 0; // apex is on the far side -> go the long way round
  if (wantsOther) sweep = sweep > 0 ? sweep - 2 * Math.PI : sweep + 2 * Math.PI;
  const pts: Vec2[] = [];
  const n = Math.max(1, segments);
  for (let i = 0; i <= n; i++) {
    const a = a1 + (sweep * i) / n;
    pts.push([center[0] + r * Math.cos(a), center[1] + r * Math.sin(a)]);
  }
  return pts;
}

/**
 * The current aperture opening as a polyline in the stop plane's local x/y (mm), `blades`-fold symmetric.
 *
 * Schematic geometry (there is no real blade CAD model here, only a shape that reads correctly on screen and
 * closes continuously as radius and rotation change):
 * - The n blade-pivot vertices sit at circumradius `radius`, evenly spaced, vertex 0 at angle `rotation`.
 * - Straight blades (rounded=false): the opening is exactly the regular n-gon through those vertices — this is
 *   the real, well-known behavior of a straight-edged iris (e.g. a classic 6- or 8-blade design), which does
 *   produce polygonal bokeh with vertices reaching further from the axis than the edge midpoints.
 * - Rounded blades (rounded=true): each edge bulges outward from the straight chord toward the circle, closing
 *   90% of the gap between the straight polygon's circumradius and inradius at the edge's midpoint (a circular
 *   arc through the two vertices and that midpoint). 90% is a schematic constant, not a measured one: it leaves
 *   a small, deliberately visible n-fold ripple so a rounded 5- or 7-blade iris still reads as polygonal-ish
 *   wide open and only looks fully circular as `blades` grows, matching the qualitative behavior real
 *   rounded-blade irises show (softer, rounder bokeh than straight blades, but not a perfect circle at low
 *   blade counts).
 *
 * segments is the number of samples per edge (straight blades still return one point pair per edge; rounded
 * blades sample the arc at this resolution).
 */
export function irisOutline(blades: number, radius: number, rounded: boolean, rotation: number, segments = 8): Vec2[] {
  if (blades < 3) throw new Error(`iris.ts: irisOutline: blades must be >= 3, got ${blades}`);
  if (!(radius > 0)) throw new Error(`iris.ts: irisOutline: radius must be positive, got ${radius}`);
  const n = blades;
  const vertex = (i: number): Vec2 => {
    const a = rotation + (2 * Math.PI * i) / n;
    return [radius * Math.cos(a), radius * Math.sin(a)];
  };
  const pts: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const v1 = vertex(i);
    if (!rounded) {
      pts.push(v1);
      continue;
    }
    const v2 = vertex(i + 1);
    const inradius = radius * Math.cos(Math.PI / n);
    const midAngle = rotation + (2 * Math.PI * (i + 0.5)) / n;
    const apexR = inradius + 0.9 * (radius - inradius);
    const apex: Vec2 = [apexR * Math.cos(midAngle), apexR * Math.sin(midAngle)];
    const arc = sampleArc(v1, apex, v2, segments);
    // drop the last point of each arc (== v2 == next edge's first point) to avoid duplicates, except the final
    // edge, whose closing point we want to keep off (the caller treats the polyline as implicitly closed).
    pts.push(...arc.slice(0, -1));
  }
  return pts;
}

/** Point-in-outline test for TraceSystem.iris, via the standard ray-casting rule on irisOutline's polyline. */
export function irisTest(blades: number, radius: number, rounded: boolean, rotation: number, segments = 8): (x: number, y: number) => boolean {
  const poly = irisOutline(blades, radius, rounded, rotation, segments);
  return (x: number, y: number): boolean => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i];
      const [xj, yj] = poly[j];
      const crosses = yi > y !== yj > y;
      if (crosses) {
        const xCross = xi + ((y - yi) / (yj - yi)) * (xj - xi);
        if (x < xCross) inside = !inside;
      }
    }
    return inside;
  };
}

/**
 * Each physical blade's own outline, for drawing the iris mechanism itself (not just the opening it leaves).
 * Schematic: blade i occupies the angular sector [rotation + i*2*pi/n, rotation + (i+1)*2*pi/n), bounded on the
 * inside by that sector's edge of the current opening (the same edge irisOutline draws — straight or arced per
 * `rounded`) and on the outside by a fixed housing radius, 2x the opening radius. There is no attempt to model
 * how the blades overlap or pivot mechanically; this is a labeled schematic for the cutaway view, per
 * docs/ENGINE.md.
 */
export function bladeShapes(blades: number, radius: number, rounded: boolean, rotation: number, segments = 8): Vec2[][] {
  if (blades < 3) throw new Error(`iris.ts: bladeShapes: blades must be >= 3, got ${blades}`);
  if (!(radius > 0)) throw new Error(`iris.ts: bladeShapes: radius must be positive, got ${radius}`);
  const n = blades;
  const housingR = radius * 2;
  const vertex = (i: number, r: number): Vec2 => {
    const a = rotation + (2 * Math.PI * i) / n;
    return [r * Math.cos(a), r * Math.sin(a)];
  };
  const inradius = radius * Math.cos(Math.PI / n);
  const shapes: Vec2[][] = [];
  for (let i = 0; i < n; i++) {
    const v1 = vertex(i, radius);
    const v2 = vertex(i + 1, radius);
    let inner: Vec2[];
    if (!rounded) {
      inner = [v1, v2];
    } else {
      const midAngle = rotation + (2 * Math.PI * (i + 0.5)) / n;
      const apexR = inradius + 0.9 * (radius - inradius);
      const apex: Vec2 = [apexR * Math.cos(midAngle), apexR * Math.sin(midAngle)];
      inner = sampleArc(v1, apex, v2, segments);
    }
    const outerFar: Vec2 = vertex(i + 1, housingR);
    const outerNear: Vec2 = vertex(i, housingR);
    shapes.push([...inner, outerFar, outerNear]);
  }
  return shapes;
}
