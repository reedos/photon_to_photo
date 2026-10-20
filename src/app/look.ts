// Materials and tokens from design/LOOK.md ("Materials (Three.js parameters)"), as factory functions, plus the
// one wavelengthColor() the whole site uses for drawing real light (design/LOOK.md, "The spectral color rule").
// Pieces (src/pieces/**) build their meshes from these, never from a bare `new THREE.MeshStandardMaterial()` --
// LOOK.md's own "Do not" list calls that out by name. Imports only from three/webgpu per docs/PROTOTYPE.md.
import * as THREE from 'three/webgpu';
import { spectralColor as engineWavelengthColor } from '../engine/data';

// ---- the spectral color rule: one function, used everywhere the site shows real light ------------------------

/**
 * THREE.Color for monochromatic light at `nm`, from the engine's own spectralColor() (the 1 nm CIE 1931 table, D65,
 * linear sRGB, display-brightness normalized). Uses the already gamma-encoded `srgb` triple and tells three.js it is already in the sRGB color
 * space, so it is not re-encoded a second time -- the accuracy gate (docs/PROTOTYPE.md's tools/accuracy.mjs)
 * checks a rendered ray's pixel against this same engine call, so any silent double-encoding would fail it.
 * Callers use this only on unlit, toneMapped:false materials (rays, spectral swatches, the Airy pattern) --
 * never as UI chrome (design/LOOK.md, "UI accent vs. spectral hue").
 */
export function wavelengthToThreeColor(nm: number): THREE.Color {
  const { srgb } = engineWavelengthColor(nm);
  return new THREE.Color().setRGB(srgb[0], srgb[1], srgb[2], THREE.SRGBColorSpace);
}

// ---- UI/materials tokens (design/LOOK.md palette; kept in sync with src/styles/tokens.css by hand) -----------

export const MATERIAL_COLORS = {
  anodizeBlack: 0x17181b,
  metalCool: 0x9aa3ab,
  metalWarm: 0x8a7a63,
  silicon: 0x1b2029,
  charge: 0xbfe4ff,
  edgeBlack: 0x050505,
  irisSteel: 0x0c0d0f,
  matteInternal: 0x050505,
} as const;

// ---- optical glass (lens elements) -----------------------------------------------------------------------------

export interface GlassOptions {
  /** Index of refraction at the d line, read from the resolved catalog glass -- engine data, never hardcoded
   *  per design/LOOK.md's own instruction. Typical crown/flint glasses span roughly 1.45-1.95. */
  ior: number;
  /** Axial thickness in mm, from the surface's own `t` -- engine data. */
  thickness: number;
  /** Dense flints show a faint warm cast at real path lengths; crown glasses are effectively colorless at
   *  lens-element thickness. Pass the dispersion class if known; defaults to a near-white crown tint. */
  dense?: boolean;
}

/** Optical glass element: MeshPhysicalMaterial per design/LOOK.md's table (transmission 1, roughness 0.02-0.04,
 *  attenuation tint by glass class, AR-coating iridescence on by default). */
export function glassMaterial(opts: GlassOptions): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    transmission: 1.0,
    ior: opts.ior,
    roughness: 0.03,
    thickness: Math.max(0.05, opts.thickness),
    attenuationColor: opts.dense ? 0xf5efd8 : 0xfbfbf8,
    attenuationDistance: opts.dense ? 350 : 500,
    clearcoat: 0,
    iridescence: 1,
    iridescenceIOR: 1.38, // typical for MgF2, the most common single-layer AR coating -- see LOOK.md
    iridescenceThicknessRange: [100, 400],
    side: THREE.DoubleSide,
  });
}

/** The AR-coating on/off toggle: the same boolean the ghosts-and-coatings set piece's ghost intensity reads
 *  (design/LOOK.md: "the same exact toggle visibly dimming the ghost paths"). */
export function setCoated(mat: THREE.MeshPhysicalMaterial, coated: boolean): void {
  mat.iridescence = coated ? 1 : 0;
  mat.needsUpdate = true;
}

/** The blackened rim at an element's clear-aperture edge -- a separate thin ring mesh, not part of the glass. */
export function edgeBlackMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: MATERIAL_COLORS.edgeBlack, roughness: 0.9, metalness: 0 });
}

// ---- anodized aluminum barrel -----------------------------------------------------------------------------------

export function anodizedBarrelMaterial(exposedBezel = false): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: exposedBezel ? MATERIAL_COLORS.metalCool : MATERIAL_COLORS.anodizeBlack,
    metalness: 1,
    roughness: 0.42,
    clearcoat: 0.2,
    clearcoatRoughness: 0.3,
  });
}

/** Matte black internals (baffles, barrel interior) -- deliberately not roughness:1/metalness:0 flat black; see
 *  design/LOOK.md's "looks cheap" pitfall. */
export function matteInternalMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: MATERIAL_COLORS.matteInternal, roughness: 0.88, metalness: 0.08 });
}

/** Rubber focus/control-ring grip (exteriors workstream, 09/28/2026): not itself named in design/LOOK.md's
 *  materials table (written before the lens-exterior pane existed), so this follows the same family as
 *  matteInternalMaterial -- a dark, non-metallic, high-roughness surface that still reads as a real material
 *  under the scene's PMREM rather than a flat CG black -- with a touch less roughness than the barrel's
 *  interior baffles (real textured rubber has a slightly more even sheen than matte-painted metal). Typical,
 *  not measured: evidence assumed. */
export function rubberGripMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 0.82, metalness: 0 });
}

/** Engraved markings (distance scale, control-ring index, f-stop numerals): a paint-filled decal layer, never
 *  emissive, per design/LOOK.md's "Anodized aluminum barrel" section. metalWarm reads as the typical white/
 *  cream paint-fill under the scene's warm-tinted PMREM highlight without introducing a new hue. */
