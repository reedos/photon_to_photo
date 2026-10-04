// The model viewer (models.html): the scripted-Blender bodies and lenses in public/models, the lens mounted on its
// body exactly as it seats (both share the sensor-at-z=0 frame), rotatable, with the cutaway and every named part
// selectable. Reed opens it from the status dashboard on his phone, so it runs the WebGL2 tier there (plain HTTP on
// the tailnet is not a secure context) and WebGPU on the PC.
//
//   models.html?body=dslr|mirrorless&lens=<id>|none&view=outside|cutaway&part=<component>
import { siteNavigation, mountSiteNavigation } from './site-nav';
import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import facts from '../../public/models/bodies.json';
import lensFacts from '../../public/models/lenses.json';
import * as look from './look';
import { sharedAssetLoader, materialHighlight } from './model-resources';

type BodyId = 'dslr' | 'mirrorless';
type ViewId = 'outside' | 'cutaway';
interface LensFact { body: BodyId; label: string; focalLength: number; markedFno: number; lengthMm: number; diameterMm: number;
  filterMm: number; filterKind: string; elementCount: number; groupCount: number; iris: { blades: number; rounded: boolean };
  representativeOf: string | null; clipped: { element: number; sd: number; shown: number }[]; focusRingThrowDeg: number }
const LENSES = (lensFacts as unknown as { lenses: Record<string, LensFact> }).lenses;
// the lineup in order, and the lens each body opens with (the ones Reed owns first)
const LINEUP: Record<BodyId, string[]> = { dslr: ['s35', 'n50', 'n500', 'n500fl'], mirrorless: ['z35', 'm50', 'z800'] };
const DEFAULT_LENS: Record<BodyId, string> = { dslr: 'n50', mirrorless: 'm50' };

// Parts that sit inside: picking one switches to the cutaway so it can be seen.
const INSIDE = new Set([
  'mirrorBox', 'mirror', 'subMirror', 'focusingScreen', 'prism', 'prismHousing', 'shutter', 'shutterCurtainFront',
  'shutterCurtainRear', 'filterStack', 'pixelArray', 'sensorDie', 'sensorPackage', 'bondWires', 'ibisPlate',
  'ibisActuators', 'ibisYoke', 'lightBox', 'evfPanel', 'evfPanelCarrier',
  'glass', 'cells', 'irisBlades', 'irisHousing',
]);
const isElement = (n: string) => /^element\d+$/.test(n);
const isInside = (n: string) => INSIDE.has(n) || isElement(n);
// Never listed: roots, the cut shell, groups of listed parts, markers.
const UNLISTED = new Set(['body', 'shellCut', 'evf', 'topDials', 'lens', 'mountFace', 'specText']);
// Kept whole in the cutaway even though their centers sit on the removed half.
const KEEP_IN_CUT = new Set(['mount', 'mountLugs', 'contacts', 'mountBoss']);
const LENS_ORDER = ['focusRing', 'controlRing', 'distanceScale', 'distanceWindow', 'switches', 'hoodBayonet', 'barrel',
  'tripodCollar', 'tripodFoot', 'dropInFilter', 'lensMount', 'lensLugs', 'lensContacts', 'apertureLever'];

