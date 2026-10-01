import { siteNavigation, mountSiteNavigation } from './site-nav';
import type { Store } from './store';

const el = (id: string) => document.getElementById(id)!;

/** Arrange the existing engine-backed controls into one compact workspace. */
export function buildWorkspace(): void {
  document.body.classList.add('workspace');
  const stage = el('stage-section');
  const toolbar = document.createElement('div');
  toolbar.className = 'studio-kit';
  toolbar.innerHTML = `<label>Camera<select id="kit-body" aria-label="Camera body"></select></label>
    <label>Lens<select id="kit-lens" aria-label="Lens"></select></label>
    <label>Scene<select id="kit-scene" aria-label="Scene"></select></label>
    <details class="view-menu"><summary aria-label="View menu">•••</summary><div id="studio-actions"></div></details>`;
  stage.prepend(toolbar);
  const viewer = el('viewer');
  const exposure = document.createElement('div');
  exposure.id = 'studio-exposure';
  viewer.append(exposure);
  const transport = document.createElement('nav');
  transport.className = 'part-nav';
  transport.setAttribute('aria-label', 'Part navigation');
  transport.innerHTML = '<button type="button" class="btn" id="part-prev" aria-label="Previous part">‹ <span>Previous</span></button><button type="button" class="btn" id="part-overview">Overview</button><button type="button" class="btn" id="part-next" aria-label="Next part"><span>Next</span> ›</button><span id="part-position" role="status" aria-live="polite">Overview</span>';
  el('hud-btns-phone').prepend(transport);
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
  el('studio-actions').insertAdjacentHTML('beforeend', '<a class="btn" href="#rp-card">Real photo comparison</a><a class="btn" href="./reference.html?page=story">How to explore</a>');
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
