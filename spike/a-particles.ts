// Spike (a): TSL compute updating 1M particles (positions in a storage buffer), drawn as
// instanced sprites, colored per particle by wavelength.
// Also covers (f) GPU->CPU readback accuracy and (g) GPU timestamp timing for this workload,
// since both are naturally measured against this same buffer.
import * as THREE from 'three/webgpu';
import { Fn, instanceIndex, hash, float, vec3, uniform, clamp, abs, mod, instancedArray } from 'three/tsl';
import { createRenderer, measureFps, report, reportError } from './common/harness.ts';

const PARTICLE_COUNT = 1_000_000;
const BOUNDS = 3; // half-size of the box particles drift in, world units
const SPEED = 0.5; // world units / second

async function main() {
  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 600;
  document.body.appendChild(canvas);

  const { renderer, backend, timestampSupported } = await createRenderer(canvas);

  try {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 800 / 600, 0.1, 100);
    camera.position.set(0, 0, 8);

    // --- storage buffers -----------------------------------------------------------------
    const positionBuffer = instancedArray(PARTICLE_COUNT, 'vec3');
    const velocityBuffer = instancedArray(PARTICLE_COUNT, 'vec3');
    const colorBuffer = instancedArray(PARTICLE_COUNT, 'vec3');
    const dt = uniform(0);

    // Coarse triangular-lobe approximation of a spectrum color from t in [0,1] (violet..red).
    // This is NOT the CIE-based mapping the physics engine will use -- it exists only so the
    // spike has a per-particle color driven by a per-particle scalar, cheaply, on the GPU.
    const spectrumColor = Fn(([t]: [any]) => {
      const r = clamp(float(1.5).sub(abs(t.mul(4).sub(3))), 0, 1);
      const g = clamp(float(1.5).sub(abs(t.mul(4).sub(2))), 0, 1);
      const b = clamp(float(1.5).sub(abs(t.mul(4).sub(1))), 0, 1);
      return vec3(r, g, b);
    });

    const computeInit = Fn(() => {
      const pos = positionBuffer.element(instanceIndex);
      const vel = velocityBuffer.element(instanceIndex);
      const col = colorBuffer.element(instanceIndex);

      const seed = instanceIndex.toFloat();
      const r1 = hash(seed);
      const r2 = hash(seed.add(1.0));
      const r3 = hash(seed.add(2.0));
      const r4 = hash(seed.add(3.0));
      const r5 = hash(seed.add(4.0));
      const r6 = hash(seed.add(5.0));

      pos.assign(vec3(r1.sub(0.5), r2.sub(0.5), r3.sub(0.5)).mul(BOUNDS * 2));
      // random-ish direction (not uniform on sphere; fine for a visual/perf spike)
      vel.assign(vec3(r4.sub(0.5), r5.sub(0.5), r6.sub(0.5)).mul(SPEED * 2));
      col.assign(spectrumColor(hash(seed.add(6.0))));
    })().compute(PARTICLE_COUNT);

    const computeUpdate = Fn(() => {
      const pos = positionBuffer.element(instanceIndex);
      const vel = velocityBuffer.element(instanceIndex);
      const next = pos.add(vel.mul(dt));
      // wrap into [-BOUNDS, BOUNDS] on each axis
      pos.assign(mod(next.add(BOUNDS), BOUNDS * 2).sub(BOUNDS));
    })().compute(PARTICLE_COUNT);

    // --- material / draw call -------------------------------------------------------------
    const material = new THREE.SpriteNodeMaterial();
    material.positionNode = positionBuffer.toAttribute();
    material.colorNode = colorBuffer.toAttribute();
    material.sizeAttenuation = true;
    material.scaleNode = float(0.012);
    material.transparent = false;
    material.depthWrite = true;

    const particles = new THREE.Sprite(material);
    particles.count = PARTICLE_COUNT;
    particles.frustumCulled = false;
    scene.add(particles);

    const result: Record<string, unknown> = { backend, ok: true, particleCount: PARTICLE_COUNT };

    // --- init + readback of the pre-update state -------------------------------------------
    const initStart = performance.now();
    await renderer.computeAsync(computeInit);
    result.initMs = performance.now() - initStart;

    const readStart = performance.now();
    const initPosRaw = await renderer.getArrayBufferAsync((positionBuffer as any).value);
    const velRaw = await renderer.getArrayBufferAsync((velocityBuffer as any).value);
    result.readbackMsFor2MBuffers = performance.now() - readStart;

    const initPos = new Float32Array(initPosRaw);
    const vel = new Float32Array(velRaw);

    // --- (f) accuracy gate: 30 fixed-dt compute steps, GPU result vs CPU-predicted result ---
    const STEPS = 30;
    const FIXED_DT = 1 / 60;
    dt.value = FIXED_DT;
    for (let i = 0; i < STEPS; i++) {
      renderer.compute(computeUpdate);
    }
    const finalPosRaw = await renderer.getArrayBufferAsync((positionBuffer as any).value);
    const finalPos = new Float32Array(finalPosRaw);

    const totalDt = STEPS * FIXED_DT;
    let maxAbsDiff = 0;
    const SAMPLE = 200;
    for (let s = 0; s < SAMPLE; s++) {
      const i = Math.floor((s / SAMPLE) * PARTICLE_COUNT);
      for (let axis = 0; axis < 3; axis++) {
        const idx = i * 3 + axis;
        let expected = initPos[idx] + vel[idx] * totalDt;
        // mirror the shader's wrap so the CPU check matches wrapped motion too
        expected = (((expected + BOUNDS) % (BOUNDS * 2)) + BOUNDS * 2) % (BOUNDS * 2) - BOUNDS;
        const diff = Math.abs(expected - finalPos[idx]);
        if (diff > maxAbsDiff) maxAbsDiff = diff;
      }
    }
    result.accuracyGate = {
      steps: STEPS,
      sampledParticles: SAMPLE,
      maxAbsDiff,
      tolerance: 1e-3,
      pass: maxAbsDiff < 1e-3,
    };

    // reset to the initial state for the fps/visual run
    await renderer.computeAsync(computeInit);

    // --- (g) GPU timestamp timing, isolated single dispatches -----------------------------
    let gpuComputeMs: number | null = null;
    let gpuRenderMs: number | null = null;
    let timestampError: string | null = null;
    if (timestampSupported) {
      try {
        dt.value = FIXED_DT;
        renderer.compute(computeUpdate);
        gpuComputeMs = (await renderer.resolveTimestampsAsync('compute')) ?? null;
        renderer.render(scene, camera);
        gpuRenderMs = (await renderer.resolveTimestampsAsync('render')) ?? null;
      } catch (e) {
        timestampError = e instanceof Error ? e.message : String(e);
      }
    }
    result.gpuTiming = { supported: timestampSupported, gpuComputeMs, gpuRenderMs, timestampError };

    // --- fps: compute + render every frame --------------------------------------------------
    let frameDt = FIXED_DT;
    const fps = await measureFps(
      () => {
        dt.value = frameDt;
        renderer.compute(computeUpdate);
        renderer.render(scene, camera);
      },
      { warmupFrames: 15, durationMs: 1500 }
    );
    result.fps = fps;

    report(result as any);
  } catch (e) {
    reportError(backend, e);
  }
}

main();
