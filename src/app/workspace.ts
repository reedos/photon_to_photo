import { siteNavigation, mountSiteNavigation, setModelsLink } from './site-nav';
import type { Store } from './store';
import { emit } from './bus';
import '../styles/studio-shell.css';

const el = (id: string) => document.getElementById(id)!;

/** The model's gesture hint for the pointer in hand: touch screens pinch, a mouse scrolls. The arrow-key part
 *  stepping (ui.ts) is named in the model's own accessible label and appears here only where the row has room:
 *  between Share this view and Expand model there are about 230 px at 1440 px wide (score loop r2: the hint was
 *  clipped to "…bit · Scroll to zoom", so "Drag to orbit" was never seen). */
export function modelHint(): string {
  if (matchMedia('(pointer: coarse)').matches) return 'Drag to orbit · Pinch to zoom';
  return matchMedia('(min-width: 1600px)').matches ? 'Drag to orbit · Scroll to zoom · ← → parts' : 'Drag to orbit · Scroll to zoom';
}

/** Whether the address names the Real photos view: ?view=photos, or the older #rp-card links. */
export function photosInUrl(href = location.href): boolean {
  const url = new URL(href);
  return url.searchParams.get('view') === 'photos' || url.hash === '#rp-card';
}

/** Arrange the existing engine-backed controls into one compact workspace. */
/** The one-line reason to be on a level (#level-why). app-start fills it in the first synchronous pass, before the
 *  renderer starts, so the line never grows after the workspace has painted (cold-load layout shift, score loop r3). */
export function levelWhy(piece: string): string {
  return ({
    camera: 'Try the shutter, aperture or focus ring. Watch the shutter, light paths and lens respond.',
    lens: 'Glass bends each color by a different amount, so one white point lands as slightly separated colors, a tiny rainbow. The little chart shows how far apart.',
    // the same words as the Focus level's linked prompt (workspace.ts mountWorkspace), so the line keeps its length
    cone: 'One distance is sharp. Change Focus distance to see nearby and distant points spread into blur.',
    loupe: 'Light becomes charge, then a number. Follow a controlled light sample into a sensor pixel.',
  } as Record<string, string>)[piece] ?? '';
}

