import '../styles/site-nav.css';

const pages = ['story', 'evidence', 'method', 'glossary', 'parts'] as const;
const names = { story: 'The story', evidence: 'Evidence', method: 'Method', glossary: 'Glossary', parts: 'Parts' };

/** The page every page's brand leads to: the opening and its three ways in (score loop r4: the brand went to the
 *  opening, the story and the camera depending on the page). */
export const OPENING_HREF = './index.html?start=1';

/** The mount each lineup lens fits, so the Models link can open the reader's own camera without loading the engine
 *  (site-nav.test.ts holds this to engine-api's LINEUP). */
export const LENS_BODY: Record<string, 'dslr' | 'mirrorless'> = { s35: 'dslr', n50: 'dslr', n500: 'dslr', n500fl: 'dslr', z35: 'mirrorless', m50: 'mirrorless', z800: 'mirrorless' };

/** The Models page for a lens: the body and lens the reader has set carry over (score loop r4: the link always opened
 *  the DSLR with the 50 mm). A lens with no 3D model (the free-form primes) keeps the page's own default. */
export function modelsHref(lens: string | null | undefined): string {
  const body = lens ? LENS_BODY[lens] : undefined;
  return body ? `./models.html?body=${body}&lens=${lens}&view=outside` : './models.html';
}

/** Points the Models link of the site bar at the reader's lens. */
export function setModelsLink(lens: string | null | undefined): void {
  const href = modelsHref(lens);
  document.querySelectorAll<HTMLAnchorElement>('#topnav a[href^="./models.html"]').forEach(a => a.setAttribute('href', href));
}

/** The site's sections. Every page leads with Start here, the opening's three ways in: the camera workspace opens them
 *  as a dialog (start-here.ts adds that button), and every other page links to the opening (score loop r2: the
 *  reference and models pages had no way back to it). */
export function siteNavigation(current = 'visualizer'): string {
  const start = current === 'visualizer' ? ''
    : `<a class="navlink start-entry" href="${current === 'opening' ? '#photo-opening' : './index.html?start=1'}" ${current === 'opening' ? 'aria-current="page"' : ''}>Start here</a>`;
  return start + `<a class="navlink" href="${current === 'visualizer' ? '#stage-section' : './index.html?piece=camera'}" data-return-view ${current === 'visualizer' ? 'aria-current="page"' : ''}>The camera</a>`
    + pages.map(page => `<a class="navlink" href="./reference.html?page=${page}" ${current === page ? 'aria-current="page"' : ''}>${names[page]}</a>`).join('')
    + `<a class="navlink" href="./models.html" ${current === 'models' ? 'aria-current="page"' : ''}>Models</a>`;
}

let menuFocusInstalled = false;
/** The phone and tablet menu is a panel that drops over the page from the header. Its links come before the Menu
 *  button in the DOM, so Tab from the open menu's button went on into the page under the panel, and the links were
 *  reached only backwards with Shift+Tab (score loop r3, WCAG 2.4.3 and 2.4.11). While it is open, focus moves to its
 *  first link, Tab cycles through the links and the button, and the rest of the page is inert. Escape and the button
 *  close it and return focus to the button, as before. Every page's own open/close code only sets aria-expanded, so
 *  this follows that attribute. */
export function installMenuFocus(): void {
  if (menuFocusInstalled) return;
  const nav = document.getElementById('topnav'), menu = document.getElementById('menu-btn');
  const header = menu?.closest('header');
  if (!nav || !menu || !header) return;
  menuFocusInstalled = true;
  let madeInert: HTMLElement[] = [];
  const items = () => [...nav.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)')].filter(item => item.checkVisibility());
  new MutationObserver(() => {
    const open = menu.getAttribute('aria-expanded') === 'true' && menu.checkVisibility();
    if (open && !madeInert.length) {
      // The page's one main landmark and its h1 stay out of the inert region, with the path between them and the body: only
      // their other contents go inert (score loop r5: with the whole of main inert, axe's landmark-one-main and
      // page-has-heading-one failed on every page with the menu open). The h1 is not interactive, so it takes no focus.
      const keep = [...document.querySelectorAll('h1')].find(h => h.checkVisibility()) ?? null;
      const collect = (parent: Element): HTMLElement[] => [...parent.children].flatMap((node): HTMLElement[] => {
        if (!(node instanceof HTMLElement) || node === header || node.contains(header) || node.inert || node.tagName === 'SCRIPT') return [];
        return keep && node !== keep && node.contains(keep) ? collect(node) : keep && node === keep ? [] : [node];
      });
      madeInert = collect(document.body);
      madeInert.forEach(node => { node.inert = true; });
      if (!document.activeElement || document.activeElement === document.body || header.contains(document.activeElement)) items()[0]?.focus();
    } else if (!open && madeInert.length) {
      madeInert.forEach(node => { node.inert = false; });
      madeInert = [];
    }
  }).observe(menu, { attributes: true, attributeFilter: ['aria-expanded'] });
  header.addEventListener('keydown', event => {
    if (event.key !== 'Tab' || menu.getAttribute('aria-expanded') !== 'true' || !menu.checkVisibility()) return;
    const list = items();
    if (!list.length) return;
    const active = document.activeElement;
    let next: HTMLElement | null = null;
    if (!event.shiftKey && active === menu) next = list[0];
    else if (!event.shiftKey && active === list[list.length - 1]) next = menu;
    else if (event.shiftKey && active === list[0]) next = menu;
    else if (event.shiftKey && active === menu) next = list[list.length - 1];
    if (next) { event.preventDefault(); next.focus(); }
  });
}

/** Reference pages return to the same shot, while the menu uses the reference site's dismissal behavior. */
export function mountSiteNavigation(workspace = false): void {
  installMenuFocus();
  const nav = document.getElementById('topnav')!;
  const menu = document.getElementById('menu-btn')!;
  const close = (focus = false) => {
    nav.classList.remove('open'); menu.setAttribute('aria-expanded', 'false');
    if (focus) menu.focus();
  };
  if (!workspace) menu.addEventListener('click', () => {
    const open = nav.classList.toggle('open'); menu.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', event => {
    const target = event.target as Element;
    if (!target.closest('#topnav, #menu-btn')) close();
    const link = target.closest<HTMLAnchorElement>('a');
    if (workspace && /(?:reference|models)\.html/.test(link?.getAttribute('href') ?? '')) {
      try { sessionStorage.setItem('p2p.return', location.search); } catch { /* storage may be disabled */ }
    }
    if (target.closest('#topnav a')) close();
    const more = document.querySelector<HTMLDetailsElement>('.view-menu');
    if (more?.open && (!target.closest('.view-menu') || target.closest('.view-menu button, .view-menu a'))) more.open = false;
  });
  window.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (nav.classList.contains('open')) { event.stopImmediatePropagation(); close(true); }
    const more = document.querySelector<HTMLDetailsElement>('.view-menu');
    if (more?.open) { event.stopImmediatePropagation(); more.open = false; more.querySelector<HTMLElement>('summary')!.focus(); }
  }, true);
  if (!workspace) {
    try {
      const query = sessionStorage.getItem('p2p.return') || '?piece=camera';
      if (query?.startsWith('?')) {
        document.querySelectorAll<HTMLAnchorElement>('[data-return-view]').forEach(a => a.href = './index.html' + query);
        // the Models link opens the camera the reader was using, not the default one (score loop r4)
        if (!document.querySelector('#topnav a[href^="./models.html"][aria-current="page"]')) setModelsLink(new URLSearchParams(query).get('lens'));
      }
    } catch { /* use the default view */ }
  }
}
