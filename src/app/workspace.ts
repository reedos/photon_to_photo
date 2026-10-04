import { siteNavigation, mountSiteNavigation } from './site-nav';
import type { Store } from './store';
import { emit } from './bus';
import '../styles/studio-shell.css';

const el = (id: string) => document.getElementById(id)!;

/** Arrange the existing engine-backed controls into one compact workspace. */
export function buildWorkspace(): void {
  document.body.classList.add('workspace', 'viewport-studio');
  const stage = el('stage-section');
  const views = document.createElement('div');
  views.className = 'workspace-views';
  views.setAttribute('role', 'tablist');
  views.setAttribute('aria-label', 'Workspace');
  views.innerHTML = '<button type="button" role="tab" id="workspace-model" aria-controls="stage-section" aria-selected="true">Explore camera</button><button type="button" role="tab" id="workspace-photos" aria-controls="photo-study-panel" aria-selected="false" tabindex="-1">Real photos</button><span>From light to a photograph</span>';
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
    window.dispatchEvent(new Event('resize'));
  });
  stage.setAttribute('role', 'tabpanel');
  stage.setAttribute('aria-labelledby', 'workspace-model');
  const study = document.createElement('section');
  study.id = 'photo-study-panel'; study.hidden = true;
  study.setAttribute('role', 'tabpanel'); study.setAttribute('aria-labelledby', 'workspace-photos');
  const studyStatus = document.createElement('p');
  studyStatus.className = 'study-loading'; studyStatus.textContent = 'Loading your photographs…';
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
  transport.innerHTML = '<button type="button" class="btn" id="part-prev" aria-label="Previous part">‹ <span>Previous</span></button><button type="button" class="btn" id="part-overview">Overview</button><button type="button" class="btn" id="part-next" aria-label="Next part"><span>Next</span> ›</button><span id="part-position" role="status" aria-live="polite">Overview</span>';
  el('hud-btns-phone').prepend(transport);
  const zoom = document.createElement('div');
  zoom.className = 'zoom-controls'; zoom.setAttribute('role', 'group'); zoom.setAttribute('aria-label', 'Model zoom');
  zoom.innerHTML = '<button type="button" class="btn" id="zoom-out" aria-label="Zoom out" title="Zoom out">−</button><span>Zoom</span><button type="button" class="btn" id="zoom-in" aria-label="Zoom in" title="Zoom in">+</button>';
  el('hud-btns-phone').append(zoom);
  const door = document.createElement('button');
  door.type = 'button'; door.id = 'card-go'; door.className = 'btn go'; door.hidden = true;
  el('card-t').after(door);
  const narrow = matchMedia('(max-width: 760px)');
  const placeDoor = () => {
    if (narrow.matches) document.querySelector('.parts-head')!.append(door);
    else el('card-t').after(door);
  };
  placeDoor(); narrow.addEventListener('change', placeDoor);
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
  inspectorSize.setAttribute('aria-label', 'Expand controls and parts'); inspectorSize.setAttribute('aria-controls', 'scenario studio-explain');
  // This is a layout action, not a third tab. Keep it outside the tablist.
  const tabRow = document.createElement('div'); tabRow.className = 'inspector-tab-row'; tabRow.append(tabs, inspectorSize);
  inspectorSize.addEventListener('click', () => {
    const expanded = document.body.classList.toggle('inspector-expanded');
    inspectorSize.setAttribute('aria-expanded', String(expanded)); inspectorSize.textContent = expanded ? 'Less ↓' : 'More ↑';
    inspectorSize.setAttribute('aria-label', expanded ? 'Reduce controls and parts' : 'Expand controls and parts');
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
  const descriptions = ['Light & depth of field', 'What looks sharp', 'Time & motion blur', 'Brightness & noise'];
  controls.querySelectorAll('.sc-controls > .sc-group:not(.sc-kit)').forEach((group, i) => {
    const hint = document.createElement('p');
    hint.className = 'control-help';
    hint.textContent = descriptions[i];
    group.append(hint);
  });
  sidebar.append(tabRow, controls, panel);
  stage.querySelector('.body')!.append(sidebar);
  const settingsDrawer = document.createElement('dialog');
  settingsDrawer.id = 'phone-settings'; settingsDrawer.setAttribute('aria-labelledby', 'phone-settings-title');
  settingsDrawer.innerHTML = '<header><div><h2 id="phone-settings-title">Camera settings</h2><p>See the model update as you adjust</p></div><button type="button" class="btn" id="phone-settings-close" autofocus>Close</button></header><div class="phone-settings-scroll"><section id="phone-exposure"><h3 id="phone-exposure-title">Exposure & focus</h3></section><section id="phone-equipment"><h3>Equipment</h3></section><section id="phone-model-view"><h3>Model view</h3></section></div>';
  document.body.append(settingsDrawer);
  el('topnav').innerHTML = siteNavigation();
}

/** Reuse the original buttons' actions, keeping a single path for scenario changes. */
export function mountWorkspace(store: Store): void {
  mountSiteNavigation(true);
  el('share-btn').textContent = 'Share this view';
  const viewTabs = [el('workspace-model'), el('workspace-photos')];
  [...viewTabs, el('expand-model')].forEach(button => { (button as HTMLButtonElement).disabled = false; });
  const viewPanels = [el('stage-section'), el('photo-study-panel')];
  function showView(index: number, focus = false) {
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
    history.replaceState(null, '', `${location.pathname}${location.search}${index === 1 ? '#rp-card' : '#stage-section'}`);
    document.querySelector('.workspace-views > span')!.textContent = index === 1 ? 'Your photographs, explained' : 'Drag to orbit · Scroll to zoom';
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
  showView(location.hash === '#rp-card' ? 1 : 0);
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
  const relocations = [
    ['equipment-controls', 'phone-equipment'], ['hud-switches', 'phone-model-view'], ['scenario', 'phone-exposure'],
  ].map(([id, target]) => {
    const node = el(id), marker = document.createComment(`Desktop home for ${id}`);
    node.before(marker); return { node, marker, target: el(target) };
  });
  function openSettings(source: HTMLElement, equipment = false) {
    if (!phone.matches || drawer.open) return;
    drawerLauncher = source; document.body.classList.add('phone-settings-open'); drawer.showModal();
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
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activate(index));
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
      tab.setAttribute('aria-controls', phone.matches && index === 0 ? 'phone-settings' : index === 0 ? 'scenario' : 'studio-explain');
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
  let lastPart: string | null = null;
  store.subscribe(state => {
    el('level-why').textContent = {
      camera: 'Try the shutter, aperture or focus ring. Watch the shutter, light paths and lens respond.',
      lens: 'Each glass surface bends light. Follow the colors to see where they meet.',
      cone: 'One distance is sharp. Change focus to see nearby and distant points spread into blur.',
      loupe: 'Light becomes charge, then a number. Follow a controlled light sample into a sensor pixel.',
    }[state.piece];
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
    if (state.cameraPart && state.cameraPart !== lastPart) {
      activate(1);

    }

    lastPart = state.cameraPart;
  });
}

function equipmentToggleLabel(summary: string) {
  const toggle = el('equipment-toggle');
  toggle.setAttribute('aria-label', `${toggle.getAttribute('aria-expanded') === 'true' ? 'Close equipment editor' : 'Edit equipment'}: ${summary}`);
}
