import { siteNavigation, mountSiteNavigation } from './site-nav';
import type { Store } from './store';
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
  toolbar.innerHTML = `<label>Camera<select id="kit-body" aria-label="Camera body"></select></label>
    <label>Lens<select id="kit-lens" aria-label="Lens"></select></label>
    <label>Scene<select id="kit-scene" aria-label="Scene"></select></label>
    <details class="view-menu"><summary aria-label="View menu">•••</summary><div id="studio-actions"></div></details>`;
  stage.prepend(toolbar);
  const viewer = el('viewer');
  const modelTools = document.createElement('div');
  modelTools.id = 'model-tools';
  modelTools.append(el('hud-switches'));
  const compactFire = document.createElement('button');
  compactFire.id = 'compact-fire'; compactFire.type = 'button'; compactFire.className = 'btn';
  compactFire.textContent = 'Fire'; compactFire.setAttribute('aria-label', 'Fire shutter');
  compactFire.disabled = true;
  compactFire.addEventListener('click', () => document.querySelector<HTMLButtonElement>('.rx-fire')?.click());
  modelTools.append(compactFire);
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
  sidebar.setAttribute('aria-label', 'Photo and settings');
  const panel = stage.querySelector<HTMLElement>('.panel')!;
  panel.id = 'studio-explain';
  panel.hidden = true;
  const tabs = document.createElement('div');
  tabs.className = 'studio-tabs';
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Explore the camera');
  tabs.innerHTML = `<button type="button" role="tab" id="tab-controls" aria-controls="scenario" aria-selected="true">Controls</button>
    <button type="button" role="tab" id="tab-explain" aria-controls="studio-explain" aria-selected="false" tabindex="-1">Parts</button>`;
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
  const photo = el('finalimg');
  const photoCanvas = el('finalimg-canvas');
  photoCanvas.tabIndex = 0;
  photoCanvas.setAttribute('role', 'button');
  photoCanvas.setAttribute('aria-label', 'Your photo. Click a pixel, or press Enter to inspect the center.');
  photoCanvas.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    const box = photoCanvas.getBoundingClientRect();
    photoCanvas.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 }));
  });
  photo.querySelector('.sc-head')!.innerHTML = '<h2 id="fi-h">Your photo</h2><span>Updates as you adjust</span>';
  const photoDetails = document.createElement('details');
  photoDetails.className = 'photo-details';
  photoDetails.innerHTML = '<summary>Photo details</summary>';
  photoDetails.append(photo.querySelector('.finalimg-side')!);
  photo.append(photoDetails);
  photoDetails.before(el('finalimg-retry'));
  const photoHint = document.createElement('p');
  photoHint.className = 'photo-hint';
  photoHint.textContent = 'Tap the photo to inspect a pixel';
  photo.querySelector('.finalimg-card')!.append(photoHint);
  sidebar.append(photo, tabs, controls, panel);
  stage.querySelector('.body')!.append(sidebar);
  el('topnav').innerHTML = siteNavigation();
}

/** Reuse the original buttons' actions, keeping a single path for scenario changes. */
export function mountWorkspace(store: Store): void {
  mountSiteNavigation(true);
  el('share-btn').textContent = 'Share this view';
  el('studio-actions').insertAdjacentHTML('beforeend', '<a class="btn" href="#rp-card">Explore real photos</a><a class="btn" href="./reference.html?page=story">How to explore</a>');
  const viewTabs = [el('workspace-model'), el('workspace-photos')];
  [...viewTabs, el('expand-model')].forEach(button => { (button as HTMLButtonElement).disabled = false; });
  const viewPanels = [el('stage-section'), el('photo-study-panel')];
  function showView(index: number, focus = false) {
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
  const selectors = ['body', 'lens', 'scene'].map((name) => {
    const select = el(`kit-${name}`) as HTMLSelectElement;
    const group = el(`sc-${name}`);
    select.addEventListener('change', () => {
      Array.from(group.querySelectorAll('button')).find(b => b.dataset[name] === select.value)?.click();
    });
    return { name, select, group };
  });
  const tabs = [el('tab-controls'), el('tab-explain')];
  const panels = [el('scenario'), el('studio-explain')];
  function activate(index: number) {
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
        activate(next); tabs[next].focus();
      }
    });
  });
  let lastPart: string | null = null;
  store.subscribe(state => {
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
    if (state.cameraPart && state.cameraPart !== lastPart) {
      activate(1);

    }

    lastPart = state.cameraPart;
  });
}
