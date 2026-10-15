// The first photograph paints before the camera renderer or physics bundles are loaded.
import { cleanSearch } from './app/address';
import { mountPhotoOpening, shouldShowPhotoOpening } from './app/photo-opening';
import examplesFile from 'virtual:p2p-facts/examples';

// Every range input's amber fill (base.css reads --pct) follows the thumb when the reader drags it; controls that
// move their own value in code set --pct where they do.
document.addEventListener('input', (event) => {
  const el = event.target;
  if (!(el instanceof HTMLInputElement) || el.type !== 'range') return;
  const min = Number(el.min) || 0, max = el.max === '' ? 100 : Number(el.max);
  el.style.setProperty('--pct', `${max > min ? (Number(el.value) - min) / (max - min) * 100 : 0}%`);
});

let entered = false;
try { entered = sessionStorage.getItem('p2p.entered') === '1' || sessionStorage.getItem('p2p.return') !== null; } catch { /* Direct links still work without storage. */ }

let starting: Promise<boolean> | undefined;
let removeOpening: (() => void) | undefined;
function hideOpening() {
  removeOpening?.(); removeOpening = undefined;
  document.body.classList.remove('entry-pending', 'photo-opening-active');
  document.getElementById('photo-opening')!.hidden = true;
  document.getElementById('top')!.hidden = false;
}
/** While the camera's code downloads (the dynamic import of app-start and the chunks it needs), the veil says how much of it has
 *  arrived. On fast 3G the veil read "Starting the renderer…" for 6 s and more with no sign of movement (score loop r5). The sizes
 *  are the build's own (<meta name="p2p-code-bytes">, the gzip size of the files named in p2p-warm-modules); what has arrived is
 *  read from the Resource Timing entries of those files, which appear as each finishes. Nothing is shown when the code comes from the
 *  cache quickly, or in the dev server, which has no such list. Returns a function that stops the updates. */
function watchCodeDownload(): () => void {
  const total = Number(document.querySelector<HTMLMetaElement>('meta[name="p2p-code-bytes"]')?.content) || 0;
  const files = (document.querySelector<HTMLMetaElement>('meta[name="p2p-warm-modules"]')?.content ?? '').split(/\s+/).filter(Boolean).map((f) => new URL(f, document.baseURI).href);
  const message = document.getElementById('veil-msg'), bar = document.getElementById('veil-bar');
  if (!total || !files.length || !message) return () => {};
  const mb = (bytes: number) => (bytes / 1e6).toFixed(1);
  const tick = () => {
    const arrived = performance.getEntriesByType('resource').filter((e) => files.includes(e.name)).reduce((a, e) => a + ((e as PerformanceResourceTiming).encodedBodySize || 0), 0);
    message.textContent = `Downloading the camera · ${mb(Math.min(arrived, total))} of ${mb(total)} MB of code`;
    if (bar) bar.style.width = `${Math.max(5, Math.min(60, Math.round((arrived / total) * 60)))}%`;
  };
  let interval = 0;
  const timer = window.setTimeout(() => { tick(); interval = window.setInterval(tick, 400); }, 700);
  return () => { window.clearTimeout(timer); window.clearInterval(interval); };
}
function failCamera(error: unknown) {
  console.error('main.ts: failed to load the camera', error);
  const veil = document.getElementById('veil')!;
  veil.classList.remove('off'); veil.classList.add('err');
  veil.setAttribute('role', 'alert');
  document.getElementById('veil-msg')!.textContent = 'The camera could not load. Reload to try again.';
  const reload = document.getElementById('veil-reload')!;
  reload.onclick = () => location.reload();
  // the 2D reference needs no 3D (score loop r5: this screen, unlike the start failure's, offered no way on)
  if (!document.getElementById('veil-reference')) {
    const reference = document.createElement('a');
    reference.id = 'veil-reference'; reference.className = 'btn veil-reference'; reference.href = 'reference.html';
    reference.textContent = 'Read the 2D reference';
    reload.after(reference);
  }
  document.getElementById('veil-reference')!.hidden = false;
}
/** Play the shot from the opening: the photograph (and its detail crop) download while the camera starts, not after it,
 *  so the player has them when it opens. The player asks for the same URLs; the browser answers it from these requests. */
