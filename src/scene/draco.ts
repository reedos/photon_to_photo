// One Draco decoder for the whole page: the camera rig, the lens housings, the Models page and the body preview all
// decode through it, so the page runs one worker pool and fetches the decoder (public/draco/) once. The bodies are
// Draco-compressed like the lenses since score loop r1 (10/11/2026). vite.config.ts drops three's bundled default
// decoder copies, which this path always replaces.
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { takePrefetched } from '../app/warm';

let shared: DRACOLoader | null = null;

export function dracoLoader(): DRACOLoader {
  if (!shared) {
    const draco = new DRACOLoader().setDecoderPath(new URL('./draco/', location.href).href);
    // The decoder files the opening fetched ahead (src/app/warm.ts) are used from memory (score loop r3).
    // _loadLibrary(url, responseType) is DRACOLoader's one file-loading method (three r186).
    // Its urls are already resolved against the decoder path.
    const lib = draco as unknown as { _loadLibrary(url: string, type: string): Promise<string | ArrayBuffer> };
    const fetchLibrary = lib._loadLibrary.bind(draco);
    lib._loadLibrary = (url, type) => {
      const ahead = takePrefetched(url);
      if (!ahead) return fetchLibrary(url, type);
      return ahead.then(buf => (type === 'text' ? new TextDecoder().decode(buf) : buf), () => fetchLibrary(url, type));
    };
    shared = draco;
  }
  return shared;
}
