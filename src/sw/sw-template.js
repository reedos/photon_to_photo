// The app's service worker (score loop r5, Performance and reliability). vite.config.ts copies this file to the site root as
// sw.js at build time and replaces __P2P_BUILD__ with a hash of every file the build emitted, so a new build is a new worker
// with a cache of its own. It is a cache of what the page asked for: a first visit downloads exactly what it did before (2.4 MB), and a
// return visit, or a visit with no network at all, finds it on the device. Score loop r6: the first visit's own files were never cached
// (the worker registers after the page has loaded them), so offline right after a first visit gave the browser's error page. Once the worker
// is active the page tells it what it already loaded and which other pages the site has ("precache" message below); the worker takes those
// from the browser's HTTP cache (cache: 'force-cache', so almost no new bytes) and the other pages' own code from the network.
//
//   pages (navigations)      network first (a new build is seen at once), the last good copy when the network is down or slow
//   assets/* (hashed names)  cache first, from any build still kept: a name that changes is a different file
//   models, textures, draco, examples and other unhashed files
//                            cache first, from THIS build's cache only: the GLBs have no hash in their names, so a new build
//                            fetches them again once instead of pairing new code with an old model
//
// The previous build's cache is kept for one more build, so a tab still running that build's code finds its chunks. Nothing
// here caches a failed, partial or cross-origin response.

const BUILD = '__P2P_BUILD__';
const CACHE = `p2p-${BUILD}`;
const INDEX = 'p2p-index';
const NETWORK_WAIT_MS = 4000;

self.addEventListener('install', () => { self.skipWaiting(); });

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const index = await caches.open(INDEX);
    const stored = await index.match('builds');
    const known = stored ? await stored.json().catch(() => ({})) : {};
    const previous = known.current && known.current !== BUILD ? known.current : known.previous;
    await index.put('builds', new Response(JSON.stringify({ current: BUILD, previous: previous ?? null })));
    for (const name of await caches.keys()) {
      if (name.startsWith('p2p-') && name !== INDEX && name !== CACHE && name !== (previous ? `p2p-${previous}` : '')) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

const cacheable = (response) => response && response.ok && response.status === 200 && response.type === 'basic';

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  // one copy of a page whatever its query string: the page reads its own location, so the shell is the same
  const key = new Request(new URL(new URL(request.url).pathname, self.location.origin).href);
  const network = fetch(request).then((response) => {
    if (cacheable(response) && (response.headers.get('content-type') ?? '').includes('text/html')) cache.put(key, response.clone());
    return response;
  });
  network.catch(() => {}); // a network that answers after the copy on the device was used is not an unhandled error
  const copy = await cache.match(key, { ignoreVary: true });
  if (!copy) return network; // first visit: the network, however long it takes
  // with a copy on the device the network gets a few seconds, and a failed network (no connection) gives way at once
  return Promise.race([network, new Promise((resolve) => setTimeout(() => resolve(copy), NETWORK_WAIT_MS))]).catch(() => copy);
}

async function cacheFirst(request, anyBuild) {
  const hit = anyBuild ? await caches.match(request, { ignoreVary: true }) : await (await caches.open(CACHE)).match(request, { ignoreVary: true });
  if (hit) return hit;
  const response = await fetch(request);
  if (cacheable(response)) (await caches.open(CACHE)).put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || request.headers.has('range')) return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') { event.respondWith(networkFirst(request)); return; }
  if (/\/assets\//.test(url.pathname)) { event.respondWith(cacheFirst(request, true)); return; }
  if (/\/(models|draco|examples|media)\//.test(url.pathname) || /\.(glb|wasm|webp|jpe?g|png|svg|json)$/.test(url.pathname)) event.respondWith(cacheFirst(request, false));
});

// ---- the first visit's files (score loop r6) -----------------------------------------------------------------------------------
const pageKey = (url) => new Request(new URL(new URL(url, self.location.href).pathname, self.location.origin).href);
const sameOrigin = (url) => { try { return new URL(url, self.location.href).origin === self.location.origin; } catch { return false; } };

/** Takes one file into this build's cache unless it is there; resolves to its text for the code the caller reads on. */
async function keep(cache, url, wantText) {
  const have = await cache.match(new Request(url), { ignoreVary: true });
  if (have) return wantText ? have.clone().text() : '-';
  const response = await fetch(new Request(url, { cache: 'force-cache' })).catch(() => null);
  if (!cacheable(response)) return '';
  await cache.put(new Request(url), response.clone());
  return wantText ? response.text() : '-';
}

/** A built page and the code it names: the page itself under its shell key, then the scripts and styles in its tags, then what those
 *  scripts import (the built chunks name each other with relative paths), to a few levels. */
async function keepPage(cache, url) {
  const response = await fetch(new Request(url, { cache: 'no-cache' })).catch(() => null);
  if (!cacheable(response) || !(response.headers.get('content-type') ?? '').includes('text/html')) return;
  await cache.put(pageKey(url), response.clone());
  const html = await response.text();
  const base = new URL(url, self.location.href);
  const seen = new Set();
  const visit = async (href, depth) => {
    const abs = new URL(href, base).href;
    if (seen.has(abs) || !sameOrigin(abs) || !/\/assets\//.test(abs)) return;
    seen.add(abs);
    const isScript = /\.js(\?|$)/.test(abs) && depth < 4;
    const text = await keep(cache, abs, isScript);
    if (!isScript || !text) return;
    for (const m of text.matchAll(/(?:from\s*|import\s*\(\s*|import\s*)["'](\.{1,2}\/[^"']+\.js)["']/g)) await visit(new URL(m[1], abs).href, depth + 1);
  };
  for (const m of html.matchAll(/(?:src|href)=["']([^"']*\/assets\/[^"']+)["']/g)) await visit(m[1], 0);
}

async function precache(resources, pages) {
  const cache = await caches.open(CACHE);
  for (const url of resources) if (sameOrigin(url) && !/\/sw\.js(\?|$)/.test(url)) await keep(cache, url, false);
  for (const url of pages) if (sameOrigin(url)) await keepPage(cache, url);
}

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'precache' || !Array.isArray(data.resources) || !Array.isArray(data.pages)) return;
  event.waitUntil(precache(data.resources.slice(0, 200), data.pages.slice(0, 8)).catch(() => {}));
});
