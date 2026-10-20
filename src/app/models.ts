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
import { dracoLoader } from '../scene/draco';
import facts from 'virtual:p2p-facts/bodies';
import lensFacts from 'virtual:p2p-facts/lenses';
import * as look from './look';
import { capCutParts } from '../scene/section-caps';
import { sharedAssetLoader, materialHighlight } from './model-resources';
import { compileInSteps } from '../scene/compile-steps';

type BodyId = 'dslr' | 'mirrorless';
type ViewId = 'outside' | 'cutaway';
interface LensFact { body: BodyId; label: string; focalLength: number; markedFno: number; lengthMm: number; diameterMm: number;
  filterMm: number; filterKind: string; elementCount: number; groupCount: number; iris: { blades: number; rounded: boolean };
  representativeOf: string | null; clipped: { element: number; sd: number; shown: number }[]; focusRingThrowDeg: number;
  glbLite?: string }
const LENSES = (lensFacts as unknown as { lenses: Record<string, LensFact> }).lenses;
/** The lens file to load (score loop r5, 10/11/2026): on a phone-width screen the lighter variant (lens_v2.py --lite: half the
 *  segments round the axis, about 40% fewer triangles, the same parts and names), the full one elsewhere. */
function lensFile(id: string): string {
  const lite = LENSES[id]?.glbLite;
  return lite && matchMedia('(max-width: 760px)').matches ? `./${lite.replace(/^public\//, '')}` : `./models/lenses/${id}.glb`;
}
// the lineup in order, and the lens each body opens with (the ones Reed owns first)
const LINEUP: Record<BodyId, string[]> = { dslr: ['s35', 'n50', 'n500', 'n500fl'], mirrorless: ['z35', 'm50', 'z800'] };
const DEFAULT_LENS: Record<BodyId, string> = { dslr: 'n50', mirrorless: 'm50' };