export function engravedMarkMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: MATERIAL_COLORS.metalWarm, roughness: 0.55, metalness: 0.1 });
}

// ---- iris blades --------------------------------------------------------------------------------------------

export function irisSteelMaterial(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({ color: MATERIAL_COLORS.irisSteel, roughness: 0.5, metalness: 0.9 });
}

// ---- silicon die, CFA, microlens, wells ---------------------------------------------------------------------

export function siliconMaterial(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: MATERIAL_COLORS.silicon, roughness: 0.25, metalness: 0.6,
    iridescence: 0.7, iridescenceThicknessRange: [200, 800],
  });
}

// Score loop r4: a step less saturated than the first tints (0xc94b3f, 0x3fae5c, 0x3f6fc9), which under the studio panels read
// as candy-colored slabs next to the camera level's satin graphite. Still clearly red, green and blue.
const CFA_TINTS: Record<'R' | 'G' | 'B', number> = { R: 0xa9524a, G: 0x4d9461, B: 0x4f76ae };

/** A faint dye film for the Bayer tiles (score loop r4): a luminance falloff toward each tile's edge, a slight diagonal
 *  gradient across it and a fine grain, multiplied into the tint, so a tile reads as a coated film and not as one flat
 *  primary. Greyscale: it carries no hue, only the dye's thickness. One shared texture; null where there is no canvas. */
let dyeFilm: THREE.Texture | null | undefined;
export function dyeFilmTexture(): THREE.Texture | null {
  if (dyeFilm !== undefined) return dyeFilm;
  dyeFilm = null;
  const c = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  const g = c && typeof c.getContext === 'function' ? c.getContext('2d') : null;
  if (!c || !g) return null;
  const n = 64;
  c.width = c.height = n;
  const img = g.createImageData(n, n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = ((x + 0.5) / n) * 2 - 1, v = ((y + 0.5) / n) * 2 - 1;
    const edge = THREE.MathUtils.smoothstep(Math.max(Math.abs(u), Math.abs(v)), 0.45, 1);
    const ign = (52.9829189 * ((0.06711056 * x + 0.00583715 * y) % 1)) % 1;
    const lum = 1 - 0.2 * edge + 0.05 * (u - v) / 2 + (ign - 0.5) * 0.05;
    const k = (y * n + x) * 4;
    img.data[k] = img.data[k + 1] = img.data[k + 2] = Math.round(255 * Math.max(0, Math.min(1, lum)));
    img.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  dyeFilm = tex;
  return tex;
}

/** The exposed sensor in the Sensor part view (score loop r5): a die with a dark cover-glass bezel, a fine pixel grid and a
 *  faint Bayer tint in each cell, instead of one flat slate rectangle. Drawing only: the grid pitch here is illustrative (about
 *  120 x 80 cells across the face), not the sensor's real pixel count, and the tint is a hint of the filter mosaic, not a
 *  measured dye. Greyscale-plus-faint-hue, used as the colour and emissive map of the lifted silicon. null without a canvas. */
let sensorDie: THREE.Texture | null | undefined;
export function sensorDieTexture(): THREE.Texture | null {
  if (sensorDie !== undefined) return sensorDie;
  sensorDie = null;
  const c = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  const g = c && typeof c.getContext === 'function' ? c.getContext('2d') : null;
  if (!c || !g) return null;
  const W = 1536, H = 1024;
  c.width = W; c.height = H;
  g.fillStyle = '#0c1118'; g.fillRect(0, 0, W, H);
  // the active area inside a dark bezel
  const bx = 44, by = 44;
  const grad = g.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, '#6d7f9a'); grad.addColorStop(0.5, '#4a5a74'); grad.addColorStop(1, '#657792');
  g.fillStyle = grad; g.fillRect(bx, by, W - 2 * bx, H - 2 * by);
  // Bayer tint, one cell per 12 px (RGGB)
  const cell = 12;
  const tints = [['rgba(190,80,70,0.22)', 'rgba(80,170,100,0.20)'], ['rgba(80,170,100,0.20)', 'rgba(80,120,200,0.22)']];
  for (let y = by; y < H - by; y += cell) for (let x = bx; x < W - bx; x += cell) {
    g.fillStyle = tints[((y - by) / cell) & 1][((x - bx) / cell) & 1];
    g.fillRect(x, y, cell, cell);
  }
  // grid lines: the metal between photodiodes
  g.strokeStyle = 'rgba(8,12,18,0.55)'; g.lineWidth = 2;
  g.beginPath();
  for (let x = bx; x <= W - bx; x += cell) { g.moveTo(x, by); g.lineTo(x, H - by); }
  for (let y = by; y <= H - by; y += cell) { g.moveTo(bx, y); g.lineTo(W - bx, y); }
  g.stroke();
  // a soft vignette inside the bezel so the face is not one tone
  const vg = g.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, W * 0.62);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.38)');
  g.fillStyle = vg; g.fillRect(bx, by, W - 2 * bx, H - 2 * by);
  // the bezel's inner edge
  g.strokeStyle = 'rgba(200,215,235,0.55)'; g.lineWidth = 3;
  g.strokeRect(bx, by, W - 2 * bx, H - 2 * by);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  sensorDie = tex;
  return tex;
}

/** A silvering falloff for the mirror when it is picked (score loop r4): a plane mirror under a far, even studio is one flat
 *  tone, which read as a paper cutout. This greyscale multiplier fades its reflection along the diagonal, as the silvering
 *  and the sheen across a real first-surface mirror do, so the face grades from silver to graphite. Drawing only. */
