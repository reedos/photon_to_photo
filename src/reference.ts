import { siteNavigation, mountSiteNavigation } from './app/site-nav';
import { CAMERA_PARTS, PART_LABELS } from './app/inspection';
import { connectedStory, mountConnectedStory } from './app/connected-story';
import { GLOSSARY } from './app/glossary';
import { evidenceIndex, evidenceSearch, evidenceDisplay, readerLocator } from './app/evidence-index';
import { glossify } from './app/gloss';
import { RAY_FIG_HTML, mountRayFigure } from './app/ref-focus-figure';

const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
const page = new URLSearchParams(location.search).get('page') ?? 'story';
const titles: Record<string, string> = { story: 'The story', evidence: 'Evidence', method: 'Method', glossary: 'Glossary', parts: 'Parts' };
const active = page in titles ? page : 'story';
document.title = `${titles[active]} · Photon to Photo`;
const canonical = document.createElement('link');
canonical.rel = 'canonical';
canonical.href = `https://reedos.dev/photon_to_photo/reference.html?page=${active}`;
document.head.append(canonical);
document.getElementById('topnav')!.innerHTML = siteNavigation(active);
const link = (label: string, piece = 'camera', part = '', lesson = '') => `<a class="btn" data-piece="${piece}" data-part="${part}"${lesson ? ` data-lesson="${lesson}"` : ''} href="./index.html?piece=${piece}${part ? '&part=' + part : ''}${lesson ? '&lesson=' + lesson : ''}">${label} →</a>`;
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
const glossary = GLOSSARY;

// Score loop r5: one small diagram per Method block (the page was text only). Both are schematics drawn for the page, not
// computed: the ray figure is now live (src/app/ref-focus-figure.ts, score loop r6: drag the point and the sensor goes from a dot to
// a disk); this one is the chain a photon follows inside one pixel. They carry no numbers.
const PIXEL_FIG = `<figure class="ref-fig"><svg viewBox="0 0 300 120" role="img" aria-label="Schematic: a photon passes a microlens and a color filter, is absorbed in a photodiode, its charge collects in a well and is read out as a number"><title>The chain inside one pixel</title>
<g stroke="currentColor" fill="none" stroke-width="1.2"><path d="M20 38 A20 14 0 0 1 60 38Z" fill="currentColor" fill-opacity=".1"/><rect x="20" y="42" width="40" height="10" fill="#5ce1c6" fill-opacity=".35"/><rect x="20" y="56" width="40" height="24" fill="#47cfff" fill-opacity=".18"/><rect x="104" y="40" width="36" height="52" opacity=".9"/><rect x="105" y="68" width="34" height="23" fill="#9dffe6" fill-opacity=".45" stroke="none"/><path d="M60 68 H84 V76 H104" stroke-dasharray="3 3"/><path d="M140 66 H182" /><path d="M176 62 L182 66 L176 70"/></g>
<g stroke="#fff0bb" stroke-width="1.5"><path d="M40 6 L40 62" stroke-dasharray="2 3"/></g><circle cx="40" cy="62" r="3" fill="#c3ffe0"/>
<rect x="188" y="52" width="92" height="28" rx="2" fill="none" stroke="currentColor" stroke-width="1.2"/><g fill="currentColor" font-size="11" font-family="inherit" text-anchor="middle"><text x="40" y="100">lens + filter</text><text x="40" y="111">photodiode</text><text x="122" y="106">well</text><text x="234" y="70" font-size="11">a number</text><text x="234" y="94">raw value</text></g></svg><figcaption>Schematic: photon, filter, photodiode, charge store, then a number.</figcaption></figure>`;

