// The CPU reference renderer in a worker, so a 600 x 400 render (about 2 s) never blocks the page. The worker
// computes its own Model from the scenario (a Model holds functions and cannot cross postMessage), renders, and
// transfers the buffers back. It keeps the latest result so the loupe can ask about one real pixel afterwards.
import { compute, renderImage } from './engine-api';
import type { RenderResult } from '../engine/model-types';
import type { Scenario } from '../engine/types';

export type WorkerRequest =
  | { type: 'render'; id: number; scenario: Scenario; width: number; height: number; seed: number }
  | { type: 'pixel'; id: number; renderId: number; x: number; y: number };

const results = new Map<number, RenderResult>(); // renderId -> result, only the latest few kept

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  try {
    if (msg.type === 'render') {
      const t0 = performance.now();
      const model = compute(msg.scenario);
      const r = renderImage(model, { width: msg.width, height: msg.height, seed: msg.seed });
      results.set(msg.id, r);
      // Pixel queries share the request counter. Retain by render count, not request-id distance,
      // so inspecting pixels cannot unexpectedly evict the displayed photo on the next render.
      while (results.size > 4) results.delete(results.keys().next().value!);
      const rgba = r.rgba.slice();
      const raw = r.raw.slice();
      const stages: Record<string, Float32Array> = {};
      for (const [k, v] of Object.entries(r.stages)) stages[k] = v.slice();
      const transfer = [rgba.buffer, raw.buffer, ...Object.values(stages).map((s) => s.buffer)];
      (self as unknown as Worker).postMessage({
        type: 'render', id: msg.id, width: r.width, height: r.height, pixelScale: r.pixelScale, rgba, raw, stages,
        meta: { ...r.meta, ms: performance.now() - t0 },
      }, transfer);
    } else if (msg.type === 'pixel') {
      const r = results.get(msg.renderId);
      if (!r) throw new Error(`render-worker: render ${msg.renderId} is no longer held`);
      (self as unknown as Worker).postMessage({ type: 'pixel', id: msg.id, pixel: r.pixel(msg.x, msg.y) });
    }
  } catch (err) {
    (self as unknown as Worker).postMessage({ type: 'error', id: msg.id, error: String(err instanceof Error ? err.stack || err.message : err) });
  }
};