// What each part does, in a sentence. Generic camera facts; the numbers come from bodies.json and lenses.json.
const NOTES: Record<string, string> = {
  shellClosed: 'The body casing. The generic bodies follow the published outside dimensions of the D850 and the Z8.',
  grip: 'The rubber hand grip. The battery sits inside it on real bodies.',
  mount: 'The bayonet lens mount. Its face sits exactly one flange distance in front of the sensor.',
  mountLugs: 'The bayonet lugs: the lens turns until its own lugs lock behind these.',
  contacts: 'Gold contacts that carry power and data between the body and the lens: aperture, focus, the lens ID.',
  modeDial: 'Chooses the exposure mode: manual, aperture priority, shutter priority, program.',
  expCompDial: 'Exposure compensation: brightens or darkens what the meter picks, in thirds of a stop.',
  commandDialFront: 'The front command dial, under the index finger. Sets the aperture in manual.',
  commandDialRear: 'The rear command dial, under the thumb. Sets the shutter speed in manual.',
  shutterButton: 'Half press to focus and meter, full press to take the picture.',
  lensReleaseButton: 'Unlocks the bayonet so the lens can turn off the mount.',
  afModeLever: 'Switches autofocus between single, continuous and manual.',
  strapLug: 'Strap attachment point.',
  portDoor: 'Rubber door over the ports: USB, HDMI, microphone, headphones, remote.',
  hotShoe: 'The accessory shoe for a flash, with contacts for its timing and metering.',
  rearScreen: 'The rear screen for live view, playback and menus.',
  topLcd: 'The top status panel: settings and shots left at a glance.',
  eyecup: 'The rubber eyecup of the optical viewfinder.',
  evfHousing: 'The electronic viewfinder housing.',
  evfEyecup: 'The rubber eyecup of the electronic viewfinder.',
  evfPanel: 'The viewfinder display: a micro-OLED panel about 13 mm across, magnified by the eyepiece lenses behind it.',
  evfPanelCarrier: 'The board that holds the viewfinder panel.',
  mirrorBox: 'The blackened box around the light path between the mount and the shutter.',
  mirror: 'The main mirror at 45 degrees: sends the image up to the viewfinder, then swings up out of the way for the exposure.',
  subMirror: 'A small mirror behind the half-silvered center of the main mirror. It sends light down to the autofocus module.',
  focusingScreen: 'The image forms here, at the same optical distance from the mirror as the sensor, so what looks sharp in the finder is sharp on the sensor.',
  prism: 'The pentaprism folds the image on the focusing screen upright and the right way round for the eye.',
  prismHousing: 'The housing over the pentaprism.',
  shutter: 'The focal-plane shutter: two curtains that run across the sensor. The gap between them is the exposure time.',
  shutterCurtainFront: 'The front curtain opens to start the exposure.',
  shutterCurtainRear: 'The rear curtain follows to end it. At fast speeds only a slit between the two crosses the sensor.',
  filterStack: 'Filters in front of the pixels: IR cut, low-pass and cover glass, 2 mm in all. The lens designs account for it.',
  pixelArray: 'The active area, 35.9 x 23.9 mm, at the sensor plane z = 0. Every pixel counts photons during the exposure.',
  sensorDie: 'The silicon die. The pixel array is its top surface.',
  sensorPackage: 'The ceramic package the die is bonded into.',
  bondWires: 'Fine gold wires from the edge of the die to the package pads.',
  ibisPlate: 'In-body stabilization: the sensor rides on this plate, which moves up to about 2 mm on five axes to cancel shake.',
  ibisActuators: 'Voice coils and magnets that move the stabilization plate.',
  ibisYoke: 'The fixed yoke the stabilization plate moves against.',
  lightBox: 'The short blackened throat between the mount and the sensor.',
  // the lens
  barrel: 'The lens barrel, built to the published length and diameter. Its wall carries every ring and holds the element cells inside.',
  focusRing: 'Turn it to focus. What each position means comes from the lens’s own optics, where the engine solves the focusing group’s travel; the ring’s total turn is an assumed figure, since no maker publishes it.',
  controlRing: 'A programmable ring: aperture, ISO or exposure compensation, as the camera assigns it.',
  distanceScale: 'The distance scale turns with the focus ring. Its marks sit where the lens’s own focus travel puts each distance.',
  distanceWindow: 'The window over the distance scale; the line behind it is the index.',
  switches: 'Slide switches on the photographer’s side of the barrel.',
  hoodBayonet: 'The hood locks onto these tabs; the dot lines it up.',
  tripodCollar: 'The collar carries the weight at the balance point and turns for vertical framing.',
  tripodFoot: 'The foot that goes on the tripod head, so the mount does not carry the lens.',
  dropInFilter: 'A filter slides in here near the rear, where the beam is small, instead of across the huge front.',
  lensMount: 'The lens half of the bayonet. Its rear face seats on the body’s mount face at the flange distance.',
  lensLugs: 'The lens’s bayonet lugs: they pass through the body’s gaps, then turn behind its lugs to lock.',
  lensContacts: 'The lens’s contacts meet the body’s: power, the lens ID, focus and aperture commands.',
  apertureLever: 'The body pushes this lever to stop the lens down to the set aperture at the moment of exposure.',
  glass: 'Every element of the prescription, lathed from its real surface curvatures and placed where the engine traces it.',
  cells: 'The black cells that hold each element on the axis and keep stray light off the edges.',
  irisBlades: 'The iris. Its blades close to set the aperture: each full stop halves the area of the opening.',
  irisHousing: 'The iris housing at the aperture stop.',
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);
const state = {
  body: (params.get('body') === 'mirrorless' ? 'mirrorless' : 'dslr') as BodyId,
  lens: params.get('lens') as string | null,
  view: (params.get('view') === 'cutaway' ? 'cutaway' : 'outside') as ViewId,
  part: params.get('part') as string | null,
};
if (state.lens !== 'none' && !(state.lens && LENSES[state.lens]?.body === state.body)) state.lens = DEFAULT_LENS[state.body];

