import { selectionFrame } from './selection-frame';
import '../styles/photon-rain.css';
// Set piece 9, the loupe: docs/BRIEF.md #9, design/LOOK.md "9. The loupe," docs/PROTOTYPE.md's loupe section.
// The scene is an explicitly controlled 18% neutral sample. Its pixel values come from the engine's sensor
// sampling path, its ray bundle from pointBundle(), and the well fill from electrons/fullWell. It does not
// render or inspect a photograph.
//
// Local Y runs through the pixel stack. Display dimensions are enlarged for legibility.
import * as THREE from 'three/webgpu';
import type { BuildPiece, CameraFrame, Inset, PartCard, PieceProbe } from './types';
import type { Bundle, Model } from '../engine/model-types';
import type { Fig, RayPath } from '../engine/types';
import { pointBundle, pointBundleSliced } from '../app/engine-api';
import { traceableBins } from './lens/valid-bins';
import { badgeJoin, isPhone } from './phone-frame';
import { cfaColorAt } from '../engine/pipeline';
import { ASSUMED_INPUTS_NOTE } from '../engine/exposure';
import { sampleNeutralPixel, type ControlledPixelInfo } from './pixel-sample';
import { isoLabel } from '../app/stops';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/** The reference pixel's one stochastic draw (shot noise, PRNU, read noise): the same seed for every setting. */
const CONTROLLED_SEED = 1;

// ---- display constants (local units; never true scale -- the badge always says so) ---------------------------

const Y_GRID = 0; // the pixel-neighborhood layer (microlens/CFA/photodiode/well all stack around this)
const GRID_N = 5; // "a few neighbors" per LOOK.md -- a 5x5 block, center cell fully detailed, edges in view
const CELL = 5; // grid spacing, local units

const MICROLENS_APEX_Y = Y_GRID + 3.2;
const MICROLENS_BASE_Y = Y_GRID + 1.5;
const CFA_TOP_Y = MICROLENS_BASE_Y;
const CFA_BOT_Y = Y_GRID + 0.95;
const DIODE_TOP_Y = CFA_BOT_Y;
const DIODE_BOT_Y = Y_GRID + 0.25;
const WELL_TOP_Y = DIODE_BOT_Y;
const WELL_BOT_Y = Y_GRID - 3.6;
const WELL_HEIGHT = WELL_TOP_Y - WELL_BOT_Y;
// The charge's smallest drawn height (a zero-height mesh disappears); the well card states it (score loop r2).
const WELL_MIN_DRAWN = 0.015;
// A sensor as it really is: every pixel carries the same stack (a CFA tile filling nearly the whole pitch, a
// microlens dome on top) on one silicon die. The neighbors are that stack with the target's detail left out
// (design/LOOK.md #9: "the target well is the only fully detailed one"): no well drawn, tints a touch dimmer.
const CELL_HALF = CELL * 0.46; // CFA tile half-size: the tiles meet with a thin gap, as on a real array
const NEIGHBOR_DIM = 0.62;
const TARGET_HALF = CELL * 0.44; // target stack footprint half-size
// The die is cut open in front of the target pixel (its column of cells toward the viewer removed down to the
// bottom of the well), the way a sensor cross-section is drawn, so the well is seen from the side through the cut.
const HALF_ARRAY = (GRID_N * CELL) / 2;
const DIE_BOT_Y = Y_GRID - 4.3;
const DIE_BEVEL = 0.16; // score loop r6
// The stack's own layers (pixel/CFA/photodiode) sit only fractions of a unit apart -- their PIN anchors (not
// the meshes) are nudged sideways, each its own compass direction, so their on-screen labels stay legible and
// non-overlapping at the well framing's oblique angle (design/RUBRIC.md's "overlapping labels" smell). The well
// frame's camera looks mostly ALONG local Z (a three-quarter angle from +Z), which foreshortens a pure +Z/-Z
// separation almost to nothing on screen -- found directly from the art director's and critic's own screenshots,
// where "the well" and "the color filter" pins (previously opposite ends of the Z axis only) sat fused. Anchors
// below mix X and Z per pin (a real compass spread, not an axis each) so every pair keeps real screen-space
// separation from the well frame's actual viewing angle, not just 3D separation that projects away.
const PIN_SPREAD = TARGET_HALF * 2.4;
// Off-screen sentinel (RUBRIC.md's "overlapping labels" smell, the grid-overview case): before a tap, every
// Stack pins stay outside the view until the controlled pixel sample is available.
const PIN_HIDE = new THREE.Vector3(0, -1e6, 0);

// how far a short view (220-300 px) aims above WELL_FRAME, so the stack sits under the reading strip (wellFrame)
const SHORT_VIEW_LIFT = 0.8;

const WELL_FRAME: CameraFrame = {
  // Looking into the cut from the front and a little to the side, down at about 30 degrees: the microlens, the
  // filter, the photodiode and the glass well with its charge stack up in one view, with the die's cut faces
  // and the neighbors' tiles around them for scale.
  // A moderate three-quarter angle, not the steep top-down look this went through first: straight down buried
  // the wider glass well and its charge fill behind the opaque photodiode slab directly above it, and a near-
  // eye-level angle clipped into the surrounding neighbor grid's own huge (relatively) swatches at this scale
  // (both found while reviewing this piece's own screenshots). This angle clears the grid and still shows the
  // well's own side wall below the narrower diode above it. Pulled back and raised slightly from an earlier,
  // tighter version of this same three-quarter angle (art director, "charge-fill-illegible"): that tighter
  // framing cropped the microlens dome out of the resting shot entirely and left only the diode+well slab
  // filling the frame -- legible per the accuracy gate's own numbers, but with nothing else in shot to give the
  // charge fill visual context. This framing keeps the same angle but backs off enough to hold the dome, the
  // diode and the well together, the same three parts the mid-dive frame shows (see docs/pieces/loupe.md).
  // (score loop r2: x 10 -> 0.5 (about 4.4 after the pan clear of the reading card). From x = 10 the right-hand neighbor column stood between the camera and the bottom
  // of the well, so the charge could only be seen by drawing it with depth testing off, as a pale square floating on
  // the neighbor's filter. From here the sight line to the well floor runs down the opened column.)
  position: new THREE.Vector3(0.5, Y_GRID + 12, 26),
  target: new THREE.Vector3(0, WELL_BOT_Y + WELL_HEIGHT * 0.6, 1.5),
};

// The ray-bundle request: rays: ~200 pupil samples (the brief's own figure) x a representative spread of
// wavelength bins (fewer than the lens cutaway's 16 -- this cone is about the CONVERGENCE, not chromatic
// splitting, so a representative rainbow reads fine at far lower ray count and cost; see docs/pieces/loupe.md).
const BUNDLE_RAYS = 192;
const BUNDLE_NMS = [430, 470, 505, 540, 575, 610, 650, 690];
// Score loop r6: a change made while the level is on screen (a slider drag) samples the pixel on the next animation frame, draws a
// coarse ray bundle (a quarter of the rays per color, every other color: an eighth of the trace), and traces the full bundle
// once the input has been quiet for BUNDLE_SETTLE_MS. The full trace ran on every input event before (38 ms on a desktop,
// 406-453 ms per frame on a 4x phone).
const COARSE_BUNDLE_RAYS = 48;
const BUNDLE_SETTLE_MS = 120;

// Photon sparks: a small fixed pool, cycling continuously while the well is in view -- decorative arrival
// motion on top of a well fill that is ALWAYS drawn at its true, static electrons/fullWell value (never
// animated up from empty). See docs/pieces/loupe.md, "known limits," for why the animation and the drawn
// fill level are deliberately decoupled.
const SPARK_POOL = 18;
const SPARK_FALL_MS = 900;
const SPARK_SPAWN_Y = MICROLENS_APEX_Y + 3.4;

// The spark badge summarizes the represented photon count for the controlled sample.
const DOT_BUDGET = 40;

// score loop r6: how much of the studio the microlens domes reflect (was 1.0 and 1.1)
const DOME_ENV = 0.42;

const CFA_NAME: Record<string, string> = { R: 'red', G: 'green', B: 'blue' };

function fmtInt(v: number): string {
  return Math.round(v).toLocaleString('en-US');
}
function fmtNum(v: number, digits = 1): string {
  return v.toLocaleString('en-US', { maximumFractionDigits: digits });
}
function fig(v: number, unit: string, ev: Fig['ev'], calc?: string, src?: string): Fig {
  return { v, unit, ev, calc, src };
}

/** Labels the controlled target and the number of photons represented by a drawn spark. */
function badgeTextFor(b: { n: number; dotsDrawn: number }): string {
  const sample = 'CONTROLLED 18% GRAY';
  if (b.dotsDrawn === 0) return sample;
  return badgeJoin(sample, `1 DOT = ${fmtInt(b.n)} ${b.n === 1 ? 'PHOTON' : 'PHOTONS'}`);
}

interface BadgeInfo {
  n: number; // photons per drawn dot
  dotsDrawn: number;
  photonsMean: number;
}

function badgeFor(photonsMean: number): BadgeInfo {
  const n = Math.max(1, Math.round(photonsMean / DOT_BUDGET));
  const dotsDrawn = Math.max(1, Math.round(photonsMean / n));
  return { n, dotsDrawn, photonsMean };
}

// ---- small mesh builders (materials always from ctx.look, per design/LOOK.md) --------------------------------

function makeNeighborSwatch(look: import('./types').PieceContext['look'], channel: 'R' | 'G' | 'B'): THREE.Mesh {
  const mat = look.cfaDyeMaterial(channel);
  mat.color.multiplyScalar(NEIGHBOR_DIM);
  // Opaque dyed tiles for the context pixels: transmission on 48 small tiles costs a pass for nothing a reader
  // can see at this scale, and a slightly rough dye surface reads as a colored film, not as flat paint.
  mat.transmission = 0;
  // score loop r3: rougher dye and coat, so a key light's highlight spreads into a soft sheen across the film instead of
  // a white point on every tile (it read as dust)
  // score loop r4: a semi-matte dyed film. The tiles keep no clearcoat of their own now, so the only sharp highlight in
  // the scene is the microlens's; a faint film texture (darker toward the edge) and a rounded edge stop each tile being a
  // flat primary slab with a hard corner.
  mat.roughness = 0.66;
  mat.clearcoat = 0.06;
  mat.clearcoatRoughness = 0.7;
  mat.specularIntensity = 0.7;
  const film = look.dyeFilmTexture();
  if (film) mat.map = film;
  const mesh = new THREE.Mesh(tileGeometry(CELL_HALF * 2, CFA_TOP_Y - CFA_BOT_Y, CELL_HALF * 2), mat);
  return mesh;
}

