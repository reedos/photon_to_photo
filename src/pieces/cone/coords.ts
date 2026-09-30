// Coordinate mapping and small geometry helpers for the cone-of-focus piece. Pure math on numbers the engine
// already computed (model.system.surfaces' z/c/k/a/sd, Bundle's landing points) -- no new physics, just turning
// already-given numbers into scene-space points, per pieces/types.ts's contract ("pieces never compute physics").
//
// Scene-space convention for this piece only (src/pieces/cone/**): the engine's optical axis (model z, light
// travels toward +z) maps to the THREE scene's local +X, so the piece's group can sit on the stage like the
// app-shell stub's axis line did (see the former src/pieces/cone.ts stub: an axis line along local X). Model y
// (vertical, up) maps to scene Y unchanged; model x (horizontal) maps to scene Z. The origin is the exit pupil
// (model.cardinal.xp.z), so the schematic pupil disc always sits at local (0,0,0) regardless of which lens or
// focus distance is picked -- every other z (mm) in this piece is relative to that.
import * as THREE from 'three/webgpu';

/** model (x, y, z) mm -> scene-local Vector3, per this module's convention. `originZ` is usually model.cardinal.xp.z. */
export function sceneFromModel(x: number, y: number, z: number, originZ: number): THREE.Vector3 {
  return new THREE.Vector3(z - originZ, y, x);
}

/**
 * Conic + even-asphere sag z(h) at radial height h, for a surface described the way TraceSurface (engine/types.ts)
 * already carries it: curvature c (1/mm), conic constant k, even asphere coefficients a[i] for order 4+2*i. This
 * is the standard lens-design sag formula (e.g. Smith, "Modern Optical Engineering", ch. 3, or any Zemax/CODE V
 * manual's surface-sag section) -- the same one realize.ts's own comments describe scaling for -- applied here to
 * numbers the Model already resolved (TraceSurface.c/k/a), not re-derived or invented. Used only to draw the last
 * element's real curved profile as faint glass (BRIEF.md set piece 3's own "last element as faint glass").
 */
export function sagAt(c: number, k: number, a: number[], h: number): number {
  let z = 0;
  if (c !== 0) {
    const disc = 1 - (1 + k) * c * c * h * h;
    if (disc > 0) z = (c * h * h) / (1 + Math.sqrt(disc));
  }
  for (let i = 0; i < a.length; i++) {
    const order = 4 + 2 * i;
    z += a[i] * h ** order;
  }
  return z;
}

/**
 * 2D convex hull (monotone chain, Andrew's algorithm -- e.g. de Berg et al., "Computational Geometry", 3rd ed.,
 * sec. 1.1) of `pts`, returned as the ORIGINAL indices into `pts`, in hull order (counter-clockwise). Used to find
 * the bundle's outer rays for the cone surface (BRIEF.md: "convex hull of rays per cross-section") from the real
 * traced landing points -- no invented geometry, just the boundary of the real point set.
 */
export function convexHullIndices(pts: { x: number; y: number }[]): number[] {
  const n = pts.length;
  if (n < 3) return pts.map((_, i) => i);
  const order = pts.map((_, i) => i).sort((i, j) => (pts[i].x - pts[j].x) || (pts[i].y - pts[j].y));
  const cross = (o: number, a: number, b: number) =>
    (pts[a].x - pts[o].x) * (pts[b].y - pts[o].y) - (pts[a].y - pts[o].y) * (pts[b].x - pts[o].x);

  const lower: number[] = [];
  for (const i of order) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], i) <= 0) lower.pop();
    lower.push(i);
  }
  const upper: number[] = [];
  for (let k = order.length - 1; k >= 0; k--) {
    const i = order[k];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], i) <= 0) upper.pop();
    upper.push(i);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** Bounding-box half-extent (max |x|, |y| from centroid) of a point set, for framing an inset/plane around it. */
export function halfExtent(pts: { x: number; y: number }[], cx: number, cy: number): number {
  let r = 0;
  for (const p of pts) r = Math.max(r, Math.abs(p.x - cx), Math.abs(p.y - cy));
  return r;
}

/** A flat ring (circle outline) in the local X=const plane (the sensor/pupil plane in this piece's convention),
 *  centered at scene (planeX, cy, cx), radius r (mm), `segments` points. `dashed`: alternate segments omitted so
 *  the caller can feed this to a LineSegments (not a closed Line loop) for a dashed ring without needing
 *  THREE.LineDashedMaterial's screen-space dash units (which don't stay a constant mm dash length across zoom). */
export function ringPoints(planeX: number, cz: number, cy: number, r: number, segments: number, dashed: boolean): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < segments; i++) {
    if (dashed && i % 2 === 1) continue;
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    pts.push(new THREE.Vector3(planeX, cy + r * Math.sin(a0), cz + r * Math.cos(a0)));
    pts.push(new THREE.Vector3(planeX, cy + r * Math.sin(a1), cz + r * Math.cos(a1)));
  }
  return pts;
}
