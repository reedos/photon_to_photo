// Materials and tokens from design/LOOK.md ("Materials (Three.js parameters)"), as factory functions, plus the
// one wavelengthColor() the whole site uses for drawing real light (design/LOOK.md, "The spectral color rule").
// Pieces (src/pieces/**) build their meshes from these, never from a bare `new THREE.MeshStandardMaterial()` --
// LOOK.md's own "Do not" list calls that out by name. Imports only from three/webgpu per docs/PROTOTYPE.md.
import * as THREE from 'three/webgpu';
import { wavelengthColor as engineWavelengthColor } from '../engine/spectrum';

// ---- the spectral color rule: one function, used everywhere the site shows real light ------------------------

/**
 * THREE.Color for monochromatic light at `nm`, from the engine's own wavelengthColor() (CIE 1931 CMFs, D65,
 * linear sRGB). Uses the already gamma-encoded `srgb` triple and tells three.js it is already in the sRGB color
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

const CFA_TINTS: Record<'R' | 'G' | 'B', number> = { R: 0xc94b3f, G: 0x3fae5c, B: 0x3f6fc9 };

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
  mat.color.multiplyScalar(0.22 + 0.78 * Math.max(0, Math.min(1, fill)));
  return mat;
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
    color: front ? 0x28464e : 0x29404d, metalness: 0, roughness: 0.035, transparent: true, opacity: front ? 0.14 : 0.08,
    clearcoat: 1, clearcoatRoughness: 0.035, envMapIntensity: 2.4, specularIntensity: 1,
    iridescence: 1, iridescenceIOR: 1.35, iridescenceThicknessRange: [250, 420],
    side: THREE.DoubleSide, depthWrite: false,
  });
}

/** The blackened rim of an element (optical edge paint), drawn as a thin band at the element's outer radius. */
export function elementEdgeMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: 0x040405, roughness: 0.8, metalness: 0.05, side: THREE.DoubleSide });
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
export function tuneStudioMaterial(mat: THREE.Material): THREE.Material {
  const n = mat.name ?? '';
  const m = mat as THREE.MeshPhysicalMaterial;
  if (!('roughness' in m) || !('color' in m)) return mat;
  if (/Paint/i.test(n)) {
    m.color.set(0x353c46);
    m.roughness = 0.38;
    if ('clearcoat' in m) { m.clearcoat = 0.25; m.clearcoatRoughness = 0.3; }
    m.envMapIntensity = 1.5;
  } else if (/Rubber/i.test(n)) {
    m.color.set(0x242629);
    m.roughness = 0.78;
    m.envMapIntensity = 1.0;
  } else if (/^(BrushedChrome|mountChrome)/i.test(n)) {
    m.color.set(0xc8c4b9);
    m.roughness = 0.32;
    m.envMapIntensity = 1.15;
  } else if (/^(GoldContact|lensContacts)/i.test(n)) {
    m.color.set(0xd4ad68);
    m.roughness = 0.3;
  } else if (/^irisBlade/i.test(n)) {
    m.color.set(0x454d58);
    m.roughness = 0.4;
  } else if (/^(KnurlBlack|knurlPlastic|buttonSatin)/i.test(n)) {
    m.color.set(0x2b2d32);
    m.roughness = 0.48;
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
  const top = new THREE.Color(0x242d39), low = new THREE.Color(0x050607), mid = new THREE.Color(0x11151b);
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
  panel(10, 40, [3.3, 2.7, 1.9], [34, 8, 30]);     // warm metal rim, behind-right
  panel(22, 8, [1.2, 1.65, 2.2], [-36, -10, 26]);  // cool glass kicker, behind-left and low
  panel(30, 6, [0.9, 1.0, 1.15], [0, -30, -18]);   // broad fill keeps underside controls readable
  const texture = pmrem.fromScene(env, 0.02).texture;
  return {
    texture,
    dispose() {
      texture.dispose(); pmrem.dispose(); dome.dispose(); domeMat.dispose();
      for (const m of panels) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
    },
  };
}

/** Rim and kicker lights for black paint on black (FID-8), added to `group` so they leave with it. The key stays
 *  where the reader expects it (upper front-left); the rim comes from behind-right-high, the cool kicker from
 *  behind-left-low, so the silhouette's top and back edges light up against the void. */
export function addStudioLights(group: THREE.Object3D, k = 1): THREE.Light[] {
  const key = new THREE.DirectionalLight(0xf4f2ee, 2.0 * k); key.position.set(-160, 220, -200);
  const fill = new THREE.DirectionalLight(0xd5e3f4, 1.2 * k); fill.position.set(200, 80, -60);
  const rim = new THREE.DirectionalLight(0xf0d4a5, 2.5 * k); rim.position.set(140, 160, 240);
  const kick = new THREE.DirectionalLight(0xbad8f5, 1.7 * k); kick.position.set(-220, -40, 180);
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
    c.width = c.height = 128;
    const g = c.getContext('2d');
    if (g) {
      const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      grad.addColorStop(0, 'rgba(30,38,46,0.9)');
      grad.addColorStop(0.45, 'rgba(16,21,27,0.55)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad; g.fillRect(0, 0, 128, 128);
      tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
    }
  }
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, opacity: tex ? 1 : 0 });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2, radius * 2), mat);
  m.rotation.x = -Math.PI / 2;
  m.renderOrder = -1;
  m.name = 'ground-glow';
  return m;
}

