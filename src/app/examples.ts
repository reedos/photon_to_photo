// The real-photo comparison panel (workflow brief, "A real-photo comparison panel"): reads public/examples/
// examples.json, hidden whenever it's empty. Never the engine's input -- BRIEF.md's synthetic-scenes-only rule is
// about what the engine renders, and this only ever compares the engine's own output at a real shot's settings
// against that real shot's own photo, side by side. These records also launch the photo journey;
// its JPEG is a scene reference and final reveal, never input to the physics renderer.
import { lensSummary } from './engine-api';
import type { Scenario } from '../engine/types';
import { fmtDistance, fmtFno, fmtRange, fmtShutter } from './units';
import type { ExampleRenderRequest, ExampleRenderResult } from './example-worker';
import type { Store } from './store';
import { chip } from './ui';
import { emit } from './bus';

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

  let examples: Example[] = [];
  let current: Example | null = null;
  let visible = false;
  let worker: Worker | null = null;
  let pendingId: string | null = null;
  let paintedId: string | null = null;
  const cached = new Map<string, ExampleRenderResult>();

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
    canvas.setAttribute('aria-busy', 'false'); status.textContent = 'Prediction ready'; retry.hidden = true;
  }

  function ensureRender() {
    const ex = current;
    if (!visible || document.hidden || !ex || pendingId === ex.id || paintedId === ex.id) return;
    img.src = `examples/${ex.image}`;
    const hit = cached.get(ex.id);
    if (hit) { paint(hit, ex.id); return; }
    cancel();
    pendingId = ex.id; canvas.setAttribute('aria-busy', 'true');
    status.textContent = 'Rendering this example…'; retry.hidden = true;
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
  const observer = new IntersectionObserver(entries => {
    visible = entries.some(entry => entry.isIntersecting && entry.intersectionRatio > 0);
    if (visible) ensureRender();
    else if (pendingId) { cancel(); status.textContent = 'Prediction will load when this panel is in view.'; }
  // A positive threshold delivers a second entry after an exact zero-area boundary contact.
  // With threshold 0, isIntersecting may already be true at that boundary and never notify on entry.
  }, { threshold: .001 });
  observer.observe(card);
  window.addEventListener('pagehide', cancel);
  window.addEventListener('pageshow', ensureRender);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) cancel(); else ensureRender();
  });

  function renderCurrent() {
    const ex = current;
    if (!ex) return;
    img.alt = ex.title;
    credit.textContent = ex.credit;
    note.textContent = ex.note;
    const lensName = (() => { try { return lensSummary(ex.lens).name; } catch { return ex.lens; } })();
    settings.textContent = `${lensName} · ${fmtFno(ex.fno)} · ${fmtShutter(ex.shutter)} · ISO ${ex.iso} · focus ${fmtDistance(ex.focusM === null ? null : ex.focusM * 1000)}`;
    playBtn.disabled = false;
    playBtn.setAttribute('aria-label', `Play this photo: ${ex.title}`);
    playBtn.onclick = () => emit('play-photo', { example: ex, source: playBtn });
    matchBtn.onclick = () => {
      store.set(exampleScenario(ex));
      document.getElementById('scenario')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    status.textContent = 'Prediction will load when this panel is in view.';
    current = ex;
    renderCurrent();
  }

  loadExamples().then((list) => {
    examples = list;
    card.hidden = examples.length === 0;
    if (examples.length === 0) return;
    picks.innerHTML = '';
    for (const ex of examples) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'rp-pick';
      btn.dataset.id = ex.id;
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
  });
}
