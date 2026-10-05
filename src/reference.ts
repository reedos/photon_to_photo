import { siteNavigation, mountSiteNavigation } from './app/site-nav';
import { CAMERA_PARTS, PART_LABELS } from './app/inspection';
import { connectedStory, mountConnectedStory } from './app/connected-story';
import { evidenceIndex, evidenceSearch } from './app/evidence-index';

const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
const page = new URLSearchParams(location.search).get('page') ?? 'story';
const titles: Record<string, string> = { story: 'Photon to Photo', evidence: 'Evidence', method: 'Method', glossary: 'Glossary', parts: 'Parts' };
const active = page in titles ? page : 'story';
document.title = `${titles[active]} · Photon to Photo`;
const canonical = document.createElement('link');
canonical.rel = 'canonical';
canonical.href = `https://reedos.dev/photon_to_photo/reference.html?page=${active}`;
document.head.append(canonical);
document.getElementById('topnav')!.innerHTML = siteNavigation(active);
const link = (label: string, piece = 'camera', part = '') => `<a class="btn" data-piece="${piece}" data-part="${part}" href="./index.html?piece=${piece}${part ? '&part=' + part : ''}">${label} →</a>`;
const heading = (counter: string, title: string, intro: string) => `<header><p class="eyebrow">${counter} · Photon to Photo</p><h1>${title}</h1><p class="lede">${intro}</p></header>`;
const descriptions: Record<string, string> = {
  lens: 'The whole lens gathers light and forms the image. Open its optics view to follow rays through the glass.',
  focusRing: 'Changing focus moves the glass. Compare the sharp image plane with the blur from nearer or farther points.',
  iris: 'The aperture blades set the opening. Change the f-number to see the pupil, light level and depth of field change.',
  glass: 'Each surface bends light according to its curvature and refractive index. Different wavelengths can take different paths.',
  mount: 'The mount seats the lens at its flange distance and connects the lens to the body.',
  sensor: 'The sensor collects light. Go inside one pixel to inspect the microlens, color filter and electron well.',
  shutter: 'The shutter controls the exposure interval. Play an exposure to inspect the mechanism and photon arrival.',
  viewfinder: 'A DSLR uses its mirror to direct light into an optical finder. The mirrorless body uses an electronic finder.',
};
const glossary: [string, string, string, string][] = [
  ['Aperture', 'The opening at the lens stop. Its image seen through the front glass is the entrance pupil.', 'camera', 'iris'],
  ['Bayer filter', 'A repeating color-filter pattern over the sensor pixels. Each site measures one color band; demosaicing estimates missing color samples.', 'loupe', 'sensor'],
  ['Bokeh', 'The appearance of out-of-focus detail. Aperture shape and the ray bundle help determine the shape of a blurred point.', 'cone', 'focusRing'],
  ['Circle of confusion', 'A chosen limit for a blur disk to count as acceptably sharp. Depth-of-field limits depend on this assumption.', 'cone', 'focusRing'],
  ['Depth of field', 'The range judged acceptably sharp under a stated blur criterion. It is not a second plane of perfect focus.', 'cone', 'focusRing'],
  ['Diffraction', 'Spreading of light at an opening. Stopping down increases the diffraction blur even while reducing many other aberrations.', 'lens', 'iris'],
  ['Entrance pupil', 'The apparent aperture seen from the subject side through the glass in front of the stop. It need not equal the physical iris diameter.', 'camera', 'iris'],
  ['Exposure', 'Light collected during the shutter interval. Aperture and shutter time affect collection; ISO does not create photons.', 'camera', 'shutter'],
  ['F-number', 'Focal length divided by entrance-pupil diameter. A larger f-number describes a smaller relative opening.', 'camera', 'iris'],
  ['Focal length', 'An optical property governing image scale and field of view for a given sensor. Perspective also depends on where the camera is placed.', 'camera', 'lens'],
  ['Full well', 'The charge a pixel can hold before it saturates in the sensor model.', 'loupe', 'sensor'],
  ['ISO', 'The exposure-index setting represented through gain and the image pipeline. Raising it does not make the sensor collect more photons.', 'loupe', 'sensor'],
  ['Microlens', 'A tiny lens over a sensor pixel that helps direct incident light into its photosensitive area.', 'loupe', 'sensor'],
  ['Read noise', 'Noise introduced when the collected signal is measured and read out. It matters especially when little light was collected.', 'loupe', 'sensor'],
  ['Shot noise', 'Variation caused by the discrete arrival of photons. More collected signal improves relative shot-noise performance.', 'loupe', 'sensor'],
  ['Shutter speed', 'The exposure duration. A longer interval collects more light and can increase motion blur.', 'camera', 'shutter'],
];

