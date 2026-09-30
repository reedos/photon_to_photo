// Lathed glass geometry for the lens cutaway (set piece 2): every element/plate is a solid of revolution built
// directly from its two surfaces' real sag profiles (surface.ts's sag()), never an invented shape. Pure Three.js
// geometry builders -- no physics here, only turning already-computed TraceSurface data into vertices.
//
// Coordinate convention: this module revolves around the WORLD Z axis directly (not Three.js's default lathe
// axis, Y), so a mesh built here needs no extra rotation to line up with the engine's optical-axis-is-Z
// convention (types.ts) -- a vertex at local (r, theta, z) maps straight to world (r*cos(theta), r*sin(theta), z).
// Every element's geometry is built in LOCAL coordinates relative to its own FRONT surface vertex (z=0 there);
// the caller positions the element's THREE.Group at that vertex's current absolute z (model.system.surfaces[i].z)
// so a focus change only moves a Group, never rebuilds a vertex buffer (an element's own two-surface thickness
// does not change with focus -- only the air gaps between elements/groups do; see docs/pieces/lens.md).
import * as THREE from 'three/webgpu';
import { sag } from '../../engine/surface';
import type { TraceSurface } from '../../engine/types';

export const RADIAL_SEGMENTS = 28; // profile samples from axis to clear-aperture rim, per surface
export const ANGULAR_SEGMENTS = 48; // samples around the 270 degree sweep

/** The camera/cutaway direction every element's wedge gap opens toward, and the default frame() direction --
 *  shared so the missing wedge always faces the viewer regardless of which lens or camera distance is in play. */
export const CUTAWAY_DIR = new THREE.Vector3(-0.86, 0.3, -0.42).normalize();

/** The half section: everything at x < 0 is removed, the same cut the lineup lenses' GLB housings carry
 *  (public/models/lenses.json: "half" parts are x >= 0, section capped), so the engine glass drawn here and the
 *  real barrel around it are cut in one plane. The viewer looks in from the -x side (CUTAWAY_DIR.x < 0), and the
 *  meridional ray fan lies in that same plane. */
export function wedgeAngles(): { thetaStart: number; thetaLength: number; gapCenter: number } {
  return { thetaStart: -Math.PI / 2, thetaLength: Math.PI, gapCenter: Math.PI };
}

export interface ProfilePoint {
  r: number;
  z: number; // LOCAL z, relative to the element's own front-surface vertex
}

export interface BodyProfile {
  front: ProfilePoint[]; // r: 0 -> sdFront, along the front surface's own sag
  rim: ProfilePoint[]; // the ground edge: front rim -> (annulus) -> OD cylinder -> (annulus) -> back rim
  back: ProfilePoint[]; // r: sdBack -> 0, along the back surface's own sag, local z includes the thickness offset
  od: number; // outer diameter radius = max(sdFront, sdBack) -- the physical ground edge
}

const EPS = 1e-6;

/**
 * The element's true cross-section, front surface to back surface, per the task brief: "a lathed solid from its
 * two surfaces' real sag profiles ... out to each surface's clear semi-diameter, joined by a cylindrical edge;
 * where one surface is smaller, a flat annulus (as real elements are ground)." `intraThickness` is the fixed
 * (focus-independent) axial gap between the two surfaces' vertices -- an element's own glass thickness, as
 * opposed to the air gaps between elements, which do move with focus (see the module doc above).
 *
 * Guards against a design where the two surfaces cross before the rim (zero or negative glass thickness
 * somewhere inside the clear aperture) by reporting it (console.warn) rather than building an inverted solid --
 * the task's own "guard against surfaces that cross before the rim (report it)" instruction. Not expected to
 * trip on any of the project's shipped lens prescriptions; a real defect in a future one would want to see this.
 */
export function buildBodyProfile(
  frontSurf: TraceSurface,
  backSurf: TraceSurface,
  intraThickness: number,
  label: string,
): BodyProfile {
  const sdFront = frontSurf.sd;
  const sdBack = backSurf.sd;
  const od = Math.max(sdFront, sdBack);
  const minSd = Math.min(sdFront, sdBack);

  const front: ProfilePoint[] = [];
  for (let i = 0; i <= RADIAL_SEGMENTS; i++) {
    const r = (i / RADIAL_SEGMENTS) * sdFront;
    front.push({ r, z: sag(frontSurf, r) });
  }
  const back: ProfilePoint[] = [];
  for (let i = RADIAL_SEGMENTS; i >= 0; i--) {
    const r = (i / RADIAL_SEGMENTS) * sdBack;
    back.push({ r, z: intraThickness + sag(backSurf, r) });
  }

  // Guard: sample the thickness (back z minus front z) across the shared radius range; it must stay positive.
  for (let i = 0; i <= 8; i++) {
    const r = (i / 8) * minSd;
    const thickness = intraThickness + sag(backSurf, r) - sag(frontSurf, r);
    if (thickness < EPS) {
      console.warn(
        `lens/geometry.ts: ${label}: front and back surfaces cross at r=${r.toFixed(2)}mm ` +
          `(thickness ${thickness.toFixed(4)}mm) -- the element's own geometry would invert here`,
      );
      break;
    }
  }

  const zFrontRim = sag(frontSurf, sdFront);
  const zBackRim = intraThickness + sag(backSurf, sdBack);
  const rim: ProfilePoint[] = [{ r: sdFront, z: zFrontRim }];
  if (sdFront < od - EPS) rim.push({ r: od, z: zFrontRim });
  rim.push({ r: od, z: zBackRim }); // the ground edge's own cylindrical wall
  if (sdBack < od - EPS) rim.push({ r: sdBack, z: zBackRim });

  return { front, rim, back, od };
}