const canvas = $<HTMLCanvasElement>('gl');
const viewEl = $('view');
const veil = $('veil');
const HIGHLIGHT = new THREE.Color(0xe6ba82);
const selectionHighlight = materialHighlight(HIGHLIGHT, 0.14);
const assembly = new THREE.Group();          // the body and, when one is mounted, the lens
let bodyRoot: THREE.Group | null = null;
let lensRoot: THREE.Group | null = null;
let renderer: THREE.WebGPURenderer;
let camera: THREE.PerspectiveCamera;
let controls: OrbitControls;
let scene: THREE.Scene;
let loader: GLTFLoader;

function syncUrl() {
  const p = new URLSearchParams();
  p.set('body', state.body);
  p.set('lens', state.lens ?? 'none');
  p.set('view', state.view);
  if (state.part) p.set('part', state.part);
  history.replaceState(null, '', `${location.pathname}?${p}`);
}

/** The selectable name for a hit: the nearest named ancestor, with a cutaway half mapped to its whole part. */
function componentName(o: THREE.Object3D | null): string | null {
  for (let n = o; n; n = n.parent) {
    const c = n.userData?.component as string | undefined;
    if (!c || c === 'body' || c === 'topDials' || c === 'evf' || c === 'lens') continue;
    if (c === 'shellCut') return 'shellClosed';
    if (n.userData.cutaway === 'half' && c.endsWith('Cut')) return c.slice(0, -3);
    return c;
  }
  return null;
}

function centerX(o: THREE.Object3D) {
  const b = new THREE.Box3().setFromObject(o);
  return (b.min.x + b.max.x) / 2;
}

// The cutaway: cut shells and half parts replace the whole ones, and outside parts on the removed half (x < 0) go.
function applyView() {
  const cut = state.view === 'cutaway';
  assembly.traverse((o) => {
    const c = o.userData?.component as string | undefined;
    if (c === 'shellClosed') o.visible = !cut;
    else if (c === 'shellCut') o.visible = cut;
    else if (o.userData.cutaway === 'full') o.visible = !cut;
    else if (o.userData.cutaway === 'half') o.visible = cut;
    else if (o.userData.onRemovedHalf) o.visible = !cut;
  });
}

// Blender's transmissive glass does not survive the trip into a real-time renderer, so the optical glass is re-dressed
// with the same material the camera level uses (look.ts): dark and deep from outside, the coating's sheen at an angle,
// never a milky plug; a PF layer looks like any other glass from outside (round-0 FID-1).
const FRONT_GLASS = look.opticalGlassMaterial(true);
const INNER_GLASS = look.opticalGlassMaterial(false);

function prepare(root: THREE.Group) {
  root.updateMatrixWorld(true);
  const inFront = (o: THREE.Object3D) => { for (let n: THREE.Object3D | null = o; n; n = n.parent) if (/^element01(Cut)?$/.test(n.name)) return true; return false; };
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && !Array.isArray(mesh.material)) {
      const n = mesh.material.name ?? '';
      if (/^(lensGlass|pfLayer)/.test(n)) mesh.material = inFront(mesh) ? FRONT_GLASS : INNER_GLASS;
      else {
        // the same finish the camera level gets: silicon and dark glass stand-ins, the pebble and paint normal maps
        mesh.material = look.studioReplacement(mesh.material) ?? mesh.material;
        look.tuneStudioMaterial(mesh.material);
        look.applySurfaceFinish(mesh.material, matchMedia('(max-width: 760px)').matches ? 0.7 : 1);
      }
    }
  });
  root.traverse((o) => {
    const c = o.userData?.component as string | undefined;
    if (c && !o.userData.cutaway && !isInside(c) && !KEEP_IN_CUT.has(c) && !UNLISTED.has(c) && c !== 'shellClosed' && c !== 'glass' && centerX(o) < -2) {
      o.userData.onRemovedHalf = true;
    }
  });
  // detail meshes without a component (buttons, bezels, caps) hang off the root node and follow the same rule
  const top = root.getObjectByName('body') ?? root.getObjectByName('lens') ?? root;
  top.children.forEach((o) => {
    if (!o.userData?.component && !o.userData.cutaway && (o as THREE.Mesh).isMesh && centerX(o) < -2) o.userData.onRemovedHalf = true;
  });
}