/** A Bayer tile's block with a small bevel on its edges, so it catches a thin line of light at each rim like a real
 *  filter film does (score loop r4). One geometry per size, shared by every tile. */
const tileGeos = new Map<string, THREE.BufferGeometry>();
function tileGeometry(w: number, h: number, d: number): THREE.BufferGeometry {
  const key = `${w}|${h}|${d}`;
  let g = tileGeos.get(key);
  if (!g) {
    g = new RoundedBoxGeometry(w, h, d, 2, Math.min(w, h, d) * 0.28);
    tileGeos.set(key, g);
  }
  return g;
}

/** A clear glass dome drawn by what it reflects alone (score loop r3): a black base added on top of what lies behind
 *  it, so the dome never grays the tile under it or the void beyond it (a white base at 8 to 16% opacity read as
 *  smoky gray domes that seemed to sit off their tiles), while the Fresnel rise of its coat outlines it with the
 *  studio panels it reflects. The piece gives it the camera studio's environment (studioLit). */
function clearDome(mat: THREE.MeshPhysicalMaterial): THREE.MeshPhysicalMaterial {
  mat.color.set(0x000000);
  mat.metalness = 0;
  mat.roughness = 0.5;
  mat.transparent = true;
  mat.opacity = 1;
  mat.blending = THREE.AdditiveBlending;
  mat.depthWrite = false;
  mat.clearcoat = 1;
  // score loop r5: smooth again (0.14 and 0.06), the reverse of the r4 change. At 0.5 every dome's reflection spread into
  // a broad white smudge over the tile under it and a grey cap over the far row, so neither read as a lens. A smooth coat
  // gives each dome one tight highlight and a thin Fresnel outline from the studio panels, which is what a clear bump is.
  mat.roughness = 0.14;
  mat.clearcoatRoughness = 0.06;
  mat.specularIntensity = 1;
  // score loop r6: the reflection was a white crescent as wide as the dome that read as candy gloss and hung over the
  // tile's far edge. A coat that is a little softer (0.2) and a quieter studio (DOME_ENV, below) leaves a faint
  // sheen and a thin Fresnel rim, so the dome is a shallow bump sitting inside its tile. A base ring (domeRings) draws
  // the rim where the dome meets the film.
  mat.clearcoatRoughness = 0.2;
  mat.specularIntensity = 0.55;
  return mat;
}

function makeMicrolens(look: import('./types').PieceContext['look']): THREE.Mesh {
  const r = TARGET_HALF * 1.05;
  const h = MICROLENS_APEX_Y - MICROLENS_BASE_Y;
  // A real plano-convex dome: the flat base is the sphere's equator, so scale a hemisphere's height to h.
  const geo = new THREE.SphereGeometry(r, 28, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  geo.scale(1, h / r, 1);
  const mat = look.microlensMaterial();
  // This enlarged teaching cutaway uses the same stable alpha treatment as its well walls and
  // neighboring domes. A viewport-transmission sampler can retain a destroyed framebuffer when
  // switching into Pixel or resizing. The engine's microlens collection and spectral values are separate.
  mat.transmission = 0;
  clearDome(mat);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = MICROLENS_BASE_Y;
  return mesh;
}

// A hollow container -- four thin glass wall panels, not a solid transmissive block -- so a viewer looks
// through exactly ONE thin pane of glass into open space where the charge sits, not through two stacked full-
// thickness glass faces (front wall + back wall) whose combined attenuation and Fresnel reflection made a
// solid box read as flat dark/opaque in practice (found while reviewing this piece's own screenshots). This
// is also the more literally correct shape for "glass, not an opaque tank" (design/LOOK.md): a real well's
// container is thin walls around its charge, not a solid glass fill.
function makeWellShell(look: import('./types').PieceContext['look'], topY: number, botY: number, half: number): THREE.Group {
  const g = new THREE.Group();
  const h = topY - botY;
  const wallT = Math.max(0.03, half * 0.06);
  const mat = look.wellGlassMaterial();
  // `transmission` materials compute what shows through via their own refraction shader/pass, not via the
  // ordinary alpha channel -- their coverage renders opaque regardless of `opacity`/`transparent` (found while
  // reviewing this piece's own screenshots: the well's charge fill was completely invisible behind its front
  // wall, confirmed by a direct camera/NDC projection check showing the charge mesh correctly on screen and
  // NOT occluded by anything else, only by this same wall). Turning transmission off and relying on ordinary
  // alpha blending instead is the fix: it guarantees the wall stays genuinely see-through at this small,
  // nested, dark-void scale, at the cost of the refraction/dispersion a full transmission pass would add --
  // an acceptable, documented trade for this look prototype (docs/pieces/loupe.md, "known limits").
  mat.transmission = 0;
  mat.transparent = true;
  // 0.3 (this shell's first value) doubles up along any view ray that crosses two walls (e.g. front and back,
  // looking straight through the well) -- two 0.3-alpha white layers composite to ~0.51 coverage, enough of a
  // pale wash to bury the charge color sitting behind them (art director, "charge-fill-illegible"; confirmed
  // directly: the resting frame's well read as a flat, uniform pale slab with no charge tint visible at all).
  // 0.16 keeps the walls genuinely visible as glass (LOOK.md's own "not an opaque tank" rule) while cutting
  // that two-layer wash roughly in half.
  mat.opacity = 0.13;
  // Score loop r2: a clear coat and the shared studio's reflections (registered by the piece) give the walls a sheen
  // that changes across each pane, so they read as glass and not as flat pale panels; they no longer write depth, so
  // one wall never cuts another out of the blend.
  mat.clearcoat = 1;
  mat.clearcoatRoughness = 0.04;
  mat.depthWrite = false;
  const front = new THREE.Mesh(new THREE.BoxGeometry(half * 2, h, wallT), mat);
  front.position.set(0, (topY + botY) / 2, half);
  const back = front.clone();
  back.position.z = -half;
  const left = new THREE.Mesh(new THREE.BoxGeometry(wallT, h, half * 2), mat);
  left.position.set(-half, (topY + botY) / 2, 0);
  const right = left.clone();
  right.position.x = half;
  // score loop r5: the floor is dark lit silicon, not a sixth pane of the same glass. As a pale pane it read as a flat
  // blue-grey tray and the charge sitting on it had nothing to stand out against.
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x0d151e, roughness: 0.38, metalness: 0.55 });
  const floor = new THREE.Mesh(new THREE.BoxGeometry(half * 2, wallT, half * 2), floorMat);
  // under the charge, not around it: centered on botY the floor slab enclosed the bottom of a low fill (score loop r2)
  floor.position.set(0, botY - wallT / 2, 0);
  // The glass's machined top rim: four thin lit bars on the walls' upper edge, so the container's mouth reads at a
  // glance from any angle (score loop r2).
  const rimMat = new THREE.MeshPhysicalMaterial({ color: 0xdbe8ef, metalness: 0, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05, transparent: true, opacity: 0.85 });
  const rimT = wallT * 1.4;
  for (const [w, d, x, z] of [[half * 2 + rimT, rimT, 0, half], [half * 2 + rimT, rimT, 0, -half], [rimT, half * 2, half, 0], [rimT, half * 2, -half, 0]] as const) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(w, rimT, d), rimMat);
    bar.position.set(x, topY - rimT / 2, z);
    g.add(bar);
  }
  g.add(front, back, left, right, floor);
  g.userData.glass = mat;
  g.userData.floor = floorMat;
  g.userData.rim = rimMat;
  return g;
}

/** Repeats a rounded box's side-face texture `times` across the face (u only), so a texture drawn for one pixel cell
 *  tiles at the array's pitch. The geometry is non-indexed and its groups follow BoxGeometry's face order. */
function repeatSideUv(geo: THREE.BufferGeometry, faces: number[], times: number): void {
  const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
  for (const f of faces) {
    const g = geo.groups[f];
    if (!g) continue;
    for (let i = g.start; i < g.start + g.count; i++) uv.setX(i, uv.getX(i) * times);
  }
  uv.needsUpdate = true;
}

