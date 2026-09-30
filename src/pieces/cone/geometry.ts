// Mesh builders for the cone-of-focus piece, all from numbers the Model/Bundle already carry (surface z/c/k/a/sd,
// the exit pupil, and the bundle's own traced ray endpoints) -- see coords.ts's module doc for the scene-space
// convention (model z -> scene local X) every builder here follows.
import * as THREE from 'three/webgpu';
import type { RayPath } from '../../engine/types';
import { convexHullIndices, sagAt, sceneFromModel } from './coords';

/** The last element as faint glass: a real lathed profile from its own two surfaces' sag (not a schematic bulge),
 *  revolved about the optical axis. `originZ` is the scene-space origin (model.cardinal.xp.z, coords.ts). */
export function buildLastElementGeometry(
  entry: { z: number; c: number; k: number; a: number[]; sd: number },
  exit: { z: number; c: number; k: number; a: number[]; sd: number },
  originZ: number,
  segments = 48,
): THREE.BufferGeometry {
  const rimSd = Math.max(entry.sd, exit.sd);
  const rSteps = 20;
  const pts: THREE.Vector2[] = [];
  // Front surface, apex (r=0) out to the rim.
  for (let i = 0; i <= rSteps; i++) {
    const h = (rimSd * i) / rSteps;
    pts.push(new THREE.Vector2(Math.max(0.0001, h), entry.z - originZ + sagAt(entry.c, entry.k, entry.a, h)));
  }
  // Back surface, rim back to the axis (reverse order).
  for (let i = rSteps; i >= 0; i--) {
    const h = (rimSd * i) / rSteps;
    pts.push(new THREE.Vector2(Math.max(0.0001, h), exit.z - originZ + sagAt(exit.c, exit.k, exit.a, h)));
  }
  const geom = new THREE.LatheGeometry(pts, segments);
  // LatheGeometry revolves about local Y; this piece's optical axis is scene local X (coords.ts). rotateZ(-90 deg)
  // takes lathe +Y onto scene +X (rotateZ(+90 deg), used here before, took it onto -X and drew the element
  // mirrored behind the exit pupil: the large gray disc clipped at the view's left edge in review round 0).
  geom.rotateZ(-Math.PI / 2);
  return geom;
}

/** A flat schematic disc in the local X=const plane (Y-Z, this piece's sensor/pupil-plane convention), radius r
 *  (mm), centered at scene (planeX, cz, cy). Used for the exit pupil disc and, larger, the sensor plate. */
export function buildDiscGeometry(planeX: number, cz: number, cy: number, r: number, segments = 64): THREE.BufferGeometry {
  const geom = new THREE.CircleGeometry(r, segments);
  geom.rotateY(Math.PI / 2); // CircleGeometry faces +Z by default; rotate its normal onto +X
  geom.translate(planeX, cy, cz);
  return geom;
}

/** A flat schematic rectangle (the sensor format's real width/height, mm) in the same X=const plane. */
export function buildRectGeometry(planeX: number, widthZ: number, heightY: number): THREE.BufferGeometry {
  const geom = new THREE.PlaneGeometry(widthZ, heightY);
  geom.rotateY(Math.PI / 2);
  geom.translate(planeX, 0, 0);
  return geom;
}

/** The bokeh-disk texture plane: local +X maps to scene +Z (model x), local +Y stays scene +Y (model y), matching
 *  disk-texture.ts's own px/py convention exactly (unlike buildRectGeometry/buildDiscGeometry's rotateY(+90),
 *  which mirrors model x -- fine for a symmetric disc/rectangle, wrong for a textured, orientation-sensitive
 *  disk whose cat's-eye shape has a real handedness toward the field edge). */
export function buildDiskPlaneGeometry(planeX: number, cz: number, cy: number, halfExtentMm: number): THREE.BufferGeometry {
  const geom = new THREE.PlaneGeometry(halfExtentMm * 2, halfExtentMm * 2);
  geom.rotateY(-Math.PI / 2);
  geom.translate(planeX, cy, cz);
  return geom;
}

/** True-pitch pixel-grid lines in the sensor plane, capped at `maxLines` per axis so an extreme defocus (a huge
 *  blur circle at a fine pitch) doesn't ask for tens of thousands of segments. */