// ---- the scripted bodies' surface finish and stand-in materials (R1-FID-B, R1-04) -----------------------------

/** Normal maps load once each, shared by every material that names them (models/<path>, from the GLB's extras). */
const normalMaps = new Map<string, THREE.Texture>();
let texLoader: THREE.TextureLoader | null = null;
function normalMap(path: string): THREE.Texture | null {
  if (typeof location === 'undefined') return null;
  let t = normalMaps.get(path);
  if (!t) {
    texLoader ??= new THREE.TextureLoader();
    t = texLoader.load(new URL(`./models/${path}`, location.href).href);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.flipY = false;
    t.colorSpace = THREE.NoColorSpace;
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
  const s = (x.normalScale ?? 0.6) * k;
  m.normalScale = new THREE.Vector2(s, s);
  m.needsUpdate = true;
}

/** Materials the Blender export can only approximate, replaced for the studio look: the pixel array reads as
 *  silicon (dark, with the thin-film sheen of its microlenses), not a white slab; the focusing screen and the
 *  pentaprism read as dark optical glass, not holes (the export's full-transmission glass renders black here). */
let SILICON: THREE.MeshPhysicalMaterial | null = null;
let DARK_GLASS: THREE.MeshPhysicalMaterial | null = null;
const STUDIO_COVER_GLASS = new WeakMap<THREE.Material, THREE.MeshPhysicalMaterial>();
export function studioReplacement(mat: THREE.Material): THREE.Material | null {
  const n = mat.name ?? '';
  if ((n === 'filterGlass' || n === 'evfGlass') && mat instanceof THREE.MeshPhysicalMaterial) {
    let glass = STUDIO_COVER_GLASS.get(mat);
    if (!glass) {
      // Like the lens glass, these thin covers use alpha in the studio view. Three's transmission
      // framebuffer sampler can retain a destroyed texture after the camera viewport changes size.
      // Keep the authored coating/roughness; the ray engine owns optical transmission separately.
      glass = mat.clone();
      glass.transmission = 0;
      glass.transparent = true;
      glass.opacity = n === 'filterGlass' ? 0.22 : 0.42;
      glass.depthWrite = false;
      STUDIO_COVER_GLASS.set(mat, glass);
    }
    return glass;
  }
  if (n === 'PixelArray') {
    SILICON ??= new THREE.MeshPhysicalMaterial({ name: 'PixelArray', color: 0x1f2233, roughness: 0.22, metalness: 0.55,
      iridescence: 1, iridescenceIOR: 1.8, iridescenceThicknessRange: [260, 640], envMapIntensity: 1.6, side: THREE.DoubleSide });
    return SILICON;
  }
  if (n === 'screenGlass') {
    DARK_GLASS ??= new THREE.MeshPhysicalMaterial({ name: 'screenGlass', color: 0x2a3945, roughness: 0.08, metalness: 0.05,
      clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 2.4, transparent: true, opacity: 0.62, side: THREE.DoubleSide, depthWrite: false });
    return DARK_GLASS;
  }
  return null;
}
