// window.p2p test hooks -- docs/PROTOTYPE.md's src/app/hooks.ts: set(partial scenario), piece(id), settle()
// (resolves when the model is applied and a frame drawn), backend(), gpuIdle(), model(), scenario(), pins().
// tools/shot.mjs drives the page through this surface.
import type { Scenario } from '../engine/types';
import type { Model } from '../engine/model-types';
import { compute } from './engine-api';
import { currentRender } from './render-client';
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
  /** Each piece's own hooks (probes for the visual accuracy gate, recording controls): p2p.pieces.lens.probe() */
  pieces: Record<string, Record<string, (...args: any[]) => any>>;
  /** The latest final-image render (sizes, meta); the loupe and the gates read it. */
  render(): import('./render-client').RenderView | null;
}

declare global {
  interface Window {
    p2p?: P2P;
  }
}

export function installHooks(store: Store, stage: Stage): void {
  const api: P2P = {
    set(partial) { store.set(partial); },
    piece(id) { store.setPiece(id); },
    settle() { return stage.settle(); },
    backend() { return stage.backend(); },
    gpuIdle() { return stage.gpuIdle(); },
    model() { return compute(store.get().scenario); },
    scenario() { return store.get().scenario; },
    pins() { return stage.pins(); },
    pieces: new Proxy({} as Record<string, Record<string, (...args: any[]) => any>>, {
      get: (_t, id: string) => stage.pieceHooks(id),
    }),
    render() { return currentRender(); },
  };
  window.p2p = api;
}
