// The real-photo comparison panel (workflow brief, "A real-photo comparison panel"): reads public/examples/
// examples.json, hidden whenever it's empty. Never the engine's input -- BRIEF.md's synthetic-scenes-only rule is
// about what the engine renders, and this only ever compares the engine's own output at a real shot's settings
// alongside that real shot as an optional calculation. These records also launch the photo journey;
// its JPEG is a scene reference and final reveal, never input to the physics renderer.
import { lensSummary } from './engine-api';
import type { Scenario } from '../engine/types';
import { fmtDistance, fmtFno, fmtRange, fmtShutter } from './units';
import type { ExampleRenderRequest, ExampleRenderResult } from './example-worker';
import type { Store } from './store';
import { chip } from './ui';
import { emit } from './bus';
import { mountPhotoDetails } from './photo-details';
import '../styles/photo-study.css';

export interface Example {
  id: string;
  title: string;
  image: string;   // a path under public/examples/
  thumb?: string;   // the picker's small copy, under public/examples/
  lens: string;     // an engine lens id
  fno: number;
  shutter: number;
  iso: number;
  focusM: number | null;
  credit: string;
  note: string;
}

interface ExamplesFile { examples: Example[] }

export async function loadExamples(): Promise<Example[]> {
  try {
    const res = await fetch('examples/examples.json');
    if (!res.ok) return [];
    const data = (await res.json()) as ExamplesFile;
    return Array.isArray(data.examples) ? data.examples : [];
  } catch {
    return []; // no examples.json, or it didn't parse: the panel just stays hidden, same as an empty list
  }
}

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`examples.ts: index.html is missing #${id}`);
  return el as T;
}

export function exampleScenario(ex: Example): Partial<Scenario> {
  // The engine's own subject stands where the real shot was focused, so the two frames are compared at the same
  // subject distance (scenes.ts's sceneFor); a photo without a recorded distance keeps the scene's own layout.
  return { lens: ex.lens, fno: ex.fno, shutter: ex.shutter, iso: ex.iso, focusM: ex.focusM, subjectM: ex.focusM ?? undefined };
}