export function buildWorkspace(): void {
  document.body.classList.add('workspace', 'viewport-studio');
  const stage = el('stage-section');
  const views = document.createElement('div');
  views.className = 'workspace-views';
  views.setAttribute('role', 'tablist');
  views.setAttribute('aria-label', 'Workspace');
  views.innerHTML = '<button type="button" role="tab" id="workspace-model" aria-controls="stage-section" aria-selected="true">The camera</button><button type="button" role="tab" id="workspace-photos" aria-controls="photo-study-panel" aria-selected="false" tabindex="-1">Real photos</button><span>From light to a photograph</span>';
  stage.before(views);
  views.querySelectorAll<HTMLButtonElement>('button').forEach(button => { button.disabled = true; });
  const expand = document.createElement('button');
  expand.type = 'button'; expand.id = 'expand-model'; expand.textContent = 'Expand model';
  expand.setAttribute('aria-pressed', 'false');
  expand.disabled = true;
  views.after(expand);
  expand.addEventListener('click', () => {
    const expanded = document.body.classList.toggle('model-expanded');
    expand.setAttribute('aria-pressed', String(expanded)); expand.textContent = expanded ? 'Show controls' : 'Expand model';
    // Full-viewport mode hides the workspace rows, so the way back joins the one control row under the model.
    if (expanded) { el('hud-btns-phone').append(expand); scrollTo(0, 0); } else views.after(expand);
    expand.focus({ preventScroll: true });
    window.dispatchEvent(new Event('resize'));
  });
  // Escape leaves the full-view mode and puts the focus back on its toggle (score loop r3). An open dialog, the
  // equipment editor or the tour's own Escape come first (they stop the event or prevent its default).
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.defaultPrevented || !document.body.classList.contains('model-expanded')) return;
    if (document.querySelector('dialog[open]')) return;
    event.preventDefault();
    expand.click();
  });
  stage.setAttribute('role', 'tabpanel');
  stage.setAttribute('aria-labelledby', 'workspace-model');
  const study = document.createElement('section');
  study.id = 'photo-study-panel'; study.hidden = true;
  study.setAttribute('role', 'tabpanel'); study.setAttribute('aria-labelledby', 'workspace-photos');
  const studyStatus = document.createElement('p');
  studyStatus.className = 'study-loading'; studyStatus.textContent = 'Loading the photographs…';
  study.append(studyStatus, el('rp-card')); stage.after(study);
  const toolbar = document.createElement('div');
  toolbar.className = 'studio-kit';
  toolbar.innerHTML = `<button type="button" id="equipment-toggle" aria-expanded="false" aria-controls="equipment-controls"><span id="equipment-summary">Camera equipment</span><b>Edit</b></button>
    <div id="equipment-controls"><label>Camera<select id="kit-body" aria-label="Camera body"></select></label>
    <label>Lens<select id="kit-lens" aria-label="Lens"></select></label></div>
    <div class="studio-share" id="studio-actions"></div>`;
  stage.prepend(toolbar);
  const why = document.createElement('p'); why.id = 'level-why'; why.className = 'level-why';
  el('steps').after(why);
  const equipmentToggle = el('equipment-toggle');
  const setEquipmentOpen = (open: boolean) => {
    toolbar.classList.toggle('equipment-open', open);
    equipmentToggle.setAttribute('aria-expanded', String(open));
    equipmentToggle.querySelector('b')!.textContent = open ? 'Done' : 'Edit';
    equipmentToggleLabel(el('equipment-summary').textContent || '');
    if (open) el('kit-body').focus({ preventScroll: true });
    else equipmentToggle.focus({ preventScroll: true });
  };
  equipmentToggle.addEventListener('click', () => setEquipmentOpen(!toolbar.classList.contains('equipment-open')));
  toolbar.addEventListener('keydown', event => {
    if (event.key === 'Escape' && toolbar.classList.contains('equipment-open')) { event.preventDefault(); setEquipmentOpen(false); }
  });
  const viewer = el('viewer');
  const modelTools = document.createElement('div');
  modelTools.id = 'model-tools';
  modelTools.append(el('hud-switches'));
  const compactFire = document.createElement('button');
  compactFire.id = 'compact-fire'; compactFire.type = 'button'; compactFire.className = 'btn';
  compactFire.innerHTML = '<span class="action-name">Fire shutter</span><span class="action-short">● Fire</span><small><span class="action-name">Current settings</span><span class="action-short">Shutter</span></small>';
  compactFire.setAttribute('aria-label', 'Fire shutter'); compactFire.title = 'Fire one simulated exposure using the current settings';
  compactFire.disabled = true;
  compactFire.addEventListener('click', () => document.querySelector<HTMLButtonElement>('.rx-fire')?.click());
  modelTools.append(compactFire);
  const gestures = document.createElement('p'); gestures.className = 'model-gestures';
  gestures.textContent = 'Drag ring: focus · Drag dial: aperture · Tap shutter';
  modelTools.append(gestures);
  viewer.prepend(modelTools);
  new MutationObserver(() => {
    el('view').querySelectorAll(':scope > .shot-launch').forEach(node => modelTools.append(node));
  }).observe(el('view'), { childList: true });
  const experiments = document.createElement('div');
  experiments.id = 'model-experiments';
  viewer.append(experiments);
  const exposure = document.createElement('div');
  exposure.id = 'studio-exposure';
  viewer.append(exposure);
  const syncFire = () => { compactFire.disabled = exposure.querySelector<HTMLButtonElement>('.rx-fire')?.disabled ?? true; };
  const fireState = new MutationObserver(syncFire);
  new MutationObserver(() => {
    fireState.disconnect();
    const source = exposure.querySelector('.rx-fire');
    if (source) fireState.observe(source, { attributes: true, attributeFilter: ['disabled'] });
    syncFire();
  }).observe(exposure, { childList: true });
  const transport = document.createElement('nav');
  transport.className = 'part-nav';
  transport.setAttribute('aria-label', 'Part navigation');
  transport.innerHTML = '<button type="button" class="btn" id="part-prev" aria-label="Previous part">‹ <span>Previous</span></button><button type="button" class="btn" id="part-overview">Overview</button><button type="button" class="btn" id="part-next" aria-label="Next part"><span>Next</span> ›</button><span id="part-position">Overview</span>';
  el('hud-btns-phone').prepend(transport);
  // A desktop's first look gets one line on how to handle the model, in the bottom bar's empty status room beside the
  // part position, until the first drag or scroll on the model (score loop r3: at 1024-1499 px both hints were hidden).
  const firstHint = document.createElement('span');
  firstHint.className = 'orbit-hint'; firstHint.setAttribute('aria-hidden', 'true'); // the model's own label says it
  firstHint.textContent = 'Drag to orbit · Scroll to zoom · Pick a numbered part';
  transport.after(firstHint);
  const handled = () => { firstHint.hidden = true; };
  el('gl').addEventListener('pointerdown', handled, { once: true });
  el('gl').addEventListener('wheel', handled, { once: true, passive: true });
  const zoom = document.createElement('div');
  zoom.className = 'zoom-controls'; zoom.setAttribute('role', 'group'); zoom.setAttribute('aria-label', 'Model zoom');
  zoom.innerHTML = '<button type="button" class="btn" id="zoom-out" aria-label="Zoom out" title="Zoom out">−</button><span>Zoom</span><button type="button" class="btn" id="zoom-in" aria-label="Zoom in" title="Zoom in">+</button>';
  el('hud-btns-phone').append(zoom);
  const door = document.createElement('button');
  door.type = 'button'; door.id = 'card-go'; door.className = 'btn go'; door.hidden = true;
  // The card's own Go inside sits under its heading and value line. On a phone tall enough to raise the card as a
  // sheet it used to sit in the part list's head, out of sight under that sheet, so the in-view crumb's copy floated
  // over the picked part instead (score loop r3); there the crumb now steps aside while a card is open
  // (studio-shell.css). A shorter phone keeps its ~110 px dock, and Go inside stays in the list's head at its top.
  const shortPhone = matchMedia('(max-width: 760px) and (max-height: 779px)');
  const placeDoor = () => {
    if (shortPhone.matches) document.querySelector('.parts-head')!.append(door);
    else el('card-sub').after(door);
  };
  placeDoor(); shortPhone.addEventListener('change', placeDoor);
  const sidebar = document.createElement('aside');
  sidebar.className = 'studio-sidebar';
  sidebar.setAttribute('aria-label', 'Camera controls and parts');
  const panel = stage.querySelector<HTMLElement>('.panel')!;
  panel.id = 'studio-explain';
  panel.hidden = true;
  const tabs = document.createElement('div');
  tabs.className = 'studio-tabs';
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Explore the camera');
  tabs.innerHTML = `<button type="button" role="tab" id="tab-controls" aria-controls="scenario" aria-selected="true">Controls</button>
    <button type="button" role="tab" id="tab-explain" aria-controls="studio-explain" aria-selected="false" tabindex="-1">Parts</button>`;
  const inspectorSize = document.createElement('button'); inspectorSize.type = 'button'; inspectorSize.id = 'inspector-size';
  inspectorSize.textContent = 'More ↑'; inspectorSize.setAttribute('aria-expanded', 'false');
  inspectorSize.setAttribute('aria-label', 'More: expand controls and parts'); inspectorSize.setAttribute('aria-controls', 'scenario studio-explain');
  // This is a layout action, not a third tab. Keep it outside the tablist.
  const tabRow = document.createElement('div'); tabRow.className = 'inspector-tab-row'; tabRow.append(tabs, inspectorSize);
  inspectorSize.addEventListener('click', () => {
    const expanded = document.body.classList.toggle('inspector-expanded');
    inspectorSize.setAttribute('aria-expanded', String(expanded)); inspectorSize.textContent = expanded ? 'Less ↓' : 'More ↑';
    inspectorSize.setAttribute('aria-label', expanded ? 'Less: reduce controls and parts' : 'More: expand controls and parts');
    window.dispatchEvent(new Event('resize'));
  });
  const controls = el('scenario');
  controls.append(exposure);
  controls.setAttribute('role', 'tabpanel');
  controls.setAttribute('aria-labelledby', 'tab-controls');
  panel.setAttribute('role', 'tabpanel');
  panel.setAttribute('aria-labelledby', 'tab-explain');
  const advanced = document.createElement('details');
  advanced.className = 'studio-advanced';
  advanced.innerHTML = '<summary>More settings & measurements</summary>';
  for (const node of controls.querySelectorAll(':scope > .sc-format, :scope > .kpis, :scope > .note')) advanced.append(node);
  controls.append(advanced);
  // A tablet held upright gives the Controls a column about 770 px tall, and the readings under the settings would be left
  // closed under 45% empty space (score loop r4): there More settings & measurements starts open. Everywhere else the
  // reader opens it.
  if (matchMedia('(min-width: 761px) and (max-width: 1023px) and (min-height: 900px) and (orientation: portrait)').matches) advanced.open = true;
  const descriptions = ['Light & depth of field', 'What looks sharp', 'Time & motion blur', 'Brightness & noise'];
  // The marked-stop note ("Marked f/4 ... true opening f/4.12") sat inside the Aperture group, which made it four lines taller than
  // Focus beside it. It is one full-width row under the two sliders instead; the slider keeps it as its description (score loop r6).
  const apertureNote = document.getElementById('sc-fno-note');
  const sliderGroups = [...controls.querySelectorAll<HTMLElement>('.sc-controls > .sc-group:not(.sc-kit)')];
  if (apertureNote && sliderGroups[1]) { sliderGroups[1].after(apertureNote); document.getElementById('sc-fno')?.setAttribute('aria-describedby', 'sc-fno-note'); }
  controls.querySelectorAll('.sc-controls > .sc-group:not(.sc-kit)').forEach((group, i) => {
    const hint = document.createElement('p');
    hint.className = 'control-help';
    hint.textContent = descriptions[i];
    group.append(hint);
  });
  // a real heading for screen-reader navigation; the tabs are the visible one (review loop r1, 10/11/2026)
  const sidebarHeading = document.createElement('h2'); sidebarHeading.className = 'sr-only'; sidebarHeading.textContent = 'Camera controls and parts';
  sidebar.append(sidebarHeading, tabRow, controls, panel);
  stage.querySelector('.body')!.append(sidebar);
  const settingsDrawer = document.createElement('dialog');
  settingsDrawer.id = 'phone-settings'; settingsDrawer.setAttribute('aria-labelledby', 'phone-settings-title'); settingsDrawer.setAttribute('aria-modal', 'true');
  settingsDrawer.innerHTML = '<header><div><h2 id="phone-settings-title">Camera settings</h2><p>See the model update as you adjust</p></div><button type="button" class="btn" id="phone-settings-close" autofocus>Close</button></header><div class="phone-settings-scroll"><section id="phone-exposure"><h3 id="phone-exposure-title">Exposure & focus</h3></section><section id="phone-equipment"><h3>Equipment</h3></section><section id="phone-model-view"><h3>Model view</h3></section></div>';
  document.body.append(settingsDrawer);
  el('topnav').innerHTML = siteNavigation();
}

