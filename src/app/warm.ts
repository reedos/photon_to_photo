// Warming the camera while the opening is on screen (score loop r3, Performance and reliability, 10/11/2026).
//
// The opening paints the first photograph without loading the 3D stack, so a tap on "Explore the camera" used to start
// every download from nothing: about 7 s on fast 4G and 16 s on slow 4G before a mid-range phone could use the camera.
// Once the opening's photograph has loaded and the browser is idle, this module:
//   - adds <link rel="modulepreload"> for app-start and the chunks it imports (the list is written into index.html at
//     build time by vite.config.ts, as <meta name="p2p-warm-modules">), so the code is fetched and compiled but not run;
//   - fetches the default kit's GLBs and the Draco decoder at low priority and keeps the bytes in memory, where the
//     loaders take them (takePrefetched). Holding the bytes, rather than relying on the HTTP cache, also works when the
//     cache is off or the server sends no-cache;
//   - warms the two normal-map images through the document's image cache.
// It does nothing with Save-Data or on a 2G or 3G connection, and nothing in the dev server (no module list). And it
// waits for a sign that someone is there (a pointer, a touch, a scroll, a key or focus; score loop r4): the opening used to
// pull about 2.5 MB as soon as it was idle, for a reader who then left without a tap.
// This module imports nothing, so the opening's entry chunk stays small.

/** A lens file's phone variant on a phone-width screen (score loop r6): lens_v2.py --lite writes <id>.lite.glb for every lens
 *  (lens-lite.test.ts), so the path alone says it, and this module still imports nothing (src/app/lens-file.ts is the same
 *  choice for the loaders, which already carry the lens facts). */
const phoneLens = (url: string) => (typeof matchMedia === 'function' && matchMedia('(max-width: 760px)').matches ? url.replace(/^(models\/lenses\/[^/.]+)\.glb$/, '$1.lite.glb') : url);

const buffers = new Map<string, Promise<ArrayBuffer>>();
const images: HTMLImageElement[] = [];

const abs = (url: string) => new URL(url, location.href).href;

/** Starts a low-priority fetch of `url` and keeps its bytes for the next loader that asks (once). */
export function prefetchBuffer(url: string): void {
  const key = abs(url);
  if (buffers.has(key)) return;
  const p = fetch(key, { priority: 'low' } as RequestInit).then(r => {
    if (!r.ok) throw new Error(`warm.ts: ${key} answered ${r.status}`);
    return r.arrayBuffer();
  });
  p.catch(() => buffers.delete(key)); // a failed prefetch is forgotten; the loader then fetches as usual
  buffers.set(key, p);
}

/** A lens's GLB has two readers: the camera rig, and the Optics level's barrel (score loop r5: the second one fetched the file
 *  again, 0.3 to 0.5 MB, when the level was built ahead). The bytes are handed over twice, then the map lets go of them. */
const taken = new Set<string>();

/** The prefetched bytes of `url`, handed over to its first and second reader (the map lets go of them after that), or undefined
 *  when none were fetched. */
export function takePrefetched(url: string): Promise<ArrayBuffer> | undefined {
  const key = abs(url);
  const p = buffers.get(key);
  if (!p) return undefined;
  if (taken.delete(key)) buffers.delete(key);
  else {
    taken.add(key);
    // a file with no second reader (the camera body, the decoder) is not kept for ever
    setTimeout(() => { if (taken.delete(key)) buffers.delete(key); }, 60000);
  }
  return p;
}

/** The default kit: the scenario a first visit opens with (engine-api DEFAULT_SCENARIO; warm.test.ts checks it). */
export const WARM_ASSETS = {
  buffers: ['models/dslr.glb', 'models/lenses/n50.glb', 'draco/draco_wasm_wrapper.js', 'draco/draco_decoder.wasm'],
  images: ['models/textures/leatherette-normal.webp', 'models/textures/paint-normal.webp'],
};

interface NetworkInformationLike { saveData?: boolean; effectiveType?: string }

/** Whether the connection asks for no speculative downloads: Save-Data, and 3G or slower, where 2.5 MB of a guess is
 *  minutes of a reader's data and shares the link with what they asked for. */
export function shouldWarm(connection: NetworkInformationLike | undefined): boolean {
  if (!connection) return true;
  if (connection.saveData) return false;
  return !/(^|-)[23]g$/.test(connection.effectiveType ?? '');
}

interface ConnectionLike extends NetworkInformationLike { effectiveType?: string; type?: string }
const currentConnection = () => (navigator as Navigator & { connection?: ConnectionLike }).connection;