export function mountExamples(store: Store): void {
  const card = byId('rp-card');
  const picks = byId('rp-picks');
  const img = byId<HTMLImageElement>('rp-img');
  const credit = byId('rp-credit');
  const canvas = byId<HTMLCanvasElement>('rp-canvas');
  const note = byId('rp-note');
  const specs = byId('rp-specs');
  const matchBtn = byId<HTMLButtonElement>('rp-match');
  const playBtn = document.createElement('button');
  playBtn.type = 'button'; playBtn.className = 'btn'; playBtn.id = 'rp-play';
  playBtn.textContent = 'Play this photo'; playBtn.disabled = true;
  matchBtn.after(playBtn);
  const settings = byId('rp-settings');
  const status = byId('rp-render-status');
  const retry = byId<HTMLButtonElement>('rp-retry');
  const heading = byId('rp-h');
  const header = card.querySelector<HTMLElement>('.sc-head')!;
  header.querySelector('.eyebrow')!.textContent = 'Your photographs · the physics behind the moment';
  const headingText = document.createElement('div'); headingText.className = 'rp-heading-text';
  headingText.append(...header.children);
  const navigation = document.createElement('div'); navigation.className = 'rp-navigation'; navigation.setAttribute('aria-label', 'Photograph navigation');
  const previousPhoto = document.createElement('button'); previousPhoto.type = 'button'; previousPhoto.className = 'btn'; previousPhoto.textContent = '←'; previousPhoto.setAttribute('aria-label', 'Previous photograph');
  const nextPhoto = document.createElement('button'); nextPhoto.type = 'button'; nextPhoto.className = 'btn'; nextPhoto.textContent = '→'; nextPhoto.setAttribute('aria-label', 'Next photograph');
  const photoCount = document.createElement('span'); photoCount.className = 'rp-count';
  navigation.append(previousPhoto, photoCount, nextPhoto); header.replaceChildren(headingText, navigation);
  const photo = card.querySelector<HTMLElement>('.rp-photo')!;
  const predictionFigure = card.querySelector<HTMLElement>('.rp-render')!;
  const side = card.querySelector<HTMLElement>('.rp-side')!;
  const compare = card.querySelector<HTMLElement>('.rp-compare')!;
  const facts = document.createElement('dl'); facts.className = 'rp-facts'; facts.id = 'rp-facts';
  const why = document.createElement('p'); why.className = 'rp-insight-title'; why.textContent = 'Look closely';
  const actions = document.createElement('div'); actions.className = 'rp-actions';
  actions.append(playBtn, matchBtn); matchBtn.textContent = 'Use these settings';
  const prediction = document.createElement('details'); prediction.className = 'rp-prediction'; prediction.id = 'rp-prediction';
  const summary = document.createElement('summary'); summary.textContent = 'Explore the calculated physics';
  const predictionBody = document.createElement('div'); predictionBody.className = 'rp-prediction-body';
  const disclosure = document.createElement('p'); disclosure.className = 'rp-prediction-note';
  disclosure.textContent = 'Same settings, different scene. This is a synthetic subject under the simulator’s lighting, not a reconstruction or measurement of your photograph. Recorded focus is approximate; model limits may adapt the settings.';
  predictionFigure.querySelector('figcaption')!.textContent = 'Synthetic scene · calculated from these settings';
  canvas.setAttribute('aria-label', 'Synthetic scene rendered using the photograph’s settings; not a reconstruction of the photograph');
  predictionBody.append(disclosure, predictionFigure, specs); prediction.append(summary, predictionBody);
  side.replaceChildren(settings, facts, why, note, actions, prediction);
  compare.replaceChildren(photo, side); card.replaceChildren(header, compare, picks);
  picks.setAttribute('aria-label', 'Choose a photograph');
  const imageStatus = document.createElement('p'); imageStatus.className = 'rp-image-status'; imageStatus.setAttribute('role', 'status');
  const imageRetry = document.createElement('button'); imageRetry.type = 'button'; imageRetry.className = 'btn'; imageRetry.textContent = 'Retry photograph'; imageRetry.hidden = true;
  const imageFrame = document.createElement('div'); imageFrame.className = 'rp-image-frame';
  imageFrame.append(img, imageStatus, imageRetry); photo.prepend(imageFrame);
  const photoDetails = mountPhotoDetails(img, imageFrame, note);
  img.decoding = 'async';
  img.onload = () => { imageStatus.hidden = true; imageRetry.hidden = true; imageFrame.setAttribute('aria-busy', 'false'); };
  img.onerror = () => { imageStatus.hidden = false; imageStatus.textContent = 'The photograph could not load.'; imageRetry.hidden = false; imageFrame.setAttribute('aria-busy', 'false'); };
  imageRetry.onclick = () => { if (current) { img.removeAttribute('src'); showPhoto(current); } };

  let examples: Example[] = [];
  let current: Example | null = null;
  let visible = document.body.dataset.workspaceView === 'photos';
  let worker: Worker | null = null;
  let pendingId: string | null = null;
  let paintedId: string | null = null;
  const cached = new Map<string, ExampleRenderResult>();
  const movePhoto = (step: number) => { if (current && examples.length) select(examples[(examples.indexOf(current) + step + examples.length) % examples.length]); };
  previousPhoto.onclick = () => movePhoto(-1); nextPhoto.onclick = () => movePhoto(1);
  picks.addEventListener('keydown', event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault(); movePhoto(event.key === 'ArrowRight' ? 1 : -1);
    picks.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
  });

  function showPhoto(ex: Example) {
    const source = `examples/${ex.image}`;
    if (img.getAttribute('src') === source) return;
    imageStatus.hidden = false; imageStatus.textContent = 'Loading photograph…'; imageRetry.hidden = true;
    imageFrame.setAttribute('aria-busy', 'true'); img.src = source;
  }

  function cancel() {
    worker?.terminate(); worker = null; pendingId = null;
    canvas.setAttribute('aria-busy', 'false');
  }

  function paint(view: ExampleRenderResult, id: string) {
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const data = ctx.createImageData(view.width, view.height);
      data.data.set(view.rgba); ctx.putImageData(data, 0, 0);
    }
    specs.replaceChildren();
    const rows: [string, string][] = [
      ['Depth of field', fmtRange(view.nearMm, view.farMm)],
      ['Background blur disk (at infinity)', `${view.backgroundBlurMm.toFixed(2)} mm`],
      ['Photons per pixel (18% gray)', Math.round(view.photons).toLocaleString('en-US')],
      ['Signal to noise', view.snr.toFixed(0)],
    ];
    for (const [k, v] of rows) {
      const div = document.createElement('div');
      const dt = document.createElement('dt'); dt.textContent = k;
      const dd = document.createElement('dd'); dd.textContent = v;
      const evidence = document.createElement('dd'); evidence.className = 'spec-evidence'; evidence.innerHTML = chip('derived');
      div.append(dt, dd, evidence); specs.appendChild(div);
    }
    paintedId = id; canvas.dataset.example = id;
    canvas.setAttribute('aria-busy', 'false'); status.textContent = 'Calculated for the synthetic scene'; retry.hidden = true;
  }

  function ensureRender() {
    const ex = current;
    if (!visible || document.hidden || !ex) return;
    showPhoto(ex);
    if (!prediction.open || pendingId === ex.id || paintedId === ex.id) return;
    const hit = cached.get(ex.id);
    if (hit) { paint(hit, ex.id); return; }
    cancel();
    pendingId = ex.id; canvas.setAttribute('aria-busy', 'true');
    status.textContent = 'Calculating the synthetic scene…'; retry.hidden = true;
    const fail = () => {
      cancel(); status.textContent = 'This example could not be rendered. Try again.'; retry.hidden = false;
    };
    try {
      const job = new Worker(new URL('./example-worker.ts', import.meta.url), { type: 'module' });
      worker = job;
      job.onmessage = (event: MessageEvent<ExampleRenderResult | { error: string }>) => {
        if (worker !== job || current?.id !== ex.id) return;
        if ('error' in event.data) { fail(); return; }
        cached.set(ex.id, event.data);
        if (cached.size > 3) cached.delete(cached.keys().next().value!);
        cancel(); paint(event.data, ex.id);
      };
      job.onerror = event => { event.preventDefault(); if (worker === job) fail(); };
      job.postMessage({ scenario: exampleScenario(ex), width: canvas.width, height: canvas.height } satisfies ExampleRenderRequest);
    } catch { fail(); }
  }
  retry.onclick = ensureRender;
  prediction.addEventListener('toggle', () => { if (prediction.open) ensureRender(); else cancel(); });
  const observer = new IntersectionObserver(entries => {
    visible = entries.some(entry => entry.isIntersecting && entry.intersectionRatio > 0);
    if (visible) ensureRender();
    else if (pendingId) { cancel(); status.textContent = 'Open this study to resume the calculation.'; }
  // A positive threshold delivers a second entry after an exact zero-area boundary contact.
  // With threshold 0, isIntersecting may already be true at that boundary and never notify on entry.
  }, { threshold: .001 });
  observer.observe(card);
  document.addEventListener('workspace-view', event => {
    visible = (event as CustomEvent<{ view: string }>).detail.view === 'photos';
    if (visible) ensureRender(); else cancel();
  });
  window.addEventListener('pagehide', cancel);
  window.addEventListener('pageshow', ensureRender);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cancel(); else ensureRender();
  });

  function renderCurrent() {
    const ex = current;
    if (!ex) return;
    img.alt = ex.title;
    heading.textContent = ex.title;
    photoCount.textContent = `${examples.indexOf(ex) + 1} / ${examples.length}`;
    credit.textContent = ex.credit;
    note.textContent = ex.note;
    photoDetails.setPhoto(ex.id, ex.note, ex.title);
    const lensName = (() => { try { return lensSummary(ex.lens).name; } catch { return ex.lens; } })();
    settings.textContent = `${lensName} · ISO ${ex.iso}`;
    facts.replaceChildren();
    for (const [label, value, explanation] of [
      ['Exposure', fmtShutter(ex.shutter), 'The time each row collects light'],
      ['Aperture', fmtFno(ex.fno), 'The opening that shapes light and blur'],
      ['Focus', ex.focusM === null ? 'Unrecorded' : `≈ ${fmtDistance(ex.focusM * 1000)}`, 'Camera-recorded distance, in coarse steps'],
    ]) {
      const fact = document.createElement('div');
      const dt = document.createElement('dt'); dt.textContent = label;
      const dd = document.createElement('dd'); dd.textContent = value;
      const caption = document.createElement('span'); caption.textContent = explanation;
      fact.append(dt, dd, caption); facts.append(fact);
    }
    playBtn.disabled = false;
    playBtn.setAttribute('aria-label', `Play this photo: ${ex.title}`);
    playBtn.onclick = () => emit('play-photo', { example: ex, source: playBtn });
    matchBtn.onclick = () => {
      store.set(exampleScenario(ex));
    };

    for (const b of picks.children) (b as HTMLElement).setAttribute('aria-pressed', String((b as HTMLElement).dataset.id === ex.id));
    ensureRender();
  }

  function select(ex: Example) {
    if (current?.id === ex.id) { ensureRender(); return; }
    cancel(); paintedId = null;
    canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    delete canvas.dataset.example; specs.replaceChildren(); retry.hidden = true;
    img.removeAttribute('src');
    status.textContent = 'Open to calculate this photograph’s settings in the simulator.';
    current = ex;
    renderCurrent();
  }

  const catalogStatus = document.querySelector<HTMLElement>('#photo-study-panel .study-loading');
  let catalogPending = false;
  async function loadCatalog() {
    if (catalogPending) return;
    catalogPending = true;
    if (catalogStatus) {
      catalogStatus.hidden = false; catalogStatus.dataset.state = 'loading';
      catalogStatus.setAttribute('role', 'status'); catalogStatus.textContent = 'Loading your photographs…';
    }
    const list = await loadExamples();
    catalogPending = false;
    examples = list;
    card.hidden = examples.length === 0;
    if (examples.length === 0) {
      if (catalogStatus) {
        catalogStatus.dataset.state = 'unavailable';
        const message = document.createElement('span'); message.textContent = 'Photos unavailable. The collection may be empty or could not be loaded.';
        const catalogRetry = document.createElement('button'); catalogRetry.type = 'button'; catalogRetry.className = 'btn'; catalogRetry.textContent = 'Retry photographs';
        catalogRetry.onclick = () => { void loadCatalog(); };
        catalogStatus.replaceChildren(message, catalogRetry);
      }
      return;
    }
    if (catalogStatus) catalogStatus.hidden = true;
    picks.innerHTML = '';
    for (const ex of examples) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'rp-pick';
      btn.dataset.id = ex.id;
      btn.setAttribute('aria-label', ex.title);
      if (ex.thumb) {
        const t = document.createElement('img');
        t.src = `examples/${ex.thumb}`;
        t.alt = '';
        t.loading = 'lazy';
        btn.appendChild(t);
      }
      const label = document.createElement('span');
      label.className = 'rp-pick-t';
      label.textContent = ex.title;
      const sub = document.createElement('span');
      sub.className = 'rp-pick-k';
      const focal = (() => { try { return `${lensSummary(ex.lens).focalLength} mm`; } catch { return ex.lens; } })();
      sub.textContent = `${focal} · ${fmtFno(ex.fno)}`;
      btn.append(label, sub);
      btn.addEventListener('click', () => select(ex));
      picks.appendChild(btn);
    }
    select(examples[0]);
  }
  void loadCatalog();
}