// Parts that sit inside: picking one switches to the cutaway so it can be seen.
const INSIDE = new Set([
  'mirrorBox', 'mirror', 'subMirror', 'focusingScreen', 'prism', 'prismHousing', 'shutter', 'shutterCurtainFront',
  'shutterCurtainRear', 'filterStack', 'pixelArray', 'sensorDie', 'sensorPackage', 'bondWires', 'ibisPlate',
  'ibisActuators', 'ibisYoke', 'lightBox', 'evfPanel', 'evfPanelCarrier', 'eyepieceOptics', 'battery',
  'afModule', 'glass', 'cells', 'irisBlades', 'irisHousing',
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
  grip: 'The rubber hand grip. The battery sits inside it on real bodies. Its profile is generic: the plan follows Nikon’s top drawing, the finger channel and bulge are the model’s own.',
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
  subMirror: 'A small mirror behind the half-silvered center of the main mirror. It sends light down to the autofocus module under the mirror-box floor.',
  focusingScreen: 'The image forms here, at the same optical distance from the mirror as the sensor, so what looks sharp in the finder is sharp on the sensor.',
  prism: 'The roof pentaprism folds the image on the focusing screen upright, and its roof flips it left to right, so the eye sees it correctly oriented.',
  eyepieceOptics: 'The eyepiece lenses carry the image from the prism to the eye. Drawn schematically: no maker publishes them.',
  afModule: 'The phase-detect autofocus module under the mirror box: a field lens, separator lenses and pairs of line sensors that compare two views of the subject to find the focus error. Drawn schematically: no maker publishes its dimensions.',
  battery: 'The battery, standing in the grip: the size of the 40 x 56 x 20.5 mm EN-EL15c.',
  prismHousing: 'The housing over the pentaprism.',
  shutter: 'The focal-plane shutter: two curtains that run across the sensor. The gap between them is the exposure time.',
  shutterCurtainFront: 'The front curtain opens to start the exposure.',
  shutterCurtainRear: 'The rear curtain follows to end it. At fast speeds only a slit between the two crosses the sensor.',
  filterStack: 'Filters in front of the pixels: IR cut and cover glass, 2 mm in all (a representative thickness). Neither the D850 nor the Z8 has an optical low-pass filter; Nikon lists both as low-pass-filter-less. The lens designs account for the glass.',
  pixelArray: 'The active area, 35.9 x 23.9 mm, at the sensor plane z = 0. Every pixel counts photons during the exposure.',
  sensorDie: 'The silicon die. The pixel array is its top surface.',
  sensorPackage: 'The ceramic package the die is bonded into.',
  bondWires: 'Fine gold wires from the edge of the die to the package pads.',
  ibisPlate: 'In-body stabilization: the sensor rides on this plate, which moves on five axes to cancel shake. Its travel range is not modeled.',
  ibisActuators: 'Voice coils and magnets that move the stabilization plate.',
  ibisYoke: 'The fixed yoke the stabilization plate moves against.',
  lightBox: 'The short blackened throat between the mount and the sensor.',
  // the lens
  barrel: 'The lens barrel, built to the published length and diameter. Its wall carries every ring and holds the element cells inside.',
  focusRing: 'Turn it to focus. What each position means comes from the lens’s own optics, where the simulator works out the focusing group’s travel; the ring’s total turn is an assumed figure, since no maker publishes it.',
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
  glass: 'Every element of the published lens design, shaped from its real surface curvatures and placed where the simulator traces rays.',
  cells: 'The black cells that hold each element on the axis and keep stray light off the edges.',
  irisBlades: 'The iris. Its blades close to set the aperture: each full stop halves the area of the opening.',
  irisHousing: 'The iris housing at the aperture stop.',
  // Controls whose cards were a title and nothing else (score loop r6). The wording follows the makers' manuals; the
  // sources are in research/model-part-notes.md. A key written 'dslr:name' or 'mirrorless:name' applies to that body only.
  'dslr:releaseModeDial': 'Chooses the release mode: single frame, continuous low or high speed, quiet, self-timer or mirror up. Press its lock release, then turn it to the mark.',
  afOnButton: 'Pressing it does what a half press of the shutter button does, so the thumb can start autofocus while the finger stays off the shutter.',
  apertureCoupling: 'The body’s lever that works the lens’s aperture lever: it holds the iris wide open for viewing and lets it stop down to the set f-number for the exposure.',
  'dslr:frontButtons': 'Pv and Fn1 sit beside the mount. With the Preview role, Pv shows the depth of field while it is held. Each button takes a role chosen in the menus.',
  'mirrorless:frontButtons': 'Fn1 and Fn2 give quick access to a setting: hold one and turn a command dial. By default Fn1 chooses the shooting menu bank and Fn2 the image area.',
  'dslr:lvButton': 'Turn the live view selector to photo or movie, then press the button: the mirror goes up and the monitor shows the view through the lens. Press it again to exit.',
  multiSelector: 'Moves the focus point while the meters are on, and steps through menus and playback. Its center button has a role set in the menus.',
  powerSwitch: 'Turns the camera on and off. Turned toward D, it lights the backlights for the buttons and the top panel.',
  subSelector: 'A small joystick that can choose the focus point in place of the multi selector. Pressing its center locks focus and exposure.',
  'mirrorless:buttonCluster': 'Four buttons on the top left: bracketing (BKT), white balance (WB), exposure mode (MODE) and release mode. To change the release mode, hold its button and turn the main command dial.',
};

/** The sentence under a selected part's title. A part with no written note still gets a line, built from where it is listed,
 *  so a pick never shows a title and nothing else. */
function partNote(name: string): string {
  const key = isElement(name) ? 'glass' : name;
  const note = NOTES[`${state.body}:${key}`] ?? NOTES[key];
  if (note) return note;
  const list = document.querySelector(`.parts button[data-part="${name}"]`)?.closest('ul')?.id;
  const where = list === 'parts-lens' ? 'on the lens' : list === 'parts-in' ? 'inside the camera, seen in the cutaway' : 'on the outside of the camera';
  return `No description written for this part yet. It sits ${where}; turn the model to find it, and the highlight shows where.`;
}

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

/** A part's label as baked into the model. The GLBs are exported from the current scripts (score loop r6: both bodies were
 *  re-exported and the freshness check, tools/check-glb-fresh.mjs, now runs in the gate runner and the default test run), so the
 *  label is shown as exported: the runtime replace that hid the old "low-pass" wording is gone. */
function shownLabel(label: string | undefined): string {
  return label ?? '';
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
// the cut halves are seen side-on, a layer or two deep: they get the lens piece's pale coated glass, as on the camera
// level, so the cutaway's glass is visible (presentation review P-01)
const CUT_GLASS = look.cutawayGlassMaterial(1.6, false);

function prepare(root: THREE.Group) {
  root.updateMatrixWorld(true);
  const inFront = (o: THREE.Object3D) => { for (let n: THREE.Object3D | null = o; n; n = n.parent) if (/^element01(Cut)?$/.test(n.name)) return true; return false; };
  const inCut = (o: THREE.Object3D) => { for (let n: THREE.Object3D | null = o; n; n = n.parent) if (/^element\d+Cut$/.test(n.name) || n.userData?.cutaway === 'half') return true; return false; };
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && !Array.isArray(mesh.material)) {
      const n = mesh.material.name ?? '';
      if (/^(lensGlass|pfLayer)/.test(n)) mesh.material = inCut(mesh) ? CUT_GLASS : inFront(mesh) ? FRONT_GLASS : INNER_GLASS;
      else {
        // the same finish the camera level gets: silicon and dark glass stand-ins, the pebble and paint normal maps
        mesh.material = look.studioReplacement(mesh.material) ?? mesh.material;
        look.tuneStudioMaterial(mesh.material);
        // the mirror's turned studio needs the studio as its own envMap (look.ts MirrorSurface, score loop r3)
        if (mesh.material.name === 'MirrorSurface' && scene.environment) (mesh.material as THREE.MeshStandardMaterial).envMap = scene.environment as THREE.Texture;
        look.applySurfaceFinish(mesh.material, matchMedia('(max-width: 760px)').matches ? 0.7 : 1);
      }
    }
  });
  capCutParts(root, CUT_GLASS); // the cut faces get their own darker section material (score loop r4)
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
  const wasInside = !!obj && isInside(name!) && state.view !== 'cutaway';
  if (wasInside) setView('cutaway');
  selectedObjs = [];
  if (obj) {
    highlight(obj);
    selectedObjs.push(obj);
    const half = assembly.getObjectByName(name + 'Cut');
    if (half && half.userData.cutaway === 'half') { highlight(half); selectedObjs.push(half); }
  }
  const label = shownLabel(obj?.userData.label as string | undefined);
  $('sel-t').textContent = obj ? label || name! : 'Select a part';
  const d = $('sel-d');
  d.textContent = obj ? partNote(name!) : 'Tap any part of the camera or lens, or pick one from the list. Inside parts switch the view to the cutaway.';
  d.classList.toggle('none', !obj);
  ($('clear') as HTMLButtonElement).disabled = !obj;
  document.querySelectorAll<HTMLButtonElement>('.parts button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.part === state.part)));
  syncUrl();
  showSelection(wasInside);
}