/** points[0..n-1] revolved from thetaStart through thetaLength (radians) around world Z, `angularSegments`
 *  steps. Smooth per-strip vertex normals (computeVertexNormals) -- a real crease at a strip boundary (e.g.
 *  optical surface to ground rim) comes for free because each strip is its own BufferGeometry/mesh, so normals
 *  never average across that seam. */
export function revolveStrip(
  points: ProfilePoint[],
  thetaStart: number,
  thetaLength: number,
  angularSegments = ANGULAR_SEGMENTS,
): THREE.BufferGeometry {
  const rows = points.length;
  const cols = angularSegments + 1;
  const pos = new Float32Array(rows * cols * 3);
  for (let p = 0; p < rows; p++) {
    for (let a = 0; a < cols; a++) {
      const theta = thetaStart + (thetaLength * a) / angularSegments;
      const { r, z } = points[p];
      const i = (p * cols + a) * 3;
      pos[i] = r * Math.cos(theta);
      pos[i + 1] = r * Math.sin(theta);
      pos[i + 2] = z;
    }
  }
  const index: number[] = [];
  for (let p = 0; p < rows - 1; p++) {
    for (let a = 0; a < cols - 1; a++) {
      const i00 = p * cols + a;
      const i01 = p * cols + a + 1;
      const i10 = (p + 1) * cols + a;
      const i11 = (p + 1) * cols + a + 1;
      // Wound so the outward (increasing-r) side faces out for a profile traversed axis-to-rim; a mesh built
      // from a rim-to-axis (reversed) profile comes out consistently inside-out, which is why callers that need
      // an inward-facing wall (the barrel's inner bore) ask for THREE.BackSide/DoubleSide rather than a second
      // hand-flipped index order here.
      index.push(i00, i10, i11, i00, i11, i01);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(index);
  geo.computeVertexNormals();
  return geo;
}

/** The flat "cut face" at a fixed angle, filled with the body's true cross-section (ShapeGeometry triangulates
 *  the possibly-concave polygon via earcut) -- LOOK.md/the brief: "the cut faces CAPPED by the element's true
 *  cross-section, so the profile reads." `outwardSign` picks which way the (uniform, since the cap is flat)
 *  normal points: +1 for the cap at thetaStart+thetaLength (facing further into the gap), -1 for the one at
 *  thetaStart (facing back the other way). */
export function buildCap(loop: ProfilePoint[], theta: number, outwardSign: 1 | -1): THREE.BufferGeometry {
  const shape = new THREE.Shape(loop.map((p) => new THREE.Vector2(p.r, p.z)));
  const geo = new THREE.ShapeGeometry(shape);
  const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  for (let i = 0; i < posAttr.count; i++) {
    const r = posAttr.getX(i);
    const z = posAttr.getY(i);
    posAttr.setXYZ(i, r * cos, r * sin, z);
  }
  posAttr.needsUpdate = true;
  const normal = new Float32Array(posAttr.count * 3);
  const nx = -sin * outwardSign;
  const ny = cos * outwardSign;
  for (let i = 0; i < posAttr.count; i++) {
    normal[i * 3] = nx;
    normal[i * 3 + 1] = ny;
    normal[i * 3 + 2] = 0;
  }
  geo.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  geo.computeBoundingSphere();
  return geo;
}

/** A flat rectangular wedge-wall cap (the barrel's own wall thickness at the cut, since it has no curved profile
 *  to speak of -- see build-barrel.ts) at a fixed angle, innerR..outerR, z0..z1. */
export function buildWedgeWallCap(innerR: number, outerR: number, z0: number, z1: number, theta: number, outwardSign: 1 | -1): THREE.BufferGeometry {
  return buildCap(
    [
      { r: innerR, z: z0 },
      { r: outerR, z: z0 },
      { r: outerR, z: z1 },
      { r: innerR, z: z1 },
    ],
    theta,
    outwardSign,
  );
}

/** A flat partial annulus at fixed z (the barrel's front/back rim, or the sensor's mount ring), normal along Z. */
export function buildAnnulusZ(innerR: number, outerR: number, z: number, thetaStart: number, thetaLength: number, outwardSign: 1 | -1, segments = ANGULAR_SEGMENTS): THREE.BufferGeometry {
  const rows = 2;
  const cols = segments + 1;
  const pos = new Float32Array(rows * cols * 3);
  for (let a = 0; a < cols; a++) {
    const theta = thetaStart + (thetaLength * a) / segments;
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    const i0 = a * 3;
    pos[i0] = innerR * c;
    pos[i0 + 1] = innerR * s;
    pos[i0 + 2] = z;
    const i1 = (cols + a) * 3;
    pos[i1] = outerR * c;
    pos[i1 + 1] = outerR * s;
    pos[i1 + 2] = z;
  }
  const index: number[] = [];
  for (let a = 0; a < cols - 1; a++) {
    const i00 = a, i01 = a + 1, i10 = cols + a, i11 = cols + a + 1;
    if (outwardSign > 0) index.push(i00, i10, i11, i00, i11, i01);
    else index.push(i00, i11, i10, i00, i01, i11);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(index);
  const normal = new Float32Array(rows * cols * 3);
  for (let i = 0; i < rows * cols; i++) normal[i * 3 + 2] = outwardSign;
  geo.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  return geo;
}

export function disposeGeometries(...geos: (THREE.BufferGeometry | undefined | null)[]): void {
  for (const g of geos) g?.dispose();
}
