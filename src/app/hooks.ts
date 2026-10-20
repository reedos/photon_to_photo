// window.p2p test hooks -- docs/PROTOTYPE.md's src/app/hooks.ts: set(partial scenario), piece(id), settle()
// (resolves when the model is applied and a frame drawn), backend(), gpuIdle(), model(), scenario(), pins().
// tools/shot.mjs drives the page through this surface.
import type { Scenario } from '../engine/types';
import type { Model } from '../engine/model-types';
import { compute, LENS_IDS, PANE_LENS_IDS } from './engine-api';
import { createPipelineTestSample } from './pipeline-test-sample';
import type { PieceId, Store } from './store';
import type { PinScreen, Stage } from './stage';

export interface P2P {
  set(partial: Partial<Scenario>): void;
  piece(id: PieceId): void;
  settle(): Promise<void>;
  backend(): string;
  gpuIdle(): Promise<void>;
  model(): Model;
  scenario(): Scenario;
  pins(): PinScreen[];
  framing(): ReturnType<Stage['framing']>;
  /** How many node builds and pipelines the renderer holds (the budgets gate: a level built ahead adds none on entry). */
  pipelineStats(): ReturnType<Stage['pipelineStats']>;
  /** The stage draws on demand: frames seen, frames drawn and why (tools/test-runtime-budgets.mjs idle). */
  drawStats(): ReturnType<Stage['drawStats']>;
  /** Each piece's own hooks (probes for the visual accuracy gate, recording controls): p2p.pieces.lens.probe() */
  pieces: Record<string, Record<string, (...args: any[]) => any>>;
  /** Legacy hook: synthetic photo rendering has been removed. */
  render(): import('./render-client').RenderView | null;
  /** The controlled chart the sensor-to-image lesson processes for the current scenario (learning.ts draws its
   *  stages); browser gates compare the drawn final stage to `rgba` byte for byte. */
  pipelineSample(): { width: number; height: number; rgba: Uint8ClampedArray };
}

declare global {
  interface Window {
    p2p?: P2P;
  }
}

export function installHooks(store: Store, stage: Stage): void {
  const api: P2P = {
    set(partial) {
      // An unknown lens id used to fall back to the default lens without a word (r5: p2p.set({ lens: 'm500' }) came back as
      // n50, and m500 is a transcribed design that is not registered). A hook that is asked for a lens that is not there says so.
      if (partial.lens !== undefined && !LENS_IDS.includes(partial.lens) && !PANE_LENS_IDS.includes(partial.lens)) {
        throw new Error(`p2p.set: unknown lens id "${partial.lens}" (known: ${[...PANE_LENS_IDS, ...LENS_IDS].join(', ')})`);
      }
      store.set(partial);
    },
    piece(id) { store.setPiece(id); },
    settle() { return stage.settle(); },
    backend() { return stage.backend(); },
    gpuIdle() { return stage.gpuIdle(); },
    model() { return compute(store.get().scenario); },
    scenario() { return store.get().scenario; },
    pins() { return stage.pins(); },
    framing() { return stage.framing(); },
    drawStats() { return stage.drawStats(); },
    pipelineStats() { return stage.pipelineStats(); },
    pieces: new Proxy({} as Record<string, Record<string, (...args: any[]) => any>>, {
      get: (_t, id: string) => stage.pieceHooks(id),
    }),
    render() { return null; },
    pipelineSample() {
      const { format, iso, sensor } = store.get().scenario;
      const { width, height, rgba } = createPipelineTestSample(format, iso, sensor);
      return { width, height, rgba };
    },
  };
  window.p2p = api;
}