let mirrorFade: THREE.Texture | null | undefined;
export function mirrorFadeTexture(): THREE.Texture | null {
  if (mirrorFade !== undefined) return mirrorFade;
  mirrorFade = null;
  const c = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  const g = c && typeof c.getContext === 'function' ? c.getContext('2d') : null;
  if (!c || !g) return null;
  const n = 64;
  c.width = c.height = n;
  const img = g.createImageData(n, n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const t = THREE.MathUtils.smoothstep((x + y) / (2 * n - 2), 0.05, 0.95);
    const ign = (52.9829189 * ((0.06711056 * x + 0.00583715 * y) % 1)) % 1;
    const lum = 1 - 0.62 * t + (ign - 0.5) * 0.03;
    const k = (y * n + x) * 4;
    img.data[k] = img.data[k + 1] = img.data[k + 2] = Math.round(255 * Math.max(0, Math.min(1, lum)));
    img.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  mirrorFade = tex;
  return tex;
}

/** A machined section (score loop r4): the cut faces of the Optics barrel were one flat mid-gray each, which read as a drawing
 *  and not as a lit solid. This tiling greyscale texture carries a slow sheen across the face and the faint lines a lathe
 *  leaves along the axis (rows, in the planar mapping glb-barrel.ts gives the section: u along z, v along y), multiplied into
 *  the section's metal tint. Mean about 0.88, so the tint keeps its level. */
let machinedSection: THREE.Texture | null | undefined;
export function machinedSectionTexture(): THREE.Texture | null {
  if (machinedSection !== undefined) return machinedSection;
  machinedSection = null;
  const c = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  const g = c && typeof c.getContext === 'function' ? c.getContext('2d') : null;
  if (!c || !g) return null;
  const n = 128;
  c.width = c.height = n;
  const img = g.createImageData(n, n);
  const rowGrain = (y: number) => { const s = Math.sin(y * 127.1) * 43758.5453; return s - Math.floor(s) - 0.5; };
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = x / n, v = y / n;
    const lum = 0.88 + 0.07 * Math.sin(2 * Math.PI * (u + 0.5 * v)) + rowGrain(y) * 0.07;
    const k = (y * n + x) * 4;
    img.data[k] = img.data[k + 1] = img.data[k + 2] = Math.round(255 * Math.max(0, Math.min(1, lum)));
    img.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  machinedSection = tex;
  return tex;
}

/** The sensor die's cut face (score loop r4): the pedestal under the Pixel level was one flat block. A real section shows
 *  its layers: a pale oxide at the top, a few bright metal wiring lines with their vias, then bulk silicon that darkens
 *  with depth, and a darker rim at the edges. Drawn, not measured: the layer count and thicknesses are illustrative.
 *  Rows run along the face's height, so it suits any of the die boxes' cut faces. */
let sectionTex: THREE.Texture | null | undefined;
export function siliconSectionTexture(): THREE.Texture | null {
  if (sectionTex !== undefined) return sectionTex;
  sectionTex = null;
  const c = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  const g = c && typeof c.getContext === 'function' ? c.getContext('2d') : null;
  if (!c || !g) return null;
  const w = 64, h = 256;
  c.width = w; c.height = h;
  const img = g.createImageData(w, h);
  // row y runs from the die's top (0) to its bottom (h)
  const rowLum = (y: number): number => {
    const t = y / h;
    if (t < 0.05) return 0.6;                       // top oxide
    if (t < 0.2) return (y % 9) < 2 ? 0.86 : 0.5;   // wiring: a bright line every 9 rows, pale oxide between
    if (t < 0.26) return 0.42;                      // the transition into the bulk
    // bulk silicon, darker with depth (score loop r6: 0.52 down to 0.3, was 0.34 down to 0.14, which read as a void)
    return 0.52 - 0.22 * THREE.MathUtils.smoothstep(t, 0.26, 1);
  };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = ((x + 0.5) / w) * 2 - 1;
    const t = y / h;
    // score loop r6: the die's faces repeat this texture once per pixel pitch (loupe.ts), so its darker rim is the line
    // between two pixels (a faint lit core in between: the pixel's own column)
    const rim = (1 - 0.6 * THREE.MathUtils.smoothstep(Math.abs(u), 0.72, 1)) * (t > 0.2 ? 1 + 0.12 * (1 - Math.abs(u)) : 1);
    // vias: short bright ticks through the wiring band at a few columns
    const via = t >= 0.05 && t < 0.2 && (x % 16) === 4 ? 0.18 : 0;
    const ign = (52.9829189 * ((0.06711056 * x + 0.00583715 * y) % 1)) % 1;
    const lum = Math.max(0, Math.min(1, (rowLum(y) + via) * rim + (ign - 0.5) * 0.04));
    const k = (y * w + x) * 4;
    img.data[k] = Math.round(255 * lum * 0.94);
    img.data[k + 1] = Math.round(255 * lum * 0.98);
    img.data[k + 2] = Math.round(255 * lum);
    img.data[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  sectionTex = tex;
  return tex;
}

/** A Bayer CFA dye layer. Desaturated representative tints per design/LOOK.md, not saturated primaries -- real
 *  Bayer dyes pass meaningful out-of-band light. Mark any spec card showing this color 'assumed'. */
export function cfaDyeMaterial(channel: 'R' | 'G' | 'B'): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: CFA_TINTS[channel], transmission: 0.78, thickness: 0.001, ior: 1.5, side: THREE.DoubleSide,
  });
}

export function microlensMaterial(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({ color: 0xffffff, transmission: 1, ior: 1.58, roughness: 0.02 });
}

/** The photodiode well: glass, not an opaque tank (design/LOOK.md's own named pitfall) -- fill is drawn by the
 *  piece as literal liquid height AND emissive brightness, both from electrons/fullWell; see chargeMaterial. */
export function wellGlassMaterial(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({ color: 0xffffff, transmission: 0.95, roughness: 0.03, side: THREE.DoubleSide });
}

/** Electrons/charge: unlit, toneMapped false, icy blue-white -- never a wavelength color (design/LOOK.md: light
 *  has no "electron color"). `fill` (0..1, electrons/fullWell) scales emissive brightness for the top-down
 *  brightness-carries-quantity rule. */
