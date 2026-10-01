// Astra-6 findings C2, C3, C4 (rig-exposure.ts / blender/dslr_v2.py). Uses the actual createExposure()
// function and the actual exported public/models/dslr.glb, with a deterministic clock, exactly as the
// review's own reproduction scripts did (.local/astra-review/repro/camera-*.mjs) -- but each claim below
// is first stated from an independent derivation (the shutter's own definition, or the badge's own printed
// numbers), not read back from the code under test.
import { describe, expect, it, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { compute } from '../app/engine-api';
import { createExposure } from './rig-exposure';
import bodyHw from '../../data/hardware/body.json';

const ROOT = resolve(__dirname, '../..');
const CURTAIN_MS = (bodyHw as any).shutter.curtainTravelMs.v as number; // 4ms, data/hardware/body.json

function loadGlb(relPath: string): Promise<THREE.Group> {
  const buf = readFileSync(resolve(ROOT, relPath));
  const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const loader = new GLTFLoader();
  return new Promise((resolve_, reject) => {
    loader.parse(arrayBuffer, '', (gltf) => resolve_(gltf.scene as unknown as THREE.Group), (err) => reject(err));
  });
}

// A minimal stand-in DOM: createExposure() creates one "hud" element and queries fixed selectors into it.
// Every selector must resolve to the SAME element on every call (not a fresh throwaway each time), or a
// field's assignment would never be observable -- this mirrors .local/astra-review/repro/camera-*.mjs's
// own fake-DOM shape.
function fakeDom() {
  const elements = new Map<string, any>();
  const el = (key = ''): any => {
    if (!elements.has(key)) {
      const listeners = new Map<string, (event: any) => void>();
      elements.set(key, {
        style: {}, textContent: '', hidden: false, attributes: {} as Record<string, string>,
        querySelector: (s: string) => el(s), addEventListener(type: string, fn: (event: any) => void) { listeners.set(type, fn); },
        removeAttribute(name: string) { delete this.attributes[name]; },
        setAttribute(name: string, value: string) { this.attributes[name] = value; }, remove() {},
        dispatch(type: string) { listeners.get(type)?.({ target: this }); },
      });
    }
    return elements.get(key);
  };
  return {
    overlay: { appendChild() {}, insertAdjacentHTML() {}, querySelector: () => el('overlay'), querySelectorAll: () => [] } as any,
    createElement: () => el('hud'),
    now: 0,
    el,
  };
}

function withFakeGlobals(run: (dom: ReturnType<typeof fakeDom>) => void) {
  const oldDoc = globalThis.document, oldPerf = globalThis.performance;
  const dom = fakeDom();
  (globalThis as any).document = { createElement: dom.createElement };
  (globalThis as any).performance = { now: () => dom.now };
  try {
    run(dom);
  } finally {
    globalThis.document = oldDoc; globalThis.performance = oldPerf;
  }
}

describe('shutter curtain coverage and timing (Astra-6 C2)', () => {
  let scene: THREE.Group;
  beforeAll(async () => { scene = await loadGlb('public/models/dslr.glb'); });

  it('the front curtain fully covers the active height at rest (blades built to exactly the sensor height, not 62% of it)', () => {
    withFakeGlobals(({ overlay }) => {
      const model = compute({ lens: 'n50', shutter: 1 / 250 });
      const group = new THREE.Group(); group.add(scene);
      const exp = createExposure({
        group, overlay, badge: { show() {}, hide() {} } as any, body: () => 'dslr',
        model: () => model, node: (n) => scene.getObjectByName(n), paths: () => [],
      });
      exp.fire();
      exp.tick(0, 0); // t = 0: rest pose, before the front curtain has moved at all
      const box = (n: string) => new THREE.Box3().setFromObject(scene.getObjectByName(n)!);
      const sensor = box('pixelArray'), front = box('shutterCurtainFront');
      const H = sensor.max.y - sensor.min.y;
      // Independent claim: a focal-plane shutter's curtain covers the WHOLE frame before the first curtain
      // starts to travel (docs/PANE.md, "Shutter speed as time"), not a fraction of it.
      const blocked = Math.max(0, Math.min(front.max.y, sensor.max.y) - Math.max(front.min.y, sensor.min.y));
      expect(blocked / H).toBeCloseTo(1, 2);
      exp.dispose();
    });
  });

  it('the center row is exposed for exactly the shutter time, independent of the curtain-travel geometry (Astra-6 measured 6.14ms vs a 4ms shutter)', () => {
    withFakeGlobals(({ overlay }) => {
      const shutterS = 1 / 250; // 4ms -- deliberately equal to CURTAIN_MS so the two constants aren't confusable
      const model = compute({ lens: 'n50', shutter: shutterS });
      const group = new THREE.Group(); group.add(scene);
      const exp = createExposure({
        group, overlay, badge: { show() {}, hide() {} } as any, body: () => 'dslr',
        model: () => model, node: (n) => scene.getObjectByName(n), paths: () => [],
      });
      exp.fire();
      const segs = exp.state().segs;
      const releaseSeg = segs.find((s) => s.name === 'release')!;
      const releaseVis = releaseSeg.realMs * releaseSeg.factor;
      const expFactor = segs.find((s) => s.name === 'exposure')!.factor;
      const box = (n: string) => new THREE.Box3().setFromObject(scene.getObjectByName(n)!);
      const shutterMs = shutterS * 1000;

      // Sample the curtains' own world positions once every 0.05 real ms through the exposure segment and
      // read back, from geometry alone, when the sensor's center row (world y = 0) is uncovered and
      // re-covered -- exactly what Astra's camera-shutter-coverage.mjs does, independent of
      // rig-exposure.ts's own shownFraction variable.
      let openAt = -1, closeAt = -1;
      const totalLocalMs = CURTAIN_MS * 3 + shutterMs; // generous: covers front and rear fully crossing
      for (let localMs = 0; localMs <= totalLocalMs; localMs += 0.05) {
        exp.tick(releaseVis + localMs * expFactor, 0.05 * expFactor);
        const front = box('shutterCurtainFront'), rear = box('shutterCurtainRear');
        const covered = (0 >= front.min.y && 0 <= front.max.y) || (0 >= rear.min.y && 0 <= rear.max.y);
        if (openAt < 0 && !covered) openAt = localMs;
        if (openAt >= 0 && closeAt < 0 && covered) closeAt = localMs;
      }
      expect(openAt).toBeGreaterThanOrEqual(0);
      expect(closeAt).toBeGreaterThan(openAt);
      expect(closeAt - openAt).toBeCloseTo(shutterMs, 0);
      exp.dispose();
    });
  });
});

describe('photon dots match their own scale badge (Astra-6 C3)', () => {
  it.each([1 / 250, 1 / 8000])('emitted dots * badge weight agree within one dot at shutter %s, including short exposures', (shutter) => {
      withFakeGlobals(({ overlay }) => {
        const model = compute({ lens: 'n50', fno: 2.8, focusM: 1.5, shutter });
        const group = new THREE.Group();
        const exp = createExposure({
          group, overlay, badge: { show() {}, hide() {} } as any, body: () => 'dslr',
          model: () => model, node: () => undefined,
          paths: () => [{ pts: [new THREE.Vector3(0, 0, -100), new THREE.Vector3()], color: new THREE.Color(1, 1, 1) }],
        });
        exp.fire();
        let emitted = 0;
        const segs = exp.state().segs;
        const duration = segs.reduce((s, x) => s + x.realMs * x.factor, 0);
        const photons = group.getObjectByName('photons') as THREE.Points;
        // Count the actual point buffer crossing the entry in consecutive 1ms windows. This does not
        // depend on Math.random calls or on an internal emission counter (neither is a displayed dot).
        for (let t = 0; t <= duration + 500; t += 1) {
          exp.tick(t, 1);
          const positions = photons.geometry.attributes.position;
          for (let i = 0; i < photons.geometry.drawRange.count; i++) {
            if (positions.getZ(i) < -100 + 100 / 420 - 1e-6) emitted++;
          }
        }
        // Independent claim (docs/PANE.md, "Light and exposure"): a dot represents dotPhotons photons, so
        // emitted * dotPhotons should equal the model's own printed total (18% gray photons/pixel * pixel
        // count), not 2.93x it.
        const total = model.exposure.photonsMidGray * model.sensor.widthPx * model.sensor.heightPx;
        const dotPhotons = exp.state().dotPhotons;
        const represented = emitted * dotPhotons;
        expect(Math.abs(represented - total)).toBeLessThanOrEqual(dotPhotons);
        exp.dispose();
      });
  });
});

describe("the photon-flight speed is badged separately from the mechanism's slow-motion factor (Astra-6 C4)", () => {
  it('the fired caption discloses a separate, fixed visual flight speed', () => {
    withFakeGlobals(({ overlay, el }) => {
      const model = compute({ lens: 'n50', shutter: 0.004 });
      const group = new THREE.Group();
      let badge = '';
      const exp = createExposure({
        group, overlay, badge: { show: (s: string) => { badge = s; }, hide() {} } as any, body: () => 'dslr',
        model: () => model, node: () => undefined,
        paths: () => [{ pts: [new THREE.Vector3(0, 0, -100), new THREE.Vector3()], color: new THREE.Color(1, 1, 1) }],
      });
      exp.fire();
      exp.tick(0, 1);
      // Independent physical fact this is checking against: light crosses a 100mm path in about 3.34e-7 ms
      // (c = 299,792,458 m/s), far too fast for a mechanism slow-motion factor (badged elsewhere) to also
      // depict -- design/LOOK.md requires that non-literal flight speed be disclosed as its own scale.
      const physicalFlightMs = 0.1 / 299792458 * 1000;
      expect(physicalFlightMs).toBeLessThan(1e-5);
      const caption = el('.rx-cap').textContent as string;
      expect(/flight|visual speed/i.test(`${badge} ${caption}`)).toBe(true);
      exp.dispose();
    });
  });
});

describe('exposure inspection', () => {
  let body: THREE.Group;
  beforeAll(async () => { body = await loadGlb('public/models/dslr.glb'); });

  function fixture(dom: ReturnType<typeof fakeDom>, reducedMotion = false) {
    let model = compute({ lens: 'n50', shutter: 1 / 250, fno: 2.8, focusM: 1.5 });
    const group = new THREE.Group();
    const scene = body.clone(true); group.add(scene);
    let mirrorUp = false, finished = 0;
    const paths = [{ pts: [new THREE.Vector3(0, 0, -100), new THREE.Vector3()], color: new THREE.Color(1, 0.5, 0) }];
    const exp = createExposure({
      group, overlay: dom.overlay, badge: { show() {}, hide() {} } as any,
      body: () => 'dslr', model: () => model, node: (n) => scene.getObjectByName(n), paths: () => paths,
      reducedMotion: () => reducedMotion, onMirror: (up) => { mirrorUp = up; }, afterFire: () => { finished++; },
    });
    const frame = () => {
      const points = group.getObjectByName('photons') as THREE.Points;
      scene.updateMatrixWorld(true);
      return {
        points: Array.from(points.geometry.attributes.position.array).slice(0, points.geometry.drawRange.count * 3),
        front: scene.getObjectByName('shutterCurtainFront')!.matrixWorld.toArray(),
        rear: scene.getObjectByName('shutterCurtainRear')!.matrixWorld.toArray(),
        mirror: scene.getObjectByName('mirror')!.matrixWorld.toArray(), mirrorUp,
        photons: dom.el('.rx-pp').textContent, well: dom.el('.rx-well i').style.width,
      };
    };
    const halfExposedPosition = () => {
      const segs = exp.state().segs;
      const release = segs.find((s) => s.name === 'release')!;
      const exposure = segs.find((s) => s.name === 'exposure')!;
      return (release.realMs * release.factor + (CURTAIN_MS / 2 + model.scenario.shutter * 1000 / 2) * exposure.factor) / exp.state().durationVisMs;
    };
    return { exp, frame, paths, halfExposedPosition, get model() { return model; }, get finished() { return finished; },
      replaceModel() { model = compute({ ...model.scenario, shutter: 1 / 125 }); } };
  }

  it('pauses every displayed quantity and resumes from that frame without counting paused wall time', () => {
    withFakeGlobals((dom) => {
      const f = fixture(dom); f.exp.fire();
      dom.now = f.halfExposedPosition() * f.exp.state().durationVisMs;
      f.exp.tick(dom.now, dom.now); f.exp.pause();
      expect(f.exp.state().shownFraction).toBeCloseTo(0.5, 12);
      expect(dom.el('.rx-pp').textContent).toBe(Math.round(f.model.exposure.photonsMidGray / 2).toLocaleString('en-US'));
      const paused = f.frame(), progress = f.exp.state().progress;
      expect(paused.points.length).toBeGreaterThan(0);
      dom.now += 5000; f.exp.tick(dom.now, 5000);
      expect(f.frame()).toEqual(paused);
      expect(f.exp.state().progress).toBe(progress);
      f.exp.resume(); dom.now += 100; f.exp.tick(dom.now, 100);
      // 100 visual ms / 200 slow-motion factor = .5 real ms: 1/8 of this 4ms shutter.
      expect(f.exp.state().shownFraction).toBeCloseTo(0.625, 12);
      expect(f.exp.state().paused).toBe(false);
      f.exp.dispose();
    });
  });

  it('backward scrubbing restores the same photons, well and geometry and owns its path snapshot', () => {
    withFakeGlobals((dom) => {
      const f = fixture(dom); f.exp.fire();
      const half = f.halfExposedPosition(); f.exp.seek(half);
      const expected = f.frame();
      f.paths[0].pts[0].set(1000, 1000, 1000); // new ray geometry must not mutate this shot
      f.exp.seek(0.1);
      expect(f.exp.state().shownFraction).toBe(0);
      expect(f.frame().mirrorUp).toBe(false);
      expect(f.frame().points).toEqual([]);
      f.exp.seek(half);
      expect(f.frame()).toEqual(expected);
      f.exp.dispose();
    });
  });

  it('a native slider input pauses at its selected position and exposes descriptive accessible values', () => {
    withFakeGlobals((dom) => {
      const f = fixture(dom); f.exp.fire();
      dom.el('.rx-scrub').value = '500'; dom.el('.rx-scrub').dispatch('input');
      expect(f.exp.state().progress).toBe(0.5);
      expect(f.exp.state().paused).toBe(true);
      expect(dom.el('.rx-scrub').attributes['aria-valuetext']).toMatch(/center row, paused/);
      expect(dom.el('.rx-pause').textContent).toBe('Resume');
      f.exp.dispose();
    });
  });

  it('cancels a paused shot when settings change instead of applying the old playhead to the new model', () => {
    withFakeGlobals((dom) => {
      const f = fixture(dom); f.exp.fire(); f.exp.seek(f.halfExposedPosition());
      f.replaceModel(); f.exp.syncModel();
      expect(f.exp.state().status).toBe('idle');
      expect(f.exp.state().dots).toBe(0);
      expect(f.frame().mirrorUp).toBe(false);
      expect(f.finished).toBe(1);
      expect(dom.el('.rx-status').textContent).toMatch(/Settings changed/);
      expect(dom.el('.rx-playback').hidden).toBe(true);
      expect(dom.el('.rx-pp').textContent).toBe(Math.round(f.model.exposure.photonsMidGray).toLocaleString('en-US'));
      f.exp.dispose();
    });
  });

  it('keeps reduced-motion shots still until the reader explicitly resumes, and allows replay after completion', () => {
    withFakeGlobals((dom) => {
      const f = fixture(dom, true); f.exp.fire();
      expect(f.exp.state().status).toBe('paused');
      dom.now = 10000; f.exp.tick(dom.now, 10000);
      expect(f.exp.state().progress).toBe(0);
      f.exp.resume();
      dom.now += f.exp.state().durationVisMs; f.exp.tick(dom.now, 5000);
      expect(f.exp.state().status).toBe('complete');
      expect(f.finished).toBe(1);
      expect(dom.el('.rx-playback').hidden).toBe(false);
      f.exp.fire();
      expect(f.exp.state().status).toBe('paused');
      expect(f.exp.state().shownFraction).toBe(0);
      f.exp.dispose();
    });
  });

  it('reset restores the original mirror hierarchy, clears points and unlocks the fire control', () => {
    withFakeGlobals((dom) => {
      const f = fixture(dom); f.exp.fire(); f.exp.seek(f.halfExposedPosition());
      f.exp.reset();
      expect(f.exp.state().status).toBe('idle');
      expect(f.frame().points).toEqual([]);
      expect(f.frame().mirrorUp).toBe(false);
      expect(dom.el('.rx-fire').disabled).toBe(false);
      // A new shot remains usable after the old hinge was detached.
      f.exp.fire(); f.exp.seek(f.halfExposedPosition());
      expect(f.exp.state().shownFraction).toBeCloseTo(0.5, 12);
      f.exp.dispose();
    });
  });

  it('holds the electronic row scan still on mirrorless playback and scrubs its center-row charge', () => {
    withFakeGlobals((dom) => {
      const model = compute({ lens: 'm50', shutter: 1 / 250 });
      const group = new THREE.Group();
      const pixelArray = new THREE.Mesh(new THREE.PlaneGeometry(35.9, 23.9), new THREE.MeshBasicMaterial());
      pixelArray.name = 'pixelArray'; group.add(pixelArray);
      const exp = createExposure({ group, overlay: dom.overlay, badge: { show() {}, hide() {} } as any,
        body: () => 'mirrorless', model: () => model, node: (n) => group.getObjectByName(n), paths: () => [] });
      exp.fire();
      const seg = exp.state().segs[0];
      expect(exp.state().segs).toHaveLength(1);
      // The published/modelled 3.6ms row traverse reaches the center after 1.8ms.
      exp.seek(1.8 * seg.factor / exp.state().durationVisMs);
      const scan = group.getObjectByName('readout-line')!;
      expect(scan.visible).toBe(true);
      expect(scan.position.y).toBeCloseTo(0, 6);
      dom.now = 10000; exp.tick(dom.now, 10000);
      expect(scan.position.y).toBeCloseTo(0, 6);
      exp.seek((1.8 + 2) * seg.factor / exp.state().durationVisMs);
      expect(exp.state().shownFraction).toBeCloseTo(0.5, 12);
      exp.setEnabled(false);
      expect(exp.state().status).toBe('idle');
      expect(scan.visible).toBe(false);
      expect(dom.el('.rx-fire').disabled).toBe(true);
      exp.dispose(); pixelArray.geometry.dispose(); (pixelArray.material as THREE.Material).dispose();
    });
  });
});
