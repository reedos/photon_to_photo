// Bootstraps the app shell: creates the store (seeded from the URL), the stage (async -- awaits the
// WebGPU/WebGL2 renderer's own init()), registers the three set pieces, mounts the UI and installs the
// window.p2p test hooks. See docs/app-shell.md.
import { createStore } from './app/store';
import { createStage, type StageDom } from './app/stage';
import { buildWorkspace, levelWhy, mountWorkspace } from './app/workspace';
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
import { primeRealizations } from './engine/data';
import realizations from 'virtual:p2p-realizations';

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`main.ts: index.html is missing #${id}`);
  return el as T;
}

export async function startApp() {
  const startTour = new URLSearchParams(location.search).has('tour');
  const startLesson = new URLSearchParams(location.search).get('lesson');
  // realize()'s numbers from the build, so no lens runs its real-ray survey on the main thread (vite.config.ts)
  primeRealizations(realizations);
  buildWorkspace();
  const store = createStore();
  byId('level-why').textContent = levelWhy(store.get().piece);
  // the camera level's tool row (#model-tools) shows only on that level; ui.ts keeps this in step from here on
  byId('stage-section').dataset.level = store.get().piece;
  // The level tabs are made by mountUI once the renderer is up. Until then inert stand-ins with the same markup hold
  // their height, so the line and the view below do not drop by a tab row after the first paint (cold-load CLS on a
  // phone was 0.15, score loop r3). mountUI replaces them in the same task.
  const steps = byId('steps');
  if (!steps.childElementCount) {
    steps.innerHTML = ['Camera', 'Optics', 'Focus', 'Pixel'].map(label =>
      `<button type="button" class="step" disabled aria-hidden="true" tabindex="-1"><span class="top"><span class="t">${label}</span></span><span class="meta"><span class="dot"></span><span class="sub"></span></span></button>`).join('');
  }
  // The stage turns this into Retry (data-retry on the veil) when the failed piece can load its models again in place.
  byId('veil-reload').addEventListener('click', () => { if (!byId('veil').dataset.retry) location.reload(); });
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

  performance.mark('p2p:app-start');
  const stage = await createStage(dom);
  performance.mark('p2p:stage-created');
  // The start is split into tasks (score loop r3): on a 4x-throttled phone, the renderer's start and the whole UI mount
  // ran as one 2.8 s task, so the Menu and the browser itself stopped answering. The workspace is covered meanwhile
  // (main.ts, body.app-booting), and window.p2p is installed last, as before.
  await yieldToMain();

  stage.registerPiece('camera', buildCamera);
  stage.registerPiece('lens', buildLens);
  stage.registerPiece('cone', buildCone);
  stage.registerPiece('loupe', buildLoupe);

  steps.replaceChildren();
  mountUI(store, stage);
  performance.mark('p2p:ui-mounted');
  await yieldToMain();
  mountWorkspace(store);
  await yieldToMain();
  mountExamples(store);
  mountLearning(store, startTour, startLesson);
  mountShotLauncher(store);
  mountPerspectiveStudy(store);
  installHooks(store, stage);
  mountStartHere();
  performance.mark('p2p:mounted');
}

/** Lets the browser handle input and paint between two parts of the start. */
function yieldToMain(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (scheduler?.yield) return scheduler.yield();
  return new Promise(resolve => setTimeout(resolve, 0));
}

export function showStartupFailure(err: unknown): void {
  // Surfaced loudly rather than left as a silently blank page -- WebGPU/WebGL init failures are the most likely
  // cause this early, and tools/shot.mjs's "zero console errors" gate should catch anything unexpected here too.
  console.error('main.ts: failed to start', err);
  const veil = document.getElementById('veil');
  if (veil) {
    veil.classList.remove('off'); veil.classList.add('err');
    // announced to a screen reader, as the lost-device veil is (score loop r4: this one had no role)
    veil.setAttribute('role', 'alert');
    // nothing the controls do can show: the Fire button, the Rays chip, the view buttons and the sliders would only
    // answer to a view that is not there, so they are taken out of the page and out of the tab order
    document.body.classList.add('startup-failed');
    // (score loop r5: the Camera equipment editor, Expand model and the Controls and Parts tabs only answer to a view that is
    // there too; they stayed on screen over an empty panel)
    for (const sel of ['#scenario', '#hud-switches', '#hud-btns', '#hud-rail', '#view-strip', '#hud-btns-phone', '#hint', '#model-tools',
      '#equipment-toggle', '#equipment-controls', '#expand-model', '.inspector-tab-row', '#studio-explain']) {
      const el = document.querySelector<HTMLElement>(sel);
      if (el) { el.inert = true; el.setAttribute('aria-hidden', 'true'); }
    }
    const message = document.getElementById('veil-msg');
    if (message) message.textContent = 'The 3D view could not start. Reload to try again, or use another browser with hardware acceleration enabled.';
    // The 2D reference needs no 3D, as on the Models and lens-preview pages (score loop r3). The start has already
    // failed, so with no WebGL2 fallback in this browser either a reload cannot help: the reference comes first.
    document.getElementById('steps')?.querySelectorAll('.step[disabled]').forEach(stand => stand.remove());
    const reload = document.getElementById('veil-reload');
    if (reload && !document.getElementById('veil-reference')) {
      const reference = document.createElement('a');
      reference.id = 'veil-reference'; reference.className = 'btn veil-reference'; reference.href = 'reference.html';
      reference.textContent = 'Read the 2D reference';
      const no3d = !hasWebGL2();
      if (no3d) { reload.before(reference); reference.classList.add('primary'); }
      else reload.after(reference);
    }
  }
}

function hasWebGL2(): boolean {
  try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; }
}
