import catalog from 'virtual:p2p-facts/examples';
import { installMenuFocus, siteNavigation } from './site-nav';
import { exampleSrcset } from './image-variants';
import { warmCameraWhenIdle } from './warm';

/** Only an unaddressed first visit gets the invitation. Every existing deep link wins. */
export function shouldShowPhotoOpening(search: string, hash: string, entered: boolean): boolean {
  // Start here (site-nav.ts) and the workspace's brand ask for the opening by name, even after a visit (score loop r2).
  if (new URLSearchParams(search).get('start') === '1') return true;
  const addressed = [...new URLSearchParams(search).keys()].some(key => key !== 'v');
  return !addressed && (!hash || hash === '#top') && !entered;
}

/** Shows the opening. `again` is a return to it with Back after the workspace has started: the workspace's own
 *  site navigation and menu stay in charge, and only the opening's choices are wired. */
export function mountPhotoOpening(enter: (photoId?: string, photos?: boolean) => Promise<void>, again = false): () => void {
  installMenuFocus();
  const opening = document.getElementById('photo-opening')!;
  const nav = document.getElementById('topnav')!;
  const menu = document.getElementById('menu-btn')!;
  const controller = new AbortController();
  const options = { signal: controller.signal };
  document.body.classList.remove('entry-pending');
  document.body.classList.add('photo-opening-active');
  document.getElementById('top')!.hidden = true;
  opening.hidden = false;
  const photo = document.getElementById('opening-photo') as HTMLImageElement;
  // the picture is at most about 700 px wide (the opening grid's photo column; the full width less 40 px on a phone)
  photo.sizes = '(max-width: 760px) calc(100vw - 40px), 700px';
  photo.srcset = exampleSrcset(catalog.examples[0].image);
  photo.src = `examples/${catalog.examples[0].image}`;
  // a request that fails leaves the frame, neutral and with a line saying so, in place of a broken-image icon (score loop r5)
  photo.addEventListener('error', () => photo.closest('figure')?.classList.add('photo-failed'), options);
  // while the reader looks at the photograph, the camera's code and default models download (score loop r3)
  if (!again) warmCameraWhenIdle(photo);
  document.getElementById('opening-follow')!.addEventListener('click', () => void enter('flycatcher'), options);
  document.getElementById('opening-explore')!.addEventListener('click', () => void enter(), options);
  document.getElementById('opening-photos')!.addEventListener('click', () => void enter(undefined, true), options);
  if (again) {
    // The workspace's own The camera link (data-return-view) leads back in.
    nav.addEventListener('click', event => {
      if ((event.target as Element).closest('a[data-return-view]')) { event.preventDefault(); event.stopPropagation(); void enter(); }
    }, { ...options, capture: true });
    document.getElementById('opening-title')?.scrollIntoView({ block: 'start' });
    // Back from the workspace shows the opening under the workspace's own bar: it names Start here as the current
    // place, not The camera, until the reader goes back in (score loop r3).
    const camera = nav.querySelector('[data-return-view]'), start = nav.querySelector('.start-entry');
    const wasCurrent = camera?.getAttribute('aria-current');
    camera?.removeAttribute('aria-current'); start?.setAttribute('aria-current', 'page');
    // the tab's title names the opening while it shows, and the workspace's own title returns with the workspace (score loop r4)
    const workspaceTitle = document.title;
    document.title = 'Photon to Photo';
    return () => {
      controller.abort();
      document.title = workspaceTitle;
      start?.removeAttribute('aria-current');
      if (wasCurrent) camera?.setAttribute('aria-current', wasCurrent);
    };
  }
  nav.innerHTML = siteNavigation('opening');
  nav.querySelector<HTMLAnchorElement>('[data-return-view]')!.href = '#stage-section';
  menu.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    menu.setAttribute('aria-expanded', String(open));
  }, options);
  nav.addEventListener('click', event => {
    const anchor = (event.target as Element).closest<HTMLAnchorElement>('a');
    if (anchor?.hasAttribute('data-return-view')) { event.preventDefault(); void enter(); }
  }, options);
  document.addEventListener('click', event => {
    if (!(event.target as Element).closest('#topnav, #menu-btn')) {
      nav.classList.remove('open'); menu.setAttribute('aria-expanded', 'false');
    }
  }, options);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && nav.classList.contains('open')) {
      nav.classList.remove('open'); menu.setAttribute('aria-expanded', 'false'); menu.focus();
    }
  }, options);
  return () => { controller.abort(); nav.classList.remove('open'); menu.setAttribute('aria-expanded', 'false'); };
}
