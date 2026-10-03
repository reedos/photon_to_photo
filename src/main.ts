// The first photograph paints before the camera renderer or physics bundles are loaded.
import { mountPhotoOpening, shouldShowPhotoOpening } from './app/photo-opening';
import examplesFile from '../public/examples/examples.json';

let entered = false;
try { entered = sessionStorage.getItem('p2p.entered') === '1' || sessionStorage.getItem('p2p.return') !== null; } catch { /* Direct links still work without storage. */ }

let starting: Promise<void> | undefined;
let removeOpening: (() => void) | undefined;
function enterCamera(photoId?: string): Promise<void> {
  return starting ??= (async () => {
    removeOpening?.();
    document.body.classList.remove('entry-pending', 'photo-opening-active');
    document.getElementById('photo-opening')!.hidden = true;
    document.getElementById('top')!.hidden = false;
    try {
      const { startApp, showStartupFailure } = await import('./app-start');
      try { await startApp(); } catch (error) { showStartupFailure(error); return; }
      try { sessionStorage.setItem('p2p.entered', '1'); } catch { /* Optional session convenience. */ }
      const example = examplesFile.examples.find(photo => photo.id === photoId);
      if (example) {
        const { emit } = await import('./app/bus');
        emit('play-photo', { example, source: document.querySelector<HTMLElement>('.shot-launch')! });
      } else if (!location.hash || location.hash === '#stage-section') {
        document.getElementById('gl')?.focus({ preventScroll: true });
      }
    } catch (error) {
      console.error('main.ts: failed to load the camera', error);
      const veil = document.getElementById('veil')!;
      veil.classList.remove('off'); veil.classList.add('err');
      document.getElementById('veil-msg')!.textContent = 'The camera could not load. Reload to try again.';
      document.getElementById('veil-reload')!.onclick = () => location.reload();
    }
  })();
}

if (shouldShowPhotoOpening(location.search, location.hash, entered)) {
  removeOpening = mountPhotoOpening(photo => enterCamera(photo));
} else {
  void enterCamera(new URLSearchParams(location.search).get('photo') ?? undefined);
}