export function chargeMaterial(fill = 1): THREE.MeshBasicMaterial {
  const mat = new THREE.MeshBasicMaterial({ color: MATERIAL_COLORS.charge });
  mat.toneMapped = false;
  // A 0.08 floor at fill≈0 is correct as a "never literally black" rule, but at typical mid-range fractions
  // (art director's own test tap sat at 0.48-0.51) it scaled the icy-blue base color down enough to read as a
  // dim, desaturated gray next to the well's own glass tint -- the "flat gray, no charge visible" complaint
  // (charge-fill-illegible). 0.22 + a 0.78 range keeps the same 0-1 endpoints legible (near-black at true empty,
  // full saturation at full) while giving mid fractions noticeably more of the base hue to stand out against
  // the glass around them.
  mat.color.multiplyScalar(chargeBrightness(fill));
  return mat;
}

/** The brightness factor chargeMaterial applies to the charge color at this fill (0..1): the Pixel level re-colors one material per
 *  sample with it instead of building a new material, whose shader would compile again, on every slider event (score loop r6). */
export function chargeBrightness(fill: number): number {
  return 0.22 + 0.78 * Math.max(0, Math.min(1, fill));
}

// ---- unlit physics-color helpers (rays, spectral swatches, the Airy pattern) ----------------------------------

/** An unlit, toneMapped:false line/point material at an exact physics color -- for rays, photon sparks and
 *  spectral swatches. See design/LOOK.md's Post-processing rules for why toneMapped:false alone is not enough
 *  once a piece composites through EffectComposer's OutputPass -- the stage (src/app/stage.ts) is responsible
 *  for compositing physics-color passes after tone mapping, not this material. */
export function physicsColorMaterial(color: THREE.Color | number): THREE.MeshBasicMaterial {
  const mat = new THREE.MeshBasicMaterial({ color });
  mat.toneMapped = false;
  return mat;
}

export function physicsLineMaterial(color: THREE.Color | number, linewidth = 1.5): THREE.LineBasicMaterial {
  const mat = new THREE.LineBasicMaterial({ color, linewidth });
  mat.toneMapped = false;
  return mat;
}

// ---- the stage's environment and key/fill lights (design/LOOK.md, "Lighting and environment") -----------------

/**
 * The one procedural PMREM environment plus key/fill lights every 3D view in this project uses -- factored out
 * of src/app/stage.ts's createStage() (09/28/2026, lens-exteriors workstream) so a standalone preview page
 * (src/scene/lens-preview.ts) gets the exact same "cool upper hemisphere, one warm rim from below-behind, a
 * black void" look without duplicating the geometry/color logic by hand. stage.ts calls this too, so the two
 * can never drift apart. Adds the lights directly to `scene` and returns the PMREMGenerator so the caller can
 * dispose it (matches PMREMGenerator's own lifecycle contract -- it is not a scene object itself).
 */
export function buildEnvironmentAndLights(renderer: THREE.WebGPURenderer, scene: THREE.Scene): THREE.PMREMGenerator {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envGeo = new THREE.IcosahedronGeometry(50, 3);
  const posAttr = envGeo.attributes.position;
  const colors = new Float32Array(posAttr.count * 3);
  const cool = new THREE.Color(0x1a2028);
  const warm = new THREE.Color(0x3a281c);
  const highlight = new THREE.Color(0xf0f0fa);
  for (let i = 0; i < posAttr.count; i++) {
    const y = posAttr.getY(i) / 50; // -1..1
    let c: THREE.Color;
    if (y > 0.55) c = cool.clone().lerp(highlight, THREE.MathUtils.smoothstep(y, 0.55, 0.95));
    else if (y < -0.5) c = new THREE.Color(0x030303).clone().lerp(warm, THREE.MathUtils.smoothstep(-y, 0.5, 1));
    else c = new THREE.Color(0x08090b);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  envGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const envMesh = new THREE.Mesh(envGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide }));
  envScene.add(envMesh);
  scene.environment = pmrem.fromScene(envScene, 0.02).texture;
  envGeo.dispose();
  (envMesh.material as THREE.Material).dispose();

  const key = new THREE.DirectionalLight(0xf4f2ee, 1.1);
  key.position.set(60, 90, 40);
  const fill = new THREE.DirectionalLight(0xaecbff, 0.25);
  fill.position.set(-60, 20, -30);
  scene.add(key, fill);

  return pmrem;
}

// ---- the camera studio (level 1 and the model viewer): glass, paint, light (round-0 FID-1, FID-8) --------------

/** The lens elements as seen on the assembled camera: thick optical glass reads DARK and deep from outside, with the
 *  multicoat's green/magenta sheen at grazing angles and one small specular highlight, never a pale frosted plug.
 *  Stacked elements must not add up to white, so the tint is near black and each layer is faint; the front element
 *  carries a little more than the ones behind it. A PF (phase Fresnel) layer looks like ordinary glass from outside,
 *  so it gets the same material. Not a physics color: this is the housing's look, the rays stay exact. */
export function opticalGlassMaterial(front = true): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: front ? 0x314f58 : 0x29404d, metalness: 0, roughness: 0.045, transparent: true, opacity: front ? 0.20 : 0.075,
    transmission: 0, clearcoat: 1, clearcoatRoughness: 0.045, envMapIntensity: front ? 2.8 : 1.8, specularIntensity: 1,
    iridescence: 1, iridescenceIOR: 1.38, iridescenceThicknessRange: [250, 380],
    side: THREE.DoubleSide, depthWrite: false,
  });
}

