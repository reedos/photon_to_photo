import { siteNavigation, mountSiteNavigation } from './app/site-nav';
import { CAMERA_PARTS, PART_LABELS } from './app/inspection';

const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
const page = new URLSearchParams(location.search).get('page') ?? 'story';
const titles: Record<string, string> = { story: 'Photon to Photo', evidence: 'Evidence', method: 'Method', glossary: 'Glossary', parts: 'Parts' };
const active = page in titles ? page : 'story';
document.title = `${titles[active]} · Photon to Photo`;
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
  content = heading('01 / 05', 'Light in.<br>A photograph out.', 'Choose a camera and lens, set a shot, then follow the light from the glass to a sensor pixel. The camera, its measurements and the photo respond to the same physics model.')
    + '<div class="ref-actions"><a class="btn go" href="./index.html" data-return-view>Open the visualizer →</a><a class="btn" href="./reference.html?page=parts">Browse the parts</a></div>'
    + '<div class="ref-grid">'
    + `<section class="ref-card"><p class="eyebrow">01 · Explore</p><h2>Start with the camera</h2><p>Use Previous and Next to visit every part, or choose one from the numbered list. Overview returns to the whole camera. The list stays available as you explore.</p>${link('Explore the camera')}</section>`
    + `<section class="ref-card"><p class="eyebrow">02 · Glass</p><h2>Go inside the lens</h2><p>Pick the lens, glass or aperture, then Go inside. Inspect the element stack and the light traced through its surfaces.</p>${link('Inspect the optics', 'lens', 'glass')}</section>`
    + `<section class="ref-card"><p class="eyebrow">03 · Focus</p><h2>See a point become a blur</h2><p>Change focus distance and aperture. Follow the light bundle to the sensor and compare the resulting spot with the sharpness criterion.</p>${link('Explore focus', 'cone', 'focusRing')}</section>`
    + `<section class="ref-card"><p class="eyebrow">04 · Signal</p><h2>Inspect one pixel</h2><p>Click a point in Your photo to enter its pixel. Inspect photon collection and the electron well, then return to the same shot.</p>${link('Enter a pixel', 'loupe', 'sensor')}</section></div>`
    + '<h2>Explore at your own pace</h2><p>Drag the model to orbit. Use the four sliders to change the shot; the photo updates automatically. Play exposure reveals the mechanism, with pause, replay and scrubbing. Arrow keys step through parts when the 3D canvas has focus. Go inside and the Camera breadcrumb connect each inspection to its parent.</p>'
    + '<p><a href="./reference.html?page=method">Read the method and limitations</a> or <a href="./reference.html?page=evidence">see what backs the numbers</a>.</p>';
} else if (active === 'parts') {
  content = heading('02 / 05', 'Parts', 'The same parts as the numbered camera sidebar. Each link opens that part in the visualizer; your current camera and shot carry over.')
    + '<div class="ref-actions"><a class="btn" href="./index.html" data-return-view>Return to your view →</a></div><div class="ref-grid">'
    + CAMERA_PARTS.map((id, i) => `<section class="ref-card"><p class="eyebrow">${String(i + 1).padStart(2, '0')} · Camera</p><h2>${PART_LABELS[id]}</h2><p>${descriptions[id]}</p>${link('Show this part', 'camera', id)}</section>`).join('') + '</div>';
} else if (active === 'glossary') {
  content = heading('03 / 05', 'Glossary', 'Terms used by the camera, optics, focus and pixel views. Each definition links back to the place where you can explore it.')
    + '<label class="ref-search">Find a term<input type="search" id="ref-search" placeholder="Aperture, ISO, bokeh…"></label><p id="search-count" role="status"></p><dl>'
    + glossary.map(([term, definition, piece, part]) => `<div data-search="${escape(term + ' ' + definition)}"><dt>${term}</dt><dd>${definition}<br>${link('See it in the visualizer', piece, part)}</dd></div>`).join('') + '</dl>';
} else if (active === 'method') {
  content = heading('04 / 05', 'Method', 'One scenario drives the optical model, camera drawing, measurements and synthetic photograph. The images illustrate that model; they are not measurements from a physical camera.')
    + `<h2>From glass to image</h2><div class="ref-grid">
    <section class="ref-card"><h2>Optics</h2><p>Lens prescriptions provide surfaces, spacings and glass properties. Rays are traced through those surfaces. The focus solver moves the modeled optic, while the iris and ray display follow the chosen aperture.</p>${link('Inspect the rays', 'lens', 'glass')}</section>
    <section class="ref-card"><h2>Sensor and photo</h2><p>A synthetic scene is rendered with the model's exposure, blur, photon noise and read noise. Sensor parameters feed the pixel and image pipeline. Each displayed image pixel represents a block of sensor pixels, as stated in Photo details.</p>${link('Inspect a pixel', 'loupe', 'sensor')}</section></div>
    <h2>What is simplified</h2><ul><li>The camera exterior and some assemblies are illustrative. A public patent example is not proof of a commercial lens's exact production prescription.</li><li>When a focusing-group prescription is unavailable, a stand-in motion may be used. Affected lens cards identify it.</li><li>Depth of field uses an assumed acceptable blur diameter. Exposure readouts identify their reference scene or reflectance.</li><li>The rendered photograph is a reduced-resolution synthetic scene, not a prediction of every detail of a real photograph.</li><li>Exposure playback stretches time and represents many photons with each dot. Its timing and dot-count explanations are under Exposure details.</li><li>Sensor values include measurements, estimates and assumptions. The evidence label remains part of the claim.</li></ul>
    <h2>How it is checked</h2><p>Unit tests compare calculations with analytic results and recorded regressions. Browser accuracy gates compare drawn rays with engine traces, rendered blur disks with ray-bundle geometry, and pixel-well levels and noise with sensor predictions. Navigation checks exercise desktop and phone layouts, part selection, return paths and keyboard controls.</p>
    <h2>Reading evidence labels</h2><p>Spec, Vendor, Reported, Calc. and Assumed distinguish source types. Calculated does not mean measured: a result inherits the limitations of its inputs.</p><a class="btn" href="./reference.html?page=evidence">Open evidence →</a>`;
} else {
  content = heading('05 / 05', 'Evidence', 'Source links recorded with the camera and lens data. This index exposes the existing records; inclusion does not mean a source has been newly verified or that every parameter is known.')
    + '<dl><dt>Spec</dt><dd>A published specification.</dd><dt>Vendor</dt><dd>A maker’s claim or published characterization.</dd><dt>Reported</dt><dd>A third party’s report or measurement.</dd><dt>Calc.</dt><dd>A result calculated from the model and its inputs.</dd><dt>Assumed</dt><dd>An explicit modeling choice where a measurement is unavailable or the scenario requires one.</dd></dl>'
    + '<h2>Recorded source index</h2><label class="ref-search">Filter sources<input type="search" id="ref-search" placeholder="D850, patent, read noise…"></label><p id="search-count" role="status"></p><div id="evidence-list"></div>';
}
document.getElementById('reference-main')!.innerHTML = content;

