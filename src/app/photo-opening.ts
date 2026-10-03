import { siteNavigation } from './site-nav';

/** Only an unaddressed first visit gets the invitation. Every existing deep link wins. */
export function shouldShowPhotoOpening(search: string, hash: string, entered: boolean): boolean {
  return !search && (!hash || hash === '#top') && !entered;
}

export function mountPhotoOpening(enter: (photoId?: string) => Promise<void>): () => void {
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
  photo.src = 'examples/flycatcher.jpg';
  nav.innerHTML = siteNavigation('opening');
  nav.querySelector<HTMLAnchorElement>('[data-return-view]')!.href = '#stage-section';
  menu.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    menu.setAttribute('aria-expanded', String(open));
  }, options);
  document.getElementById('opening-follow')!.addEventListener('click', () => void enter('flycatcher'), options);
  document.getElementById('opening-explore')!.addEventListener('click', () => void enter(), options);
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
