import type { Store } from './store';
import type { Scenario } from '../engine/types';
import { currentRender, onRender, onRenderFailure, type RenderView } from './render-client';
import { EXPERIMENTS, sameShot } from './learning-model';
import { formatShutter } from './store';
import { compute } from './engine-api';
import { emit } from './bus';

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const caption = (s: Scenario) => `${s.lens} · ${s.scene} · f/${s.fno} · ${formatShutter(s.shutter)} s · ISO ${s.iso} · focus ${s.focusM ?? '∞'}${s.focusM === null ? '' : ' m'}`;
type Snapshot = Pick<RenderView, 'scenario' | 'rgba' | 'width' | 'height'>;

export function mountComparison(store: Store): void {
  const actions = document.createElement('div'); actions.className = 'photo-actions';
  actions.innerHTML = '<button class="btn" id="pin-photo" disabled>Pin A</button><button class="btn" id="compare-photo">Compare</button>';
  el('finalimg').querySelector('.finalimg-card')!.after(actions);
  const dialog = document.createElement('dialog'); dialog.id = 'compare-dialog'; dialog.setAttribute('aria-labelledby', 'compare-title');
  dialog.innerHTML = `<header><div><span class="journey-label">One change, a visible result</span><h2 id="compare-title">Compare your photos</h2></div><button class="btn" id="compare-close" autofocus>Close</button></header>
    <div class="experiment-picker"><label>Try an experiment<select id="experiment"><option value="">Choose an experiment…</option>${Object.entries(EXPERIMENTS).map(([id, e]) => `<option value="${id}">${e.title}</option>`).join('')}</select></label><button class="btn" id="experiment-start">Start</button><button class="btn" id="experiment-next" disabled>Apply B →</button><button class="btn" id="experiment-restore" hidden>Restore my shot</button></div>
    <p id="experiment-note">Pin the current photo as A, close this panel, and change any setting. B follows your live photo.</p>
    <div class="compare-pictures"><figure><h3>A · Pinned</h3><canvas id="compare-a" width="600" height="400" role="img" aria-label="Pinned photo A"></canvas><figcaption id="compare-a-caption">No pinned photo yet.</figcaption></figure><figure><h3>B · Current</h3><canvas id="compare-b" width="600" height="400" role="img" aria-label="Current photo B"></canvas><figcaption id="compare-b-caption"></figcaption></figure></div>
    <p id="compare-difference" role="status"></p><footer><button class="btn" id="compare-pin" disabled>Pin current as A</button><button class="btn" id="compare-clear" disabled>Clear A</button><span id="compare-status" role="status">Waiting for your photo…</span></footer>`;
  document.body.append(dialog);
  let pinned: Snapshot | null = null, saved: Scenario | null = null;
  let experiment: string | null = null, expectedA: Scenario | null = null, readyA = false;
  let changing = false;
  function latest() { const v = currentRender(); return v && sameShot(v.scenario, compute(store.get().scenario).scenario) ? v : null; }
  function draw(id: string, view: Snapshot | null) {
    const canvas = el<HTMLCanvasElement>(id), ctx = canvas.getContext('2d')!;
    if (!view) { ctx.clearRect(0, 0, canvas.width, canvas.height); return; }
    canvas.width = view.width; canvas.height = view.height;
    const pixels = ctx.createImageData(view.width, view.height); pixels.data.set(view.rgba); ctx.putImageData(pixels, 0, 0);
  }
  function pin(view: RenderView) {
    pinned = { width: view.width, height: view.height, scenario: structuredClone(view.scenario), rgba: view.rgba.slice() };
  }
  function refresh() {
    const view = latest();
    if (expectedA && view && sameShot(view.scenario, expectedA)) {
      pin(view); expectedA = null; readyA = true;
    }
    el<HTMLButtonElement>('pin-photo').disabled = !view;
    el('pin-photo').textContent = pinned ? 'Repin A' : 'Pin A';
    el<HTMLButtonElement>('compare-pin').disabled = !view;
    el<HTMLButtonElement>('compare-clear').disabled = !pinned;
    el<HTMLButtonElement>('experiment-next').disabled = !readyA;
    el('compare-status').textContent = !view ? 'Rendering current settings…' : expectedA ? 'Preparing experiment A…' : pinned ? 'A stays pinned · B follows your settings' : 'Your current photo is ready to pin';
    if (!dialog.open) return;
    draw('compare-a', pinned); draw('compare-b', view);
    el('compare-a-caption').textContent = pinned ? caption(pinned.scenario) : 'No pinned photo yet.';
    el('compare-b-caption').textContent = view ? caption(view.scenario) : 'Updating your shot…';
    const labels: [keyof Scenario, string][] = [['lens', 'lens'], ['scene', 'scene'], ['fno', 'aperture'], ['focusM', 'focus'], ['shutter', 'shutter'], ['iso', 'ISO'], ['format', 'format'], ['motion', 'motion'], ['subjectM', 'subject distance'], ['lux', 'illumination'], ['cct', 'light color'], ['sensor', 'sensor']];
    const changed = pinned && view ? labels.filter(([k]) => JSON.stringify(pinned!.scenario[k]) !== JSON.stringify(view.scenario[k])).map(([, label]) => label) : [];
    el('compare-difference').textContent = pinned && view ? (changed.length ? `Changed: ${changed.join(', ')}.` : 'Same settings. Change a control to see the difference.') : '';
  }
  function cancelExperiment() {
    experiment = null; expectedA = null; readyA = false;
    el('experiment-note').textContent = 'Pin the current photo as A, close this panel, and change any setting. B follows your live photo.';
  }
  el('pin-photo').onclick = () => { const v = latest(); if (v) { cancelExperiment(); pin(v); refresh(); } };
  el('compare-photo').onclick = () => { emit('pause-exposure', {}); emit('pause-tour', {}); dialog.showModal(); refresh(); };
  el('compare-close').onclick = () => dialog.close();
  // Stop the app's Escape handler from navigating behind an open native modal.
  dialog.addEventListener('keydown', e => e.stopPropagation());
  dialog.addEventListener('close', () => el('compare-photo').focus({ preventScroll: true }));
  el('compare-pin').onclick = () => { const v = latest(); if (v) { cancelExperiment(); pin(v); refresh(); } };
  el('compare-clear').onclick = () => { cancelExperiment(); pinned = null; refresh(); };
  el('experiment').onchange = () => { cancelExperiment(); refresh(); };
  el('experiment-start').onclick = () => {
    const id = el<HTMLSelectElement>('experiment').value, recipe = EXPERIMENTS[id]; if (!recipe) return;
    saved ??= structuredClone(store.get().scenario);
    experiment = id; readyA = false; expectedA = null;
    changing = true;
    store.set({ ...recipe.before, format: 'ff', shutterType: 'mechanical', sensor: undefined, lux: undefined, cct: undefined });
    changing = false; expectedA = structuredClone(compute(store.get().scenario).scenario);
    el('experiment-note').textContent = recipe.text + ' First wait for A, then apply B.';
    el('experiment-restore').hidden = false; refresh();
  };
  el('experiment-next').onclick = () => {
    if (!experiment || !readyA) return;
    const recipe = EXPERIMENTS[experiment]; readyA = false;
    changing = true; store.set(recipe.after); changing = false;
    el('experiment-note').textContent = recipe.text; refresh();
  };
  el('experiment-restore').onclick = () => {
    if (!saved) return;
    cancelExperiment(); changing = true;
    // Explicit undefined values clear experiment-only optional fields before merging the saved shot.
    store.set({ motion: undefined, subjectM: undefined, lux: undefined, cct: undefined, sensor: undefined, ...saved });
    changing = false; saved = null; el('experiment-restore').hidden = true;
    el('experiment-note').textContent = 'Your original shot is restored. A remains pinned for comparison.'; refresh();
  };
  let oldScenario = store.get().scenario;
  store.subscribe(state => {
    if (!changing && state.scenario !== oldScenario && experiment) {
      cancelExperiment(); el('experiment-note').textContent = 'Settings changed. Start the experiment again to make a controlled A/B pair.';
    }
    oldScenario = state.scenario; refresh();
  });
  onRender(refresh);
  onRenderFailure(refresh);
}