// ---- what a selection does to the picture (score loop r5) -----------------------------------------------------------
// A tint was all a picked part got: a small part (a dial, a button) was a few tinted pixels, and a part inside or behind
// others showed no change at all. Now the rest of the scene dims so the part stands out, a name and a leader point at it
// on the model, the camera moves in on a small one, the card says when the part is hidden from this angle, and the part's
// row in the list scrolls into view when the pick came from the model.
let selectedObjs: THREE.Object3D[] = [];
let partBox: THREE.Box3 | null = null;
let behind = false;
let nudged = false;
let tween: number | null = null;
const labelEl = $('mv-label');
const DIM = 0.32;
function setDim(on: boolean) {
  scene.environmentIntensity = on ? DIM : 1;
  scene.traverse((o) => {
    const light = o as THREE.Light;
    if (!light.isLight) return;
    light.userData.baseIntensity ??= light.intensity;
    light.intensity = (light.userData.baseIntensity as number) * (on ? DIM : 1);
  });
}
function selectionBox(): THREE.Box3 | null {
  if (!selectedObjs.length) return null;
  const box = new THREE.Box3();
  for (const o of selectedObjs) box.union(new THREE.Box3().setFromObject(o));
  return box.isEmpty() ? null : box;
}
/** Whether the first thing the camera sees toward the part's center is something else. */
function isBehind(box: THREE.Box3, name: string, at: THREE.Vector3 = camera.position): boolean {
  const center = box.getCenter(new THREE.Vector3());
  const from = at.clone();
  const ray = new THREE.Raycaster(from, center.clone().sub(from).normalize());
  const visible = (o: THREE.Object3D) => { for (let n: THREE.Object3D | null = o; n; n = n.parent) if (!n.visible) return false; return true; };
  const hit = ray.intersectObject(assembly, true).find((h) => visible(h.object) && !h.object.userData.edgeBand);
  if (!hit) return false;
  if (hit.distance > from.distanceTo(center) - 0.5) return false;
  const owner = componentName(hit.object);
  return owner !== name && !selectedObjs.some((o) => { for (let n: THREE.Object3D | null = hit.object; n; n = n.parent) if (n === o) return true; return false; });
}
function showSelection(switchedToCutaway: boolean) {
  window.cancelAnimationFrame(tween ?? 0); tween = null;
  const vis = $('sel-vis');
  const box = selectionBox();
  partBox = box;
  setDim(!!box);
  if (!box || !state.part) {
    labelEl.hidden = true; vis.hidden = true; behind = false;
    if (nudged) { nudged = false; if (bodyRoot) frame(); }
    return;
  }
  const row = document.querySelector<HTMLElement>(`.parts button[data-part="${state.part}"]`);
  row?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  switchedNote = switchedToCutaway ? 'Inside the camera, so the view switched to the cutaway.' : '';
  let blocked = frameSelection(box);
  // a part on the outside that the lens or the body covers from every side: the cutaway shows it
  if (blocked && state.view === 'outside') {
    setView('cutaway');
    switchedNote = 'Covered by other parts from outside, so the view switched to the cutaway.';
    blocked = frameSelection(box);
  }
  behind = blocked;
  const notes = [switchedNote, behind ? 'Hidden behind other parts from this angle. Orbit around it to see it.' : ''].filter(Boolean);
  vis.textContent = notes.join(' ');
  vis.hidden = !notes.length;
  labelEl.hidden = false;
  placeLabel();
  invalidate(600);
}
/** Moves in on a part that would be a few pixels at the current distance, keeping the view direction. */
let switchedNote = '';
/** Returns whether the part is still hidden behind another from the camera's final place. */
function frameSelection(box: THREE.Box3): boolean {
  window.cancelAnimationFrame(tween ?? 0); tween = null;
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const w = viewEl.clientWidth, h = viewEl.clientHeight;
  const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const dist = camera.position.distanceTo(sphere.center);
  const sizePx = (sphere.radius * 2 * h) / (dist * 2 * tan);
  const want = 0.3 * Math.min(w, h);
  if (sizePx >= want * 0.75) return !!state.part && isBehind(box, state.part);
  const dNew = Math.max(sphere.radius * 2.4, (sphere.radius * 2 * h) / (want * 2 * tan));
  if (dNew >= dist) return !!state.part && isBehind(box, state.part);
  let dir = camera.position.clone().sub(controls.target).normalize();
  let stillBehind = false;
  // a part another part stands in front of is looked at from the nearest side where nothing does (the view direction
  // turned about the vertical axis in steps, then raised), so the move in shows the part and not what hides it
  if (state.part && isBehind(box, state.part, sphere.center.clone().addScaledVector(dir, dNew))) {
    const up = new THREE.Vector3(0, 1, 0);
    stillBehind = true;
    search: for (const lift of [0, 0.5]) for (const deg of [30, -30, 60, -60, 90, -90, 120, -120, 150, -150, 180]) {
      const d = dir.clone().applyAxisAngle(up, THREE.MathUtils.degToRad(deg));
      if (lift) d.y = Math.max(d.y, lift);
      d.normalize();
      if (!isBehind(box, state.part, sphere.center.clone().addScaledVector(d, dNew))) { dir = d; stillBehind = false; break search; }
    }
  }
  const p0 = camera.position.clone(), t0 = controls.target.clone();
  const t1 = sphere.center.clone(), p1 = t1.clone().addScaledVector(dir, dNew);
  nudged = true;
  controls.minDistance = Math.min(controls.minDistance, dNew * 0.5);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const start = performance.now();
  const step = (now: number) => {
    const k = reduced ? 1 : Math.min(1, (now - start) / 450);
    const e = k * k * (3 - 2 * k);
    controls.target.lerpVectors(t0, t1, e);
    camera.position.lerpVectors(p0, p1, e);
    camera.near = Math.max(0.2, Math.min(camera.near, camera.position.distanceTo(controls.target) / 20));
    camera.updateProjectionMatrix();
    controls.update();
    placeLabel();
    invalidate(300);
    if (k >= 1 && state.part && partBox) {
      behind = isBehind(partBox, state.part);
      const vis = $('sel-vis');
      const base = switchedNote;
      vis.textContent = [base, behind ? 'Hidden behind other parts from this angle. Orbit around it to see it.' : ''].filter(Boolean).join(' ');
      vis.hidden = !vis.textContent;
    }
    tween = k < 1 ? requestAnimationFrame(step) : null;
  };
  tween = requestAnimationFrame(step);
  return stillBehind;
}
/** The part's name, a ring on its center and a short leader, placed over the 3D view. The name goes up and to the right
 *  of the ring, or to its left, and is kept inside the view; the leader runs to the nearest point of the name's box. */
