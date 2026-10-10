// Standalone preview for any docs/PANE.md lineup lens: lens-preview.html?lens=n500&cutaway=1&focus=3&fno=8
// Orbit controls, the stage's own WebGPURenderer + PMREM lighting approach (src/app/look.ts's
// buildEnvironmentAndLights, factored out of src/app/stage.ts so this page matches it exactly), no app shell.
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { compute } from '../engine/camera';
import { PANE_LENS_IDS } from '../app/engine-api';
import type { Scenario } from '../engine/types';
import * as look from '../app/look';
import { buildLens, exteriorSpecFor, type LensExteriorHandle } from './lens-exterior';

const params = new URLSearchParams(location.search);
const forceWebGL = params.get('gl') === 'webgl2';
const lensParam = params.get('lens');
const lensId = lensParam && PANE_LENS_IDS.includes(lensParam) ? lensParam : PANE_LENS_IDS[0];
const cutaway = params.get('cutaway') === '1';
const showHood = params.get('hood') === '1';
const fnoParam = Number(params.get('fno'));
const focusParam = params.get('focus');

const canvas = document.getElementById('gl') as HTMLCanvasElement;
const statusEl = document.getElementById('status') as HTMLElement | null;

async function main() {
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, forceWebGL });
  await renderer.init();
  const backend = (renderer.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2';
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight, false);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 5000);
  const pmrem = look.buildEnvironmentAndLights(renderer, scene);
  // This standalone preview's whole frame is filled by the barrel's own anodized-black metal (metalness 1),
  // unlike the cutaway piece's usual framing where mostly-transparent glass elements dominate the shot -- a
  // fully metallic, near-black base color reflects almost nothing but the environment, and the shared PMREM
  // environment (look.ts's buildEnvironmentAndLights, deliberately dim/black-void per design/LOOK.md) alone
  // left product shots too dark to read edge bevels/knurling/engraving at the bar this workstream's brief asks
  // for ("high-quality product models under good light"). Two extra lights, this page only (the shared
  // function itself, and the real app's pane, are untouched): a broader soft fill from camera-right to open up
  // the barrel's far side, and a lower-intensity rim from directly behind to separate the silhouette from pure
  // black. Both are ordinary non-physical "studio" lights per LOOK.md's own convention (key+fill are already
  // that); they light materials only, same as the shared key/fill.
  const previewFill = new THREE.DirectionalLight(0xe8eef5, 1.4);
  previewFill.position.set(80, 30, 90);
  const previewRim = new THREE.DirectionalLight(0xffffff, 0.9);
  previewRim.position.set(-30, 40, -140);
  const previewTop = new THREE.DirectionalLight(0xdfe6f2, 0.7);
  previewTop.position.set(0, 160, 20);
  // A soft hemisphere lift (product-photography "fill everything a little" trick): a fully metallic barrel's
  // only response to directed lights is a narrow specular lobe, so without a broad, low-intensity ambient term
  // the anodized surface between highlights reads as pure black -- correct for the shared moody scene, too
  // dim to show edge bevels/knurling/engraving clearly at the screenshot bar this workstream's brief sets.
  const hemi = new THREE.HemisphereLight(0x2a3038, 0x08090a, 0.9);
  scene.add(previewFill, previewRim, previewTop, hemi);
  renderer.toneMappingExposure = 1.7;

  const controls = new OrbitControls(camera as unknown as THREE.Camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  // Built directly (not through app/engine-api.ts's normalizeScenario), which restricts `lens` to the 12
  // free-form primes (its own LENS_IDS, deliberately excluding this pane lineup -- see its own comment);
  // compute() itself (src/engine/camera.ts) already clamps fno/focus to whatever lens is actually requested.
  const scenario: Scenario = {
    lens: lensId,
    fno: Number.isFinite(fnoParam) && fnoParam > 0 ? fnoParam : 4,
    shutter: 1 / 250,
    iso: 100,
    focusM: focusParam === 'inf' ? null : focusParam ? Number(focusParam) : 3,
    format: 'ff',
    shutterType: 'mechanical',
    scene: 'bench',
  };
  const model = compute(scenario);

  const spec = exteriorSpecFor(lensId);
  const handle: LensExteriorHandle = buildLens(model, { cutaway, hood: showHood, webgpu: backend === 'webgpu' });
  scene.add(handle.group);

  // A fully metallic material (anodizedBarrelMaterial's metalness:1, per design/LOOK.md) has NO diffuse term --
  // every visible brightness comes from the environment map's specular reflection and direct-light specular
  // highlights, never from the extra directional/hemisphere lights added above (those only feed a material's
  // diffuse response, which is zero at metalness 1.0 by construction; discovered by inspecting scene.children
  // while debugging why this page's screenshots didn't visibly brighten after adding those lights). The look.ts
  // material factory itself is shared with the real app's pane and deliberately dim (design/LOOK.md's "black
  // void" family look), so it is not touched; this page instead raises envMapIntensity per-material, here only,
  // so the barrel's machined surfaces, knurling and engraving actually read at the product-photo bar the
  // screenshot task asks for.
  handle.group.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const phys = m as THREE.MeshPhysicalMaterial;
      if ('envMapIntensity' in phys) phys.envMapIntensity = (phys.metalness ?? 0) > 0.5 ? 3.2 : 1.8;
    }
  });

  // Frame the whole lens: bounding sphere from its published length/diameter (data/hardware/lens-exteriors.json).
  const box = new THREE.Box3().setFromObject(handle.group);
  const sphere = new THREE.Sphere();
  box.getBoundingSphere(sphere);
  const dist = sphere.radius / Math.sin(THREE.MathUtils.degToRad(20)) * 1.15;
  const dir = new THREE.Vector3(-0.5, 0.34, -0.79).normalize();
  camera.position.copy(sphere.center).addScaledVector(dir, dist);
  controls.target.copy(sphere.center);
  camera.near = Math.max(0.05, dist / 200);
  camera.far = dist * 20;
  camera.updateProjectionMatrix();

  if (statusEl) {
    statusEl.textContent =
      `${lensId} (${spec.representativeOf ?? lensId}) · ${backend.toUpperCase()} · ` +
      `cutaway=${cutaway} hood=${showHood} · f/${model.scenario.fno.toFixed(1)} · ` +
      `focus ${model.focus.distanceMm === null ? 'inf' : (model.focus.distanceMm / 1000).toFixed(2) + ' m'}`;
  }
  canvas.dataset.ready = '1'; // the screenshot script's own readiness signal

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    camera.aspect = w / h;
    const halfVertical = THREE.MathUtils.degToRad(camera.fov / 2);
    const limitingAngle = Math.min(halfVertical, Math.atan(Math.tan(halfVertical) * camera.aspect));
    // Keep the user's current view direction and orbit target; only the distance is refit to the new aspect.
    const viewDir = camera.position.clone().sub(controls.target);
    if (viewDir.lengthSq() < 1e-12) viewDir.copy(dir);
    viewDir.normalize();
    camera.position.copy(controls.target).addScaledVector(viewDir, sphere.radius / Math.sin(limitingAngle) * 1.15);
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }
  window.addEventListener('resize', resize);
  resize();

  function loop() {
    controls.update();
    handle.tick();
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  }
  loop();

  // Exposed for the screenshot/accuracy tooling, same convention as window.p2p.pieces in the main app.
  (window as unknown as { p2pLensPreview: unknown }).p2pLensPreview = { model, handle, renderer, camera, pmrem, scene, controls };
}

main().catch((err) => {
  console.error(err);
  if (statusEl) statusEl.textContent = `Error: ${(err as Error).message}`;
});