function makeSlab(look: import('./types').PieceContext['look'], mat: THREE.Material, topY: number, botY: number, half: number): THREE.Mesh {
  const geo = new THREE.BoxGeometry(half * 2, Math.max(0.02, topY - botY), half * 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = (topY + botY) / 2;
  return mesh;
}

// ---- the piece --------------------------------------------------------------------------------------------

export const build: BuildPiece = (ctx) => {
  const group = new THREE.Group();
  group.name = 'piece-loupe';

  // ---- the pixel-neighborhood grid: center cell = full detail, others = dim flat swatches ---------------------
  const gridGroup = new THREE.Group();
  gridGroup.position.y = 0;
  group.add(gridGroup);
  const neighborMeshes: THREE.Mesh[] = [];
  const center = Math.floor(GRID_N / 2);
  const RGGB_LOCAL: ('R' | 'G' | 'B')[][] = [
    ['R', 'G'],
    ['G', 'B'],
  ];
  const inCut = (row: number, col: number) => col === center && row > center; // the opened column, toward the viewer
  const neighborCells: { row: number; col: number }[] = [];
  for (let row = 0; row < GRID_N; row++) {
    for (let col = 0; col < GRID_N; col++) {
      if ((row === center && col === center) || inCut(row, col)) continue; // the target has its own full stack
      const ch = RGGB_LOCAL[row % 2][col % 2];
      const mesh = makeNeighborSwatch(ctx.look, ch);
      mesh.position.set((col - center) * CELL, (CFA_TOP_Y + CFA_BOT_Y) / 2, (row - center) * CELL);
      gridGroup.add(mesh);
      neighborMeshes.push(mesh);
      neighborCells.push({ row, col });
    }
  }
  // The neighbors' microlenses: one shared dome, instanced. Clear, glossy and only faintly there, so the tiles'
  // colors read through them the way they do through a real microlens array.
  const domeR = TARGET_HALF * 1.05;
  const domeGeo = new THREE.SphereGeometry(domeR, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  domeGeo.scale(1, (MICROLENS_APEX_Y - MICROLENS_BASE_Y) / domeR, 1);
  const domeMat = clearDome(new THREE.MeshPhysicalMaterial());
  const domes = new THREE.InstancedMesh(domeGeo, domeMat, neighborCells.length);
  {
    const m = new THREE.Matrix4();
    neighborCells.forEach(({ row, col }, i) => {
      m.makeTranslation((col - center) * CELL, MICROLENS_BASE_Y, (row - center) * CELL);
      domes.setMatrixAt(i, m);
    });
    domes.instanceMatrix.needsUpdate = true;
  }
  gridGroup.add(domes);
  // score loop r6: a thin pale ring where each dome meets its film (the target's included), so a dome reads as a shallow
  // bump with an edge and not as a floating highlight. One line geometry for all of them.
  {
    const SEG = 40, pos: number[] = [];
    const cells = [...neighborCells, { row: center, col: center }];
    for (const { row, col } of cells) {
      const ox = (col - center) * CELL, oz = (row - center) * CELL;
      for (let i = 0; i < SEG; i++) {
        const a0 = (i / SEG) * Math.PI * 2, a1 = ((i + 1) / SEG) * Math.PI * 2;
        pos.push(ox + Math.cos(a0) * domeR, MICROLENS_BASE_Y + 0.01, oz + Math.sin(a0) * domeR, ox + Math.cos(a1) * domeR, MICROLENS_BASE_Y + 0.01, oz + Math.sin(a1) * domeR);
      }
    }
    const ringGeo = new THREE.BufferGeometry();
    ringGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    gridGroup.add(new THREE.LineSegments(ringGeo, new THREE.LineBasicMaterial({ color: 0xd2e2f0, transparent: true, opacity: 0.34, depthWrite: false })));
  }

  // The silicon die under the array, cut open along the target's column toward the viewer. Its top faces sit
  // under the tiles; the faces the cut exposes get a lighter section tone so the cut reads as a cut.
  const dieMat = ctx.look.siliconMaterial();
  // score loop r3: the cut faces a little lighter and glossier, so the studio panels they face give each a tone of its
  // own and they read as cut silicon, not as flat voids
  // score loop r4: the cut faces carry a section texture (look.ts siliconSectionTexture: oxide, wiring lines with vias, bulk
  // silicon darkening with depth, a darker rim), so the pedestal under the array is a layered cross-section and not one
  // flat gray block. The texture is the tone, the color a neutral cool multiplier.
  const dieCutMat = new THREE.MeshStandardMaterial({ color: 0xd4dce6, roughness: 0.46, metalness: 0.45 });
  const sectionTex = ctx.look.siliconSectionTexture();
  if (sectionTex) dieCutMat.map = sectionTex;
  // The die's side faces look sideways into the stage's dark middle band, so the polished silicon (LOOK.md: roughness
  // 0.25, metalness 0.6, PMREM reflections) mirrored nothing and every face rendered one flat (12,14,17), a void
  // rather than a material (score loop r1). The silicon here reflects the camera studio's softbox panels instead, so
  // each face of the die and the photodiode band takes its own tone. Material only; the stage's environment is unchanged.
  // Built on the first activate, when the renderer is live (a hooks-only build never renders).
  // Score loop r3: the one studio environment the deep levels share (look.ts sharedStudioTexture), not a PMREM of its
  // own built in the first activate, where its synchronous bake added to the first visit's stall.
  let siliconStudio: { texture: THREE.Texture } | null = null;
  const studioLitMats: [THREE.MeshStandardMaterial, number][] = [];
  const studioLit = <T extends THREE.MeshStandardMaterial>(m: T, k: number): T => {
    studioLitMats.push([m, k]);
    if (siliconStudio) { m.envMap = siliconStudio.texture; m.envMapIntensity = k; m.needsUpdate = true; }
    return m;
  };
  const lightSilicon = () => {
    const r = ctx.renderer as unknown as { hasInitialized?: () => boolean };
    if (siliconStudio || typeof r.hasInitialized !== 'function' || !r.hasInitialized()) return;
    const texture = ctx.look.sharedStudioTexture(ctx.renderer);
    if (!texture) return;
    siliconStudio = { texture };
    for (const [m, k] of studioLitMats) { m.envMap = siliconStudio.texture; m.envMapIntensity = k; m.needsUpdate = true; }
  };
  studioLit(dieMat, 1.8);
  studioLit(dieCutMat, 2.2);
  studioLit(domeMat, DOME_ENV);
  const dieParts: THREE.Mesh[] = [];
  const dieBox = (x0: number, x1: number, z0: number, z1: number, cutFaces: number[]) => {
    // score loop r6: a beveled block, so the die's front edge catches a thin line of light instead of ending in a hard
    // corner; each side face's section texture repeats once per pixel pitch, so the cell boundaries (the dark rim of the
    // texture) mark where one pixel ends and the next begins, filling what was a dead dark slab
    const geo = new RoundedBoxGeometry(x1 - x0, DIODE_TOP_Y - DIE_BOT_Y, z1 - z0, 2, DIE_BEVEL);
    // face groups: 0 +x, 1 -x, 2 +y, 3 -y, 4 +z, 5 -z
    repeatSideUv(geo, [0, 1], (z1 - z0) / CELL);
    repeatSideUv(geo, [4, 5], (x1 - x0) / CELL);
    const mats = [0, 1, 2, 3, 4, 5].map((f) => (cutFaces.includes(f) ? dieCutMat : dieMat));
    const mesh = new THREE.Mesh(geo, mats);
    mesh.position.set((x0 + x1) / 2, (DIODE_TOP_Y + DIE_BOT_Y) / 2, (z0 + z1) / 2);
    gridGroup.add(mesh);
    dieParts.push(mesh);
  };
  const cx0 = -CELL / 2, cx1 = CELL / 2, cz0 = -CELL / 2;
  dieBox(-HALF_ARRAY, cx0, -HALF_ARRAY, HALF_ARRAY, [0, 4]);     // left of the cut
  dieBox(cx1, HALF_ARRAY, -HALF_ARRAY, HALF_ARRAY, [1, 4]);      // right of the cut
  dieBox(cx0, cx1, -HALF_ARRAY, cz0, [4]);                        // behind the target
  // score loop r5: the wall seen through the glass behind the well is a darker cut of the same layered section, so the
  // glass reads against a deep, lit backdrop instead of a pale grey panel, and the charge stands out in front of it
  const dieCutDeepMat = dieCutMat.clone();
  dieCutDeepMat.color.set(0x7a8594);
  studioLit(dieCutDeepMat, 1.6);
  (dieParts[dieParts.length - 1].material as THREE.Material[])[4] = dieCutDeepMat;
  // score loop r5: the floor of the opened column. The cut stopped at the bottom of the well and nothing stood under it, so
  // the glass sat over a black void; this is the die's own section (same layered face as the pedestal beside it) with its
  // top face dark silicon, so the trench has a lit floor and a front face.
  {
    const topY = WELL_BOT_Y - 0.14;
    const geo = new THREE.BoxGeometry(cx1 - cx0, topY - DIE_BOT_Y, HALF_ARRAY - cz0);
    const trenchMat = new THREE.MeshStandardMaterial({ color: 0x1b2430, roughness: 0.46, metalness: 0.5 });
    studioLit(trenchMat, 1.3);
    const mesh = new THREE.Mesh(geo, [dieCutMat, dieCutMat, trenchMat, dieMat, dieCutMat, dieMat]);
    mesh.position.set(0, (topY + DIE_BOT_Y) / 2, (cz0 + HALF_ARRAY) / 2);
    gridGroup.add(mesh);
    dieParts.push(mesh);
  }

  // ---- the target pixel's full stack: microlens, CFA, photodiode, glass well + charge fill --------------------
  const microlens = makeMicrolens(ctx.look);
  studioLit(microlens.material as THREE.MeshPhysicalMaterial, DOME_ENV);
  gridGroup.add(microlens);

  // The target dye uses LOOK.md's tint with illustrative alpha coverage, like the other cutaway
  // covers. Display opacity is not the spectral transmission used for photon/electron calculations.
  const targetDye = (ch: 'R' | 'G' | 'B') => {
    const m = ctx.look.cfaDyeMaterial(ch);
    m.transmission = 0;
    m.transparent = true;
    m.opacity = 0.7;
    m.depthWrite = false;
    m.roughness = 0.5;
    m.clearcoat = 0.12; // score loop r4: semi-matte like the neighbors' film, so the microlens carries the sharp highlight
    const film = ctx.look.dyeFilmTexture();
    if (film) m.map = film;
    // Front faces only: a double-sided, alpha-blended box drew its far faces through its near ones in triangle order,
    // which showed as diagonal stripes across the red filter's top and front (score loop r2).
    m.side = THREE.FrontSide;
    return studioLit(m, 1.2);
  };
  const dyes = new Map<'R' | 'G' | 'B', THREE.MeshStandardMaterial>();
  const dyeFor = (ch: 'R' | 'G' | 'B') => { let m = dyes.get(ch); if (!m) { m = targetDye(ch); dyes.set(ch, m); } return m; };
  const dyeColors = new Map<'R' | 'G' | 'B', THREE.Color>();
  const dyeColor = (ch: 'R' | 'G' | 'B') => {
    let c = dyeColors.get(ch);
    if (!c) { const fresh = ctx.look.cfaDyeMaterial(ch); c = fresh.color.clone(); fresh.dispose(); dyeColors.set(ch, c); }
    return c;
  };
  let cfaMesh = makeSlab(ctx.look, dyeFor('G'), CFA_TOP_Y, CFA_BOT_Y, TARGET_HALF);
  gridGroup.add(cfaMesh);

  // score loop r4: the photodiode slab is a lighter, bluer silicon than the die around it. In the same dark silicon its
  // front face read as a black hole between the red filter and the glass well; this one catches the studio panels.
  const diodeMat = ctx.look.siliconMaterial();
  diodeMat.color.set(0x3b4b63);
  diodeMat.roughness = 0.34;
  diodeMat.metalness = 0.4;
  const diodeMesh = makeSlab(ctx.look, studioLit(diodeMat, 1.8), DIODE_TOP_Y, DIODE_BOT_Y, TARGET_HALF);
  gridGroup.add(diodeMesh);

  // Wider than the photodiode sitting on top of it -- a flared glass base, not a same-width column hidden
  // directly under an opaque diode -- so the well's own glass walls and the charge inside are actually visible
  // from the dive's oblique, from-above camera angle, not occluded by the silicon slab above (found while
  // reviewing this piece's own screenshots: a same-width stack hid the well entirely). The height/fill
  // FRACTION this draws is exactly electrons/fullWell either way; only the footprint is a legibility choice.
  const WELL_HALF = TARGET_HALF * 0.96;
  const wellShell = makeWellShell(ctx.look, WELL_TOP_Y, WELL_BOT_Y, WELL_HALF);
  studioLit(wellShell.userData.glass as THREE.MeshPhysicalMaterial, 1.6);
  studioLit(wellShell.userData.rim as THREE.MeshPhysicalMaterial, 1.8);
  studioLit(wellShell.userData.floor as THREE.MeshStandardMaterial, 1.4);
  gridGroup.add(wellShell);
  // The well's glass edges, inked (the same pale line as the lens cutaway's glass sections), so the container
  // reads as a glass box around the charge rather than as a floating blue slab.
  const wellEdgeGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(WELL_HALF * 2, WELL_TOP_Y - WELL_BOT_Y, WELL_HALF * 2));
  const wellEdgeMat = new THREE.LineBasicMaterial({ color: 0xd4e4ec, transparent: true, opacity: 0.8 });
  const wellEdges = new THREE.LineSegments(wellEdgeGeo, wellEdgeMat);
  wellEdges.position.y = (WELL_TOP_Y + WELL_BOT_Y) / 2;
  gridGroup.add(wellEdges);

  const chargeGeo = new THREE.BoxGeometry(WELL_HALF * 1.8, 1, WELL_HALF * 1.8);
  const chargeMesh = new THREE.Mesh(chargeGeo, ctx.look.chargeMaterial(1));
  const chargeBase = (chargeMesh.material as THREE.MeshBasicMaterial).color.clone();
  (chargeMesh.material as THREE.MeshBasicMaterial).color.multiplyScalar(ctx.look.chargeBrightness(0.08));
  chargeMesh.scale.y = 0.001; // never literally zero -- LOOK.md's own zero-height-mesh pitfall
  chargeMesh.position.y = WELL_BOT_Y;
  gridGroup.add(chargeMesh);

  // ---- the ray bundle: the last segment of each traced ray, converging on the microlens apex ------------------
  const bundleGeo = new THREE.BufferGeometry();
  bundleGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
  bundleGeo.setAttribute('color', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
  const bundleMat = new THREE.LineBasicMaterial({ vertexColors: true, toneMapped: false, transparent: true, opacity: 0.85 });
  const bundleLines = new THREE.LineSegments(bundleGeo, bundleMat);
  gridGroup.add(bundleLines);

  // ---- photon sparks: a small pool, respawned on a cycle while the well is on screen ---------------------------
  const sparkGroup = new THREE.Group();
  const photonControls = document.createElement('div'); photonControls.className = 'light-playback'; photonControls.hidden = true;
  photonControls.innerHTML = '<button class="btn" type="button" aria-pressed="false">▶ Play photons</button><label><span class="playback-caption">Arriving light<small>Illustrative time · drag to inspect</small></span><input type="range" min="0" max="1000" value="0" aria-label="Photon animation phase"></label><span class="playback-note packet-note"><span>Illustrative packets</span> <span>Not individual real-time photons</span></span>';
  document.getElementById('model-experiments')!.before(photonControls);
  const photonButton = photonControls.querySelector('button')!, photonRange = photonControls.querySelector('input')!;
  const rainLaunch = document.createElement('button'); rainLaunch.type = 'button'; rainLaunch.className = 'btn rain-launch';
  rainLaunch.textContent = 'Photon rain & noise'; rainLaunch.hidden = true; photonControls.before(rainLaunch);
  let rainView: ReturnType<typeof import('../app/photon-rain').createPhotonRain> | null = null;
  let cancelRainOpening: (() => void) | null = null;
  rainLaunch.onclick = async () => {
    if (!currentModel || rainLaunch.disabled) return;
    pausePhotons(); rainLaunch.disabled = true;
    let canceled = false;
    const onEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel(); };
    const cancel = () => { canceled = true; document.removeEventListener('keydown', onEscape, true); };
    cancelRainOpening = cancel;
    document.addEventListener('keydown', onEscape, true);
    try {
      // Reopening an existing dialog is synchronous. A cold lazy import may
      // finish after Escape or a trip to another level; do not resurrect it.
      if (!rainView) {
        const { createPhotonRain } = await import('../app/photon-rain');
        if (canceled || disposed || !group.visible) return;
        rainView = createPhotonRain();
      }
      if (!canceled && !disposed && group.visible) rainView.open(currentModel, rainLaunch);
    } catch (error) { console.error('Photon rain could not open', error); rainLaunch.textContent = 'Retry photon rain'; }
    finally {
      document.removeEventListener('keydown', onEscape, true);
      if (cancelRainOpening === cancel) cancelRainOpening = null;
      rainLaunch.disabled = false;
    }
  };
  let photonPlaying = false, photonTime = 0;
  const pausePhotons = () => { photonPlaying = false; photonButton.setAttribute('aria-pressed', 'false'); photonButton.textContent = photonTime > 0 ? '▶ Resume photons' : '▶ Play photons'; };
  photonButton.onclick = () => { if (photonPlaying) pausePhotons(); else { photonPlaying = true; photonButton.textContent = 'Ⅱ Pause photons'; photonButton.setAttribute('aria-pressed', 'true'); } };
  // the slider's value is a 0..1000 step number; a screen reader hears how far along the fall of the illustrative photons it is (score loop r6)
  let spokenPhase = '';
  const speakPhotonPhase = () => {
    const text = `${Math.round(100 * Number(photonRange.value) / 1000)} percent of the illustrative photon fall; timing is illustrative`;
    if (text !== spokenPhase) { spokenPhase = text; photonRange.setAttribute('aria-valuetext', text); } // only when the spoken words change: it runs every frame while playing
  };
  speakPhotonPhase();
  photonRange.oninput = () => { photonTime = Number(photonRange.value) / 1000 * SPARK_FALL_MS; pausePhotons(); speakPhotonPhase(); };
  const offPhotonPause = ctx.bus.on('pause-exposure', pausePhotons);
  const hiddenPhotons = () => { if (document.hidden) pausePhotons(); };
  document.addEventListener('visibilitychange', hiddenPhotons);
  gridGroup.add(sparkGroup);
  const sparkGeo = new THREE.SphereGeometry(0.06, 8, 6);
  const sparkMat = ctx.look.physicsColorMaterial(ctx.look.wavelengthToThreeColor(560));
  const sparks: { mesh: THREE.Mesh; phaseMs: number }[] = [];
  for (let i = 0; i < SPARK_POOL; i++) {
    const mesh = new THREE.Mesh(sparkGeo, sparkMat);
    mesh.position.set((Math.random() - 0.5) * 1.2, SPARK_SPAWN_Y, (Math.random() - 0.5) * 1.2);
    sparkGroup.add(mesh);
    sparks.push({ mesh, phaseMs: (i / SPARK_POOL) * SPARK_FALL_MS });
  }

  /** WELL_FRAME, pulled back on a narrow (phone) view so the stack and a ring of neighbors still fit across it,
   *  and aimed a little higher so the way-back line at the top of the view stays clear of the photon bundle. */
  function wellFrame(): CameraFrame {
    const aspect = ctx.camera.aspect || 1.5;
    // A short view (a landscape phone, or a 568 px tall one, 220-240 px: review loop r1) carries the reading as a
    // strip along its top edge (levels.css), so the stack is aimed lower and pulled back a little to clear it.
    const viewH = (ctx.renderer as unknown as { domElement?: HTMLElement }).domElement?.clientHeight || 640;
    // (Integration r1: only the layouts that scroll, landscape phones and portrait phones 680 px tall or less; a taller
    // phone whose view came out short keeps the reading card's own pan below, clearOfReading.)
    const scrollingLayout = typeof window !== 'undefined' && (window.innerHeight <= 680 || window.matchMedia('(orientation: landscape) and (max-height: 500px)').matches);
    if (aspect >= 0.9 && viewH <= 300 && scrollingLayout) {
      const dir = WELL_FRAME.position.clone().sub(WELL_FRAME.target);
      // a landscape phone keeps the reading as a card in the top-right corner (levels.css): pan the stack left of it
      if (window.matchMedia('(orientation: landscape) and (max-height: 500px)').matches)
        return clearOfReading({ position: WELL_FRAME.target.clone().addScaledVector(dir, 1.5), target: WELL_FRAME.target.clone() });
      // a landscape view this short has the least height of all, so it pulls back further
      const wide = aspect >= 1.8;
      const target = WELL_FRAME.target.clone().add(new THREE.Vector3(0, SHORT_VIEW_LIFT * (wide ? 1.5 : 1), 0));
      const frame = { position: target.clone().addScaledVector(dir, wide ? 1.3 : 1.12), target };
      return wide ? frame : clearOfReading(frame);
    }
    if (aspect >= 0.9) {
      // score loop r4: backed off 20% on a desktop-sized view, so the array's near rows and left columns are not cut by
      // the view's left and bottom edges at the default zoom, and the well sits nearer its middle
      const back = WELL_FRAME.position.clone().sub(WELL_FRAME.target).multiplyScalar(isPhone() ? 1.32 : 1.5);
      return clearOfReading({ position: WELL_FRAME.target.clone().add(back), target: WELL_FRAME.target.clone() });
    }
    const dir = WELL_FRAME.position.clone().sub(WELL_FRAME.target);
    const target = WELL_FRAME.target.clone().add(new THREE.Vector3(0, 1.2, 0));
    return clearOfReading({ position: target.clone().addScaledVector(dir, 1.18), target });
  }

  /** Pans a frame (a pure pan along the screen's axes) so the pixel stack sits in the middle of the part of the
   *  view the reference-pixel reading leaves free: left of it when it is a card at the right, below it when it is a
   *  strip across the top (review loop 10/11/2026: the card covered the right third of the grid). The reading is
   *  measured when it is on screen; while the sample loads it is hidden, so its place comes from the same layout
   *  rules levels.css and studio-shell.css give it. */
  function clearOfReading(base: CameraFrame): CameraFrame {
    const dom = ctx.renderer.domElement;
    const viewW = dom.clientWidth, viewH = dom.clientHeight;
    if (!viewW || !viewH) return base;
    let shiftX = 0, shiftY = 0;
    const r = read.getBoundingClientRect(), v = dom.getBoundingClientRect();
    if (!read.hidden && r.width > 0) {
      // A strip across the top: the arriving photons rise above the stack, so it moves down by most of the strip's
      // height (the scale badge holds the bottom edge).
      // (integration r2: 0.9, was 0.75; the well view's camera moved to x 0.5 (r2-visual), which lifts the arriving
      // photons' pin on screen, and at 0.75 it sat under the strip on a 360x780 phone)
      if (r.width >= viewW * 0.6) shiftY = (r.bottom - v.top) * 0.9;
      else shiftX = (v.right - r.left) / 2;
    // (score loop r6: on a wide view the array is already backed off, so the pan only has to clear the card's left edge)
    if (r.width < viewW * 0.6 && viewW >= 900) shiftX = Math.min(shiftX, 80);
    } else if (matchMedia('(orientation: landscape) and (max-height: 500px)').matches) shiftX = (204 + 8 + 6) / 2;
    // a portrait phone carries the reading as a strip across the top (levels.css), the short ones included since
    // review loop r1; only a wider short view keeps the corner card (score loop r3: at 320x568 the corner guess
    // panned the stack sideways and left the arriving photons under the strip)
    else if (isPhone()) { if (innerHeight > 680 || matchMedia('(max-width: 599px) and ((orientation: portrait) or (max-width: 479px))').matches) shiftY = 50; else shiftX = (142 + 6 + 6) / 2; }
    // score loop r6 (visual): the array is backed off (1.5x) so it fits beside the card; the pan only has to clear the card's
    // own left edge, and 80 px keeps the array's left edge off the view's edge
    else shiftX = 80;
    shiftX = Math.min(shiftX, viewW * 0.2);
    shiftY = Math.min(shiftY, viewH * 0.34); // integration r2: 0.34, was 0.3 (see the strip note above)
    if (!shiftX && !shiftY) return base;
    const forward = base.target.clone().sub(base.position);
    const dist = forward.length();
    forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, forward).normalize();
    const worldPerPx = (dist * Math.tan(THREE.MathUtils.degToRad(20))) / (viewH / 2);
    // Moving the camera right slides the picture left; moving it up slides the picture down.
    const move = right.multiplyScalar(shiftX * worldPerPx).addScaledVector(up, shiftY * worldPerPx);
    // Below a strip the stack has less height to stand in: step back a little so its top and bottom pins both fit.
    const back = shiftY ? forward.clone().multiplyScalar(-dist * Math.min(0.45, 1.3 * shiftY / viewH)) : new THREE.Vector3(); // integration r2: 1.3x, at most 0.45 (was 1x, 0.35)
    return { position: base.position.clone().add(move).add(back), target: base.target.clone().add(move) };
  }

  // ---- piece state --------------------------------------------------------------------------------------------
  let targetX = -1;
  let targetY = -1;
  let currentPixel: ControlledPixelInfo | null = null;
  let currentModel: Model | null = null;
  let currentBundlePaths: RayPath[] = [];
  let badge: BadgeInfo = { n: 1, dotsDrawn: 0, photonsMean: 0 };
  const badgeText = () => badgeTextFor(badge);
  let fetchSeq = 0;
  let disposed = false;
  let pendingPixel = false;
  let pixelError = '';
  let injectSampleFailure = false; // test hook: the next sample rejects, to exercise the Retry path
  const status = document.createElement('div');
  status.className = 'lv-read lv-status';
  status.setAttribute('role', 'status');
  const statusText = document.createElement('p');
  const retry = document.createElement('button');
  retry.type = 'button'; retry.className = 'btn'; retry.textContent = 'Retry pixel';
  retry.onclick = () => refreshPixel();
  status.append(statusText, retry); ctx.overlay.appendChild(status);

  let refineTimer = 0, sampleRaf = 0, sampleTimer = 0;
  let bundleCoarse = false;
  let bundleToken = 0;
  const yieldToMain = (): Promise<void> => {
    const sched = (globalThis as unknown as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
    return sched?.yield ? sched.yield() : new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  };
  const cancelDeferred = () => {
    window.clearTimeout(refineTimer); window.clearTimeout(sampleTimer);
    if (sampleRaf) cancelAnimationFrame(sampleRaf);
    sampleRaf = 0; runDeferredSample = null;
  };
  let runDeferredSample: (() => void) | null = null;
  function invalidatePixel(): void {
    cancelDeferred(); bundleCoarse = false;
    fetchSeq++; pendingPixel = false; currentPixel = null; currentBundlePaths = [];
    pausePhotons();
    badge = { n: 1, dotsDrawn: 0, photonsMean: 0 };
    bundleGeo.setDrawRange(0, 0);
    syncBackButton();
  }

  function updateGridColors(cfa: 'R' | 'G' | 'B'): void {
    // Bayer colors around the sampled native pixel follow cfaColorAt directly, rather than an assumed pattern.
    const realX = currentPixel?.x ?? 0;
    const realY = currentPixel?.y ?? 0;
    let i = 0;
    for (let row = 0; row < GRID_N; row++) {
      for (let col = 0; col < GRID_N; col++) {
        if ((row === center && col === center) || inCut(row, col)) continue;
        const ch = cfaColorAt('RGGB', realX + (col - center), realY + (row - center));
        const mesh = neighborMeshes[i++];
        const mat = mesh.material as THREE.MeshPhysicalMaterial;
        mat.color.copy(dyeColor(ch)).multiplyScalar(NEIGHBOR_DIM);
      }
    }
    // the three target dyes are built once each and swapped in, not rebuilt per sample (a new material compiles its shader on its
    // first frame: a Pixel slider drag paid that on every event on a phone, score loop r6)
    cfaMesh.material = dyeFor(cfa);
  }

  function updateWellFill(): void {
    if (!currentPixel) return;
    const frac = Math.max(0, Math.min(1, currentPixel.electrons / currentPixel.fullWell));
    const h = Math.max(WELL_MIN_DRAWN, frac * WELL_HEIGHT); // never literally zero -- see the zero-height pitfall
    chargeMesh.scale.y = h;
    chargeMesh.position.y = WELL_BOT_Y + h / 2;
    // one material for the piece's life, re-colored: a new material per sample made the renderer build its shader again on every
    // slider event (score loop r6)
    const mat = chargeMesh.material as THREE.MeshBasicMaterial;
    mat.color.copy(chargeBase).multiplyScalar(ctx.look.chargeBrightness(frac));
    // The stage's shared camera spans mm-scale lens elements to sub-micron sensor structure in one near/far
    // range (0.01 to 100000, stage.ts), so float32 depth-buffer precision at THIS piece's own small, close-in
    // well scale is coarse enough that the charge fill lost ordinary depth testing against its own well walls
    // outright (confirmed directly: forcing depthTest off made an otherwise-invisible test fill appear exactly
    // where expected, with nothing else actually in front of it). Disabling depth test/write for the charge
    // mesh specifically -- always draw it, never let it write depth for anything else -- sidesteps that
    // precision floor for the one object that must always read through the glass around it; the microlens,
    // CFA and diode above it are opaque/near-opaque anyway and still draw over it normally as ordinary opaque
    // geometry (they are not affected by this flag, which is set only on the charge material).
    // Score loop r2: depth tested again. Drawn with depthTest off (the note above), the fill showed through the
    // neighbor filters in front of the well as a pale square floating over them. The camera now looks down the opened
    // column (WELL_FRAME), the floor sits under the fill instead of around it (makeWellShell), and the fill is drawn
    // after the opaque tiles and before the glass walls, so it is hidden where something is truly in front of it.
    chargeMesh.renderOrder = 1;
  }

  /** `coarse`: the drag preview, an eighth of the trace. `sliced`: the full trace as a run of short tasks (it draws when done). */
  function updateRayBundle(coarse = false, sliced = false): void {
    if (!currentModel || !currentPixel) return;
    const token = ++bundleToken;
    bundleCoarse = coarse || sliced;
    const halfFieldDeg = currentModel.realized.realization.halfFieldDeg || 1;
    const widthPx = currentModel.sensor.widthPx;
    const heightPx = currentModel.sensor.heightPx;
    const pitchMm = currentModel.sensor.pitchUm / 1000;
    const dxImg = currentPixel.x - widthPx / 2;
    const dyImg = heightPx / 2 - currentPixel.y; // image row grows downward; flip so +y reads "up", matching
    // types.ts's own "y up" system convention for the field-angle math below.
    const sensorXmm = dxImg * pitchMm;
    const sensorYmm = dyImg * pitchMm;
    const radialMm = Math.hypot(sensorXmm, sensorYmm);
    const efl = currentModel.cardinal.efl;
    const angleDeg = (Math.atan(radialMm / efl) * 180) / Math.PI;
    const fieldFrac = Math.max(0, Math.min(1, angleDeg / halfFieldDeg));
    const theta = radialMm > 1e-6 ? Math.atan2(sensorYmm, sensorXmm) : 0;
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    // Orthonormal local basis: radial (toward/away from the image center, in our local XZ plane) mapped from
    // the traced ray's own meridional (system-y) component; tangential from system-x; "toward the sensor"
    // (system +z) mapped to local -Y (our dive axis runs photo-at-top to well-at-bottom). This is a pure
    // rotation of orthonormal axes, so it preserves the real ray's arrival ANGLE exactly; only its drawn
    // LENGTH is a visual choice (see BUNDLE_LEN).
    const radial3 = new THREE.Vector3(cosT, 0, sinT);
    const tangent3 = new THREE.Vector3(-sinT, 0, cosT);
    const down3 = new THREE.Vector3(0, -1, 0);

    const pointDistMm = currentPixel.objectPoint[2]; // axial "distance from sensor," render.ts's own convention
    const bins = traceableBins(currentModel, BUNDLE_NMS);
    const req = { pointDistMm, fieldFrac, rays: coarse ? COARSE_BUNDLE_RAYS : BUNDLE_RAYS, nms: coarse ? bins.filter((_, i) => i % 2 === 0) : bins };
    const basis = { radial3, tangent3, down3 };
    if (sliced) {
      // the full bundle in slices of one color, a task each, so a phone can paint and take input between them (score loop r6)
      const seq = fetchSeq, model = currentModel;
      void pointBundleSliced(model, req, { sliceNms: 1, yieldToMain, cancelled: () => disposed || seq !== fetchSeq || token !== bundleToken })
        .then((bundle) => { if (bundle && !disposed && seq === fetchSeq && token === bundleToken) { drawBundle(bundle, basis); bundleCoarse = false; ctx.invalidate?.(); } })
        .catch(() => { /* the coarse bundle stays */ });
      return;
    }
    drawBundle(pointBundle(currentModel, req), basis);
  }

  function drawBundle(bundle: Bundle, basis: { radial3: THREE.Vector3; tangent3: THREE.Vector3; down3: THREE.Vector3 }): void {
    const { radial3, tangent3, down3 } = basis;
    currentBundlePaths = bundle.paths;

    const BUNDLE_LEN = 3.6;
    const apex = new THREE.Vector3(0, MICROLENS_APEX_Y, 0);
    const positions: number[] = [];
    const colors: number[] = [];
    const tmp = new THREE.Vector3();
    for (const path of bundle.paths) {
      if (path.status !== 'ok' || !path.dirOut) continue;
      const [dx, dy, dz] = path.dirOut;
      tmp.copy(radial3).multiplyScalar(dy).addScaledVector(tangent3, dx).addScaledVector(down3, dz).normalize();
      const start = apex.clone().addScaledVector(tmp, -BUNDLE_LEN);
      positions.push(start.x, start.y, start.z, apex.x, apex.y, apex.z);
      const c = ctx.look.wavelengthToThreeColor(path.nm);
      colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    bundleGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    bundleGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    bundleGeo.computeBoundingSphere();
    bundleGeo.setDrawRange(0, positions.length / 3);
  }

  /** A resolved sample draws a coarse ray bundle at once and the full one in short tasks after it (after the input has stopped,
   *  when `deferred`: a slider drag), so neither a drag nor a level's first entry holds the page for the whole trace. */
  function applyPixel(deferred = false): void {
    if (!currentPixel) return;
    updateGridColors(currentPixel.cfa);
    updateWellFill();
    updateRayBundle(true);
    const seq = fetchSeq;
    window.clearTimeout(refineTimer);
    refineTimer = window.setTimeout(() => { if (seq === fetchSeq && currentPixel) updateRayBundle(false, true); }, deferred ? BUNDLE_SETTLE_MS : 0);
    badge = badgeFor(currentPixel.photonsMean);
    selectedProbeSync();
    syncBackButton();
  }

  /** `deferred`: a change made while the level is shown (a slider drag): the sample runs on the next animation frame, so the
   *  input events of one frame share one trace, and its ray bundle is coarse until the input stops. */
  function refreshPixel(deferred = false): void {
    if (disposed || !group.visible || !currentModel) return;
    cancelDeferred();
    const seq = ++fetchSeq;
    pendingPixel = true; pixelError = ''; currentPixel = null; syncBackButton();
    if (deferred && !document.hidden && typeof requestAnimationFrame === 'function') {
      const run = () => {
        if (seq !== fetchSeq || !runDeferredSample) return;
        window.clearTimeout(sampleTimer);
        if (sampleRaf) cancelAnimationFrame(sampleRaf);
        sampleRaf = 0; runDeferredSample = null;
        sample(seq, true);
      };
      runDeferredSample = run;
      sampleRaf = requestAnimationFrame(run);
      sampleTimer = window.setTimeout(run, 100);
      return;
    }
    sample(seq, false);
  }

  function sample(seq: number, coarse: boolean): void {
    // R-P6 (10/10/2026 correctness review): one fixed seed, not the refresh counter. With a fresh draw per refresh,
    // ISO 100 -> 1600 showed 2,885 -> 2,721 electrons, as if gain changed the collected charge; with one seed a
    // control changes only what its physics changes (photon rain shows the draw-to-draw spread on its own).
    Promise.resolve().then(() => {
      if (injectSampleFailure) { injectSampleFailure = false; throw new Error('Injected sample failure'); }
      return sampleNeutralPixel(currentModel!, CONTROLLED_SEED);
    }).then((info) => {
      if (disposed || !group.visible || seq !== fetchSeq) return;
      pendingPixel = false; currentPixel = info; targetX = info.x; targetY = info.y;
      applyPixel(coarse);
    }).catch(() => {
      if (disposed || seq !== fetchSeq) return;
      pendingPixel = false; pixelError = 'The controlled pixel sample could not be calculated. Retry the sample.';
      syncBackButton();
    });
  }

  function clearSelection(): void {
    ctx.bus.emit('select-part', { id: null });
    syncBackButton();
  }

  // ---- overlay: the way back and the pixel's numbers (design/LOOK.md #9: "a Back control (and Esc)" and "the
  // well's fill fraction as a number, not just the visual") ------------------------------------------------------
  // A breadcrumb like the camera's detail modes (Camera / the part): "Photo / Row r, column c", the first step a
  // link back out along the same dive. Styled in src/styles/levels.css (.lv-crumb).
  // On a phone with a part picked, the strip above the sheet holds only the pixel: the readout and the photo
  // inset step aside until the pick is cleared (R1-13).
  let pickedOnPhone = false;
  const read = document.createElement('div');
  read.className = 'lv-read';
  read.hidden = true;
  // One evidence chip for the whole reading (R2-08): every row is worked out by the engine for this pixel, the
  // same "Calc." the part cards give these numbers.
  // Each label carries a long and a short form: the smallest phones (340 px wide or less, levels.css) set the
  // reading as one line of short labels under its heading, with a Details button that opens the full reading
  // (score loop r2: the two-column strip covered half of a 240 px view there).
  const label = (long: string, short: string) => `<span class="lv-l">${long}</span><span class="lv-s" aria-hidden="true">${short}</span>`;
  read.innerHTML = `<div class="lv-read-h"><p class="lv-ctl-k" data-k="heading">Reference pixel</p><span class="chip derived" title="Calculated from the settings and the sensor model for this pixel; not measured on a real sensor" data-evidence-note>Calc.</span><button type="button" class="lv-read-more" aria-expanded="false">Details</button></div>
    <p class="lv-read-condition" data-k="conditions"></p>
    <p class="lv-read-condition-short" data-k="conditionsShort"></p>
    <div class="lv-read-row"><span title="Expected photon arrivals between 380 and 780 nm (the engine's 16 wavelength bins); actual arrivals vary. Includes an assumed 90% lens transmission.">${label('Expected photons <small>380–780 nm</small>', 'Photons')}</span><b data-k="photons"></b></div>
    <div class="lv-read-row lv-read-mean"><span title="Mean photoelectrons for this pixel's color filter: a red, green or blue pixel each collects a different count">${label('Expected electrons', 'Mean e⁻')}</span><b data-k="electronsMean"></b></div>
    <div class="lv-read-row"><span title="One seeded random exposure: shot noise, PRNU, dark current and read noise drawn once">${label('Sampled electrons<small class="lv-gloss">one exposure</small>', 'e⁻')}</span><b data-k="electrons"></b></div>
    <div class="lv-read-well" aria-hidden="true"><i></i></div>
    <div class="lv-read-row"><span title="Sampled electrons / full well">${label('Well filled<small class="lv-gloss">of capacity</small>', 'Well')}</span><b data-k="fill"></b></div>
    <div class="lv-read-row lv-read-extra"><span title="From the same sampled exposure">${label('Raw value', 'Raw')}</span><b data-k="dn"></b></div>
    <p class="lv-read-why">ISO multiplies the count before it becomes a number, so a faint exposure can still give a bright raw value.</p>`;
  const readMore = read.querySelector<HTMLButtonElement>('.lv-read-more')!;
  readMore.addEventListener('click', () => {
    const open = !read.classList.contains('lv-read-open');
    read.classList.toggle('lv-read-open', open);
    readMore.setAttribute('aria-expanded', String(open));
    readMore.textContent = open ? 'Less' : 'Details';
  });
  ctx.overlay.appendChild(read);
  // Score loop r6 (WCAG 1.4.12): a reader's text spacing can make the reading taller than the room it has (levels.css caps and
  // scrolls it); while it scrolls it is a focusable region, so a keyboard user can reach the rest of it (axe scrollable-region-focusable)
  const readFocus = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => {
    const scrolls = !read.hidden && read.scrollHeight > read.clientHeight + 1 && getComputedStyle(read).overflowY === 'auto';
    if (scrolls) { read.tabIndex = 0; read.setAttribute('role', 'group'); read.setAttribute('aria-label', 'Reference pixel reading'); }
    else { read.removeAttribute('tabindex'); read.removeAttribute('role'); read.removeAttribute('aria-label'); }
  }) : null;
  readFocus?.observe(read);
  const readOut = (k: string) => read.querySelector<HTMLElement>(`[data-k="${k}"]`)!;
  const readWell = read.querySelector<HTMLElement>('.lv-read-well i')!;

  let loadingState = '';
  function syncBackButton(): void {
    const active = group.visible && !disposed;
    rainLaunch.hidden = !group.visible;
    const ready = !!currentPixel;
    const waiting = active && !ready && !pixelError;
    const label = 'Sampling a controlled neutral pixel…';
    const nextLoading = waiting ? label : '';
    if (nextLoading !== loadingState) {
      loadingState = nextLoading;
      ctx.bus.emit('piece-loading', { id: 'loupe', loading: waiting, label, progress: 0.5 });
    }
    // The shared central veil explains pending work and holds numbered pins. An
    // error replaces it with a centered, actionable message rather than an empty
    // scene or an old pixel presented as if it belonged to the current settings.
    status.hidden = !active || !pixelError;
    statusText.textContent = pixelError;
    retry.hidden = !pixelError;
    retry.disabled = pendingPixel;
    photonControls.hidden = !group.visible || !ready;
    gridGroup.visible = ready;

    read.hidden = !currentPixel || pickedOnPhone;
    if (currentPixel) {
      const scenario = currentModel!.scenario;
      const shutterLabel = scenario.shutter < 1 ? `1/${Math.round(1 / scenario.shutter)} s` : `${fmtNum(scenario.shutter, 2)} s`;
      readOut('conditions').textContent = `${CFA_NAME[currentPixel.cfa][0].toUpperCase()}${CFA_NAME[currentPixel.cfa].slice(1)} pixel · 18% gray · ${fmtNum(currentPixel.sample.lux, 0)} lux · ${fmtInt(currentPixel.sample.cctK)} K daylight · f/${fmtNum(scenario.fno, 1)} · ${shutterLabel} · ${isoLabel(scenario.iso, currentModel!.sensor.isoRange)} · ${currentPixel.sample.distanceMm === null ? 'infinity focus' : `${fmtNum(currentPixel.sample.distanceMm / 1000, 2)} m focus`}`;
      // Score loop r2: phones hide the long line above, so they get this short one (the filter color and settings).
      readOut('conditionsShort').textContent = `${CFA_NAME[currentPixel.cfa][0].toUpperCase()}${CFA_NAME[currentPixel.cfa].slice(1)} pixel · 18% gray · f/${fmtNum(scenario.fno, 1)} · ${shutterLabel} · ${isoLabel(scenario.iso, currentModel!.sensor.isoRange)}`;
      const frac = Math.max(0, Math.min(1, currentPixel.electrons / currentPixel.fullWell));
      readOut('photons').textContent = fmtInt(currentPixel.photonsMean);
      readOut('electronsMean').textContent = fmtInt(currentPixel.electronsMean);
      // score loop r2: the tour's 18% gray figure is the green pixel's; name this pixel's filter over its counts (in the
      // heading, so the rows keep one line on a phone and the panel does not grow over the pins)
      // score loop r3 (visual + ux): 'Pixel · red' on one line beside its chip, as two nowrap phrases with the dot
      // trailing the first, so a wrap never starts a line with '· red' (CFA_NAME is a fixed word list, not user text)
      readOut('heading').innerHTML = `<span style="white-space:nowrap">Pixel ·</span> <span style="white-space:nowrap">${CFA_NAME[currentPixel.cfa]}</span>`;
      readOut('electrons').textContent = fmtInt(currentPixel.electrons);
      readOut('fill').textContent = `${fmtNum(frac * 100, 1)}%`;
      // Score-loop r1 (10/11/2026): the 14-bit ADC can clip before the well fills (high ISO). Say so at the code.
      const adcMax = 2 ** currentModel!.sensor.bits - 1;
      const adcClipped = currentPixel.dn >= adcMax;
      readOut('dn').textContent = adcClipped ? `${fmtInt(currentPixel.dn)} · ADC max, clipped` : fmtInt(currentPixel.dn);
      readOut('dn').className = adcClipped ? 'lv-clipped' : '';
      readOut('dn').title = adcClipped
        ? `The analog-to-digital converter's maximum code (${fmtInt(adcMax)}): this exposure is clipped in the raw file even though the well is not full`
        : 'Digital output code after gain and analog-to-digital conversion';
      readWell.style.width = `${(frac * 100).toFixed(1)}%`;
    }
  }

  function onKeydown(ev: KeyboardEvent): void {
    if (ev.key === 'Escape') clearSelection();
  }



  // ---- probes -------------------------------------------------------------------------------------------------
  function selectedProbeSync(): void { /* probes read closure state live; nothing to push */ }

  const probes: PieceProbe[] = [
    {
      id: 'pixel',
      label: 'The controlled pixel sample',
      anchor: new THREE.Vector3(TARGET_HALF, CFA_TOP_Y, -TARGET_HALF),
      card(): PartCard {
        const p = currentPixel;
        return {
          kicker: 'Pixel · the pixel',
          title: p ? `Row ${fmtInt(p.y)}, column ${fmtInt(p.x)}` : 'Waiting for the render…',
          body: 'A central sensor pixel sampling a controlled 18% neutral target under the model illuminant. ' +
            'The raw digital number (DN) is the count read from it, before any color processing.',
          more: 'The count is read before demosaicing, white balance or the color matrix.' +
            // Score loop r3: the Camera level's sensor card and the HUD quote a green pixel; say so when this one is not.
            (p && p.cfa !== 'G'
              ? ` This is a ${CFA_NAME[p.cfa]} pixel, so its electron count differs from the Camera level’s sensor card, which quotes a green pixel (a green filter passes the most of a gray target’s daylight).`
              : ''),
          specs: p ? [
            { k: 'Row / column', v: `${fmtInt(p.y)} / ${fmtInt(p.x)}` },
            { k: 'Filter color', v: CFA_NAME[p.cfa][0].toUpperCase() + CFA_NAME[p.cfa].slice(1) },
            { k: 'Raw digital number (DN)', v: fmtInt(p.dn), fig: fig(p.dn, 'DN', 'assumed', 'sensor.ts samplePixel(): sensor readout with sampled read noise', ASSUMED_INPUTS_NOTE) },
            // Score loop r5 (10/14/2026): "Saturated" only tested the well, so it said "no" while the overlay on the same view
            // said "ADC max, clipped" (ISO 1600, 1/60 s). Two rows, one per limit, so the card and the overlay agree.
            { k: 'Well full', v: p.saturated ? 'yes' : 'no' },
            { k: 'ADC clipped (raw at its maximum)', v: currentModel && p.dn >= 2 ** currentModel.sensor.bits - 1 ? 'yes' : 'no' },
          ] : [],
        };
      },
    },
    {
      id: 'microlens',
      label: 'The microlens',
      anchor: new THREE.Vector3(0, MICROLENS_APEX_Y, 0),
      card(model: Model): PartCard {
        // Score loop r3: the body follows the same branch as the fill-factor row, so a sensor whose measured QE
        // already includes the fill factor is never also called "an assumed 97%".
        const fillInQe = model.sensor.figs.fillFactor?.v === 1;
        const fillPct = fmtNum((model.sensor.figs.fillFactor?.v ?? 0.97) * 100, 0);
        return {
          kicker: 'Pixel · the microlens',
          title: 'Microlens',
          body: 'A plano-convex dome molded over each pixel, focusing its share of the incoming cone down ' +
            'through the color filter onto the photodiode, so light that would land between photodiodes is not wasted.',
          more: 'Pitch is the sensor’s own. ' +
            (fillInQe
              ? 'For this sensor the measured quantum efficiency already includes the fill factor (the share of the pixel that collects light), so it is not applied again.'
              : `The fill factor (the share of the pixel that collects light) is an assumed ${fillPct}%, typical of backside-illuminated sensors.`),
          specs: [
            { k: 'Pixel pitch', v: `${fmtNum(model.sensor.pitchUm, 2)} µm`, fig: model.sensor.figs.pitchUm },
            fillInQe
              ? { k: 'Fill factor', v: 'Inside the effective QE', fig: model.sensor.figs.fillFactor }
              : { k: 'Fill factor (assumed)', v: `${fillPct}%`, fig: model.sensor.figs.fillFactor },
          ],
        };
      },
    },
    {
      id: 'cfa',
      label: 'The color filter',
      anchor: new THREE.Vector3(TARGET_HALF, CFA_TOP_Y, TARGET_HALF),
      card(): PartCard {
        const ch = currentPixel?.cfa ?? 'G';
        return {
          kicker: 'Pixel · the color filter',
          title: `${ch} channel dye`,
          body: 'One dye of the Bayer pattern (a checkerboard of red, green and blue filters) above this photodiode. ' +
            'It passes mostly its own band and a little of the others.',
          more: 'Later processing (demosaicing and the color matrix) corrects for that cross-talk. The model uses a representative ' +
            'filter shape fitted to a Nikon D700, not this camera’s measured curves; the fit keeps the D700’s daylight red, green and blue balance.',
          specs: [
            { k: 'Channel', v: ch },
            { k: 'Filter curves', v: 'Fitted to Nikon D700', fig: fig(1, 'model', 'derived', 'data/color/camera-sensitivity-gaussian-model.json: D65-response-preserving Gaussian fit to Jiang et al. 2013 (Nikon D700); folded into the QE curves, not this camera’s own measurement') },
          ],
        };
      },
    },
    {
      id: 'photodiode',
      label: 'The photodiode',
      anchor: new THREE.Vector3(0, DIODE_BOT_Y + 0.05, TARGET_HALF),
      card(model: Model): PartCard {
        // The selected pixel's own color channel: a red pixel peaks lower than the green figure the sensor is quoted at.
        const ch = currentPixel?.cfa ?? 'G';
        const chFig = model.sensor.figs[`qePeak${ch}`] ?? model.sensor.figs.qePeak;
        return {
          kicker: 'Pixel · the photodiode',
          title: 'Photodiode',
          body: 'Turns an arriving photon into a freed electron with some probability (its quantum efficiency) and ' +
            'stores that charge in its own potential well until readout. The well drawn below is that store, pulled out so you can see it fill.',
          specs: [
            { k: `Peak quantum efficiency (QE), ${CFA_NAME[ch]} pixel`, v: `${fmtNum((chFig?.v ?? 0) * 100, 0)}%`, fig: chFig },
          ],
        };
      },
    },
    {
      id: 'well',
      label: 'The well',
      anchor: new THREE.Vector3(TARGET_HALF * 0.96, WELL_BOT_Y + WELL_HEIGHT * 0.35, TARGET_HALF * 0.96),
      card(model: Model): PartCard {
        const p = currentPixel;
        const fillPct = p ? (100 * p.electrons) / p.fullWell : 0;
        return {
          kicker: 'Pixel · the well',
          title: 'The charge well',
          body: 'The photodiode’s own charge store: the electrons freed during the exposure wait here until readout. ' +
            'It holds at most the full-well capacity; past that, extra electrons are not counted and the pixel saturates.',
          more: 'The electrons are one sampled exposure, and the mean is listed beside it; the two differ by photon shot noise. ' +
            // r6: the lineup bodies' sensitivity is scaled to their measured (DxOMark saturation-based) ISO (data.ts calibratedGreenPeak),
            // so the counts follow that third-party figure; a real copy of the camera can differ by about a stop.
            'These counts are this model’s, not a measurement of a real camera: its sensitivity is scaled to this body’s measured ISO (a third-party DxOMark figure), and a real copy can differ by about a stop. The Camera level’s sensor card lists the levels. ' +
            `How it’s drawn: pulled out below the photodiode as glass, its height is the fill fraction (at least ${fmtNum((100 * WELL_MIN_DRAWN) / WELL_HEIGHT, 1)}% so it stays visible), ` +
            'and its brightness rises with the fill from a 22% floor.',
          specs: p ? [
            { k: 'Electrons, one sample', v: `${fmtInt(p.electrons)} e⁻`, fig: fig(p.electrons, 'e-', 'assumed', 'sensor.ts samplePixel(): one seeded stochastic draw', ASSUMED_INPUTS_NOTE) },
            { k: 'Electrons, mean (before any clipping)', v: `${fmtInt(p.electronsMean)} e⁻`, fig: fig(p.electronsMean, 'e-', 'assumed', 'sensor.ts expectedElectrons(): photons by wavelength x effective QE (fill factor inside it)', ASSUMED_INPUTS_NOTE) },
            { k: 'Full well', v: `${fmtInt(p.fullWell)} e⁻`, fig: model.sensor.figs.fullWellE },
            // r3 physics (10/11/2026): the raw value reaches the ADC's top code below the full well at every ISO,
            // even at base ISO (D850: 58,190 e- against 59,126 e-), so "ADC max, clipped" comes before a 100% fill.
            { k: `Raw value clips at (ISO ${fmtInt(model.scenario.iso)})`, v: `${fmtInt(model.sensor.adcClipE)} e⁻`, fig: model.sensor.figs.adcClipE },
            { k: 'Fill, this sample', v: `${fmtNum(fillPct, 1)}%` },
            { k: 'Read noise (electronics)', v: `${fmtNum(p.readNoise, 1)} e⁻ rms`, fig: model.sensor.figs.readNoiseE },
          ] : [],
        };
      },
    },
    {
      id: 'photons',
      label: 'Arriving photons',
      anchor: new THREE.Vector3(0, SPARK_SPAWN_Y, 0),
      card(): PartCard {
        return {
          kicker: 'Pixel · the photons',
          title: 'Photon arrivals',
          body: 'Sparks fall onto the microlens at a scaled rate: too many real photons arrive to draw one dot ' +
            'each, so the badge states the honest ratio for this exact pixel.',
          specs: currentPixel ? [
            { k: 'Photons (mean, 380–780 nm)', v: fmtInt(badge.photonsMean), fig: fig(badge.photonsMean, 'photons', 'assumed', 'sensor.ts expectedElectrons() input, this pixel’s photonsMean: the sum of the engine’s 16 wavelength bins, 380 to 780 nm', ASSUMED_INPUTS_NOTE) },
            ...(currentModel ? [{ k: 'Lens transmission (assumed)', v: `${Math.round(currentModel.figs.lensTransmission.v * 100)}%`, fig: currentModel.figs.lensTransmission }] : []),
            { k: 'Badge scale', v: `1 dot = ${fmtInt(badge.n)} photons` },
          ] : [],
        };
      },
    },
  ];
  // Each probe's real anchor, saved once so tick() can park a probe at PIN_HIDE before a tap resolves (the
  // Move anchors into view as soon as the sample resolves, without losing their real positions.
  const realAnchors = new Map(probes.map((p) => [p.id, p.anchor.clone()]));
  let tickedPixel: unknown = undefined; // the sample the last tick drew (render on demand, score loop r2)

  // ---- PieceHandle ----------------------------------------------------------------------------------------

  return {
    group,

    update(model, _scenario) {
      let scenarioChanged = false;
      if (currentModel && JSON.stringify(currentModel.scenario) !== JSON.stringify(model.scenario)) {
        invalidatePixel(); pixelError = ''; scenarioChanged = group.visible;
      }
      currentModel = model;
      if (!currentPixel && !pendingPixel) refreshPixel(scenarioChanged);
      syncBackButton();
      if (currentPixel) ctx.badge.show(badgeText());
      else ctx.badge.hide();
    },

    frame() { return wellFrame(); },

    /** Draws the full ray bundle now, and starts a sample that a frame is still owed (the stage calls it before a settle frame). */
    flush() {
      if (runDeferredSample) runDeferredSample();
      if (currentPixel && bundleCoarse) { window.clearTimeout(refineTimer); updateRayBundle(false); ctx.invalidate?.(); }
    },

    probes,

    tick(dtMs) {
      if (document.hidden || ctx.renderer.domElement.inert || document.querySelector('dialog[open]')) pausePhotons();
      // the stage draws on demand: this frame changed the picture while the sparks fall, and when the sample
      // resolved or cleared (the pins, the charge fill and the sparks show or hide)
      const animated = photonPlaying || currentPixel !== tickedPixel;
      tickedPixel = currentPixel;
      if (photonPlaying) { photonTime = (photonTime + Math.min(dtMs, 100)) % SPARK_FALL_MS; photonRange.value = String(Math.round(1000 * photonTime / SPARK_FALL_MS)); photonRange.style.setProperty('--pct', `${100 * photonTime / SPARK_FALL_MS}%`); speakPhotonPhase(); }
      // Park stack pins off-screen until the controlled pixel sample is ready.
      const showPins = !!currentPixel;
      for (const p of probes) {
        const real = realAnchors.get(p.id);
        if (real) p.anchor.copy(showPins ? real : PIN_HIDE);
      }
      // The charge fill draws without a depth test (see updateWellFill), so while the camera is still above the
      // The charge fill has no depth test, so show it only with a resolved sample.
      chargeMesh.visible = !!currentPixel;
      // Photon sparks: a small pool falling on a fixed cycle from just above the microlens down to its apex.
      for (const s of sparks) {
        const t = ((photonTime + s.phaseMs) % SPARK_FALL_MS) / SPARK_FALL_MS;
        s.mesh.position.y = THREE.MathUtils.lerp(SPARK_SPAWN_Y, MICROLENS_APEX_Y, t);
        s.mesh.visible = !!currentPixel;
      }
      // Reassert the controlled-sample badge while the pixel is available.
      if (currentPixel) ctx.badge.show(badgeText());
      else ctx.badge.hide();
      return animated;
    },

    insets(): Inset[] {
      return [];
    },

    select(id) {
      pickedOnPhone = !!id && isPhone();
      syncBackButton();
    },
    selectionFrame(id) {
      const anchor = realAnchors.get(id);
      return anchor
        ? selectionFrame(wellFrame(), group.localToWorld(anchor.clone()))
        : this.frame();
    },

    prepare() { lightSilicon(); },
    activate() {
      lightSilicon();
      if (!currentPixel && !pendingPixel) refreshPixel();
      syncBackButton();
      window.addEventListener('keydown', onKeydown);
    },

    deactivate() {
      cancelRainOpening?.();
      rainLaunch.hidden = true; rainView?.close();
      pausePhotons(); photonControls.hidden = true;
      invalidatePixel(); status.hidden = true;
      window.removeEventListener('keydown', onKeydown);
      pickedOnPhone = false;
    },
    onViewInteraction() {},

    hooks: {
      photons: () => ({ playing: photonPlaying, phase: photonTime / SPARK_FALL_MS }),
      // Test/accuracy-gate surface: window.p2p.pieces.loupe.<name>(...). See tools/accuracy/loupe.mjs.
      // The resolved controlled sample on screen (null while one is pending). It used to call refreshPixel() first,
      // which since sampling became asynchronous (c6209df) cleared the pixel and always returned null.
      sample() { if (!currentModel) throw new Error('loupe.ts hooks.sample: model not ready'); return currentPixel; },

      // The Back control, for the choreography (tools/choreo/loupe.mjs) to drive without a real DOM click.
      back() {
        clearSelection();
      },

      state() {
        return { targetX, targetY, hasPixel: currentPixel !== null, pendingPixel, pixelError };
      },

      // tools/test-loupe-loading.mjs: make the next controlled sample fail, then resample, so the gate can check the
      // centered error and its Retry without a worker to break.
      failNextSample() { injectSampleFailure = true; refreshPixel(); },

      debugCamera() {
        const world = new THREE.Vector3();
        chargeMesh.getWorldPosition(world);
        const ndc = world.clone().project(ctx.camera);
        return {
          camPos: ctx.camera.position.toArray(),
          chargeWorld: world.toArray(),
          chargeNdc: ndc.toArray(),
          chargeVisible: chargeMesh.visible,
          chargeScale: chargeMesh.scale.toArray(),
          groupPos: group.position.toArray(),
          gridGroupPos: gridGroup.position.toArray(),
        };
      },

      badge() {
        return { ...badge };
      },

      // Reads the numbers straight off the drawn THREE.js meshes, not a recomputation, so this checks what a
      // reader actually sees, not just what the model says (accuracy gate #1).
      drawnFill() {
        return {
          fillHeightUnits: chargeMesh.scale.y,
          wellHeightUnits: WELL_HEIGHT,
          fillFrac: currentPixel ? currentPixel.electrons / currentPixel.fullWell : null,
          chargeColor: (chargeMesh.material as THREE.MeshBasicMaterial).color.toArray(),
        };
      },

      // Determinism check: repeat the same seeded controlled-pixel sample twice.
      async sampleTwice() {
        if (!currentModel) throw new Error('loupe.ts hooks.sampleTwice: model not ready');
        const [a, b] = await Promise.all([
          Promise.resolve().then(() => sampleNeutralPixel(currentModel!, CONTROLLED_SEED)),
          Promise.resolve().then(() => sampleNeutralPixel(currentModel!, CONTROLLED_SEED)),
        ]);
        return { a, b };
      },

      probe() {
        return {
          pixel: currentPixel,
          badge: { ...badge },
          drawnFill: {
            fillHeightUnits: chargeMesh.scale.y,
            wellHeightUnits: WELL_HEIGHT,
            emissiveBrightness: (chargeMesh.material as THREE.MeshBasicMaterial).color.getHSL({ h: 0, s: 0, l: 0 }).l,
          },
        };
      },
    },

    dispose() {
      cancelRainOpening?.();
      disposed = true; invalidatePixel(); status.remove();
      offPhotonPause(); document.removeEventListener('visibilitychange', hiddenPhotons); photonControls.remove(); rainLaunch.remove(); rainView?.dispose();
      window.removeEventListener('keydown', onKeydown);
      wellEdgeGeo.dispose();
      wellEdgeMat.dispose();
      readFocus?.disconnect();
      read.remove();
      domeGeo.dispose();
      domeMat.dispose();
      for (const d of dieParts) { d.geometry.dispose(); for (const m of [d.material].flat()) m.dispose(); }
      dieMat.dispose();
      dieCutMat.dispose();
      // the shared studio belongs to the renderer (look.ts), not to this piece
      ctx.labels.clear('loupe-');
      bundleGeo.dispose();
      bundleMat.dispose();
      sparkGeo.dispose();
      sparkMat.dispose();
      for (const s of sparks) (s.mesh.geometry as THREE.BufferGeometry).dispose?.();
      for (const m of neighborMeshes) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
      microlens.geometry.dispose();
      (microlens.material as THREE.Material).dispose();
      cfaMesh.geometry.dispose();
      for (const m of dyes.values()) m.dispose();
      diodeMesh.geometry.dispose();
      (diodeMesh.material as THREE.Material).dispose();
      for (const child of wellShell.children) (child as THREE.Mesh).geometry.dispose();
      (wellShell.userData.glass as THREE.Material).dispose(); // one shared material, 5 walls
      (wellShell.userData.rim as THREE.Material).dispose(); // and one for the 4 rim bars
      (wellShell.userData.floor as THREE.Material).dispose();
      chargeGeo.dispose();
      (chargeMesh.material as THREE.Material).dispose();
    },
  };

};
