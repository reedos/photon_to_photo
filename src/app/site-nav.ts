import '../styles/site-nav.css';

const pages = ['story', 'evidence', 'method', 'glossary', 'parts'] as const;
const names = { story: 'The story', evidence: 'Evidence', method: 'Method', glossary: 'Glossary', parts: 'Parts' };

export function siteNavigation(current = 'visualizer'): string {
  return `<a class="navlink" href="${current === 'visualizer' ? '#stage-section' : './index.html?piece=camera'}" data-return-view ${current === 'visualizer' ? 'aria-current="page"' : ''}>Visualizer</a>`
    + pages.map(page => `<a class="navlink" href="./reference.html?page=${page}" ${current === page ? 'aria-current="page"' : ''}>${names[page]}</a>`).join('')
    + `<a class="navlink" href="./models.html" ${current === 'models' ? 'aria-current="page"' : ''}>Models</a>`;
}

/** Reference pages return to the same shot, while the menu uses the reference site's dismissal behavior. */
export function mountSiteNavigation(workspace = false): void {
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
      if (query?.startsWith('?')) document.querySelectorAll<HTMLAnchorElement>('[data-return-view]').forEach(a => a.href = './index.html' + query);
    } catch { /* use the default view */ }
  }
}