function unhighlight() {
  selectionHighlight.clear();
}

function highlight(obj: THREE.Object3D) {
  selectionHighlight.add(obj);
}

function select(name: string | null) {
  unhighlight();
  state.part = name;
  const obj = name ? assembly.getObjectByName(name) : null;
  if (name && !obj) state.part = null;
  if (obj && isInside(name!) && state.view !== 'cutaway') setView('cutaway');
  if (obj) {
    highlight(obj);
    const half = assembly.getObjectByName(name + 'Cut');
    if (half && half.userData.cutaway === 'half') highlight(half);
  }
  const label = (obj?.userData.label as string | undefined) ?? '';
  $('sel-t').textContent = obj ? label || name! : 'Nothing yet';
  const d = $('sel-d');
  d.textContent = obj ? NOTES[isElement(name!) ? 'glass' : name!] ?? '' : 'Tap any part of the camera or lens, or pick one from the list. Inside parts switch the view to the cutaway.';
  d.classList.toggle('none', !obj);
  ($('clear') as HTMLButtonElement).disabled = !obj;
  document.querySelectorAll<HTMLButtonElement>('.parts button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.part === state.part)));
  syncUrl();
}

function listParts() {
  const order: string[] = [...(facts as any)[state.body].namedComponents, ...LENS_ORDER];
  const found: { o: THREE.Object3D; group: 'out' | 'lens' | 'in' }[] = [];
  const collect = (root: THREE.Object3D | null, lens: boolean) => root?.traverse((o) => {
    const c = o.userData?.component as string | undefined;
    if (!c || UNLISTED.has(c) || o.name !== c || o.userData.cutaway === 'half' || isElement(c)) return;
    found.push({ o, group: isInside(c) ? 'in' : lens ? 'lens' : 'out' });
  });
  collect(bodyRoot, false);
  collect(lensRoot, true);
  const rank = (n: string) => { const i = order.indexOf(n); return i < 0 ? 999 : i; };
  found.sort((a, b) => rank(a.o.name) - rank(b.o.name));
  const lists = { out: $('parts-out'), lens: $('parts-lens'), in: $('parts-in') };
  const counts = { out: 0, lens: 0, in: 0 };
  for (const l of Object.values(lists)) l.textContent = '';
  for (const { o, group } of found) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.part = o.name;
    b.setAttribute('aria-pressed', 'false');
    b.innerHTML = `<span class="pn">${String(++counts[group]).padStart(2, '0')}</span><span class="pt"></span><span class="pk"></span>`;
    (b.querySelector('.pt') as HTMLElement).textContent = (o.userData.label as string) || o.name;
    (b.querySelector('.pk') as HTMLElement).textContent = group === 'in' ? 'inside' : '';
    b.addEventListener('click', () => select(state.part === o.name ? null : o.name));
    li.append(b);
    lists[group].append(li);
  }
  $('lens-group').hidden = counts.lens === 0;
  $('parts-k').textContent = `Parts · ${found.length}`;
}