/** The outermost element's reflection alone, drawn over its tinted glass (score loop r3, presentation review P-12):
 *  the front glass is alpha-blended at 0.20, which scales its environment reflection down with it, so from outside a
 *  long lens's front element read as a black hole. This black-based layer is added on top instead: only the coated
 *  surface's reflection of the studio panels (with its Fresnel rise toward the rim) adds light, and the glass's own
 *  opacity is unchanged. Drawing only. */
export function glassSheenMaterial(env: THREE.Texture | null = null): THREE.MeshPhysicalMaterial {
  const m = new THREE.MeshPhysicalMaterial({
    name: 'glassSheen', color: 0x000000, metalness: 0, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.12,
    envMapIntensity: 1.0, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.FrontSide,
  });
  // Seen from the usual front three-quarter view, a front element mirrors only the dark studio dome; its own view of
  // the studio is turned so the low kicker softbox lands on it (as the DSLR mirror's is, MIRROR_ENV_TURN). The caller
  // passes the studio texture, since envMapRotation is ignored for scene.environment.
  m.envMap = env;
  m.envMapRotation.set(0, 2.95, 0);
  return m;
}

/** The blackened rim of an element (optical edge paint), drawn as a thin band at the element's outer radius. */
export function elementEdgeMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0x0b1014, roughness: 0.62, metalness: 0.08, side: THREE.DoubleSide });
}

/** Polished optical surfaces and the rougher exposed section are different finishes. These tints and coating
 * thicknesses illustrate glass, not a measured coating spectrum. Alpha-only coverage deliberately avoids the
 * viewport-transmission sampler; the optical engine alone bends and colors the rays through the real profiles. */
export function cutawayGlassMaterial(ior: number, dense: boolean): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    // cool near-white for crowns and flints alike: the warm flint tint read khaki, a milky plug (score loop r1)
    color: dense ? 0xc4d6dc : 0xb4d2dc, transmission: 0, transparent: true, opacity: 0.16,
    depthWrite: false, roughness: 0.055, metalness: 0, ior, reflectivity: 0.9,
    iridescence: 0.55, iridescenceIOR: 1.38, iridescenceThicknessRange: [180, 360],
    envMapIntensity: 1.35, side: THREE.DoubleSide,
  });
}

export function sectionGlassMaterial(dense: boolean): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: dense ? 0xc4d6dc : 0xb6d4dd, metalness: 0, roughness: 0.32, transmission: 0,
    transparent: true, opacity: 0.22, clearcoat: 0.25, clearcoatRoughness: 0.2,
    side: THREE.DoubleSide, depthWrite: false,
  });
}

/** Representative coated sensor surface, not a Bayer pattern or a signal level. Uses the existing environment
 * to reveal a subtle angle-dependent sheen without a texture, extra pass, light or animation. */
export function sensorArrayMaterial(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    name: 'PixelArray', color: 0x283444, roughness: 0.18, metalness: 0.6,
    iridescence: 1, iridescenceIOR: 1.8, iridescenceThicknessRange: [260, 640],
    envMapIntensity: 2.1, side: THREE.DoubleSide,
  });
}

/** A band at radius r from z0 to z1 (mm, lens axis = z), over angles a0..a1 (a full turn, or the kept half of a cut). */
export function edgeBandGeometry(r: number, z0: number, z1: number, a0 = 0, a1 = Math.PI * 2, seg = 72): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const a = a0 + ((a1 - a0) * i) / seg;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    pos.push(x, y, z0, x, y, z1);
    if (i < seg) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Presentation finishes, not measured reflectance: graphite paint, soft rubber, machined mounts and coated
 * glass should remain distinguishable at the overview scale. Only known housing materials are tuned here;
 * spectral rays, Bayer dyes and computed signal colors never pass through this palette. */
/** How far the mirror's view of the studio is turned about the vertical (radians); see tuneStudioMaterial. */
export const MIRROR_ENV_TURN = 0.97;

export function tuneStudioMaterial(mat: THREE.Material): THREE.Material {
  const n = mat.name ?? '';
  const m = mat as THREE.MeshPhysicalMaterial;
  if (!('roughness' in m) || !('color' in m)) return mat;
  if (/Paint/i.test(n)) {
    // Neutral graphite, near design/LOOK.md's anodize black (#17181b): the old slate 0x353c46 under the cool panels
    // rendered steel blue (score loop r1: a lit face sampled (135,156,176)). The cool tint stays in the light only.
    m.color.set(0x242526);
    m.roughness = 0.42;
    if ('clearcoat' in m) { m.clearcoat = 0.25; m.clearcoatRoughness = 0.3; }
    m.envMapIntensity = 1.5;
  } else if (/Baffle/i.test(n)) {
    // matte-black internals (LOOK.md: #050505, roughness 0.88, metalness 0.08): the barrel's inner wall read pale
    // through the front element, so the lens looked like an empty tube from outside (score loop r1)
    m.color.set(MATERIAL_COLORS.matteInternal);
    m.roughness = 0.88;
    if ('metalness' in m) m.metalness = 0.08;
    m.envMapIntensity = 0.6;
  } else if (/Rubber/i.test(n)) {
    m.color.set(0x242629);
    m.roughness = 0.78;
    m.envMapIntensity = 1.0;
  } else if (/^(BrushedChrome|mountChrome)/i.test(n)) {
    // score loop r4: 0x8f8b83, 0.38 and 1.0 (were 0xc8c4b9, 0.32, 1.15): the hot shoe and the prism's chrome sampled luma 0.85 in
    // the cutaway, the brightest flat faces in the view; the key panel's reflection now stays near 0.6
    m.color.set(0x8f8b83);
    m.roughness = 0.38;
    m.envMapIntensity = 1.0;
  } else if (/^(GoldContact|lensContacts)/i.test(n)) {
    m.color.set(0xd4ad68);
    m.roughness = 0.3;
  } else if (/^irisBlade/i.test(n)) {
    m.color.set(0x454d58);
    m.roughness = 0.4;
  } else if (/^(KnurlBlack|knurlPlastic|buttonSatin)/i.test(n)) {
    m.color.set(0x2b2d32);
    m.roughness = 0.48;
  } else if (/^(afSensorCarrier|CeramicCarrier)$/.test(n)) {
    // the AF module's sensor carrier and the sensor package in dark ceramic, like the camera level's sensorPackageDark:
    // at the export's 0.72 cream they lit up as a bright block on the mirror-box floor, away from the ray path
    // (score loop r3). Drawing only; size and place are the model's.
    m.color.set(MATERIAL_COLORS.anodizeBlack);
    m.roughness = 0.55;
    if ('metalness' in m) m.metalness = 0.1;
  } else if (/^MirrorSurface/.test(n)) {
    // The DSLR's main and sub-mirror (score loop r3): a silvered first-surface mirror. It read as a matte black slab
    // because, seen from the default cutaway, it reflects only the dark studio dome. A light base, mirror-smooth, and
    // its own view of the studio turned (MIRROR_ENV_TURN) so the edge of the tall rim softbox crosses it from that view, at
    // 0.3 so the white rays stay readable over it (1.04 at 1.5 made a white slab that hid them); the caller
    // gives it the studio as its own envMap, since envMapRotation is ignored for scene.environment. Drawing only.
    m.color.setScalar(0.85);
    m.roughness = 0.05;
    if ('metalness' in m) m.metalness = 1;
    m.envMapIntensity = 0.3;
    m.envMapRotation.set(0, MIRROR_ENV_TURN, 0);
  } else if (/^(engraving|indexWhite)/i.test(n)) {
    m.color.set(0xd5cdbd);
  }
  return mat;
}