let content = '';
if (active === 'story') {
  content = connectedStory();
} else if (active === 'parts') {
  content = heading('02 / 05', 'Parts', 'The same parts as the numbered camera sidebar. Each link opens that part in the visualizer; your current camera and shot carry over.')
    + '<div class="ref-actions"><a class="btn" href="./index.html" data-return-view>Return to your view →</a></div><div class="ref-grid">'
    + CAMERA_PARTS.map((id, i) => `<section class="ref-card"><p class="eyebrow">${String(i + 1).padStart(2, '0')} · Camera</p><h2>${PART_LABELS[id]}</h2><p>${descriptions[id]}</p>${link('Show this part', 'camera', id)}</section>`).join('') + '</div>';
} else if (active === 'glossary') {
  content = heading('03 / 05', 'Glossary', 'Terms used by the camera, optics, focus and pixel views. Each definition links back to the place where you can explore it.')
    + '<label class="ref-search">Find a term<input type="search" id="ref-search" placeholder="Aperture, ISO, bokeh…"></label><div class="ref-search-status"><p id="search-count" role="status"></p><button class="btn" id="ref-clear" type="button" hidden>Clear search</button></div><dl>'
    + glossary.map(([term, definition, piece, part]) => `<div data-search="${escape(term + ' ' + definition)}"><dt>${term}</dt><dd>${definition}<br>${link('See it in the visualizer', piece, part)}</dd></div>`).join('') + '</dl>';
} else if (active === 'method') {
  content = heading('04 / 05', 'Method', 'Camera settings drive the optical model, mechanisms and measurements. Focused sensor experiments explain the physics; supplied photographs connect it to real moments.')
    + `<h2>From glass to image</h2><div class="ref-grid">
    <section class="ref-card"><h2>Optics</h2><p>Lens prescriptions provide surfaces, spacings and glass properties. Rays are traced through those surfaces. The focus solver moves the modeled optic, while the iris and ray display follow the chosen aperture.</p>${link('Inspect the rays', 'lens', 'glass')}</section>
    <section class="ref-card"><h2>Sensor and photo</h2><p>Pixel inspection uses a controlled neutral target and the sensor model. Image Pipeline processes a small illustrative color sample. Neither experiment reconstructs the original sensor data of a supplied photograph.</p>${link('Inspect a pixel', 'loupe', 'sensor')}</section></div>
    <h2>What is simplified</h2><ul><li>The camera exterior and some assemblies are illustrative. A public patent example is not proof of a commercial lens's exact production prescription.</li><li>When a focusing-group prescription is unavailable, a stand-in motion may be used. Affected lens cards identify it.</li><li>Depth of field uses an assumed acceptable blur diameter. Exposure readouts identify their reference scene or reflectance.</li><li>Real-photo journeys preserve the supplied JPEG. Their sensor, charge and image-assembly animations explain mechanisms; they do not recover the original RAW data.</li><li>Exposure playback stretches time and represents many photons with each dot. Its timing and dot-count explanations are under Exposure details.</li><li>Sensor values include measurements, estimates and assumptions. The evidence label remains part of the claim.</li></ul>
    <h2>Format and focus guides</h2><p>Smaller formats on the two full-frame bodies model a centered sensor crop, retaining pixel pitch and per-pixel noise. Readout timing retains the full-frame measurement or estimate; it is not a measured crop-mode speed. The fixed-aspect preview fits a centered window inside that sensor area, using square spatial samples and local Bayer blocks to approximate averaged noise. The sharpness criterion states the assumed acceptable blur diameter used for depth of field. Use the lens model's depth-of-field limits and traced blur to inspect the sharp range.</p>
    <h2>How it is checked</h2><p>Unit tests compare calculations with analytic results and recorded regressions. Browser accuracy gates compare drawn rays with engine traces, rendered blur disks with ray-bundle geometry, and pixel-well levels and noise with sensor predictions. Navigation checks exercise desktop and phone layouts, part selection, return paths and keyboard controls.</p>
    <h2>Reading evidence labels</h2><p>Spec, Vendor, Reported, Calc. and Assumed distinguish source types. Calculated does not mean measured: a result inherits the limitations of its inputs.</p><a class="btn" href="./reference.html?page=evidence">Open evidence →</a>`;
} else {
  content = heading('05 / 05', 'Evidence', 'Source links recorded with the camera and lens data. This index exposes the existing records; inclusion does not mean a source has been newly verified or that every parameter is known.')
    + '<details class="evidence-label-key"><summary>How to read evidence labels</summary><dl><dt>Spec</dt><dd>A published specification.</dd><dt>Vendor</dt><dd>A maker’s claim or published characterization.</dd><dt>Reported</dt><dd>A third party’s report or measurement.</dd><dt>Calc.</dt><dd>A result calculated from the model and its inputs.</dd><dt>Assumed</dt><dd>An explicit modeling choice where a measurement is unavailable or the scenario requires one.</dd></dl></details>'
    + '<h2>Recorded source index</h2><label class="ref-search">Filter sources<input type="search" id="ref-search" placeholder="D850, patent, read noise…"></label><div class="ref-search-status"><p id="search-count" role="status"></p><button class="btn" id="ref-clear" type="button" hidden>Clear search</button></div><p class="evidence-help">Search a camera, parameter or citation. Open a source’s recorded uses to see which fields cite it and the evidence labels attached to those records.</p><div id="evidence-list"></div>';
}
document.getElementById('reference-main')!.innerHTML = content;
if (active === 'story') mountConnectedStory();