function showFacts() {
  const f = (facts as any)[state.body];
  const env = f.envelopeMm;
  const lf = state.lens && state.lens !== 'none' ? LENSES[state.lens] : null;
  $('ttl').textContent = (state.body === 'dslr' ? 'DSLR' : 'Mirrorless') + (lf ? ` + ${lf.focalLength} mm f/${lf.markedFno}` : ' body');
  $('sub').textContent = `${f.mount.type} · flange ${f.mount.flangeMm} mm · throat ${f.mount.throatMm} mm`;
  let t = `Generic and unbranded, built to the published envelope of the ${state.body === 'dslr' ? 'Nikon D850' : 'Nikon Z8'}: ` +
    `${env.width} x ${env.height} x ${env.depth} mm. ${f.mount.lugCount} bayonet lugs, ${f.mount.contactCount} contacts. ` +
    `Sensor ${f.sensor.activeAreaWidthMm} x ${f.sensor.activeAreaHeightMm} mm at z = 0. ` +
    (state.body === 'dslr' ? 'Mirror box and focal-plane shutter inside.' : 'No mechanical shutter; the sensor rides on a stabilization plate.');
  if (lf) {
    t += `\n\nThe lens: ${lf.label}. ${lf.lengthMm} mm long from the mount, ${lf.diameterMm} mm across, ` +
      `${lf.filterMm} mm ${lf.filterKind} filter. ${lf.elementCount} elements in ${lf.groupCount} groups, each lathed from the ` +
      `engine's prescription; ${lf.iris.blades}${lf.iris.rounded ? ' rounded' : ''} iris blades.` +
      (lf.clipped.length ? ` The engine's clear aperture for element${lf.clipped.length > 1 ? 's' : ''} ${lf.clipped.map((c) => c.element).join(' and ')} is wider than this barrel allows (${lf.clipped.map((c) => `${c.sd.toFixed(1)} mm radius`).join(', ')}), so the glass is shown trimmed to the barrel and the engine's margin is under review.` : '');
  }
  $('facts').textContent = t;
}

function frame() {
  const box = new THREE.Box3().setFromObject(assembly);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const fovV = THREE.MathUtils.degToRad(camera.fov);
  const fovH = 2 * Math.atan(Math.tan(fovV / 2) * camera.aspect);
  const dist = (sphere.radius * 1.04) / Math.sin(Math.min(fovV, fovH) / 2);   // the whole sphere in the narrower field: long teles on a phone held upright
  // outside: a front three-quarter; cutaway: swung round to the open side (x < 0) to look into the cut
  const dir = (state.view === 'cutaway' ? new THREE.Vector3(-0.9, 0.3, -0.42) : new THREE.Vector3(-0.62, 0.34, -0.71)).normalize();
  controls.target.copy(sphere.center);
  camera.position.copy(sphere.center).addScaledVector(dir, dist);
  camera.near = dist / 50; camera.far = dist * 20;
  camera.updateProjectionMatrix();
  controls.minDistance = sphere.radius * 0.5;
  controls.maxDistance = dist * 3;
  controls.update();
}

const load = sharedAssetLoader(async (path: string): Promise<THREE.Group> => {
  const gltf = await loader.loadAsync(new URL(path, location.href).href);
  const root = gltf.scene;
  prepare(root);
  return root;
});

function lensButtons() {
  const seg = $('lens-seg');
  seg.textContent = '';
  for (const id of [...LINEUP[state.body], 'none']) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.lens = id;
    const lf = LENSES[id];
    b.textContent = lf ? `${lf.focalLength} f/${lf.markedFno}${id === 'n500' || id === 'z800' ? ' PF' : ''}` : 'No lens';
    b.title = lf ? lf.label : 'The body alone';
    b.setAttribute('aria-pressed', String((state.lens ?? 'none') === id));
    b.addEventListener('click', () => { if ((state.lens ?? 'none') !== id) setRig(state.body, id); });
    seg.append(b);
  }
}

let rigGeneration = 0;
async function setRig(body: BodyId, lens: string | null, keepPart = false) {
  const generation = ++rigGeneration;
  state.body = body;
  state.lens = lens && lens !== 'none' && LENSES[lens]?.body === body ? lens : lens === 'none' ? 'none' : DEFAULT_LENS[body];
  document.querySelectorAll<HTMLButtonElement>('[data-body]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.body === body)));
  lensButtons();
  veil.classList.remove('off', 'err');
  const lf = state.lens !== 'none' ? LENSES[state.lens!] : null;
  $('veil-msg').textContent = `Loading the ${body === 'dslr' ? 'DSLR' : 'mirrorless'} body${lf ? ` and the ${lf.focalLength} mm lens` : ''}`;
  try {
    const [b, l] = await Promise.all([load(`./models/${body}.glb`), lf ? load(`./models/lenses/${state.lens}.glb`) : Promise.resolve(null)]);
    if (generation !== rigGeneration) return; // a later tap won, even if it returned to the same kit
    unhighlight();
    assembly.clear();
    bodyRoot = b; lensRoot = l;
    assembly.add(b);
    if (l) assembly.add(l);
    assembly.updateMatrixWorld(true);
    applyView();
    listParts();
    showFacts();
    frame();
    select(keepPart ? state.part : null);
    veil.classList.add('off');
  } catch (e) {
    if (generation !== rigGeneration) return;
    veil.classList.add('err');
    $('veil-msg').textContent = `Could not load the model: ${(e as Error).message}`;
  }
}

function setView(v: ViewId) {
  state.view = v;
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === v)));
  if (bodyRoot) { applyView(); frame(); }
  if (v === 'outside' && state.part && isInside(state.part)) select(null);
  syncUrl();
}

