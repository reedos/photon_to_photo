// Standalone preview for the two camera bodies (docs/PANE.md build brief: "a standalone preview page ... that
// renders both bodies side by side with orbit controls and the stage's lighting approach ... with
// ?body=dslr|mirrorless&cutaway=1 query options, so they can be screenshotted in isolation"). Deliberately does
// not import src/app/stage.ts -- that module is wired to the full app shell's DOM/bus/piece contract, which this
// page doesn't have; instead it re-derives the same renderer/PMREM/lighting recipe directly from design/LOOK.md
// and docs/rendering-spike.md so the bodies are lit and rendered exactly as they will be in the real pane.
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as look from '../app/look';
import { buildDslrBody } from './bodies/dslr';
import { buildMirrorlessBody } from './bodies/mirrorless';

const params = new URLSearchParams(location.search);
const which = params.get('body'); // 'dslr' | 'mirrorless' | null (both)
const cutaway = params.get('cutaway') === '1';
// ?glb=1 loads the scripted-Blender exports (public/models/{dslr,mirrorless}.glb) through
// GLTFLoader instead of the Three.js-primitive builders above -- the one-time QC step in the
// Blender body build brief ("load the .glb in the app's own Three.js WebGPU pipeline once
// ... and screenshot it, to confirm the export reads correctly there: materials, scale,
// orientation, named nodes").
const useGlb = params.get('glb') === '1';

const canvas = document.getElementById('gl') as HTMLCanvasElement;
const hud = document.getElementById('hud') as HTMLElement;

async function main() {
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
  await renderer.init();
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // The bodies' cutaway wedge uses THREE.ClippingGroup (common.ts's makeCutawayGroup), the WebGPURenderer/TSL
  // pipeline's own scene-graph clipping mechanism -- no renderer-level flag needed (unlike the legacy
  // WebGLRenderer.localClippingEnabled + material.clippingPlanes convention).
  const backend = (renderer.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'WEBGPU' : 'WEBGL2';

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 1, 5000);
  camera.position.set(220, 140, 320);

  const controls = new OrbitControls(camera as unknown as THREE.Camera, canvas);
  controls.target.set(0, 0, -20);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  // ---- procedural PMREM environment, same recipe as src/app/stage.ts (design/LOOK.md: "not a photographic
  // HDRI"): a cool upper hemisphere, a warm rim from below-behind, dark elsewhere.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envGeo = new THREE.IcosahedronGeometry(80, 3);
  const posAttr = envGeo.attributes.position;
  const colors = new Float32Array(posAttr.count * 3);
  const cool = new THREE.Color(0x1a2028);
  const warm = new THREE.Color(0x3a281c);
  const highlight = new THREE.Color(0xf0f0fa);
  for (let i = 0; i < posAttr.count; i++) {
    const y = posAttr.getY(i) / 80;
    let c: THREE.Color;
    if (y > 0.5) c = cool.clone().lerp(highlight, THREE.MathUtils.smoothstep(y, 0.5, 0.95));
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

  const key = new THREE.DirectionalLight(0xf4f2ee, 4.5);
  key.position.set(140, 220, -180);
  const fill = new THREE.DirectionalLight(0xaecbff, 1.4);
  fill.position.set(-180, 90, 120);
  const rim = new THREE.DirectionalLight(0xd9c9a8, 1.8);
  rim.position.set(-60, -40, -220);
  const ambient = new THREE.AmbientLight(0x2a2f38, 0.6);
  scene.add(key, fill, rim, ambient);

  const showDslr = which !== 'mirrorless';
  const showMirrorless = which !== 'dslr';

  if (useGlb) {
    // ---- scripted-Blender .glb bodies (QC path) --------------------------------------------
    const loader = new GLTFLoader();
    const load = (path: string) => new Promise<THREE.Group>((res, rej) =>
      loader.load(path, (gltf) => res(gltf.scene), undefined, rej));

    function setupGlb(root: THREE.Group, x: number) {
      root.position.x = x;
      const closed = root.getObjectByName('shellClosed');
      const cut = root.getObjectByName('shellCut');
      if (closed) closed.visible = !cutaway;
      if (cut) cut.visible = cutaway;
      // Internal-only parts (mirror, shutter, sensor stack, EVF innards) only make sense
      // with the cutaway shell showing; toggle every non-shell top-level-ish node by name
      // heuristic isn't needed here since the Blender export already ships pixelArray etc.
      // visible by default (the app's own selection UI decides what to show); this preview
      // just confirms the export loads and reads correctly, so leave the rest as exported.
      scene.add(root);
    }

    if (showDslr) {
      load('./models/dslr.glb').then((root) => setupGlb(root, showMirrorless ? -110 : 0));
    }
    if (showMirrorless) {
      load('./models/mirrorless.glb').then((root) => setupGlb(root, showDslr ? 110 : 0));
    }

    hud.textContent = `Photon to Photo — body preview (glb) · ${backend}` +
      (which ? ` · ${which}` : ' · dslr + mirrorless') + (cutaway ? ' · cutaway' : '');

    (window as unknown as { p2pPreview: unknown }).p2pPreview = { scene, camera, renderer };
  } else {
    // ---- bodies (Three.js-primitive builders) ---------------------------------------------
    const dslr = buildDslrBody(look, { cutaway });
    const mirrorless = buildMirrorlessBody(look, { cutaway });

    if (showDslr) {
      dslr.group.visible = true;
      if (showMirrorless) dslr.group.position.x = -110;
      scene.add(dslr.group);
    }
    if (showMirrorless) {
      mirrorless.group.visible = true;
      if (showDslr) mirrorless.group.position.x = 110;
      scene.add(mirrorless.group);
    }

    hud.textContent = `Photon to Photo — body preview · ${backend}` +
      (which ? ` · ${which}` : ' · dslr + mirrorless') + (cutaway ? ' · cutaway' : '');

    // Expose for the screenshot tool / manual inspection in devtools.
    (window as unknown as { p2pPreview: unknown }).p2pPreview = {
      scene, camera, renderer, dslr, mirrorless,
      setCutaway(on: boolean) { dslr.setCutaway(on); mirrorless.setCutaway(on); },
    };
  }

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
  }
  window.addEventListener('resize', resize);
  resize();

  function frame() {
    requestAnimationFrame(frame);
    controls.update();
    renderer.render(scene, camera);
  }
  frame();
}

main();