let content = '';
if (active === 'story') {
  content = connectedStory();
} else if (active === 'parts') {
  content = heading('Page 5 of 5', 'Parts', 'The same parts as the numbered camera sidebar. Each link opens that part in the visualizer; your current camera and shot carry over.')
    + '<div class="ref-actions"><a class="btn" href="./index.html" data-return-view>Return to your view →</a></div><div class="ref-grid">'
    + CAMERA_PARTS.map((id, i) => `<section class="ref-card"><p class="eyebrow">${String(i + 1).padStart(2, '0')} · Camera</p><h2>${PART_LABELS[id]}</h2><p>${descriptions[id]}</p>${link('Show this part', 'camera', id)}</section>`).join('') + '</div>';
} else if (active === 'glossary') {
  content = heading('Page 4 of 5', 'Glossary', 'Terms used by the camera, optics, focus and pixel views. Each definition links back to the place where you can explore it.')
    + '<label class="ref-search">Find a term<input type="search" id="ref-search" placeholder="Aperture, ISO, bokeh…"></label><div class="ref-search-status"><p id="search-count" role="status"></p><button class="btn" id="ref-clear" type="button" hidden>Clear search</button></div><dl>'
    + [...glossary].sort((a, b) => a[0].localeCompare(b[0], 'en', { sensitivity: 'base' })).map(([term, definition, piece, part, lesson]) => `<div data-search="${escape(term + ' ' + definition)}"><dt>${term}</dt><dd>${definition}<br>${link('See it in the visualizer', piece, part, lesson)}</dd></div>`).join('') + '</dl>';
} else if (active === 'method') {
  content = heading('Page 3 of 5', 'Method', 'Camera settings drive the optical model, mechanisms and measurements. Focused sensor experiments explain the physics; supplied photographs connect it to real moments.')
    + `<h2>From glass to image</h2><div class="ref-grid">
    <section class="ref-card"><h2>Optics</h2><p>Lens prescriptions provide surfaces, spacings and glass properties. Rays are traced through those surfaces. The focus solver moves the modeled optic, while the iris and ray display follow the chosen aperture.</p>${RAY_FIG_HTML}${link('Inspect the rays', 'lens', 'glass')}</section>
    <section class="ref-card"><h2>Sensor and photo</h2><p>Pixel inspection uses a controlled neutral target and the sensor model. Image Pipeline processes a small illustrative color sample. Neither experiment reconstructs the original sensor data of a supplied photograph.</p>${PIXEL_FIG}${link('Inspect a pixel', 'loupe', 'sensor')}</section></div>
    <h2>In plain words</h2><ul class="method-plain"><li><b>Real:</b> the lens designs come from published patents, camera facts from published specifications, and every ray is traced by the physics engine.</li><li><b>Illustrative:</b> the camera’s outside, the animations, and the sparks that stand for photons.</li><li><b>Assumed:</b> anything with no measurement behind it. Its evidence label says Assumed.</li></ul>
    <h2>What to keep in mind</h2><ul><li>The camera exterior and some assemblies are illustrative.</li><li>A public patent example is not proof of a commercial lens’s exact production prescription.</li><li>Every lens is assumed to pass 90% of the light (about 1/7 stop lost); coatings and element losses are not modeled one by one.</li><li>The color filters are a representative shape fitted to a Nikon D700, not the selected camera’s measured curves.</li><li>Animations of real photographs and of an exposure explain how a picture like it is made. They do not recover the original RAW data, and exposure playback stretches time.</li><li>Sensor values include measurements, estimates and assumptions. The evidence label remains part of the claim.</li></ul>
    <details class="method-specialists"><summary>Model details for specialists</summary><ul><li>Each lens’s focusing groups move as its patent tabulates them. Where a patent lists that motion only down to a farther distance than the product focuses (the 50 mm f/1.8 below 1.7 m), the groups keep moving the same way past the table, an assumption that lens’s Optics focus card states. Where a prescription gives no focusing figures at all, a stand-in motion moves the whole optic, and the cards say so; no lineup lens needs one now.</li><li>Autofocus is modeled as a camera does it: at every distance the sensor sits at the best focus of a point on the axis, found by tracing red, yellow and blue light through the lens wide open. That best focus lies a little short of the paraxial image and by an amount that changes with distance, so the model re-solves it for each distance. Stopping down afterward keeps that focus, so a fast lens shows its focus shift.</li><li>Ray and photon colors give each wavelength its hue at a normalized display brightness, so violet and deep red stay visible. The brightness of a colored line or dot does not show how much light it carries.</li><li>Depth of field keeps the textbook convention: near and far limits use the paraxial rule (the small-angle, ideal-lens formula) for yellow light at 587.6 nm, and an assumed acceptable blur diameter, the circle of confusion (format diagonal / 1500). Real lenses add focus shift and color, which the cone's traced disk shows. The range is geometric: it leaves out diffraction, and where the Airy disk is itself wider than that blur (on a full-frame format, from about f/21) even a perfectly focused point is softer than the criterion, which the focus card says. Exposure readouts identify their reference scene or reflectance.</li><li>The Focus level’s traced disk is rays only (geometric optics); diffraction is not added to it. The Airy disk for the working f-number at 550 nm is listed beside it, in micrometers and pixels, and a real recorded point is never smaller than that. Past about f/11 the Airy disk is the larger part of an in-focus point on this sensor’s pixels, so the traced disk understates how soft a stopped-down point is. The Waves &amp; diffraction view shows the diffraction pattern itself.</li><li>Exposure playback stretches time and represents many photons with each dot. Its timing and dot-count explanations are under Exposure details.</li><li>Every photon, electron, well and raw-value figure includes the assumed 90% lens transmission. Those readouts are for the frame center. Toward the corners the frame naturally gets darker, because light arrives there at an angle and sees a smaller, tilted opening (the cos⁴ falloff); the engine’s test-only image render applies that darkening, and the center readouts need none. The site shows no rendered photograph: its pipeline lesson uses an illustrative chart. Photon counts cover the engine's 380–780 nm band (16 wavelength bins).</li><li>The sensors’ absolute sensitivity is calibrated to each body’s measured ISO. For an 18% gray at the exposure the meter picks, ISO 12232 expects a green pixel at about 11% of its raw clip at the ISO setting (with the assumed 90% lens transmission). DxOMark’s measured, saturation-based ISO, as Bill Claff charts it, is lower than the setting: 0.699 of it for the D850 and 0.740 for the Z8 (about 0.5 stop), so the expected level at the measured ISO is about 7.9% for the D850 and 8.4% for the Z8. The color sensitivity curves are scaled so a metered gray in 5500 K daylight lands there (a green peak of about 52% for both bodies, a derived effective figure, not a published peak quantum efficiency; Claff’s own 44% effective quantum efficiency for the D850 is the starting scale and a cross-check). That measured ISO is third-party, and one body of each model; real copies vary by about a stop. The sensor card lists both levels.</li><li>Well fill and signal-to-noise figures describe a pixel only below its usable limit, the lower of its full well and the point where the raw value clips (at every ISO the converter clips first). Past that limit the cards say the patch is clipped and give no signal-to-noise number, because the formula has no clip and would make a blown patch look clean. A pixel’s “mean” electron count is the value before any clipping.</li><li>All light is assumed to enter the design diffraction order of a Phase Fresnel element. Real PF elements send a little into other orders, which adds flare and costs some contrast; that loss is not modeled.</li><li>The engine’s image render uses the ideal cos⁴ falloff and a straight-line (rectilinear) projection. It has no lens distortion, no extra corner darkening from the barrel, and no traced aberration. The cone and the ray fans do show the traced vignetting and aberration.</li><li>When a patent gives only nd and vd for a glass or resin with no catalog match, the model keeps that nd and vd exactly and borrows the nearest catalog glass's dispersion shape, so color far from the 587.6 nm d line is approximate. Where the patent also states the glass's partial dispersion (θgF), the model matches that too, as for the SR-type element of the 800 mm PF design. The thin resin layers of a PF element barely affect focus: changing their dispersion moves the 800 mm lens's blue focus by under 3 µm.</li></ul></details>
    <h2>Smaller formats</h2><p>Choosing a smaller format (APS-C, for example) on the two full-frame bodies uses the middle part of the same sensor, as the camera’s own crop mode does: each pixel stays the same size and is just as noisy. The readout time stays the full-frame measurement or estimate; no crop-mode speed was measured.</p><h2>How sharp counts as sharp</h2><p>Depth of field depends on an agreed blur limit, the circle of confusion, stated on the Focus level’s depth-of-field card. To see the sharp range, compare those near and far limits with the traced blur disk on the Focus level.</p>
    <h2>How it is checked</h2><p>Every drawn ray is compared with an independent calculation, the blur disks are compared with the geometry of their ray bundles, and the pixel numbers are compared with sensor predictions. The site’s controls and layouts are re-checked automatically on phone and desktop sizes after every change.</p>
    <h2>Reading evidence labels</h2><p>Spec, Vendor, Reported, Calc. and Assumed distinguish source types. Calculated does not mean measured: a result inherits the limitations of its inputs.</p><a class="btn" href="./reference.html?page=evidence">Open evidence →</a>`;
} else {
  content = heading('Page 2 of 5', 'Evidence', 'Source links recorded with the camera and lens data. This index exposes the existing records; inclusion does not mean a source has been newly verified or that every parameter is known.')
    + '<details class="evidence-label-key"><summary>How to read evidence labels</summary><dl><dt>Spec</dt><dd>A published specification.</dd><dt>Vendor</dt><dd>A maker’s claim or published characterization.</dd><dt>Reported</dt><dd>A third party’s report or measurement.</dd><dt>Calc.</dt><dd>A result calculated from the model and its inputs.</dd><dt>Assumed</dt><dd>An explicit modeling choice where a measurement is unavailable or the scenario requires one.</dd></dl></details>'
    + '<figure class="evidence-summary" id="evidence-summary" hidden></figure>'
    + '<h2>Recorded source index</h2><label class="ref-search">Filter sources<input type="search" id="ref-search" placeholder="D850, patent, read noise…"></label><div class="ref-search-status"><p id="search-count" role="status"></p><button class="btn" id="ref-clear" type="button" hidden>Clear search</button></div><p class="evidence-help">Each row is one web source behind numbers in the model: a camera’s published figures, a lens patent, or a noise measurement. Rows are grouped by the camera or lens they belong to.</p><p class="evidence-help">Search a camera, parameter or citation. Open a source’s recorded uses to see which fields cite it and the evidence labels attached to those records.</p><div id="evidence-list"></div>';
}
document.getElementById('reference-main')!.innerHTML = content;
mountRayFigure(document);
if (active === 'story') mountConnectedStory();
// Score loop r3: the Method page glosses the first use of each glossary term, as the app's cards do (its prose used
// terms such as paraxial and circle of confusion with no way to look them up).
if (active === 'method') {
  const seen = new Set<string>();
  document.querySelectorAll<HTMLElement>('#reference-main :is(p, li):not(.eyebrow)').forEach(node => {
    if (!node.children.length && node.textContent) glossify(node, node.textContent, seen);
  });
}