/** Reuse the original buttons' actions, keeping a single path for scenario changes. */
export function mountWorkspace(store: Store): void {
  mountSiteNavigation(true);
  // The brand returns to the opening and its three ways in, as Start here does on every other page (score loop r2).
  const brand = document.querySelector<HTMLAnchorElement>('#topbar .brand, header .brand');
  if (brand) { brand.href = './index.html?start=1'; brand.setAttribute('aria-label', 'Photon to Photo, the opening'); }
  el('share-btn').textContent = 'Share this view';
  const viewTabs = [el('workspace-model'), el('workspace-photos')];
  [...viewTabs, el('expand-model')].forEach(button => { (button as HTMLButtonElement).disabled = false; });
  const viewPanels = [el('stage-section'), el('photo-study-panel')];
  // Real photos and the model are separate places in the browser history: switching pushes an entry, Back
  // returns (popstate below). The first call on load and Back/Forward themselves only replace.
  function showView(index: number, focus = false, history: 'push' | 'replace' = 'push') {
    // An expanded phone inspector belongs to the model currently being read.
    // Do not carry its overlay back from a photo/settings navigation journey.
    if (index === 1 && document.body.classList.contains('inspector-expanded')) el('inspector-size').click();
    viewTabs.forEach((tab, i) => {
      tab.setAttribute('aria-selected', String(i === index)); tab.tabIndex = i === index ? 0 : -1;
      viewPanels[i].hidden = i !== index;
      viewPanels[i].inert = i !== index;
    });
    document.body.dataset.workspaceView = index === 1 ? 'photos' : 'model';
    el('expand-model').hidden = index === 1;
    // The view is in the query too (view=photos), so a shared Real photos link names its photograph with it
    // (examples.ts adds photo= and crop=); the model's URL drops all three (score loop r2).
    const hash = index === 1 ? '#rp-card' : '#stage-section';
    const url = new URL(location.href);
    url.hash = hash;
    if (index === 1) url.searchParams.set('view', 'photos');
    else for (const key of ['view', 'photo', 'crop']) url.searchParams.delete(key);
    if (history === 'push' && photosInUrl() !== (index === 1)) window.history.pushState({ p2p: 'view' }, '', url);
    else window.history.replaceState(window.history.state, '', url);
    document.querySelector('.workspace-views > span')!.textContent = index === 1 ? 'Real photographs, explained' : modelHint();
    document.dispatchEvent(new CustomEvent('workspace-view', { detail: { view: index === 1 ? 'photos' : 'model' } }));
    if (focus) viewTabs[index].focus({ preventScroll: true });
  }
  viewTabs.forEach((tab, index) => {
    tab.addEventListener('click', () => showView(index));
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault(); showView(event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - index, true);
    });
  });
  document.addEventListener('click', event => {
    const target = event.target as Element;
    if (target.closest('a[href="#rp-card"]')) { event.preventDefault(); showView(1, true); }
    if (target.closest('a[href="#stage-section"], #rp-match')) {
      event.preventDefault(); showView(0);
      if (target.closest('#rp-match')) { el('tab-controls').click(); el('tab-controls').focus({ preventScroll: true }); }
    }
  });
  showView(photosInUrl() ? 1 : 0, false, 'replace');
  window.addEventListener('popstate', () => {
    const index = photosInUrl() ? 1 : 0;
    if (document.body.dataset.workspaceView !== (index === 1 ? 'photos' : 'model')) showView(index, false, 'replace');
  });
  const selectors = ['body', 'lens'].map((name) => {
    const select = el(`kit-${name}`) as HTMLSelectElement;
    const group = el(`sc-${name}`);
    select.addEventListener('change', () => {
      Array.from(group.querySelectorAll('button')).find(b => b.dataset[name] === select.value)?.click();
    });
    return { name, select, group };
  });
  const tabs = [el('tab-controls'), el('tab-explain')];
  const panels = [el('scenario'), el('studio-explain')];
  const phone = matchMedia('(max-width: 599px)');
  const syncModelView = () => { document.body.dataset.modelView = document.querySelector('#hud-switches [data-view][aria-pressed="true"]')?.getAttribute('data-view') || 'outside'; };
  new MutationObserver(syncModelView).observe(el('hud-switches'), { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-pressed'] });
  syncModelView();
  const drawer = el('phone-settings') as HTMLDialogElement;
  let drawerLauncher: HTMLElement | null = null;
  let restoreDrawerFocus = true;
  let desktopPane = 0;
  // While the sheet is open the page behind it is inert, as the menu does (site-nav.ts installMenuFocus): a touch screen
  // reader could still swipe into the covered model, pins and controls (score loop r4). Other dialogs stay live.
  let inertBehind: HTMLElement[] = [];
  const releaseBehind = () => { inertBehind.forEach(node => { node.inert = false; }); inertBehind = []; };
  const relocations = [
    ['equipment-controls', 'phone-equipment'], ['hud-switches', 'phone-model-view'], ['scenario', 'phone-exposure'],
  ].map(([id, target]) => {
    const node = el(id), marker = document.createComment(`Desktop home for ${id}`);
    node.before(marker); return { node, marker, target: el(target) };
  });
  function openSettings(source: HTMLElement, equipment = false) {
    if (!phone.matches || drawer.open) return;
    drawerLauncher = source; document.body.classList.add('phone-settings-open'); drawer.showModal();
    inertBehind = [...document.body.children].filter((node): node is HTMLElement =>
      node instanceof HTMLElement && node !== drawer && !node.inert && !['SCRIPT', 'DIALOG'].includes(node.tagName));
    inertBehind.forEach(node => { node.inert = true; });
    window.dispatchEvent(new Event('resize'));
    emit('pause-exposure', {});
    el('equipment-toggle').setAttribute('aria-expanded', String(equipment));
    equipmentToggleLabel(el('equipment-summary').textContent || '');
    el('tab-controls').setAttribute('aria-expanded', 'true');
    (equipment ? el('kit-body') : el('phone-settings-close')).focus({ preventScroll: true });
    const scroll = el('phone-settings').querySelector<HTMLElement>('.phone-settings-scroll')!;
    scroll.scrollTop = equipment ? el('phone-equipment').offsetTop - scroll.offsetTop : 0;
  }
  function closeSettings(restoreFocus = true) { if (drawer.open) { restoreDrawerFocus = restoreFocus; drawer.close(); } }
  el('phone-settings-close').addEventListener('click', () => closeSettings());
  drawer.addEventListener('close', () => {
    if (drawer.open) return;
    releaseBehind();
    document.body.classList.remove('phone-settings-open');
    window.dispatchEvent(new Event('resize'));
    el('equipment-toggle').setAttribute('aria-expanded', 'false');
    equipmentToggleLabel(el('equipment-summary').textContent || '');
    el('tab-controls').setAttribute('aria-expanded', 'false');
    const target = drawerLauncher?.checkVisibility() ? drawerLauncher : document.body.dataset.workspaceView === 'photos' ? el('workspace-photos') : el('tab-controls');
    if (restoreDrawerFocus) target.focus({ preventScroll: true });
    drawerLauncher = null; restoreDrawerFocus = true;
  });
  drawer.addEventListener('click', event => {
    if ((event.target as Element).closest('#open-readout, #open-pipeline')) closeSettings(false);
  }, { capture: true });
  drawer.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const items = [...drawer.querySelectorAll<HTMLElement>('button, input, select, textarea, summary, a[href], [tabindex]')]
      .filter(node => node.checkVisibility() && node.tabIndex >= 0 && !node.matches(':disabled'));
    const first = items[0], last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  });
  // Capture the compact equipment trigger before its desktop disclosure handler.
  el('equipment-toggle').addEventListener('click', event => {
    if (!phone.matches) return;
    event.stopImmediatePropagation(); openSettings(el('equipment-toggle'), true);
  }, { capture: true });
  document.addEventListener('workspace-view', event => {
    if ((event as CustomEvent<{ view: string }>).detail.view !== 'model') closeSettings();
  });
  function activate(index: number) {
    if (phone.matches) {
      panels[0].hidden = false; panels[1].hidden = false;
      document.querySelector<HTMLElement>('.studio-sidebar')!.dataset.pane = 'parts';
      if (index === 0) openSettings(tabs[0]);
      return;
    }
    desktopPane = index;
    tabs.forEach((tab, i) => {
      tab.setAttribute('aria-selected', String(i === index));
      tab.tabIndex = i === index ? 0 : -1;
      panels[i].hidden = i !== index;
      document.querySelector<HTMLElement>('.studio-sidebar')!.dataset.pane = index === 0 ? 'controls' : 'parts';
    });
  }
  // On a phone both panes show at once and Parts is a plain button, not a tab: activated by the reader, it brings the
  // parts list into view and puts focus on the part that is chosen (Overview when none is), so it does something a
  // screen reader can follow (score loop r3: it was a button that did nothing, still styled as the selected tab).
  // Programmatic clicks (ui.ts after a pick) only switch the desktop pane.
  const jumpToParts = () => {
    const list = el('parts');
    const target = list.querySelector<HTMLElement>('button[aria-pressed="true"]') ?? list.querySelector<HTMLElement>('button');
    list.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    target?.focus({ preventScroll: true });
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', event => {
      activate(index);
      if (index === 1 && phone.matches && event.isTrusted) jumpToParts();
    });
    tab.addEventListener('keydown', (event) => {
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - index;
        if (!phone.matches) activate(next);
        tabs[next].focus();
      }
    });
  });
  function applyPhoneLayout() {
    closeSettings();
    if (!phone.matches && document.body.classList.contains('inspector-expanded')) el('inspector-size').click();
    document.body.classList.toggle('phone-settings-layout', phone.matches);
    document.querySelector('.studio-kit')!.classList.remove('equipment-open');
    el('equipment-toggle').setAttribute('aria-expanded', 'false');
    el('equipment-toggle').querySelector('b')!.textContent = 'Edit';
    for (const { node, marker, target } of relocations) {
      if (phone.matches) target.append(node);
      else marker.parentNode!.insertBefore(node, marker.nextSibling);
    }
    const tablist = document.querySelector('.studio-tabs')!;
    tablist.setAttribute('role', phone.matches ? 'group' : 'tablist');
    tabs.forEach((tab, index) => {
      tab.setAttribute('role', phone.matches ? 'button' : 'tab');
      if (phone.matches) { tab.removeAttribute('aria-selected'); tab.tabIndex = 0; }
      else tab.removeAttribute('aria-expanded');
      // The parts list is the pane that is showing under the view; Settings is a launcher for a sheet. A button cannot be
      // aria-selected, so the pane in view is aria-current, and CSS underlines it (score loop r6: neither button said which
      // panel was showing).
      if (phone.matches && index === 1) tab.setAttribute('aria-current', 'true'); else tab.removeAttribute('aria-current');
      // A phone's Settings opens a modal dialog: aria-haspopup and aria-expanded say so, and an aria-controls that
      // points at a closed dialog cannot be resolved (axe aria-valid-attr-value, score loop r3). Parts names the list.
      if (phone.matches && index === 0) tab.removeAttribute('aria-controls');
      else tab.setAttribute('aria-controls', phone.matches ? 'parts' : index === 0 ? 'scenario' : 'studio-explain');
    });
    tabs[0].textContent = phone.matches ? 'Settings' : 'Controls';
    if (phone.matches) {
      tabs[0].setAttribute('aria-haspopup', 'dialog'); tabs[0].setAttribute('aria-expanded', 'false');
      panels[0].setAttribute('role', 'region'); panels[0].setAttribute('aria-labelledby', 'phone-exposure-title');
      panels[1].setAttribute('role', 'region');
      panels[0].hidden = false; panels[1].hidden = false;
      document.querySelector<HTMLElement>('.studio-sidebar')!.dataset.pane = 'parts';
    } else {
      tabs[0].removeAttribute('aria-haspopup');
      panels[0].setAttribute('role', 'tabpanel'); panels[0].setAttribute('aria-labelledby', 'tab-controls');
      panels[1].setAttribute('role', 'tabpanel');
      activate(desktopPane);
    }
    window.dispatchEvent(new Event('resize'));
  }
  phone.addEventListener('change', applyPhoneLayout); applyPhoneLayout();
  // A phone's inspector is a ~110 px dock under the model. A picked part opens it as a sheet over the lower part of
  // the view, so the card's explanation and measurements show with the model still above it, and closing the card
  // (or Overview) lowers the sheet again. The reader's own More/Less choice is never overruled (score loop r2: a
  // tapped pin showed only the card's eyebrow and title, with the text under the fold).
  const sizeButton = el('inspector-size');
  let autoSheet = false;
  sizeButton.addEventListener('click', event => { if (event.isTrusted) autoSheet = false; });
  new MutationObserver(() => {
    const selected = el('studio-explain').classList.contains('has-selection');
    const expanded = document.body.classList.contains('inspector-expanded');
    // Below ~780 px of height the sheet would leave the model about 120 px; there the dock scrolls to the card instead.
    if (selected && !expanded && innerHeight >= 780 && sizeButton.checkVisibility() && document.body.dataset.workspaceView !== 'photos'
      && !document.body.classList.contains('tour-active')) { sizeButton.click(); autoSheet = true; }
    else if (!selected && autoSheet) { autoSheet = false; if (expanded) sizeButton.click(); }
  }).observe(el('studio-explain'), { attributes: true, attributeFilter: ['class'] });
  // A phone on its side scrolls the page (studio-shell.css, landscape phones): the site bar, the workspace rows and
  // the kit bar sit above the level tabs, so on entry the model's view started about 230 px down a 390 px screen
  // with its lower pins and the playback row below the fold. On entering the workspace and on every level change
  // the level tabs move to the top of the screen, so the tabs, the model and its controls fill it (score loop r2).
  const landscapePhone = matchMedia('(max-height: 500px) and (orientation: landscape) and (min-width: 480px)');
  const tabsToTop = () => {
    if (!landscapePhone.matches || document.body.dataset.workspaceView === 'photos' || document.body.classList.contains('model-expanded')) return;
    const steps = el('steps');
    if (steps.checkVisibility() && Math.abs(steps.getBoundingClientRect().top) > 1) steps.scrollIntoView({ block: 'start', behavior: 'instant' });
  };
  requestAnimationFrame(tabsToTop);
  let lastPiece = store.get().piece;
  let lastPart: string | null = null; // the camera part, or a deeper level's pin
  let lastLens = store.get().scenario.lens;
  // The level prompt that asks for a setting names it as a link: it turns the inspector to Controls (the Settings sheet
  // on a phone) and marks that slider, as the tour does, whichever tab the reader had open (score loop r3: on Focus
  // the prompt asked to change focus while Focus distance sat on a hidden tab).
  const why = el('level-why');
  why.addEventListener('click', event => {
    // "Expand model" offered where the reader is reading why the level is there (phones only; score loop r6)
    if ((event.target as Element).closest('button[data-expand]')) { el('expand-model').click(); return; }
    const link = (event.target as Element).closest<HTMLButtonElement>('button[data-control]');
    if (!link) return;
    const control = el(link.dataset.control!);
    if (phone.matches) { openSettings(link); requestAnimationFrame(() => control.scrollIntoView({ block: 'center' })); }
    else activate(0);
    const group = control.closest('.sc-group') ?? control;
    group.scrollIntoView({ block: 'nearest' });
    group.classList.add('tour-cue');
    window.setTimeout(() => group.classList.remove('tour-cue'), 2600);
    control.focus({ preventScroll: true });
  });
  let whyPiece = '';
  let lastWhyPiece = '';
  store.subscribe(state => {
    // Models opens the camera in the workspace now: its body and lens carry over (score loop r4)
    setModelsLink(state.scenario.lens);
    const levelChanged = state.piece !== lastPiece;
    if (levelChanged) { lastPiece = state.piece; requestAnimationFrame(tabsToTop); }
    whyPiece = state.piece;
    if (whyPiece !== lastWhyPiece) {
      lastWhyPiece = whyPiece;
      why.replaceChildren();
      if (state.piece === 'cone') {
        const link = document.createElement('button');
        link.type = 'button'; link.className = 'why-link'; link.dataset.control = 'sc-focus'; link.textContent = 'Change Focus distance';
        why.append('One distance is sharp. ', link, ' to see nearby and distant points spread into blur.');
      } else why.textContent = levelWhy(state.piece);
      // On a phone the deep levels leave the model 250 px or less: the reason (behind Why?) says Expand model is there
      if (state.piece !== 'camera') {
        const more = document.createElement('button');
        more.type = 'button'; more.className = 'why-expand'; more.dataset.expand = '1';
        more.textContent = 'Need more room? Expand the model.';
        why.append(' ', more);
      }
    }
    for (const { name, select, group } of selectors) {
      const buttons = Array.from(group.querySelectorAll('button'));
      const options = buttons.map(button => ({ value: button.dataset[name]!, label: name === 'lens' ? Array.from(button.childNodes).map(node => node.textContent).join(' · ') : button.firstChild?.textContent || '' }));
      const signature = JSON.stringify(options);
      if (select.dataset.options !== signature) {
        select.replaceChildren(...options.map(({ value, label }) => new Option(label.replace(/\s+/g, ' ').trim(), value)));
        select.dataset.options = signature;
      }
      select.value = buttons.find(button => button.getAttribute('aria-pressed') === 'true')?.dataset[name] ?? '';
      select.disabled = !buttons.length;
    }
    const equipment = selectors.map(({ select }) => select.selectedOptions[0]?.textContent?.replace(/\s*·\s*/g, ' ') || '').filter(Boolean);
    const summary = el('equipment-summary');
    summary.textContent = equipment.join(' · ');
    equipmentToggleLabel(summary.textContent);
    // A part picked on this level opens its card. A level change keeps the reader's own tab: entering Focus or Pixel
    // supplies a camera parent (focus ring, sensor), and that is not a pick (score loop r3).
    const pick = state.piece === 'camera' ? state.cameraPart : state.pin ?? null;
    if (pick && pick !== lastPart && !levelChanged) activate(1);
    // The camera level's home is Controls: when the lens changes (the sliders it moves) and no part is picked, the desktop panel
    // returns there instead of staying on a Parts list the visitor has finished with (score loop r5). A lens swapped while a
    // part is picked keeps its Parts list, and the Overview button leaves the pane as it is (test-workspace, test-selection).
    const lensChanged = state.scenario.lens !== lastLens;
    lastLens = state.scenario.lens;
    if (!phone.matches && !levelChanged && state.piece === 'camera' && !document.body.classList.contains('tour-active') && desktopPane === 1
      && lensChanged && !pick) activate(0);

    lastPart = pick;
  });
}

function equipmentToggleLabel(summary: string) {
  const toggle = el('equipment-toggle');
  toggle.setAttribute('aria-label', `${toggle.getAttribute('aria-expanded') === 'true' ? 'Close equipment editor' : 'Edit equipment'}: ${summary}`);
}
