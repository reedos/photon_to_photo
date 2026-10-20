// The real-photo gallery reads public/examples/examples.json. The photographs and their recorded settings
// support study, matching and the illustrated Play the shot journey; no synthetic scene is generated here.
import { lensSummary } from './engine-api';
import type { Scenario } from '../engine/types';
import { fmtDistance, fmtFno, fmtShutter } from './units';
import type { Store } from './store';
import { emit } from './bus';
import { mountPhotoDetails } from './photo-details';
import { exampleSrcset } from './image-variants';
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

/** What each photograph shows, in one sentence, for the gallery image's alt text (score loop r4: the alt was only the
 *  title, "Vermilion flycatcher"). Descriptions of the picture itself, not of how it was made. */
export const PHOTO_ALT: Record<string, string> = {
  flycatcher: 'A red vermilion flycatcher beside its nest in a web of branches',
  mallard: 'A mallard and two ducklings on a fallen log in bright green grass, beside rippling water',
  'fox-snow': 'A red fox looks toward the camera from a concrete ledge beside a patch of snow, with a striped post behind it',
  squirrel: 'A ground squirrel sits upright on a rock with its front paws raised to its mouth, against a soft blurred background',
  'fox-portrait': 'A red fox with a pale chest stands on a ledge and looks at the camera against a smooth gray backdrop',
  'sheep-flock': 'Sheep graze on a green mountain slope under a rocky peak and clouds',
  'sheep-close': 'A woolly sheep with a black face looks at the camera on a green meadow, another sheep’s fleece at the left edge',
  'sheep-portrait': 'A horned sheep with a black face and a bell collar stands on a green hillside, with another sheep behind it',
  chipmunk: 'A chipmunk sits upright on a lichen-covered rock, with a soft green and gray background',
  bears: 'Two brown bears stand on a gravel riverbank in front of a line of green bushes under an overcast sky',
};

interface ExamplesFile { examples: Example[] }

