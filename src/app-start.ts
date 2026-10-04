// Bootstraps the app shell: creates the store (seeded from the URL), the stage (async -- awaits the
// WebGPU/WebGL2 renderer's own init()), registers the three set pieces, mounts the UI and installs the
// window.p2p test hooks. See docs/app-shell.md.
import { createStore } from './app/store';
import { createStage, type StageDom } from './app/stage';
import { buildWorkspace, mountWorkspace } from './app/workspace';
import { mountUI } from './app/ui';
import { mountExamples } from './app/examples';
import { mountLearning } from './app/learning';
import { mountPerspectiveStudy } from './app/perspective-study';
import { mountShotLauncher } from './app/shot-launch';
import { mountStartHere } from './app/start-here';
import { installHooks } from './app/hooks';
import { build as buildCamera } from './scene/camera-rig';
import { build as buildLens } from './pieces/lens';
import { build as buildCone } from './pieces/cone';
import { build as buildLoupe } from './pieces/loupe';

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`main.ts: index.html is missing #${id}`);
  return el as T;
}

export async function startApp() {
  const startTour = new URLSearchParams(location.search).get('tour') === '1';
  const startLesson = new URLSearchParams(location.search).get('lesson');
  buildWorkspace();
  byId('veil-reload').addEventListener('click', () => location.reload());
  const dom: StageDom = {
    canvas: byId('gl'),
    view: byId('view'),
    pins: byId('pins'),
    veil: byId('veil'),
    hudTitle: byId('hud-title'),
    hudSub: byId('hud-sub'),
    scaleLabel: byId('scale-label'),
    scaleBar: byId('scale-bar'),
    scaleBadge: byId('scale-badge'),
    backendChip: byId('backend-chip'),
  };

  const store = createStore();
  const stage = await createStage(dom);

  stage.registerPiece('camera', buildCamera);
  stage.registerPiece('lens', buildLens);
  stage.registerPiece('cone', buildCone);
  stage.registerPiece('loupe', buildLoupe);

  mountUI(store, stage);
  mountWorkspace(store);
  mountExamples(store);
  mountLearning(store, startTour, startLesson);
  mountShotLauncher(store);
  mountPerspectiveStudy(store);
  installHooks(store, stage);
  mountStartHere();
}

export function showStartupFailure(err: unknown): void {
  // Surfaced loudly rather than left as a silently blank page -- WebGPU/WebGL init failures are the most likely
  // cause this early, and tools/shot.mjs's "zero console errors" gate should catch anything unexpected here too.
  console.error('main.ts: failed to start', err);
  const veil = document.getElementById('veil');
  if (veil) {
    veil.classList.remove('off'); veil.classList.add('err');
    const message = document.getElementById('veil-msg');
    if (message) message.textContent = 'The 3D view could not start. Reload to try again, or use another browser with hardware acceleration enabled.';
  }
}