const shotPhotos: HTMLImageElement[] = [];
function startShotPhotos(photoId?: string) {
  const example = examplesFile.examples.find(photo => photo.id === photoId) as { image?: string; detailImage?: string } | undefined;
  if (!example || shotPhotos.length) return;
  for (const file of [example.image, example.detailImage]) {
    if (!file) continue;
    const img = new Image();
    img.decoding = 'async';
    img.src = new URL(`examples/${file}`, document.baseURI).href;
    shotPhotos.push(img);
  }
}
// The model takes the focus only when the reader chose it (Explore the camera on the opening). A cold load leaves the
// focus at the top of the page, so Tab starts at the skip link and the site bar (score loop r3).
function enterCamera(photoId?: string, photos = false, focusModel = false): Promise<void> {
  startShotPhotos(photoId);
  // The workspace stays covered until app-start has mounted it (src/styles/app.css, .boot-cover): its rows are built
  // in steps around the renderer's start, and showing them as they arrive shifted the page (score loop r3).
  if (!starting) document.body.classList.add('app-booting');
  hideOpening();
  starting ??= (async () => {
    try {
      performance.mark('p2p:enter');
      const stopWatching = watchCodeDownload();
      const { startApp, showStartupFailure } = await import('./app-start').finally(stopWatching);
      const message = document.getElementById('veil-msg');
      if (message && !document.getElementById('veil')?.classList.contains('err')) message.textContent = 'Starting the renderer…';
      try { await startApp(); } catch (error) { showStartupFailure(error); return false; }
      try { sessionStorage.setItem('p2p.entered', '1'); } catch { /* Optional session convenience. */ }
      return true;
    } catch (error) { failCamera(error); return false; } finally { document.body.classList.remove('app-booting'); }
  })();
  return starting.then(async started => {
    if (!started) return;
    try {
      const example = examplesFile.examples.find(photo => photo.id === photoId);
      if (photos) {
        document.getElementById('workspace-photos')!.click();
        document.getElementById('workspace-photos')!.focus({ preventScroll: true });
      }
      if (example) {
        const { emit } = await import('./app/bus');
        emit('play-photo', { example, source: document.querySelector<HTMLElement>('.shot-launch')! });
      } else if (focusModel && !photos && (!location.hash || location.hash === '#stage-section')) {
        document.getElementById('gl')?.focus({ preventScroll: true });
      }
      // a shot or photo id that names no photograph (shot=none) does not stay in the address
      if (photoId && !example) {
        const url = new URL(location.href);
        let dropped = false;
        for (const key of ['shot', 'photo']) if (url.searchParams.get(key) === photoId && !(photos && key === 'photo')) { url.searchParams.delete(key); dropped = true; }
        if (dropped) history.replaceState(history.state, '', url);
      }
    } catch (error) { failCamera(error); }
  });
}

// The opening is a place in the browser history (review loop 10/11/2026): leaving it adds an entry, so Back from the
// workspace returns to it, and Forward from it goes back in.
function leaveOpening(photoId?: string, photos = false): Promise<void> {
  if (history.state?.p2p === 'opening') history.pushState({ p2p: 'workspace' }, '', `${location.pathname}#stage-section`);
  return enterCamera(photoId, photos, true);
}
function showOpening(again: boolean) {
  history.replaceState({ p2p: 'opening' }, '', location.href);
  removeOpening = mountPhotoOpening((photo, photos) => leaveOpening(photo, photos), again);
}
window.addEventListener('popstate', () => {
  const atOpening = history.state?.p2p === 'opening';
  if (atOpening && !removeOpening) showOpening(true);
  else if (!atOpening && removeOpening) void enterCamera();
});