/** The camera studio: the black void of the site, plus a large soft key panel (3:1) above and in front, a tall strip
 *  behind the camera on the right for the rim, and a cool low kicker behind on the left. Environment only, built once;
 *  the caller disposes the PMREM generator. Black paint only reads by what it reflects, so these panels are what
 *  draw its edges (FID-8). */
export function buildStudioEnvironment(renderer: THREE.Renderer): { texture: THREE.Texture; dispose(): void } {
  const pmrem = new THREE.PMREMGenerator(renderer as unknown as THREE.WebGPURenderer);
  const env = new THREE.Scene();
  const dome = new THREE.IcosahedronGeometry(50, 3);
  const p = dome.attributes.position;
  const cols = new Float32Array(p.count * 3);
  // near-neutral: a blue dome tinted the graphite paint steel blue (score loop r1), so only a trace of cool is kept
  const top = new THREE.Color(0x2a2b2e), low = new THREE.Color(0x0b0c0e), mid = new THREE.Color(0x131315);
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) / 50;
    const c = y > 0.3 ? mid.clone().lerp(top, THREE.MathUtils.smoothstep(y, 0.3, 1)) : mid.clone().lerp(low, THREE.MathUtils.smoothstep(-y, -0.3, 0.8));
    cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
  }
  dome.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const domeMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide });
  env.add(new THREE.Mesh(dome, domeMat));
  const panels: THREE.Mesh[] = [];
  const panel = (w: number, h: number, rgb: [number, number, number], at: [number, number, number]) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(...rgb), side: THREE.DoubleSide }));
    m.position.set(...at);
    m.lookAt(0, 0, 0);
    env.add(m);
    panels.push(m);
  };
  // camera frame: lens toward -z, y up, the reader usually in front-left (-x, -z)
  panel(48, 16, [4, 4, 3.8], [-18, 34, -20]);     // softer key preserves the metal's highlight detail
  panel(10, 40, [3.0, 2.85, 2.6], [34, 8, 30]);    // metal rim, behind-right: only a trace warm (score loop r3)
  panel(22, 8, [1.35, 1.45, 1.6], [-36, -10, 26]);  // glass kicker, behind-left and low: near-neutral, a trace cool
  panel(30, 6, [0.95, 0.98, 1.02], [0, -30, -18]);   // broad fill keeps underside controls readable
  // a dim, wide floor bounce (score loop r4): from low angles the matte-black body's underside mirrored only the near-black lower dome
  // and read as a void; this broad cool panel under it gives it a faint material read. The floor itself stays black (it is drawn
  // by the ground glow, not lit)
  panel(80, 56, [0.6, 0.63, 0.68], [0, -44, 12]);
  const texture = pmrem.fromScene(env, 0.02).texture;
  return {
    texture,
    dispose() {
      texture.dispose(); pmrem.dispose(); dome.dispose(); domeMat.dispose();
      for (const m of panels) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
    },
  };
}

/** One camera-studio environment per renderer, shared by the deep levels (Optics, Focus, Pixel) so their glass,
 *  metal and silicon reflect the same softbox panels as the Camera level (score loop r2: their materials read
 *  flat and unlit under the stage's dim dome). Built on first use once the renderer is live; null before that. */
const sharedStudio = new WeakMap<object, ReturnType<typeof buildStudioEnvironment>>();
export function sharedStudioTexture(renderer: THREE.Renderer): THREE.Texture | null {
  const r = renderer as unknown as { hasInitialized?: () => boolean };
  if (typeof r.hasInitialized !== 'function' || !r.hasInitialized()) return null;
  let s = sharedStudio.get(renderer);
  if (!s) { s = buildStudioEnvironment(renderer); sharedStudio.set(renderer, s); }
  return s.texture;
}

/** Materials that should reflect the shared studio (above): `add` registers one with its env intensity, `apply`
 *  hands them the studio once the renderer is live (call it from a piece's activate, or before each render).
 *  Material look only: rays, spectral swatches and charge stay unlit and never pass through this. */