if (active === 'evidence') {
  // An explicit allowlist keeps unrelated datasets out of the public reference bundle.
  const records = import.meta.glob(['../data/d850.json', '../data/z8.json', '../data/read-noise.json',
    '../data/lenses/{s35,n50,n500,n500fl,z35,m50,z800}.json'], { eager: true, import: 'default' });
  const sources = evidenceIndex(records);
  document.getElementById('evidence-list')!.innerHTML = sources.map(source => {
    const kinds = [...new Set(source.uses.map(use => use.evidence).filter(Boolean))];
    return `<article class="evidence-row" data-search="${escape(evidenceSearch(source))}"><b>${source.label}<small>${escape(kinds.join(' · ') || 'Source record')}</small></b><div><a href="${escape(source.url)}" target="_blank" rel="noopener noreferrer">${escape(source.uses[0].locator || new URL(source.url).hostname)}</a><small>${escape(source.url)}</small><details class="evidence-uses"><summary>${source.uses.length} recorded ${source.uses.length === 1 ? 'use' : 'uses'}</summary><ul>${source.uses.map(use => `<li><code>${escape(use.path)}</code><span>${escape(use.evidence || 'No evidence label on this record')}${use.evidence && use.evidencePath !== use.path ? ' · from enclosing record ' + escape(use.evidencePath || 'root') : ''}</span>${use.locator ? '<p>' + escape(use.locator) + '</p>' : ''}</li>`).join('')}</ul></details></div></article>`;
  }).join('');
}
const search = document.getElementById('ref-search') as HTMLInputElement | null;
if (search) {
  const clear = document.getElementById('ref-clear')!;
  search.value = new URLSearchParams(location.search).get('q') ?? '';
  const filter = () => {
    const query = search.value.trim().toLowerCase(); let count = 0;
    const words = query.split(/\s+/).filter(Boolean);
    document.querySelectorAll<HTMLElement>('[data-search]').forEach(row => { row.hidden = !words.every(word => row.dataset.search!.toLowerCase().includes(word)); if (!row.hidden) count++; });
    clear.hidden = !search.value;
    const url = new URL(location.href);
    if (search.value) url.searchParams.set('q', search.value); else url.searchParams.delete('q');
    history.replaceState(history.state, '', url);
    document.getElementById('search-count')!.textContent = `${count} ${active === 'glossary' ? 'terms' : 'sources'}${count ? '' : ' — try a different search'}`;
  };
  clear.onclick = () => { search.value = ''; filter(); search.focus(); };
  search.addEventListener('input', filter); filter();
}
try {
  const query = sessionStorage.getItem('p2p.return') ?? '';
  document.querySelectorAll<HTMLAnchorElement>('a[data-piece]').forEach(anchor => {
    const params = new URLSearchParams(query); params.set('piece', anchor.dataset.piece!);
    if (anchor.dataset.part) params.set('part', anchor.dataset.part); else params.delete('part');
    anchor.href = './index.html?' + params;
  });
} catch { /* default links still work */ }
mountSiteNavigation();