function lights() {
  // the camera studio (look.ts, round-0 FID-8): the black void with softbox panels, a rim from behind-right-high
  // and a cool kicker from behind-left-low, so black paint reads by its reflections and its edges
  scene.environment = look.buildStudioEnvironment(renderer).texture;
  look.addStudioLights(scene, 1.15);
}

async function main() {
  // ?gl=webgl2 forces the tier a phone gets over plain HTTP on the tailnet, to check it from the PC
  renderer = new THREE.WebGPURenderer({ canvas, antialias: true, forceWebGL: params.get('gl') === 'webgl2' });
  await renderer.init();
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const webgpu = !!(renderer.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend;
  const chip = $('backend');
  chip.classList.toggle('webgl2', !webgpu);
  chip.lastElementChild!.textContent = webgpu ? 'WebGPU' : 'WebGL2';
  chip.title = webgpu ? 'Rendering with WebGPU' : 'Rendering with WebGL2 (WebGPU needs a secure context; plain HTTP on the tailnet is not one)';

  // the lenses are Draco-compressed; the plain-JS decoder, since the review server's CSP does not allow WebAssembly
  const draco = new DRACOLoader().setDecoderPath(new URL('./draco/', location.href).href);
  loader = new GLTFLoader().setDRACOLoader(draco);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x080d14);
  scene.add(assembly);
  camera = new THREE.PerspectiveCamera(32, 1, 1, 5000);
  controls = new OrbitControls(camera as unknown as THREE.Camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  lights();

  let viewportWidth = 0, viewportHeight = 0;
  const resize = () => {
    const w = viewEl.clientWidth, h = viewEl.clientHeight;
    if (w < 1 || h < 1 || (w === viewportWidth && h === viewportHeight)) return;
    viewportWidth = w; viewportHeight = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    if (bodyRoot) frame();
  };
  new ResizeObserver(resize).observe(viewEl);
  resize();

  // a tap selects; a drag only rotates
  const ray = new THREE.Raycaster();
  let down: { x: number; y: number } | null = null;
  canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || !bodyRoot || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) { down = null; return; }
    down = null;
    const r = canvas.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    const visible = (o: THREE.Object3D) => { for (let n: THREE.Object3D | null = o; n; n = n.parent) if (!n.visible) return false; return true; };
    const hit = ray.intersectObject(assembly, true).find((h) => visible(h.object));
    const name = hit ? componentName(hit.object) : null;
    if (name === 'shellClosed' && state.view === 'cutaway') return select(null);
    select(name && name !== state.part ? name : null);
  });

  document.querySelectorAll<HTMLButtonElement>('[data-body]').forEach((b) =>
    b.addEventListener('click', () => { if (b.dataset.body !== state.body) setRig(b.dataset.body as BodyId, null); }));
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) =>
    b.addEventListener('click', () => setView(b.dataset.view as ViewId)));
  $('reset').addEventListener('click', () => bodyRoot && frame());
  // the site bar's menu on a phone, as on the main page

  $('clear').addEventListener('click', () => select(null));

  renderer.setAnimationLoop(() => {
    if (document.hidden) return;
    controls.update(); renderer.render(scene, camera);
  });
  setView(state.view);
  await setRig(state.body, state.lens, true);
  (window as unknown as { p2pModels: unknown }).p2pModels = { scene, camera, renderer, state, ready: true };
}

$('topnav').innerHTML = siteNavigation('models');
mountSiteNavigation();
$('model-retry').addEventListener('click', () => {
  if (loader) void setRig(state.body, state.lens, true);
  else location.reload();
});
main().catch((e) => {
  veil.classList.remove('off');
  veil.classList.add('err');
  $('veil-msg').textContent = `This device could not start the 3D view: ${(e as Error).message}`;
});