if (active === 'evidence') {
  // An explicit allowlist keeps unrelated datasets out of the public reference bundle.
  const records = import.meta.glob(['../data/d850.json', '../data/z8.json', '../data/read-noise.json',
    '../data/lenses/{s35,n50,n500,n500fl,z35,m50,z800}.json'], { eager: true, import: 'default' });
  const sources = evidenceIndex(records);
  // A compact summary above the list (score loop r4): how the recorded uses divide among the five evidence labels, counted from
  // the same records the list shows. A use with no label on its record is counted as unlabeled, never assigned one.
  const KINDS: [string, string][] = [['spec', 'Spec'], ['vendor', 'Vendor'], ['reported', 'Reported'], ['derived', 'Calc.'], ['assumed', 'Assumed'], ['', 'No label on the record']];
  const tally = new Map<string, number>();
  for (const s of sources) for (const use of s.uses) { const k = KINDS.some(([id]) => id === use.evidence) ? use.evidence : ''; tally.set(k, (tally.get(k) ?? 0) + 1); }
  const total = [...tally.values()].reduce((a, b) => a + b, 0);
  const summary = document.getElementById('evidence-summary');
  if (summary && total) {
    summary.hidden = false;
    summary.innerHTML = `<figcaption><b>${total}</b> recorded uses across <b>${sources.length}</b> sources, by evidence label</figcaption>`
      + '<p class="evidence-help">The index lists sourced records only. Assumptions with no source (scene light, lens transmission, dark current, pixel-to-pixel variation, the blur criterion) are on the cards labeled Assumed.</p>'
      + `<div class="ev-bar" role="img" aria-label="${KINDS.filter(([id]) => tally.get(id)).map(([id, name]) => `${name} ${tally.get(id)}`).join(', ')}">`
      + KINDS.filter(([id]) => tally.get(id)).map(([id, name]) => `<i class="ev-seg ev-${id || 'none'}" style="flex-grow:${tally.get(id)}" title="${escape(name)}: ${tally.get(id)}"></i>`).join('') + '</div>'
      + '<ul class="ev-key">' + KINDS.filter(([id]) => tally.get(id)).map(([id, name]) => `<li><i class="ev-dot ev-${id || 'none'}"></i>${escape(name)} <b>${tally.get(id)}</b></li>`).join('') + '</ul>';
  }
  const rowHtml = (source: (typeof sources)[number]) => {
    const kinds = [...new Set(source.uses.map(use => use.evidence).filter(Boolean))];
    // score loop r2: the reader-facing part of each record shows by default; how it was retrieved is collapsed
    const first = readerLocator(source.uses[0].locator).summary;
    const located = (locator: string) => {
      const r = readerLocator(locator);
      return (r.summary ? '<p>' + escape(r.summary) + '</p>' : '')
        + (r.notes ? `<details class="retrieval-notes"><summary>Retrieval notes</summary><p>${escape(r.notes)}</p></details>` : '');
    };
    return `<article class="evidence-row" data-search="${escape(evidenceSearch(source))}"><b>${escape(evidenceDisplay(source.label).name)}<small>${escape(kinds.join(' · ') || 'Source record')}</small></b><div><a href="${escape(source.url)}" target="_blank" rel="noopener noreferrer">${escape(first || new URL(source.url).hostname)}</a><small>${escape(source.url)}</small><details class="evidence-uses"><summary>${source.uses.length} recorded ${source.uses.length === 1 ? 'use' : 'uses'}</summary><ul>${source.uses.map(use => `<li><code>${escape(use.path)}</code><span>${escape(use.evidence || 'No evidence label on this record')}${use.evidence && use.evidencePath !== use.path ? ' · from enclosing record ' + escape(use.evidencePath || 'root') : ''}</span>${use.locator ? located(use.locator) : ''}</li>`).join('')}</ul></details></div></article>`;
  };
  const groups = ['Cameras', 'Lenses', 'Other records'];
  document.getElementById('evidence-list')!.innerHTML = groups.map(group => {
    const rows = sources.filter(source => evidenceDisplay(source.label).group === group);
    return rows.length ? `<section class="evidence-group"><h3>${group}</h3>${rows.map(rowHtml).join('')}</section>` : '';
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
    document.querySelectorAll<HTMLElement>('.evidence-group').forEach(group => { group.hidden = !group.querySelector('[data-search]:not([hidden])'); });
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
    if (anchor.dataset.lesson) params.set('lesson', anchor.dataset.lesson); else params.delete('lesson');
    anchor.href = './index.html?' + params;
  });
} catch { /* default links still work */ }
mountSiteNavigation();
