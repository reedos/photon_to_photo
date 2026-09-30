// Shared setup for every rendering-spike page. Keep this small: it exists to remove boilerplate
// from each test page, not to hide what's being measured.
import * as THREE from 'three/webgpu';

export type BackendName = 'webgpu' | 'webgl2';

export interface RendererHandle {
  renderer: THREE.WebGPURenderer;
  backend: BackendName;
  isWebGPU: boolean;
  adapterInfo: Record<string, unknown> | null;
  timestampSupported: boolean; // GPU timestamp queries actually usable on this backend/device
}

function backendFromQuery(): BackendName {
  const p = new URLSearchParams(location.search);
  const b = p.get('backend');
  return b === 'webgl2' ? 'webgl2' : 'webgpu';
}

// Both backends go through WebGPURenderer; forceWebGL swaps in the WebGL2 backend internally.
// trackTimestamp is requested on both; whether it actually works depends on adapter features
// (webgpu: 'timestamp-query' feature) or the EXT_disjoint_timer_query_webgl2 extension (webgl2).
export async function createRenderer(
  canvas: HTMLCanvasElement,
  opts: { antialias?: boolean } = {}
): Promise<RendererHandle> {
  const backend = backendFromQuery();
  const forceWebGL = backend === 'webgl2';

  const renderer = new THREE.WebGPURenderer({
    canvas,
    antialias: opts.antialias ?? true,
    forceWebGL,
    trackTimestamp: true,
  });

  await renderer.init();

  let timestampSupported = false;
  try {
    timestampSupported = renderer.hasFeature('timestamp-query');
  } catch (e) {
    timestampSupported = false;
  }

  let adapterInfo: Record<string, unknown> | null = null;
  try {
    // Only present on the real WebGPU backend.
    const backendObj = (renderer as any).backend;
    const adapter = backendObj?.adapter;
    if (adapter?.info) {
      const info = adapter.info;
      adapterInfo = {
        vendor: info.vendor,
        architecture: info.architecture,
        device: info.device,
        description: info.description,
      };
    }
  } catch (e) {
    adapterInfo = null;
  }

  return { renderer, backend, isWebGPU: !forceWebGL, adapterInfo, timestampSupported };
}

// Runs `frame()` once per rAF for `durationMs` wall-clock time (after `warmupFrames` untimed
// frames) and returns fps + per-frame timing stats from performance.now(), i.e. CPU-observed
// frame pacing, not a GPU timestamp.
export async function measureFps(
  frame: () => void | Promise<void>,
  opts: { warmupFrames?: number; durationMs?: number } = {}
): Promise<{ fps: number; frames: number; avgMs: number; minMs: number; maxMs: number }> {
  const warmupFrames = opts.warmupFrames ?? 20;
  const durationMs = opts.durationMs ?? 1500;

  for (let i = 0; i < warmupFrames; i++) {
    await frame();
    await nextFrame();
  }

  const times: number[] = [];
  const start = performance.now();
  while (performance.now() - start < durationMs) {
    const t0 = performance.now();
    await frame();
    await nextFrame();
    times.push(performance.now() - t0);
  }

  const sum = times.reduce((a, b) => a + b, 0);
  const avgMs = times.length ? sum / times.length : NaN;
  return {
    fps: times.length ? 1000 / avgMs : 0,
    frames: times.length,
    avgMs,
    minMs: times.length ? Math.min(...times) : NaN,
    maxMs: times.length ? Math.max(...times) : NaN,
  };
}

export function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

// Times an arbitrary async op with performance.now(). Not GPU time, just wall clock around the
// awaited call (which for compute()/computeAsync() includes submission; only *Async variants
// actually wait on the GPU).
export async function timeMs(fn: () => void | Promise<void>): Promise<number> {
  const t0 = performance.now();
  await fn();
  const t1 = performance.now();
  return t1 - t0;
}

export interface SpikeResult {
  backend: BackendName;
  ok: boolean;
  [key: string]: unknown;
}

// Every spike page ends by calling this. Playwright polls window.__spikeDone.
export function report(result: SpikeResult): void {
  (window as any).__spikeResult = result;
  (window as any).__spikeDone = true;
  // Also visible in the page for manual runs (npm run dev and open by hand).
  const pre = document.getElementById('result');
  if (pre) pre.textContent = JSON.stringify(result, null, 2);
}

// GOTCHA (verified with a throwaway probe script, see docs/rendering-spike.md): row 0 of the buffer
// from renderer.readRenderTargetPixelsAsync() is the TOP of the image on the real WebGPU
// backend, but the BOTTOM of the image on the WebGL2 fallback backend. Any pixel-accuracy check
// (this spike's (d), and the project's later visual-accuracy gate) needs this per-backend flip
// or it silently samples the wrong row on one of the two backends.
export async function readPixelRGBA(
  renderer: THREE.WebGPURenderer,
  rt: THREE.RenderTarget,
  backend: BackendName,
  x: number,
  y: number,
  targetHeight: number
): Promise<[number, number, number, number]> {
  const row = backend === 'webgpu' ? Math.round(y) : targetHeight - Math.round(y) - 1;
  const buf = await renderer.readRenderTargetPixelsAsync(rt, Math.round(x), row, 1, 1);
  const arr = new Uint8Array(buf as ArrayBuffer);
  return [arr[0], arr[1], arr[2], arr[3]];
}

// Some WebGL2-fallback failure modes (see docs/rendering-spike.md gotchas: StorageTexture
// compute) don't throw -- they hang forever polling a GPU query that was never validly begun.
// Race any risky call against a hard deadline so a spike page can still report "hangs" as a
// result instead of timing out the whole Playwright run.
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label}: timed out after ${ms}ms (likely hung)`)), ms)),
  ]);
}

export function reportError(backend: BackendName, error: unknown): void {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  report({ backend, ok: false, error: message });
}
