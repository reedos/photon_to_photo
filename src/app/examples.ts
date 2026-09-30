// The real-photo comparison panel (workflow brief, "A real-photo comparison panel"): reads public/examples/
// examples.json, hidden whenever it's empty. Never the engine's input -- BRIEF.md's synthetic-scenes-only rule is
// about what the engine renders, and this only ever compares the engine's own output at a real shot's settings
// against that real shot's own photo, side by side. The only place real photos enter this app.
import { compute, lensSummary, renderImage } from './engine-api';
import type { Scenario } from '../engine/types';
import { fmtDistance, fmtFno, fmtRange, fmtShutter } from './units';
import { exitPupilBlurDiameterMm } from '../engine/camera';
import type { Store } from './store';
import { chip } from './ui';

export interface Example {
  id: string;
  title: string;
  image: string;   // a path under public/examples/
  lens: string;     // an engine lens id
  fno: number;
  shutter: number;
  iso: number;
  focusM: number | null;
  credit: string;
  note: string;
}

interface ExamplesFile { examples: Example[] }

async function loadExamples(): Promise<Example[]> {
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

/** A far-enough background that its own blur disk reads as the background-at-infinity figure (docs contract:
 *  "background blur disk size"), not a guess at the real photo's own background distance, which examples.json
 *  doesn't carry. */
const FAR_BACKGROUND_MM = 1e9;

function exampleScenario(ex: Example): Partial<Scenario> {
  return { lens: ex.lens, fno: ex.fno, shutter: ex.shutter, iso: ex.iso, focusM: ex.focusM };
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
  const settings = byId('rp-settings');

  let examples: Example[] = [];
  let current: Example | null = null;

  function renderCurrent() {
    const ex = current;
    if (!ex) return;
    img.src = `examples/${ex.image}`;
    img.alt = ex.title;
    credit.textContent = ex.credit;
    note.textContent = ex.note;
    const lensName = (() => { try { return lensSummary(ex.lens).name; } catch { return ex.lens; } })();
    settings.textContent = `${lensName} · ${fmtFno(ex.fno)} · ${fmtShutter(ex.shutter)} · ISO ${ex.iso} · focus ${fmtDistance(ex.focusM === null ? null : ex.focusM * 1000)}`;
    matchBtn.onclick = () => {
      store.set(exampleScenario(ex));
      document.getElementById('scenario')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    const model = compute(exampleScenario(ex));
    const bg = exitPupilBlurDiameterMm(model, FAR_BACKGROUND_MM);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const w = canvas.width, h = canvas.height;
      const view = renderImage(model, { width: w, height: h, seed: 1 });
      const data = ctx.createImageData(view.width, view.height);
      data.data.set(view.rgba);
      ctx.putImageData(data, 0, 0);
    }
    specs.innerHTML = '';
    const rows: [string, string][] = [
      ['Depth of field', fmtRange(model.focus.nearMm, model.focus.farMm)],
      ['Background blur disk (at infinity)', `${bg.toFixed(2)} mm`],
      ['Photons per pixel (18% gray)', Math.round(model.exposure.photonsMidGray).toLocaleString('en-US')],
      ['Signal to noise', model.exposure.snrMidGray.toFixed(0)],
    ];
    for (const [k, v] of rows) {
      const div = document.createElement('div');
      const dt = document.createElement('dt'); dt.textContent = k;
      const dd = document.createElement('dd'); dd.textContent = v;
      div.append(dt, dd);
      div.insertAdjacentHTML('beforeend', chip('derived'));
      specs.appendChild(div);
    }
    for (const b of picks.children) (b as HTMLElement).setAttribute('aria-pressed', String((b as HTMLElement).dataset.id === ex.id));
  }

  function select(ex: Example) {
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
      btn.className = 'btn btn-quiet';
      btn.dataset.id = ex.id;
      btn.textContent = ex.title;
      btn.addEventListener('click', () => select(ex));
      picks.appendChild(btn);
    }
    select(examples[0]);
  });
}
