// Spike (e): a compute pass writing a 1536x1024 storage texture -- per-pixel Poisson noise from
// a hash RNG, then displayed. Measures ms. StorageTexture + textureStore() is documented as
// "can only be used with a WebGPU backend" (three's own doc comment on StorageTextureNode) --
// this page proves that empirically on both backends and, when it fails, falls back to the same
// noise math run per-fragment in a normal render pass instead (works on both backends).
import * as THREE from 'three/webgpu';
import {
  Fn, instanceIndex, hash, float, int, uvec2, vec4, textureStore, Loop, Break, If, screenCoordinate,
} from 'three/tsl';
import { createRenderer, readPixelRGBA, report, reportError, withTimeout } from './common/harness.ts';

const TEX_W = 1536;
const TEX_H = 1024;
const LAMBDA = 12; // mean photon count per pixel for this synthetic test
const MAX_ITERS = 48; // bounded Knuth-Poisson loop; fine for lambda ~12, see docs/rendering-spike.md

// Knuth's Poisson sampler, bounded to MAX_ITERS iterations (TSL loops need a static bound). A
// real engine would switch to a Gaussian approximation for large lambda instead of raising this.
function poissonSample(seed: any) {
  const L = float(Math.exp(-LAMBDA));
  const k = int(0).toVar();
  const p = float(1).toVar();
  Loop({ start: int(0), end: int(MAX_ITERS), type: 'int', condition: '<' }, () => {
    const u = hash(seed.add(k.toFloat()).add(1.0));
    p.mulAssign(u);
    k.addAssign(1);
    If(p.lessThanEqual(L), () => {
      Break();
    });
  });
  return k.sub(1).max(0).toFloat();
}

async function main() {
  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 600;
  document.body.appendChild(canvas);

  const { renderer, backend, timestampSupported } = await createRenderer(canvas);
  const result: Record<string, unknown> = { backend, ok: true, texture: [TEX_W, TEX_H], lambda: LAMBDA };

  // --- attempt: compute-written StorageTexture (the brief's ask) --------------------------
  // Uses its OWN renderer/canvas: on WebGL2 a failed StorageTexture write can wedge the
  // renderer's GPU-timer-query bookkeeping so badly that unrelated later render() calls on the
  // same renderer hang too (see docs/rendering-spike.md gotchas). Isolating it means the
  // fragment-shader fallback below is unaffected either way.
  try {
    const storageCanvas = document.createElement('canvas');
    storageCanvas.width = 800;
    storageCanvas.height = 600;
    const { renderer: storageRenderer, timestampSupported: storageTimestampSupported } =
      await createRenderer(storageCanvas);

    const storageTex = new THREE.StorageTexture(TEX_W, TEX_H);

    const computeTexture = Fn(() => {
      const posX = instanceIndex.mod(TEX_W);
      const posY = instanceIndex.div(TEX_W);
      const indexUV = uvec2(posX, posY);
      const seed = posX.toFloat().add(posY.toFloat().mul(TEX_W));
      const k = poissonSample(seed);
      const v = k.div(LAMBDA * 3).clamp(0, 1);
      textureStore(storageTex, indexUV, vec4(v, v, v, 1)).toWriteOnly();
    })().compute(TEX_W * TEX_H);

    const wallStart = performance.now();
    // On WebGL2 this doesn't always throw when StorageTexture writes aren't really supported --
    // it can hang polling a GPU query that never got begun (see docs/rendering-spike.md
    // gotchas), so this is guarded with a hard timeout instead of a bare await.
    await withTimeout(storageRenderer.computeAsync(computeTexture) as Promise<unknown>, 5000, 'storageTexture computeAsync');
    const wallMs = performance.now() - wallStart;

    // Timestamp queries on top of an already-fragile path add another way to hang; only try on
    // the real WebGPU backend, where the base operation above already proved solid.
    let gpuMs: number | null = null;
    if (storageTimestampSupported && backend === 'webgpu') {
      storageRenderer.compute(computeTexture);
      gpuMs = (await withTimeout(storageRenderer.resolveTimestampsAsync('compute') as Promise<number>, 5000, 'resolveTimestampsAsync')) ?? null;
    }

    // display it, to prove the texture is really usable downstream, not just written
    const scene = new THREE.Scene();
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicNodeMaterial({ map: storageTex }));
    scene.add(quad);
    const rt = new THREE.RenderTarget(TEX_W, TEX_H);
    storageRenderer.setRenderTarget(rt);
    await withTimeout(Promise.resolve(storageRenderer.render(scene, cam)), 5000, 'storageTexture display render');
    storageRenderer.setRenderTarget(null);

    // sanity: sample a block of pixels, check the noise has plausible mean/variance
    const samples: number[] = [];
    for (let i = 0; i < 40; i++) {
      const x = 100 + i * 30;
      const y = 500;
      const px = await withTimeout(readPixelRGBA(storageRenderer, rt, backend, x, y, TEX_H), 5000, 'storageTexture readback');
      samples.push((px[0] / 255) * (LAMBDA * 3));
    }
    const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
    const variance = samples.reduce((a, b) => a + (b - mean) ** 2, 0) / samples.length;

    result.storageTextureCompute = {
      ok: true,
      wallMs,
      gpuMs,
      sampleMean: mean,
      sampleStd: Math.sqrt(variance),
      expectedMean_forPoisson: LAMBDA,
      note: 'mean/std are rough (40 samples, quantized to 8-bit) -- a sanity check that this is noisy around lambda, not a precision claim.',
    };
  } catch (e) {
    result.storageTextureCompute = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  // --- fallback: same math, run per-fragment in a normal render pass ----------------------
  try {
    const scene = new THREE.Scene();
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = Fn(() => {
      const coord = screenCoordinate; // fragment pixel coords in the current render target
      const seed = coord.x.add(coord.y.mul(TEX_W));
      const k = poissonSample(seed);
      const v = k.div(LAMBDA * 3).clamp(0, 1);
      return vec4(v, v, v, 1);
    })();
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
    scene.add(quad);

    const rt = new THREE.RenderTarget(TEX_W, TEX_H);
    const wallStart = performance.now();
    renderer.setRenderTarget(rt);
    renderer.render(scene, cam);
    renderer.setRenderTarget(null);
    const wallMs = performance.now() - wallStart;

    let gpuMs: number | null = null;
    if (timestampSupported) {
      try {
        renderer.setRenderTarget(rt);
        renderer.render(scene, cam);
        renderer.setRenderTarget(null);
        gpuMs = (await renderer.resolveTimestampsAsync('render')) ?? null;
      } catch (e) {
        gpuMs = null;
      }
    }

    result.fragmentShaderFallback = { ok: true, wallMs, gpuMs };
  } catch (e) {
    result.fragmentShaderFallback = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  report(result as any);
}

main().catch((e) => reportError('webgpu', e));