export function studioLitSet(renderer: THREE.Renderer) {
  const mats: [THREE.MeshStandardMaterial, number][] = [];
  let tex: THREE.Texture | null = null;
  const give = (m: THREE.MeshStandardMaterial, k: number) => { m.envMap = tex; m.envMapIntensity = k; m.needsUpdate = true; };
  return {
    add<T extends THREE.MeshStandardMaterial>(m: T, k = 1.4): T { mats.push([m, k]); if (tex) give(m, k); return m; },
    apply(): boolean {
      if (tex) return true;
      tex = sharedStudioTexture(renderer);
      if (!tex) return false;
      for (const [m, k] of mats) give(m, k);
      return true;
    },
    remove(m: THREE.Material) { const i = mats.findIndex(([x]) => x === m); if (i >= 0) mats.splice(i, 1); },
  };
}

/** Rim and kicker lights for black paint on black (FID-8), added to `group` so they leave with it. The key stays
 *  where the reader expects it (upper front-left); the rim comes from behind-right-high, the cool kicker from
 *  behind-left-low, so the silhouette's top and back edges light up against the void. */
export function addStudioLights(group: THREE.Object3D, k = 1): THREE.Light[] {
  const key = new THREE.DirectionalLight(0xf4f2ee, 2.0 * k); key.position.set(-160, 220, -200);
  // fill and kicker near-neutral (score loop r1): their blue tint, not the paint, made the bodies read steel blue;
  // the kicker is cut by 30% so the edges still separate from the void without washing the body
  const fill = new THREE.DirectionalLight(0xe6ebf2, 1.45 * k); fill.position.set(200, 80, -60); // 1.2 before score loop r4: about +0.27 EV on the body
  // rim near-neutral, weaker and lower (score loop r3): the warm 0xf0d4a5 at 2.5 from 160 up lit every top face (prism,
  // top deck, grip top) flat-on and turned the black body cream there (a top face sampled (235,228,212)); from 60 up it
  // grazes the back and top edges instead
  const rim = new THREE.DirectionalLight(0xf2ece4, 1.4 * k); rim.position.set(140, 60, 240);
  // score loop r6: a cooler, stronger kicker (1.7, was 1.2 at 0xe6ebf2), so the grip and the back of a dark body show an edge against the floor
  const kick = new THREE.DirectionalLight(0xd6e4f8, 1.7 * k); kick.position.set(-220, -40, 180);
  const amb = new THREE.AmbientLight(0x2c2e31, 0.4 * k);
  group.add(key, fill, rim, kick, amb);
  return [key, fill, rim, kick, amb];
}

/** A faint pool of light on an unseen floor under the camera, so it stands on something instead of floating in the
 *  void. A radial gradient from the page's --surface to transparent; drawn, not lit. */
export function groundGlow(radius: number): THREE.Mesh {
  const c = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  let tex: THREE.Texture | null = null;
  if (c) {
    c.width = c.height = 256;
    const g = c.getContext('2d');
    if (g) {
      const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
      // score loop r6: a lifted pool (was 30,38,46 and 16,21,27), so a dark body has a lighter floor behind and below it
      grad.addColorStop(0, 'rgba(58,72,88,0.92)');
      grad.addColorStop(0.4, 'rgba(34,43,54,0.66)');
      grad.addColorStop(0.75, 'rgba(14,18,23,0.3)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad; g.fillRect(0, 0, 256, 256);
      ditherCanvas(g, 256);
      tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      // no mip averaging (the glow is usually drawn smaller than 256 texels across), so the dither reaches the screen
      tex.generateMipmaps = false;
      tex.minFilter = THREE.NearestFilter;
    }
  }
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, opacity: tex ? 1 : 0 });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2), mat);
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = -1;
  m.name = 'ground-glow';
  return m;
}

/** A faint screen-space backdrop for the camera level (score loop r6): a cool radial pool, brightest a little below the view's
 *  middle, falling to black at the edge, with +-1 level of noise in every channel so the 8-bit steps of so dark a ramp do not
 *  show as rings. Used as the scene background, so it needs no geometry, never depends on the orbit and adds no bloom. */
let backdropTex: THREE.Texture | null | undefined;
export function stageBackdropTexture(): THREE.Texture | null {
  if (backdropTex !== undefined) return backdropTex;
  backdropTex = null;
  const c = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  const g = c && typeof c.getContext === 'function' ? c.getContext('2d') : null;
  if (!c || !g) return null;
  const W = 512, H = 320;
  c.width = W; c.height = H;
  const grad = g.createRadialGradient(W * 0.5, H * 0.58, 0, W * 0.5, H * 0.58, W * 0.62);
  grad.addColorStop(0, 'rgb(36,47,60)');
  grad.addColorStop(0.45, 'rgb(16,22,29)');
  grad.addColorStop(1, 'rgb(0,0,0)');
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  const img = g.getImageData(0, 0, W, H);
  const d = img.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const ign = (52.9829189 * ((0.06711056 * x + 0.00583715 * y) % 1)) % 1;
    const n = Math.round((ign - 0.5) * 2.4);
    if (d[i] + d[i + 1] + d[i + 2] === 0) continue;
    d[i] = Math.max(0, d[i] + n); d[i + 1] = Math.max(0, d[i + 1] + n); d[i + 2] = Math.max(0, d[i + 2] + n);
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = false;
  tex.minFilter = THREE.LinearFilter;
  backdropTex = tex;
  return tex;
}

/** Breaks up 8-bit banding in a dark canvas gradient (score loop r3: the ground glow spanned about 15 levels on black
 *  and showed contour steps): each texel's alpha moves by up to `amp` levels with an interleaved-gradient noise (Jimenez
 *  2014), a cheap stand-in for blue noise that has no low-frequency blotches. The glow's brightest channel is 46/255,
 *  so about 3 alpha levels move the drawn color by half an output level: amp 4 reaches the output. Only alpha moves. */