if (active === 'evidence') {
  // An explicit allowlist keeps unrelated datasets out of the public reference bundle.
  const records = import.meta.glob(['../data/d850.json', '../data/z8.json', '../data/read-noise.json',
    '../data/lenses/{s35,n50,n500,n500fl,z35,m50,z800}.json'], { eager: true, import: 'default' });
  const sources = new Map<string, { label: string; url: string; loc: string; ev: string }>();
  function collect(value: unknown, label: string) {
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    for (const key of ['src', 'url']) {
      const url = record[key];
      if (typeof url === 'string' && /^https?:\/\//.test(url)) {
        const id = label + url;
        if (!sources.has(id)) sources.set(id, { label, url, loc: String(record.loc ?? record.title ?? ''), ev: String(record.ev ?? 'Source record') });
      }
    }
    Object.values(record).forEach(child => collect(child, label));
  }
  Object.entries(records).forEach(([path, value]) => collect(value, path.split('/').pop()!.replace('.json', '').toUpperCase()));
  document.getElementById('evidence-list')!.innerHTML = [...sources.values()].map(source => `<article class="evidence-row" data-search="${escape(Object.values(source).join(' '))}"><b>${source.label}<small>${escape(source.ev)}</small></b><div><a href="${escape(source.url)}" target="_blank" rel="noopener noreferrer">${escape(source.loc || new URL(source.url).hostname)}</a><small>${escape(source.url)}</small></div></article>`).join('');
}
const search = document.getElementById('ref-search') as HTMLInputElement | null;
if (search) {
  const filter = () => {
    const query = search.value.trim().toLowerCase(); let count = 0;
    document.querySelectorAll<HTMLElement>('[data-search]').forEach(row => { row.hidden = !row.dataset.search!.toLowerCase().includes(query); if (!row.hidden) count++; });
    document.getElementById('search-count')!.textContent = `${count} ${active === 'glossary' ? 'terms' : 'sources'}${count ? '' : ' — try a different search'}`;
  };
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
