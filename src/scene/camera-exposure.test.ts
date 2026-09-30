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
      elements.set(key, {
        style: {}, textContent: '', hidden: false,
        querySelector: (s: string) => el(s), addEventListener() {}, removeAttribute() {}, setAttribute() {}, remove() {},
      });
    }
    return elements.get(key);
  };
  return {
    overlay: { appendChild() {}, insertAdjacentHTML() {}, querySelector: () => el('overlay'), querySelectorAll: () => [] } as any,
    createElement: () => el('hud'),
    el,
  };
}

function withFakeGlobals(run: (dom: ReturnType<typeof fakeDom>) => void) {
  const oldDoc = globalThis.document, oldPerf = globalThis.performance;
  const dom = fakeDom();
  (globalThis as any).document = { createElement: dom.createElement };
  (globalThis as any).performance = { now: () => 0 };
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
  it('emitted dots * photons-per-dot land within one dot of the model total (not 2.93x it)', () => {
    let emitted = 0;
    const oldRandom = Math.random;
    Math.random = () => { emitted++; return 0.5; };
    try {
      withFakeGlobals(({ overlay }) => {
        const model = compute({ lens: 'n50', fno: 2.8, focusM: 1.5, shutter: 1 / 250 });
        const group = new THREE.Group();
        const exp = createExposure({
          group, overlay, badge: { show() {}, hide() {} } as any, body: () => 'dslr',
          model: () => model, node: () => undefined,
          paths: () => [{ pts: [new THREE.Vector3(0, 0, -100), new THREE.Vector3()], color: new THREE.Color(1, 1, 1) }],
        });
        exp.fire();
        emitted = 0;
        const segs = exp.state().segs;
        const duration = segs.reduce((s, x) => s + x.realMs * x.factor, 0);
        for (let t = 0; t <= duration + 500; t += 1) exp.tick(t, 1);
        // Independent claim (docs/PANE.md, "Light and exposure"): a dot represents dotPhotons photons, so
        // emitted * dotPhotons should equal the model's own printed total (18% gray photons/pixel * pixel
        // count), not 2.93x it.
        const total = model.exposure.photonsMidGray * model.sensor.widthPx * model.sensor.heightPx;
        const dotPhotons = exp.state().dotPhotons;
        const represented = emitted * dotPhotons;
        expect(Math.abs(represented - total)).toBeLessThanOrEqual(dotPhotons);
        exp.dispose();
      });
    } finally {
      Math.random = oldRandom;
    }
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
