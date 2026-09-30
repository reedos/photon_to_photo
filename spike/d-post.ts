// Spike (d): can a saturated marker render at its exact sRGB value (255,0,0) while the rest of
// the scene is tone-mapped? The intelligence_factory pitfall was EffectComposer's OutputPass
// tone-mapping everything, making `toneMapped: false` on a material do nothing once a full-screen
// post pass re-applies tone mapping to the whole frame. Three tests, all read back with
// getRenderTargetPixelsAsync (an exact pixel check, not a screenshot eyeball):
//   1. Direct renderer.render() (no post pipeline) -- does material.toneMapped actually work here?
//   2. RenderPipeline fed by a single pass(scene, camera) -- does it reproduce the pitfall?
//   3. RenderPipeline with outputColorTransform=false, two passes composited manually -- the
//      working pattern, if (2) fails.
// Also checks GTAO (ao() from three/addons/tsl/display/GTAONode.js) on both backends.
import * as THREE from 'three/webgpu';
import {
  pass, renderOutput, mrt, output, normalView, screenUV, mix, vec4, builtinAOContext,
} from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { createRenderer, readPixelRGBA, report, reportError } from './common/harness.ts';

const WIDTH = 640;
const HEIGHT = 480;

const MARKER_WORLD_POS = new THREE.Vector3(2.1, 1.6, 0.5);

function projectToPixel(camera: THREE.Camera, worldPos: THREE.Vector3): { x: number; y: number } {
  // Vector3.project() reads camera.matrixWorldInverse, which is only refreshed by
  // updateMatrixWorld() -- normally done inside renderer.render(). Force it here so this also
  // works before the first render of a given camera state.
  camera.updateMatrixWorld(true);
  const ndc = worldPos.clone().project(camera);
  return { x: ((ndc.x + 1) / 2) * WIDTH, y: ((1 - ndc.y) / 2) * HEIGHT };
}