/** Whether this browser can draw the 3D view at all (WebGPU with an adapter, or WebGL2 for the fallback). `navigator.gpu`
 *  exists in browsers that have WebGPU but no usable GPU (score loop r5: with the 3D APIs off the opening showed no warning
 *  and Explore ended on the failure screen), so it is asked for an adapter before it is believed. */
async function canDraw3d(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown | null> } }).gpu;
  if (gpu) {
    try { if (await gpu.requestAdapter()) return true; } catch { /* no adapter: WebGL2 may still do */ }
  }
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return !!gl;
  } catch { return false; }
}

// The address says only what is open: a tour or shot value that names nothing is dropped before anything reads or copies it.
{
  const cleaned = cleanSearch(location.search);
  if (cleaned !== (location.search || '')) history.replaceState(history.state, '', `${location.pathname}${cleaned}${location.hash}`);
}

if (shouldShowPhotoOpening(location.search, location.hash, entered)) {
  showOpening(false);
  // With neither, Explore would only end on the error screen: say so on the opening, and point to the 2D reference
  // (score loop r4; the failure screen already does, after the tap).
  void canDraw3d().then((ok) => {
    if (ok) return;
    document.getElementById('opening-no3d')?.removeAttribute('hidden');
    // Explore the camera would open a workspace with no view and an empty panel (score loop r6): it becomes the way to the 2D
    // story instead. The copy of the button has none of the listener that enters the camera.
    const explore = document.getElementById('opening-explore');
    if (explore) {
      const story = explore.cloneNode(true) as HTMLElement;
      story.querySelector('strong')!.textContent = 'Read the 2D story →';
      story.querySelector('span')!.textContent = 'This browser cannot draw the 3D camera. The story and reference need none.';
      story.addEventListener('click', () => { location.href = './reference.html?page=story'; });
      explore.replaceWith(story);
    }
  });
} else {
  // shot=<id> is the open Play the shot dialog; an older link's photo=<id> also plays the shot, unless the link is
  // to the Real photos view, where photo= names the photograph on show (score loop r2).
  const params = new URLSearchParams(location.search);
  const photos = params.get('view') === 'photos' || location.hash === '#rp-card';
  void enterCamera(params.get('shot') ?? (photos ? null : params.get('photo')) ?? undefined, photos);
}

// A service worker keeps what the page asked for on the device (src/sw/sw-template.js, score loop r5): a return visit, or a visit
// with no network, finds the camera's code and models there. Only in the production build (it is the one that names the worker's
// build: <meta name="p2p-warm-modules"> is written by the same build), and after the page has loaded and the browser is idle, so
// registering it never shares the cold load's bandwidth or its first seconds. Browser automation (navigator.webdriver) does not
// register it unless the address has sw=1: the gates inject failures and go offline on purpose, and a cache answering for the
// network would hide exactly what they test.
if ('serviceWorker' in navigator && document.querySelector('meta[name="p2p-warm-modules"]') && (!navigator.webdriver || new URLSearchParams(location.search).get('sw') === '1')) {
  // Once the worker is active, the page tells it what it has already loaded (the code and models of this visit, which it was not there to
  // cache) and the site's other pages, so the first visit is on the device too, not only the second (score loop r6).
  const handOver = (worker: ServiceWorker | null | undefined) => {
    if (!worker) return;
    const resources = performance.getEntriesByType('resource').map((e) => e.name).filter((n) => { try { return new URL(n).origin === location.origin; } catch { return false; } });
    worker.postMessage({ type: 'precache', resources, pages: [new URL('./', document.baseURI).href, new URL('models.html', document.baseURI).href, new URL('reference.html', document.baseURI).href] });
  };
  const register = () => {
    navigator.serviceWorker.register('./sw.js').then(() => navigator.serviceWorker.ready).then((reg) => handOver(reg.active)).catch(() => { /* the page works without it */ });
  };
  const later = () => (window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 2000)))(register, { timeout: 10000 });
  if (document.readyState === 'complete') later(); else window.addEventListener('load', later, { once: true });
}