function ditherCanvas(g: CanvasRenderingContext2D, n: number, amp = 4): void {
  const img = g.getImageData(0, 0, n, n);
  const d = img.data;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = (y * n + x) * 4;
    if (!d[i + 3]) continue;
    const ign = (52.9829189 * ((0.06711056 * x + 0.00583715 * y) % 1)) % 1;
    d[i + 3] = Math.max(0, Math.min(255, d[i + 3] + Math.round((ign - 0.5) * 2 * amp)));
  }
  g.putImageData(img, 0, 0);
}

/** A soft contact shadow for the body's footprint (score loop r3): the camera floated on black with only the faint
 *  glow under it. A unit plane with an elliptical radial alpha (dark under the middle, gone at the edge) that the
 *  caller scales to the footprint and lays just above the glow, so it darkens the glow where the body meets the floor.
 *  Baked, no shadow map: safe with the WebGPU tier's anti-aliasing and independent of AO. Drawing only. */
export function contactShadow(): THREE.Mesh {
  const c = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  let tex: THREE.Texture | null = null;
  if (c) {
    c.width = c.height = 128;
    const g = c.getContext('2d');
    if (g) {
      const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      grad.addColorStop(0, 'rgba(0,0,0,0.92)');
      grad.addColorStop(0.55, 'rgba(0,0,0,0.6)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
      tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
    }
  }
  const mat = new THREE.MeshBasicMaterial({ color: 0x000000, map: tex, transparent: true, depthWrite: false, toneMapped: false, opacity: tex ? 1 : 0 });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = -0.5;
  m.name = 'contact-shadow';
  return m;
}

// ---- the scripted bodies' surface finish and stand-in materials (R1-FID-B, R1-04) -----------------------------

/** Normal maps load once each, shared by every material that names them (models/<path>, from the GLB's extras). */
const normalMaps = new Map<string, THREE.Texture>();
/** The extras name the PNG the Blender scripts write; a lossless WebP copy with identical pixels ships beside it,
 *  23% smaller (tools/make-normal-webp.py, score loop r3). */
const LOSSLESS_WEBP = new Set(['textures/leatherette-normal.png', 'textures/paint-normal.png']);
export function normalMapFile(path: string): string {
  return LOSSLESS_WEBP.has(path) ? path.replace(/\.png$/, '.webp') : path;
}
let texLoader: THREE.TextureLoader | null = null;
function normalMap(path: string): THREE.Texture | null {
  if (typeof location === 'undefined') return null;
  let t = normalMaps.get(path);
  if (!t) {
    texLoader ??= new THREE.TextureLoader();
    t = texLoader.load(new URL(`./models/${normalMapFile(path)}`, location.href).href);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.flipY = false;
    t.colorSpace = THREE.NoColorSpace;
    // anisotropic filtering (three clamps it to what the GPU offers): a fine normal map minified at a grazing angle sparkled
    // along its tile ridges on the grip (score loop r5)
    t.anisotropy = 8;
    normalMaps.set(path, t);
  }
  return t;
}

/** The pebble of the grip leatherette and the grain of the satin paint: public/models/bodies.json "$textures". Each
 *  finished material carries glTF extras {normalMap, normalScale, uvTileMm} (three puts them in material.userData)
 *  and its meshes carry box-projected UVs, so this only loads the map and sets its strength. `k` scales the
 *  strength (a phone gets a little less, where a strong fine normal map shimmers). */
export function applySurfaceFinish(mat: THREE.Material, k = 1): void {
  const x = mat.userData as { normalMap?: string; normalScale?: number } | undefined;
  const m = mat as THREE.MeshStandardMaterial;
  if (!x?.normalMap || !('normalMap' in m) || m.normalMap) return;
  const t = normalMap(x.normalMap);
  if (!t) return;
  m.normalMap = t;
  // Satin paint at half its exported grain (score loop r3): on the flat prism hump the 0.14 grain read as stucco; a
  // painted metal or polycarbonate housing is smooth. The grip's leatherette keeps its full pebble.
  const paint = /Paint/i.test(mat.name ?? '') ? 0.5 : 1;
  const s = (x.normalScale ?? 0.6) * k * paint;
  m.normalScale = new THREE.Vector2(s, s);
  m.needsUpdate = true;
}

/** Materials the Blender export can only approximate, replaced for the studio look: the pixel array reads as
 *  silicon (dark, with the thin-film sheen of its microlenses), not a white slab; the focusing screen and the
 *  pentaprism read as dark optical glass, not holes (the export's full-transmission glass renders black here). */
let SILICON: THREE.MeshPhysicalMaterial | null = null;
let DARK_GLASS: THREE.MeshPhysicalMaterial | null = null;
// The sensor's filter stack (filterGlass) and the EVF eyepiece (evfGlass) are not replaced any more. Their export
// used to be near-white glass with KHR_materials_transmission, which this renderer cannot use (three's transmission
// sampler kept a destroyed texture after resizes), so this function cloned them with transmission 0 at 0.10 to 0.12
// opacity (presentation review P-04, P-05). Since the aperture review of 10/11/2026 the Blender scripts export them as
// dark coated glass with alpha blending and no transmission (blender/bodykit.py mat_cover_glass), which the loader
// renders as authored; src/scene/bodies/blender-glb.test.ts holds the export to that.
export function studioReplacement(mat: THREE.Material): THREE.Material | null {
  const n = mat.name ?? '';
  if (n === 'PixelArray') {
    SILICON ??= sensorArrayMaterial();
    return SILICON;
  }
  if (n === 'screenGlass') {
    DARK_GLASS ??= new THREE.MeshPhysicalMaterial({ name: 'screenGlass', color: 0x2a3945, roughness: 0.08, metalness: 0.05,
      clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 2.4, transparent: true, opacity: 0.62, side: THREE.DoubleSide, depthWrite: false });
    return DARK_GLASS;
  }
  return null;
}
