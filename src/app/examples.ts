// The real-photo gallery reads public/examples/examples.json. The photographs and their recorded settings
// support study, matching and the illustrated Play the shot journey; no synthetic scene is generated here.
import { lensSummary } from './engine-api';
import type { Scenario } from '../engine/types';
import { fmtDistance, fmtFno, fmtShutter } from './units';
import type { Store } from './store';
import { emit } from './bus';
import { mountPhotoDetails } from './photo-details';
import '../styles/photo-study.css';

export interface Example {
  id: string;
  title: string;
  image: string;   // a path under public/examples/
  thumb?: string;   // the picker's small copy, under public/examples/
  fullImage?: string;
  detailImage?: string;
  cameraName?: string;
  lensName?: string;
  focalLengthMm?: number;
  modelMatch?: boolean;
  subject?: { x: number; y: number };
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
  // Recorded values feed the settings workspace; focus remains metadata when it is unavailable.
  return { lens: ex.lens, fno: ex.fno, shutter: ex.shutter, iso: ex.iso, ...(ex.focusM === null ? {} : { focusM: ex.focusM }) };
}

export function mountExamples(store: Store): void {
  const card = byId('rp-card');
  const picks = byId('rp-picks');
  const img = byId<HTMLImageElement>('rp-img');
  const credit = byId('rp-credit');
  const note = byId('rp-note');
  const matchBtn = byId<HTMLButtonElement>('rp-match');
  const playBtn = document.createElement('button');
  playBtn.type = 'button'; playBtn.className = 'btn'; playBtn.id = 'rp-play';
  playBtn.textContent = 'Play this photo'; playBtn.disabled = true;
  matchBtn.after(playBtn);
  const settings = byId('rp-settings');
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
  const side = card.querySelector<HTMLElement>('.rp-side')!;
  const settingsExplanation = side.querySelector<HTMLElement>(':scope > .note');
  const compare = card.querySelector<HTMLElement>('.rp-compare')!;
  const facts = document.createElement('dl'); facts.className = 'rp-facts'; facts.id = 'rp-facts';
  const why = document.createElement('p'); why.className = 'rp-insight-title'; why.textContent = 'Look closely';
  const actions = document.createElement('div'); actions.className = 'rp-actions';
  actions.append(playBtn, matchBtn); matchBtn.textContent = 'Use these settings';
  side.replaceChildren(settings, facts, why, note, ...(settingsExplanation ? [settingsExplanation] : []), actions);
  compare.replaceChildren(photo, side); card.replaceChildren(header, compare, picks);
  picks.setAttribute('aria-label', 'Choose a photograph');
  const imageStatus = document.createElement('p'); imageStatus.className = 'rp-image-status'; imageStatus.setAttribute('role', 'status');
  const imageRetry = document.createElement('button'); imageRetry.type = 'button'; imageRetry.className = 'btn'; imageRetry.textContent = 'Retry photograph'; imageRetry.hidden = true;
  const imageFrame = document.createElement('div'); imageFrame.className = 'rp-image-frame';
  imageFrame.append(img, imageStatus, imageRetry); photo.prepend(imageFrame);
  const photoDetails = mountPhotoDetails(img, imageFrame, note);
  img.decoding = 'async';
  img.onload = async () => {
    const source = img.currentSrc;
    try { await img.decode(); }
    catch {
      if (img.currentSrc !== source) return;
      imageStatus.hidden = false; imageStatus.textContent = 'The photograph could not load.';
      imageRetry.hidden = false; imageFrame.setAttribute('aria-busy', 'false'); return;
    }
    if (img.currentSrc !== source) return;
    imageStatus.hidden = true; imageRetry.hidden = true; imageFrame.setAttribute('aria-busy', 'false');
  };
  img.onerror = () => { imageStatus.hidden = false; imageStatus.textContent = 'The photograph could not load.'; imageRetry.hidden = false; imageFrame.setAttribute('aria-busy', 'false'); };
  imageRetry.onclick = () => { if (current) { img.removeAttribute('src'); showPhoto(current); } };

  let examples: Example[] = [];
  let current: Example | null = null;
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

  function renderCurrent() {
    const ex = current;
    if (!ex) return;
    showPhoto(ex);
    img.alt = ex.title;
    heading.textContent = ex.title;
    photoCount.textContent = `${examples.indexOf(ex) + 1} / ${examples.length}`;
    credit.textContent = ex.credit;
    note.textContent = ex.note;
    photoDetails.setPhoto(ex.id, ex.note, ex.title, ex.fullImage ? `examples/${ex.fullImage}` : undefined);
    const lensName = (() => { try { return lensSummary(ex.lens).name; } catch { return ex.lens; } })();
    settings.textContent = `${ex.cameraName ? ex.cameraName + ' · ' : ''}${ex.lensName ?? lensName} · ISO ${ex.iso}`;
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
      dd.append(caption); fact.append(dt, dd); facts.append(fact);
    }
    playBtn.disabled = false;
    playBtn.setAttribute('aria-label', `Play this photo: ${ex.title}`);
    playBtn.onclick = () => emit('play-photo', { example: ex, source: playBtn });
    matchBtn.disabled = ex.modelMatch === false;
    matchBtn.textContent = ex.modelMatch === false ? 'Lens not modeled' : 'Use these settings';
    matchBtn.title = ex.modelMatch === false ? 'The recorded camera and lens are not available in this simulator.' : '';
    matchBtn.onclick = () => {
      store.set(exampleScenario(ex));
    };

    for (const b of picks.children) (b as HTMLElement).setAttribute('aria-pressed', String((b as HTMLElement).dataset.id === ex.id));
  }

  function select(ex: Example) {
    if (current?.id === ex.id) return;
    img.removeAttribute('src');
    current = ex;
    renderCurrent();
    picks.querySelector<HTMLElement>('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
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
      const focal = ex.focalLengthMm ? `${ex.focalLengthMm} mm` : (() => { try { return `${lensSummary(ex.lens).focalLength} mm`; } catch { return ex.lens; } })();
      sub.textContent = `${focal} · ${fmtFno(ex.fno)}`;
      btn.append(label, sub);
      btn.addEventListener('click', () => select(ex));
      picks.appendChild(btn);
    }
    select(examples[0]);
  }
  void loadCatalog();
}