export function buildPixelGridPositions(planeX: number, cz: number, cy: number, halfExtentMm: number, pitchMm: number, maxLines: number): Float32Array {
  const nHalf = Math.min(maxLines, Math.floor(halfExtentMm / pitchMm));
  const pts: number[] = [];
  for (let i = -nHalf; i <= nHalf; i++) {
    const y = cy + i * pitchMm;
    pts.push(planeX, y, cz - halfExtentMm, planeX, y, cz + halfExtentMm);
  }
  for (let i = -nHalf; i <= nHalf; i++) {
    const z = cz + i * pitchMm;
    pts.push(planeX, cy - halfExtentMm, z, planeX, cy + halfExtentMm, z);
  }
  return new Float32Array(pts);
}

/** From every 'ok' ray, the point it last touched a physical surface (pts[length-2]) and where it landed on the
 *  sensor (pts[length-1] == the matching Bundle.landing entry) -- the real final leg of its traced path, not an
 *  invented straight line to a pupil-rim point. RayPath.nm already carries its own wavelength (types.ts). */
function lastLeg(ray: RayPath): { start: [number, number, number]; end: [number, number, number] } | null {
  if (ray.status !== 'ok' || ray.pts.length < 2) return null;
  return { start: ray.pts[ray.pts.length - 2], end: ray.pts[ray.pts.length - 1] };
}

/**
 * The translucent cone surface: the convex hull of the bundle's landing points on the sensor (its outer rays,
 * BRIEF.md/PROTOTYPE.md), each hull ray's own last-surface point forming the corresponding "top" vertex, so the
 * lateral surface follows real per-ray correspondence -- a warped frustum from the real aperture-side cross
 * section to the real disk boundary, not an idealized circular cone.
 */
export function buildConeSurfaceGeometry(paths: RayPath[], originZ: number): THREE.BufferGeometry | null {
  const legs = paths.map(lastLeg).filter((l): l is NonNullable<typeof l> => l !== null);
  if (legs.length < 3) return null;
  const endPts2 = legs.map((l) => ({ x: l.end[0], y: l.end[1] }));
  const hull = convexHullIndices(endPts2);
  if (hull.length < 3) return null;

  const positions: number[] = [];
  const pushTri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  };
  for (let i = 0; i < hull.length; i++) {
    const j = (i + 1) % hull.length;
    const li = legs[hull[i]];
    const lj = legs[hull[j]];
    const startI = sceneFromModel(li.start[0], li.start[1], li.start[2], originZ);
    const startJ = sceneFromModel(lj.start[0], lj.start[1], lj.start[2], originZ);
    const endI = sceneFromModel(li.end[0], li.end[1], li.end[2], originZ);
    const endJ = sceneFromModel(lj.end[0], lj.end[1], lj.end[2], originZ);
    pushTri(startI, endI, endJ);
    pushTri(startI, endJ, startJ);
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.computeVertexNormals();
  return geom;
}

/** A sparse subsample of individual rays (their real last leg), for the spectral-color line detail inside the
 *  cone surface. Returns a flat position array (pairs of points, for LineSegments) plus the matching nm per pair. */
export function sparseRaySegments(paths: RayPath[], originZ: number, maxCount: number): { positions: Float32Array; nms: number[] } {
  const legs: { start: [number, number, number]; end: [number, number, number]; nm: number }[] = [];
  for (const r of paths) {
    const leg = lastLeg(r);
    if (leg) legs.push({ ...leg, nm: r.nm });
  }
  const step = Math.max(1, Math.floor(legs.length / maxCount));
  const chosen = legs.filter((_, i) => i % step === 0).slice(0, maxCount);
  const positions = new Float32Array(chosen.length * 6);
  const nms: number[] = [];
  chosen.forEach((leg, i) => {
    const s = sceneFromModel(leg.start[0], leg.start[1], leg.start[2], originZ);
    const e = sceneFromModel(leg.end[0], leg.end[1], leg.end[2], originZ);
    positions.set([s.x, s.y, s.z, e.x, e.y, e.z], i * 6);
    nms.push(leg.nm);
  });
  return { positions, nms };
}