function placeLabel() {
  if (labelEl.hidden || !partBox) return;
  const w = viewEl.clientWidth, h = viewEl.clientHeight;
  const p = partBox.getCenter(new THREE.Vector3()).project(camera);
  const x = ((p.x + 1) / 2) * w, y = ((1 - p.y) / 2) * h;
  const span = labelEl.querySelector('span') as HTMLElement, leader = labelEl.querySelector('b') as HTMLElement, ring = labelEl.querySelector('i') as HTMLElement;
  const text = (($('sel-t').textContent ?? '') + (behind ? ' · behind' : '')).trim();
  if (span.textContent !== text) span.textContent = text;
  labelEl.classList.toggle('behind', behind);
  const onScreen = p.z < 1 && p.z > -1 && x > -20 && x < w + 20 && y > -20 && y < h + 20;
  labelEl.style.visibility = onScreen ? '' : 'hidden';
  const lw = Math.min(span.offsetWidth || text.length * 7.5 + 16, w - 12), lh = span.offsetHeight || 22;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  let left = x + 28;
  if (left + lw > w - 6) left = x - 28 - lw;
  left = clamp(left, 6, Math.max(6, w - lw - 6));
  const top = clamp(y - 30, 6, Math.max(6, h - lh - 6));
  ring.style.left = `${x - 7}px`; ring.style.top = `${y - 7}px`;
  span.style.left = `${left}px`; span.style.top = `${top}px`;
  const qx = clamp(x, left, left + lw), qy = clamp(y, top, top + lh);
  const dx = qx - x, dy = qy - y, len = Math.hypot(dx, dy) - 7;
  leader.style.left = `${x}px`; leader.style.top = `${y}px`;
  leader.style.width = `${Math.max(0, len)}px`;
  leader.style.transform = `rotate(${Math.atan2(dy, dx)}rad) translateX(7px)`;
  leader.hidden = len < 2;
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
    (b.querySelector('.pt') as HTMLElement).textContent = shownLabel(o.userData.label as string | undefined) || o.name;
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
    `${env.width} x ${env.height} x ${env.depth} mm${f.depthNote ? ` (${f.depthNote})` : ''}. ${f.shapeNote ? `${f.shapeNote} ` : ''}${f.mount.lugCount} bayonet lugs, ${f.mount.contactCount} contacts. ` +
    `Sensor ${f.sensor.activeAreaWidthMm} x ${f.sensor.activeAreaHeightMm} mm at z = 0. ` +
    (state.body === 'dslr' ? 'Mirror box and focal-plane shutter inside.' : 'No mechanical shutter; the sensor rides on a stabilization plate.');
  if (lf) {
    t += `\n\nThe lens: ${lf.label}. ${lf.lengthMm} mm long from the mount, ${lf.diameterMm} mm across, ` +
      `${lf.filterMm} mm ${lf.filterKind} filter. ${lf.elementCount} elements in ${lf.groupCount} groups, each shaped from the ` +
      `published lens design; ${lf.iris.blades}${lf.iris.rounded ? ' rounded' : ''} iris blades.` +
      (lf.clipped.length ? ` The simulator's clear aperture for element${lf.clipped.length > 1 ? 's' : ''} ${lf.clipped.map((c) => c.element).join(' and ')} is wider than this barrel allows (${lf.clipped.map((c) => `${c.sd.toFixed(1)} mm radius`).join(', ')}), so the glass is shown trimmed to the barrel and the engine's margin is under review.` : '');
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
  nudged = false;
  controls.update();
  placeLabel();
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
  const bodyName = body === 'dslr' ? 'DSLR body' : 'mirrorless body';
  try {
    // each model says which one failed, so the message can name it (score loop r2)
    const named = <T,>(p: Promise<T>, what: string) => p.catch((e) => { throw Object.assign(new Error(`${what}: ${(e as Error)?.message ?? e}`), { what }); });
    const [b, l] = await Promise.all([named(load(`./models/${body}.glb`), `the ${bodyName}`),
      lf ? named(load(lensFile(state.lens!)), `the ${lf.focalLength} mm f/${lf.markedFno} lens`) : Promise.resolve(null)]);
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
    // Build the new kit's pipelines behind the veil, then draw its first frame and let the GPU finish it before the
    // veil lifts: the first frame compiled them in place and froze the page for 0.7 to 0.9 s on desktop and about 2 s
    // on a 4x-throttled phone right after the reveal (score loop r2).
    $('veil-msg').textContent = 'Preparing the model';
    performance.mark('p2p:models-built');
    await compileAhead(generation);
    performance.mark('p2p:models-compiled');
    if (generation !== rigGeneration) return;
    invalidate();
    controls.update(); renderer.render(scene, camera);
    performance.mark('p2p:models-drawn');
    await gpuIdle();
    if (generation !== rigGeneration || graphicsLost) return;
    veil.classList.add('off');
  } catch (e) {
    if (generation !== rigGeneration) return;
    console.error('models.ts: a model did not load', e);
    veil.classList.add('err');
    const what = (e as { what?: string })?.what;
    $('veil-msg').textContent = `${what ? what[0].toUpperCase() + what.slice(1) : 'The model'} did not load. Check the connection and try again.`;
  }
}

/** Every pipeline the scene needs with the new kit in it, built ahead of its first frame (frustum culling off, since
 *  the camera may not face every part yet). The stage's camera rig does the same (src/scene/camera-rig.ts). */
let compiling = false; // the loop draws nothing while the kit compiles: a frame would build the same materials in place
async function compileAhead(generation: number) {
  const r = renderer as unknown as { compileAsync?: (scene: THREE.Object3D, camera: THREE.Camera, target?: THREE.Scene) => Promise<void>; backend?: { isWebGLBackend?: boolean } };
  if (!r.compileAsync) return;
  // As in the camera rig: WebGL2 and phone widths compile ahead (WebGL2 links in parallel); desktop WebGPU builds its
  // pipelines faster in the first frame, which setRig draws behind the veil anyway.
  if (!r.backend?.isWebGLBackend && viewEl.clientWidth > 760) return;
  // In steps (score loop r4): three builds a node material in JavaScript inside each compileAsync call, so one call for the
  // whole kit was a single task of 3 to 4 s on a 4x-throttled phone. A branch at a time, with a frame between, keeps
  // the page answering; the frames themselves are held (they would build the same materials in place).
  compiling = true;
  try {
    await compileInSteps(r, assembly, camera, scene, { alive: () => generation === rigGeneration && !graphicsLost });
  } catch (error) { console.warn('models.ts: the kit did not compile ahead; its first frame will', error); }
  finally { compiling = false; }
}

/** Resolves when the GPU has finished the work submitted so far (one animation frame on WebGL2). */
async function gpuIdle() {
  const b = renderer.backend as unknown as { isWebGPUBackend?: boolean; device?: { queue: { onSubmittedWorkDone(): Promise<void> } } };
  if (b.isWebGPUBackend && b.device) await b.device.queue.onSubmittedWorkDone();
  else await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

// ---- render on demand (score loop r2) -----------------------------------------------------------------------------
// The page draws while the orbit controls move (their damping included), for a short window after any input, load
// or resize, and once a second as a safety net. At rest it redrew an unchanged scene every frame: 48% of the main
// thread on desktop and 99% on a 4x-throttled phone.
const SAFETY_MS = 1000;
let drawUntil = 0, lastDrawAt = -1e9, lastBusyAt = 0, graphicsLost = false;
let sleeping = false, sleepTimer = 0, loop: ((now: number) => void) | null = null;
function invalidate(ms = 300) { drawUntil = Math.max(drawUntil, performance.now() + ms); wake(); }
// three's renderer runs its own animation-frame loop whether or not a callback is set (see src/app/stage.ts): stopping
// that loop is what lets the page go quiet, and it restarts from the next animation frame
const animation = () => (renderer as unknown as { _animation?: { start(): void; stop(): void } })._animation;
function wake() {
  if (!sleeping) return;
  sleeping = false;
  window.clearTimeout(sleepTimer);
  requestAnimationFrame(() => { if (!sleeping && !graphicsLost) animation()?.start(); });
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
  performance.mark('p2p:models-init');
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const webgpu = !!(renderer.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend;
  const chip = $('backend');
  chip.classList.toggle('webgl2', !webgpu);
  chip.lastElementChild!.textContent = webgpu ? 'WebGPU' : 'WebGL2';
  chip.title = webgpu ? 'Rendering with WebGPU' : 'Rendering with WebGL2 (WebGPU needs a secure context; plain HTTP on the tailnet is not one)';

  // the bodies and the lenses are Draco-compressed; the page shares one decoder (src/scene/draco.ts), which loads the
  // WebAssembly build from public/draco/ (three's default; the plain-JS build there is only its fallback)
  const draco = dracoLoader();
  loader = new GLTFLoader().setDRACOLoader(draco);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x000000); // design/LOOK.md --ground, as in the stage
  scene.add(assembly);
  camera = new THREE.PerspectiveCamera(32, 1, 1, 5000);
  controls = new OrbitControls(camera as unknown as THREE.Camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  lights();
  performance.mark('p2p:models-lit');

  let viewportWidth = 0, viewportHeight = 0;
  const resize = () => {
    // the canvas's own box: on a phone the controls take a bar above it (models.html), so it is shorter than the view
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (w < 1 || h < 1 || (w === viewportWidth && h === viewportHeight)) return;
    viewportWidth = w; viewportHeight = h;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
    if (bodyRoot) frame();
    invalidate();
  };
  new ResizeObserver(resize).observe(canvas);
  resize();
  // The pinned part card sticks under the viewer on a phone. Its offset follows the viewer's real height (a stylesheet rule that
  // sizes the viewer differently from the one that places the card left the card behind the model, score loop r6).
  const viewerEl = document.querySelector<HTMLElement>('.mv-body .viewer');
  if (viewerEl) {
    const syncViewerHeight = () => document.documentElement.style.setProperty('--mv-view-real', `${Math.round(viewerEl.getBoundingClientRect().height)}px`);
    new ResizeObserver(syncViewerHeight).observe(viewerEl);
    syncViewerHeight();
  }

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

  // any input on the page can change the picture (a part pick, the view, the kit), and so can a load or a resize
  for (const name of ['pointerdown', 'pointerup', 'click', 'input', 'change', 'keydown', 'wheel', 'transitionend'] as const) {
    document.addEventListener(name, () => invalidate(400), { capture: true, passive: true });
  }
  document.addEventListener('visibilitychange', () => invalidate());
  // A lost GPU device or WebGL context (a driver reset, a reclaimed context) leaves a frozen canvas: say so, and offer
  // the reload that brings the view back (the stage does the same on the main page).
  const originalDeviceLost = renderer.onDeviceLost.bind(renderer);
  renderer.onDeviceLost = (info) => {
    originalDeviceLost(info);
    graphicsLost = true;
    window.clearTimeout(sleepTimer); sleeping = false;
    void renderer.setAnimationLoop(null);
    veil.classList.remove('off');
    veil.classList.add('err');
    veil.setAttribute('role', 'alert');
    $('veil-msg').textContent = 'The browser lost the 3D view. Restore it to continue with this camera and lens.';
    $('model-retry').textContent = 'Restore 3D view';
  };
  controls.addEventListener('change', () => invalidate());
  canvas.addEventListener('pointerdown', () => { window.cancelAnimationFrame(tween ?? 0); tween = null; });
  let behindTimer = 0;
  controls.addEventListener('end', () => {
    window.clearTimeout(behindTimer);
    behindTimer = window.setTimeout(() => {
      if (!partBox || !state.part) return;
      const now = isBehind(partBox, state.part);
      if (now === behind) return;
      behind = now;
      const vis = $('sel-vis');
      vis.textContent = behind ? 'Hidden behind other parts from this angle. Orbit around it to see it.' : '';
      vis.hidden = !behind;
      placeLabel(); invalidate();
    }, 200);
  });
  loop = (time?: number) => {
    const now = typeof time === 'number' ? time : performance.now(); // a restarted loop's first call has none
    if (document.hidden || graphicsLost || compiling) return;
    const moved = controls.update();
    if (moved || now < drawUntil) lastBusyAt = now;
    if (!moved && now >= drawUntil && now - lastDrawAt < SAFETY_MS) {
      // nothing to draw for a moment: stop the loop, and come back for one frame a second (or at the next input)
      if (now - lastBusyAt > 300 && animation()) {
        sleeping = true;
        animation()!.stop();
        sleepTimer = window.setTimeout(wake, SAFETY_MS);
      }
      return;
    }
    lastDrawAt = now;
    placeLabel();
    renderer.render(scene, camera);
  };
  void renderer.setAnimationLoop(loop);
  setView(state.view);
  await setRig(state.body, state.lens, true);
  (window as unknown as { p2pModels: unknown }).p2pModels = { scene, camera, renderer, state, ready: true };
}

$('topnav').innerHTML = siteNavigation('models');
mountSiteNavigation();
$('model-retry').addEventListener('click', () => {
  if (loader && !graphicsLost && !startFailed) void setRig(state.body, state.lens, true);
  else location.reload();
});
let startFailed = false;
main().catch((e) => {
  // The reader gets the plain message the main page gives (app-start.ts showStartupFailure), Reload rather than a
  // Retry that cannot succeed, and the 2D reference; the exception itself goes to the console (score loop r2).
  console.error('models.ts: the 3D view could not start', e);
  startFailed = true;
  veil.classList.remove('off');
  veil.classList.add('err');
  $('veil-msg').textContent = 'The 3D view could not start. Reload to try again, or use another browser with hardware acceleration enabled.';
  $('model-retry').textContent = 'Reload';
  if (!document.getElementById('veil-reference')) {
    const a = document.createElement('a');
    a.id = 'veil-reference'; a.className = 'btn'; a.href = 'reference.html'; a.textContent = 'Read the 2D reference';
    veil.append(a);
    veil.style.alignContent = 'center'; veil.style.gap = '16px'; // the message and its two actions as one group
  }
});