function buildLitScene(withMarker: boolean): { scene: THREE.Scene } {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070a);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x223344, 0.6));
  const dir = new THREE.DirectionalLight(0xffffff, 8.0); // deliberately hot, to give tone mapping something to do
  dir.position.set(3, 5, 4);
  scene.add(dir);

  const sphere = new THREE.Mesh(
    new THREE.SphereGeometry(1.2, 48, 32),
    new THREE.MeshStandardNodeMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.0 })
  );
  scene.add(sphere);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 10),
    new THREE.MeshStandardNodeMaterial({ color: 0x556070, roughness: 0.9 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1.3;
  scene.add(floor);

  if (withMarker) {
    const marker = new THREE.Mesh(
      new THREE.CircleGeometry(0.35, 32),
      new THREE.MeshBasicNodeMaterial({ color: 0xff0000, toneMapped: false })
    );
    marker.position.copy(MARKER_WORLD_POS);
    scene.add(marker);
  }

  return { scene };
}

async function main() {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  document.body.appendChild(canvas);

  const { renderer, backend } = await createRenderer(canvas);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const result: Record<string, unknown> = { backend, ok: true };
  const camera = new THREE.PerspectiveCamera(45, WIDTH / HEIGHT, 0.1, 50);
  camera.position.set(0, 0.6, 6);
  camera.lookAt(0, 0, 0);

  // --- test 1: direct render, no RenderPipeline -------------------------------------------
  try {
    const { scene } = buildLitScene(true);
    const markerScreen = projectToPixel(camera, MARKER_WORLD_POS);
    const rt = new THREE.RenderTarget(WIDTH, HEIGHT);
    renderer.setRenderTarget(rt);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    const px = await readPixelRGBA(renderer, rt, backend, markerScreen.x, markerScreen.y, HEIGHT);
    result.test1_directRender = {
      markerPixel: px,
      exact: px[0] === 255 && px[1] === 0 && px[2] === 0,
    };
  } catch (e) {
    result.test1_directRender = { error: e instanceof Error ? e.message : String(e) };
  }

  // --- test 2: RenderPipeline, single pass(scene,camera), outputColorTransform default true -
  try {
    const { scene } = buildLitScene(true);
    const markerScreen = projectToPixel(camera, MARKER_WORLD_POS);
    const pipeline = new THREE.RenderPipeline(renderer);
    const scenePass = pass(scene, camera);
    pipeline.outputNode = scenePass;
    // outputColorTransform stays at its default (true): tone map + colorspace applied to the
    // WHOLE pass output at the end, exactly like OutputPass did -- this is the pitfall.
    const rt = new THREE.RenderTarget(WIDTH, HEIGHT);
    renderer.setRenderTarget(rt);
    pipeline.render();
    renderer.setRenderTarget(null);
    const px = await readPixelRGBA(renderer, rt, backend, markerScreen.x, markerScreen.y, HEIGHT);
    result.test2_singlePassPipeline = {
      markerPixel: px,
      exact: px[0] === 255 && px[1] === 0 && px[2] === 0,
      note: 'expected to reproduce the OutputPass pitfall: material.toneMapped=false should NOT survive a single pass() fed straight into the default pipeline output.',
    };
  } catch (e) {
    result.test2_singlePassPipeline = { error: e instanceof Error ? e.message : String(e) };
  }

  // --- test 3: RenderPipeline, split passes, manual per-branch renderOutput composite --------
  try {
    const { scene: litScene } = buildLitScene(false); // no marker in the tone-mapped branch
    const { scene: markerOnlyScene } = buildLitScene(false);
    const markerScreen = projectToPixel(camera, MARKER_WORLD_POS);
    // second scene holding only the marker, transparent elsewhere
    markerOnlyScene.background = null;
    const marker = new THREE.Mesh(
      new THREE.CircleGeometry(0.35, 32),
      new THREE.MeshBasicNodeMaterial({ color: 0xff0000, toneMapped: false, transparent: true })
    );
    marker.position.copy(MARKER_WORLD_POS);
    markerOnlyScene.add(marker);

    const pipeline = new THREE.RenderPipeline(renderer);
    pipeline.outputColorTransform = false; // we do renderOutput ourselves, per branch

    const litPass = pass(litScene, camera);
    const markerPass = pass(markerOnlyScene, camera);

    const litOut = renderOutput(litPass, renderer.toneMapping, renderer.outputColorSpace);
    const markerOut = renderOutput(markerPass, THREE.NoToneMapping, renderer.outputColorSpace);
    const composited = vec4(mix(litOut.rgb, markerOut.rgb, markerPass.a), 1.0);

    pipeline.outputNode = composited;

    const rt = new THREE.RenderTarget(WIDTH, HEIGHT);
    renderer.setRenderTarget(rt);
    pipeline.render();
    renderer.setRenderTarget(null);

    const markerPx = await readPixelRGBA(renderer, rt, backend, markerScreen.x, markerScreen.y, HEIGHT);
    const litPx = await readPixelRGBA(renderer, rt, backend, WIDTH * 0.5, HEIGHT * 0.55, HEIGHT); // on the bright sphere
    // also check the marker pass's own alpha channel directly, to see if the transparent
    // background actually came through as alpha=0 the way the composite assumes
    const markerPassAlphaProbe = await readPixelRGBA(renderer, rt, backend, WIDTH * 0.05, HEIGHT * 0.05, HEIGHT);

    result.test3_splitPassComposite = {
      markerPixel: markerPx,
      exact: markerPx[0] === 255 && markerPx[1] === 0 && markerPx[2] === 0,
      litSpherePixel: litPx,
      cornerPixel_shouldBeLitNotMarker: markerPassAlphaProbe,
    };
  } catch (e) {
    result.test3_splitPassComposite = { error: e instanceof Error ? e.message : String(e), stack: e instanceof Error ? e.stack : undefined };
  }

  // --- GTAO availability ---------------------------------------------------------------------
  // Uses its own renderer with antialias OFF: GTAONode's textureGather-based depth sampling
  // (see docs/rendering-spike.md gotchas) does not support a multisampled depth texture, which
  // is what our shared `renderer` above produces (antialias: true).
  async function runGtao(antialias: boolean) {
    const gtaoCanvas = document.createElement('canvas');
    gtaoCanvas.width = WIDTH;
    gtaoCanvas.height = HEIGHT;
    const { renderer: gtaoRenderer } = await createRenderer(gtaoCanvas, { antialias });
    gtaoRenderer.toneMapping = THREE.ACESFilmicToneMapping;

    // On real WebGPU, pipeline-creation validation errors are reported async to the console
    // (see docs/rendering-spike.md gotchas), not thrown -- catch them with an error scope so a
    // failure here is visible to this try/catch instead of silently leaving stale pixels.
    const device = (gtaoRenderer as any).backend?.device as GPUDevice | undefined;
    if (device?.pushErrorScope) device.pushErrorScope('validation');

    const { scene } = buildLitScene(false);
    const pipeline = new THREE.RenderPipeline(gtaoRenderer);

    const prePass = pass(scene, camera);
    prePass.setMRT(mrt({ output, normal: normalView }));
    const prePassNormal = prePass.getTextureNode('normal');
    const prePassDepth = prePass.getTextureNode('depth');

    const scenePass = pass(scene, camera);
    const aoPass = ao(prePassDepth, prePassNormal, camera);
    const aoPassOutput = aoPass.getTextureNode();
    (scenePass as any).contextNode = builtinAOContext(aoPassOutput.sample(screenUV).r);

    pipeline.outputNode = scenePass;

    const rt = new THREE.RenderTarget(WIDTH, HEIGHT);
    gtaoRenderer.setRenderTarget(rt);
    pipeline.render();
    gtaoRenderer.setRenderTarget(null);

    let gpuError: string | null = null;
    if (device?.popErrorScope) {
      const err = await device.popErrorScope();
      gpuError = err ? `${err.constructor.name}: ${err.message}` : null;
    }

    const px = await readPixelRGBA(gtaoRenderer, rt, backend, WIDTH * 0.5, HEIGHT * 0.5, HEIGHT);
    return { ok: gpuError === null, samplePixel: px, gpuError, antialias };
  }

  try {
    result.gtao_antialiasTrue = await runGtao(true);
  } catch (e) {
    result.gtao_antialiasTrue = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  try {
    result.gtao_antialiasFalse = await runGtao(false);
  } catch (e) {
    result.gtao_antialiasFalse = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  report(result as any);
}

main().catch((e) => reportError('webgpu', e));