/** Whether a guess at what the reader asks for next may be fetched: only on a connection that reports 4G, without Save-Data
 *  and not over a cellular network (score loop r5: 3.1 MB of lenses went to every 4G phone on mobile data, on top of the cold
 *  load, for readers who may never swap). A browser with no connection API (Safari, Firefox) fetches nothing. */
export function mayGuess(connection: ConnectionLike | undefined = currentConnection()): boolean {
  return !!connection && !connection.saveData && connection.effectiveType === '4g' && connection.type !== 'cellular';
}

/** Fetches `urls` one at a time, a pause between each, at low priority, into the same in-memory store the loaders read.
 *  Only where mayGuess allows. The camera passes the one swap a reader is most likely to make next (about 0.4 MB); the others
 *  are fetched when the reader shows interest in one (prefetchOnIntent). */
export function prefetchNeighbours(urls: string[], connection: ConnectionLike | undefined = currentConnection()): void {
  if (!mayGuess(connection)) return;
  const queue = urls.filter((u) => !buffers.has(abs(u)));
  const next = () => {
    const url = queue.shift();
    if (!url) return;
    if (!document.hidden && !document.querySelector('dialog[open]')) prefetchBuffer(url);
    else queue.unshift(url);
    window.setTimeout(() => (window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 0)))(next, { timeout: 4000 }), 1500);
  };
  window.setTimeout(next, 5000);
}

/** Fetches a lens's files when the reader points at, touches or focuses its button (`[data-lens]`): a swap that was going to
 *  be asked for finds them in memory, and one that never is costs no bytes. `urlsFor` names the files a lens needs. Returns a
 *  function that stops listening. */
export function prefetchOnIntent(urlsFor: (lensId: string) => string[], target: EventTarget = document, connection: ConnectionLike | undefined = currentConnection()): () => void {
  if (!mayGuess(connection)) return () => {};
  const seen = new Set<string>();
  const onIntent = (event: Event) => {
    const el = (event.target as Element | null)?.closest?.('[data-lens]') as HTMLElement | null;
    const id = el?.dataset.lens;
    if (!id || seen.has(id)) return;
    seen.add(id);
    for (const url of urlsFor(id)) prefetchBuffer(url);
  };
  const names = ['pointerover', 'focusin', 'touchstart'];
  for (const name of names) target.addEventListener(name, onIntent, { capture: true, passive: true });
  return () => { for (const name of names) target.removeEventListener(name, onIntent, { capture: true }); };
}

const SIGNS = ['pointerdown', 'pointermove', 'touchstart', 'wheel', 'scroll', 'keydown', 'focusin'];
/** Calls `go` once, at the first pointer, touch, scroll, key or focus event: someone is reading the opening. Returns a
 *  function that stops listening. (A tap on Explore is itself a sign, and starts the real load at once.) */
export function whenReaderIsHere(go: () => void, target: EventTarget = window): () => void {
  let done = false;
  const stop = () => { for (const name of SIGNS) target.removeEventListener(name, fire, true); };
  function fire() { if (done) return; done = true; stop(); go(); }
  for (const name of SIGNS) target.addEventListener(name, fire, { capture: true, passive: true });
  return stop;
}

let warmed = false;
/** Warms the camera once the opening's photograph has loaded and the main thread is idle. */
export function warmCameraWhenIdle(photo: HTMLImageElement): void {
  if (warmed) return;
  warmed = true;
  if (!shouldWarm((navigator as Navigator & { connection?: NetworkInformationLike }).connection)) return;
  const modules = document.querySelector<HTMLMetaElement>('meta[name="p2p-warm-modules"]')?.content.split(/\s+/).filter(Boolean) ?? [];
  if (!modules.length) return; // the dev server serves unbundled modules: nothing to name ahead
  const go = () => {
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 200));
    idle(() => {
      for (const href of modules) {
        const link = document.createElement('link');
        link.rel = 'modulepreload'; link.href = href; link.setAttribute('fetchpriority', 'low');
        document.head.append(link);
      }
      for (const url of WARM_ASSETS.buffers) prefetchBuffer(phoneLens(url));   // a phone gets the lens's lighter file (score loop r6)
      for (const url of WARM_ASSETS.images) {
        // TextureLoader loads through an <img> with crossOrigin 'anonymous'; the same mode lets it reuse this one
        const img = new Image(); img.crossOrigin = 'anonymous'; img.decoding = 'async'; img.src = url;
        images.push(img);
      }
    }, { timeout: 3000 });
  };
  // the photograph has loaded, a reader is there, and the browser is idle
  const ready = () => whenReaderIsHere(go);
  if (photo.complete) ready();
  else {
    photo.addEventListener('load', ready, { once: true });
    photo.addEventListener('error', ready, { once: true });
  }
}