export async function loadExamples(): Promise<Example[]> {
  try {
    const res = await fetch('examples/examples.json', { cache: 'no-cache' });
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

/** What the camera was just set to, for the toast and the screen-reader announcement after "Use these settings". */
export function appliedSettingsText(ex: Example): string {
  const parts = [ex.focalLengthMm ? `${ex.focalLengthMm}\u00a0mm` : '', fmtFno(ex.fno), fmtShutter(ex.shutter).replace(' ', '\u00a0'), `ISO ${ex.iso}`].filter(Boolean);
  return `Camera set to the settings recorded for ${ex.title}: ${parts.join(', ')}.`;
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
  playBtn.textContent = 'Play the shot with this photo'; playBtn.disabled = true;
  matchBtn.after(playBtn);
  const settings = byId('rp-settings');
  const heading = byId('rp-h');
  const header = card.querySelector<HTMLElement>('.sc-head')!;
  header.querySelector('.eyebrow')!.textContent = 'Real photographs · the physics behind the moment';
  const headingText = document.createElement('div'); headingText.className = 'rp-heading-text';
  headingText.append(...header.children);
  const navigation = document.createElement('div'); navigation.className = 'rp-navigation'; navigation.setAttribute('aria-label', 'Photograph navigation');
  const previousPhoto = document.createElement('button'); previousPhoto.type = 'button'; previousPhoto.className = 'btn'; previousPhoto.textContent = '←'; previousPhoto.setAttribute('aria-label', 'Previous photograph');
  const nextPhoto = document.createElement('button'); nextPhoto.type = 'button'; nextPhoto.className = 'btn'; nextPhoto.textContent = '→'; nextPhoto.setAttribute('aria-label', 'Next photograph');
  const photoCount = document.createElement('span'); photoCount.className = 'rp-count';
  // The model's Share button belongs to the model's toolbar; this one copies the link to the photograph on show
  // (score loop r2: the Real photos view had no way to share a particular photograph).
  const share = document.createElement('button'); share.type = 'button'; share.className = 'btn rp-share'; share.id = 'rp-share'; share.textContent = 'Share';
  const shareStatus = document.createElement('span'); shareStatus.className = 'sr-only'; shareStatus.setAttribute('role', 'status');
  navigation.append(previousPhoto, photoCount, nextPhoto, share, shareStatus); header.replaceChildren(headingText, navigation);
  const photo = card.querySelector<HTMLElement>('.rp-photo')!;
  const side = card.querySelector<HTMLElement>('.rp-side')!;
  const settingsExplanation = side.querySelector<HTMLElement>(':scope > .note');
  const compare = card.querySelector<HTMLElement>('.rp-compare')!;
  const facts = document.createElement('dl'); facts.className = 'rp-facts'; facts.id = 'rp-facts';
  const why = document.createElement('p'); why.className = 'rp-insight-title'; why.textContent = 'Look closely';
  const actions = document.createElement('div'); actions.className = 'rp-actions';
  actions.append(playBtn, matchBtn); matchBtn.textContent = 'Use these settings';
  // A photograph whose lens the simulator does not have (score loop r6): the disabled button carried its reason only in a
  // tooltip, a touch screen has none, and the sentence above it still said to set the camera to the recorded settings.
  // Now a line under the buttons says why, the sentence says what is possible, and a second button offers the same
  // f-number and shutter on the 500 mm lens.
  const ALT_LENS = 'n500fl';
  const shortLens = (id: string) => { try { const l = lensSummary(id); return `${l.focalLength} mm f/${l.markedFno}`; } catch { return id; } };
  const matchWhy = document.createElement('p'); matchWhy.className = 'rp-match-why'; matchWhy.id = 'rp-match-why'; matchWhy.hidden = true;
  const altBtn = document.createElement('button'); altBtn.type = 'button'; altBtn.className = 'btn'; altBtn.id = 'rp-try-alt'; altBtn.hidden = true;
  actions.append(altBtn);
  const settingsSentence = settingsExplanation?.textContent ?? '';
  side.replaceChildren(settings, facts, why, note, ...(settingsExplanation ? [settingsExplanation] : []), actions, matchWhy);
  compare.replaceChildren(photo, side); card.replaceChildren(header, compare, picks);
  picks.setAttribute('aria-label', 'Choose a photograph');
  // The strip's edges fade where more photographs are scrolled out of sight (photo-study.css).
  const edges = () => {
    const end = picks.scrollWidth - picks.clientWidth;
    picks.classList.toggle('more-before', picks.scrollLeft > 2);
    picks.classList.toggle('more-after', picks.scrollLeft < end - 2);
  };
  picks.addEventListener('scroll', edges, { passive: true });
  new ResizeObserver(edges).observe(picks);
  const imageStatus = document.createElement('p'); imageStatus.className = 'rp-image-status'; imageStatus.setAttribute('role', 'status');
  const imageRetry = document.createElement('button'); imageRetry.type = 'button'; imageRetry.className = 'btn'; imageRetry.textContent = 'Retry photograph'; imageRetry.hidden = true;
  const imageFrame = document.createElement('div'); imageFrame.className = 'rp-image-frame';
  imageFrame.append(img, imageStatus, imageRetry); photo.prepend(imageFrame);
  const photoDetails = mountPhotoDetails(img, imageFrame, note, () => writeUrl('replace'));
  img.decoding = 'async';
  // The gallery starts in the hidden Real photos view: a lazy image is not fetched until that view is shown, so its
  // 1 MB first photo no longer competes with the camera's models on a cold load (score loop r1).
  img.loading = 'lazy';
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
  /** The chosen photograph and detail live in the address while Real photos shows (view=photos&photo=fox-portrait
   *  &crop=…): a reload or a shared link opens the same one, and Back steps through the photographs chosen. */
  const photosShown = () => document.body.dataset.workspaceView === 'photos';
  function writeUrl(mode: 'push' | 'replace') {
    if (!current || !photosShown()) return;
    const url = new URL(location.href);
    url.searchParams.set('view', 'photos'); url.searchParams.set('photo', current.id);
    const detail = photoDetails.detail();
    if (detail) url.searchParams.set('crop', detail); else url.searchParams.delete('crop');
    if (url.href === location.href) return;
    if (mode === 'push' && new URL(location.href).searchParams.get('photo') !== current.id) history.pushState({ p2p: 'photo' }, '', url);
    else history.replaceState(history.state, '', url);
  }
  /** The photograph and detail the address names, when it names one in this catalog. */
  function fromUrl() {
    const params = new URLSearchParams(location.search);
    const named = examples.find(ex => ex.id === params.get('photo'));
    if (named) select(named, 'none');
    if (named || !params.get('photo')) photoDetails.showDetail(params.get('crop'));
    return !!named;
  }
  window.addEventListener('popstate', () => { if (examples.length && photosShown()) fromUrl(); });
  document.addEventListener('workspace-view', event => { if ((event as CustomEvent<{ view: string }>).detail.view === 'photos') writeUrl('replace'); });
  share.onclick = async () => {
    writeUrl('replace');
    let copied = false;
    try { await navigator.clipboard.writeText(location.href); copied = true; } catch { /* no clipboard: the address bar holds the link */ }
    share.textContent = copied ? 'Link copied' : 'Copy the address';
    shareStatus.textContent = copied ? `Link copied · ${current?.title ?? 'Real photos'}` : 'Copy the link from the address bar';
    window.setTimeout(() => { share.textContent = 'Share'; }, 2500);
  };
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
    imageFrame.setAttribute('aria-busy', 'true');
    // A smaller WebP copy fits the frame (score loop r3: a 390 px phone fetched the 1 MB JPEG). The image is lazy, so
    // sizes="auto" lets the browser use the frame's laid-out width once the Real photos view shows it. The JPEG stays
    // src and the widest candidate; the detail crop keeps its own full-resolution file (photo-details.ts).
    img.sizes = 'auto, (max-width: 760px) 100vw, 60vw';
    img.srcset = exampleSrcset(ex.image);
    img.src = source;
  }

  function renderCurrent() {
    const ex = current;
    if (!ex) return;
    showPhoto(ex);
    img.alt = PHOTO_ALT[ex.id] ?? ex.title;
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
      ['Focus', ex.focusM === null ? 'Unrecorded' : `≈ ${fmtDistance(ex.focusM * 1000)}`, ex.focusM === null ? 'This file has no focus distance' : 'Camera-recorded distance, in coarse steps'],
    ]) {
      const fact = document.createElement('div');
      const dt = document.createElement('dt'); dt.textContent = label;
      const dd = document.createElement('dd'); dd.textContent = value;
      const caption = document.createElement('span'); caption.textContent = explanation;
      dd.append(caption); fact.append(dt, dd); facts.append(fact);
    }
    playBtn.disabled = false;
    playBtn.setAttribute('aria-label', `Play the shot with this photo: ${ex.title}`);
    playBtn.onclick = () => emit('play-photo', { example: ex, source: playBtn });
    const unmodeled = ex.modelMatch === false;
    matchBtn.disabled = unmodeled;
    matchBtn.textContent = unmodeled ? 'Lens not modeled' : 'Use these settings';
    matchBtn.title = unmodeled ? 'The recorded camera and lens are not available in this simulator.' : '';
    matchWhy.hidden = !unmodeled;
    if (settingsExplanation) settingsExplanation.textContent = unmodeled ? 'This photo’s recorded settings cannot be copied exactly. The original photograph stays unchanged.' : settingsSentence;
    const alt = (() => { try { return unmodeled && ex.fno >= lensSummary(ALT_LENS).maxFno ? lensSummary(ALT_LENS) : null; } catch { return null; } })();
    if (unmodeled) matchWhy.textContent = `${ex.lensName ?? 'This photo’s lens'} is not in the simulator, so its explanation uses a stand-in: the ${shortLens(ex.lens)}.${alt ? ` You can still try its f-number and shutter on the ${shortLens(ALT_LENS)}.` : ''}`;
    altBtn.hidden = !alt;
    if (alt) {
      altBtn.textContent = `Try ${fmtFno(ex.fno)} · ${fmtShutter(ex.shutter)} on the ${shortLens(ALT_LENS)}`;
      altBtn.onclick = () => {
        emit('camera-set', { text: `Camera set to the ${shortLens(ALT_LENS)} with the f-number and shutter recorded for ${ex.title}: ${fmtFno(ex.fno)}, ${fmtShutter(ex.shutter).replace(' ', '\u00a0')}, ISO ${ex.iso}.` });
        store.set({ lens: ALT_LENS, fno: ex.fno, shutter: ex.shutter, iso: ex.iso });
      };
    }
    matchBtn.onclick = () => {
      emit('camera-set', { text: appliedSettingsText(ex) });
      store.set(exampleScenario(ex));
    };

    for (const b of picks.children) (b as HTMLElement).setAttribute('aria-pressed', String((b as HTMLElement).dataset.id === ex.id));
  }

  function select(ex: Example, history: 'push' | 'replace' | 'none' = 'push') {
    if (current?.id === ex.id) return;
    img.removeAttribute('src');
    current = ex;
    renderCurrent();
    picks.querySelector<HTMLElement>('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (history !== 'none') writeUrl(history);
  }

  const catalogStatus = document.querySelector<HTMLElement>('#photo-study-panel .study-loading');
  let catalogPending = false;
  async function loadCatalog() {
    if (catalogPending) return;
    catalogPending = true;
    if (catalogStatus) {
      catalogStatus.hidden = false; catalogStatus.dataset.state = 'loading';
      catalogStatus.setAttribute('role', 'status'); catalogStatus.textContent = 'Loading the photographs…';
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
    if (!fromUrl()) select(examples[0], 'replace');
    edges();
  }
  void loadCatalog();
}
