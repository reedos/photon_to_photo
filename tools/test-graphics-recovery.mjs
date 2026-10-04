// Inject WebGL context loss and WebGPU device loss, verify the actionable stage veil,
// then follow its Restore 3D view action back to real rendered geometry. Run against
// the production candidate supplied via P2P_URL; each backend gets a fresh context.
// Screenshots and telemetry default to shots/graphics-recovery.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { decodePng } from './accuracy/png.mjs';

const url = process.env.P2P_URL;
if (!url) throw new Error('Set P2P_URL to the production candidate for graphics recovery.');
const output = process.env.P2P_AUDIT_OUTPUT || 'shots/graphics-recovery';
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true,
  args: ['--use-angle=d3d11', '--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const report = { url, cases: [], passed: false,
  webgpuFaultNote: 'The test physically destroys the captured renderer GPUDevice, then maps its normal loss reason "destroyed" to "unknown" before Three.js handles it. Three.js intentionally ignores ordinary renderer cleanup with reason "destroyed"; the mapping simulates an unexpected driver failure and is test-only.' };

function geometryPixels(actual, backdrop) {
  const a = decodePng(actual), b = decodePng(backdrop);
  assert.equal(a.width, b.width); assert.equal(a.height, b.height);
  let changed = 0, brightPixels = 0, centerPixels = 0;
  const bins = new Map();
  const x0 = Math.floor(a.width * 0.2), x1 = Math.ceil(a.width * 0.8);
  const y0 = Math.floor(a.height * 0.2), y1 = Math.ceil(a.height * 0.8);
  for (let i = 0; i < a.width * a.height; i++) {
    let d = 0;
    for (let c = 0; c < 3; c++) d += Math.abs(a.data[i * a.channels + c] - b.data[i * b.channels + c]);
    if (d > 35) changed++;
  }
  // Backdrop delta alone counts the clear color as rendered work. Require visible,
  // nonuniform image evidence in the central 60%, away from the app's corner insets.
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * a.width + x) * a.channels;
    const r = a.data[i], g = a.data[i + 1], bl = a.data[i + 2];
    const key = (r >> 4) * 256 + (g >> 4) * 16 + (bl >> 4);
    bins.set(key, (bins.get(key) || 0) + 1);
    if (Math.max(r, g, bl) > 65) brightPixels++;
    centerPixels++;
  }
  const dominantFraction = Math.max(...bins.values()) / centerPixels;
  return { changedPixels: changed, totalPixels: a.width * a.height, brightPixels, centerPixels,
    uniqueColorBins: bins.size, variedFraction: 1 - dominantFraction };
}

async function capture(page, backend, phase) {
  const rect = await page.locator('#gl').boundingBox();
  assert.ok(rect && rect.width > 0 && rect.height > 0, `${backend} ${phase}: canvas has a visible rectangle`);
  const style = '#view > :not(#gl) { transition:none!important; animation:none!important; opacity:0!important; }';
  const actual = await page.screenshot({ path: `${output}/${backend}-${phase}-canvas.png`, clip: rect, style });
  const backdrop = await page.screenshot({ clip: rect, style: `${style} #gl { opacity:0!important; }` });
  return geometryPixels(actual, backdrop);
}

async function exercise(backend) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, reducedMotion: 'no-preference' });
  const page = await context.newPage();
  page.setDefaultTimeout(45000);
  const errors = [];
  let releaseBodyRequest;
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

  if (backend === 'webgpu') {
    // WebGPU has no public loss injection API. Wrap adapter acquisition so the exact
    // device the renderer receives can be destroyed once after the first real frame.
    await context.addInitScript(() => {
      window.__graphicsAuditDevice = null;
      if (!navigator.gpu) return;
      const gpu = navigator.gpu;
      const requestAdapter = gpu.requestAdapter.bind(gpu);
      gpu.requestAdapter = async (...args) => {
        const adapter = await requestAdapter(...args);
        if (!adapter) return adapter;
        const prototype = Object.getPrototypeOf(adapter);
        if (!prototype.__graphicsAuditWrapped) {
          const requestDevice = prototype.requestDevice;
          Object.defineProperty(prototype, 'requestDevice', { configurable: true, writable: true,
            value: async function (...deviceArgs) {
              const device = await requestDevice.apply(this, deviceArgs);
              // Three ignores info.reason === 'destroyed' because that is normal
              // renderer cleanup. Relabel this deliberately destroyed device as a
              // simulated driver loss so its real lost-device callback is exercised.
              const nativeLost = device.lost;
              const nativeThen = nativeLost.then.bind(nativeLost);
              Object.defineProperty(nativeLost, 'then', { configurable: true, writable: true,
                value(onFulfilled, onRejected) {
                  return nativeThen(info => onFulfilled?.(info.reason === 'destroyed'
                    ? { ...info, reason: 'unknown', message: 'Injected WebGPU driver loss' } : info), onRejected);
                } });
              window.__graphicsAuditDevice = device;
              return device;
            } });
          Object.defineProperty(prototype, '__graphicsAuditWrapped', { value: true });
        }
        return adapter;
      };
    });
  }

  const entry = new URL(`?lens=n50&piece=camera${backend === 'webgl2' ? '&gl=webgl2' : ''}`, url);
  const test = { backend, entry: entry.href, errors, screenshots: [], initialGeometry: null,
    lostGeometry: null, restoredGeometry: null };
  try {
    await page.goto(entry.href);
    await page.waitForFunction(expected => window.p2p?.backend() === expected, backend);
    await page.waitForFunction(() => window.p2p.render()?.scenario.lens === 'n50'
      && window.p2p.framing().piece === 'camera' && !window.p2p.framing().moving);
    await page.evaluate(() => window.p2p.pieces.camera.ready());
    test.initialGeometry = await capture(page, backend, 'before-loss');
    test.screenshots.push(`${backend}-before-loss-canvas.png`);
    assert.ok(test.initialGeometry.changedPixels > 500, `${backend}: real camera geometry rendered before injection`);
    assert.ok(test.initialGeometry.variedFraction > 0.02 && test.initialGeometry.brightPixels > 25,
      `${backend}: central rendered image has variation and visible details, not only the clear color`);

    // Hold a real alternate camera body GLB request. Its completion emits the app's
    // actual piece-loading=false event after the injected renderer loss.
    const bodySelect = page.locator('#kit-body');
    const bodies = await bodySelect.locator('option').evaluateAll(options => options.map(option => option.value));
    const currentBody = await bodySelect.inputValue();
    const nextBody = bodies.find(body => body !== currentBody);
    assert.ok(nextBody, 'another camera body is available for the delayed asset request');
    const bodyPattern = `**/models/${nextBody}.glb`;
    let bodyRequestSeen;
    const bodyRequest = new Promise(resolve => { bodyRequestSeen = resolve; });
    await context.route(bodyPattern, route => {
      bodyRequestSeen();
      return new Promise(done => {
        releaseBodyRequest = () => { void route.continue().finally(done); };
      });
    });
    await bodySelect.selectOption(nextBody);
    await bodyRequest;
    await page.waitForFunction(() => !document.querySelector('#veil').classList.contains('off'));

    test.urlBeforeLoss = page.url();
    test.beforeState = await page.evaluate(() => ({ scenario: window.p2p.scenario(), piece: window.p2p.framing().piece }));
    if (backend === 'webgl2') {
      const lossApi = await page.evaluate(() => {
        const gl = document.querySelector('#gl').getContext('webgl2');
        if (!gl) throw new Error('The renderer did not expose its WebGL2 context.');
        const extension = gl.getExtension('WEBGL_lose_context');
        if (!extension) throw new Error('WEBGL_lose_context is unavailable.');
        extension.loseContext();
        return { initiallyLost: gl.isContextLost() };
      });
      test.injection = { api: 'WEBGL_lose_context', ...lossApi };
    } else {
      test.injection = await page.evaluate(() => {
        const device = window.__graphicsAuditDevice;
        if (!device) throw new Error('The renderer device was not captured at GPUAdapter.requestDevice().');
        device.destroy();
        return { api: 'GPUDevice.destroy', captured: true, simulatedDriverLossReason: 'unknown',
          note: 'The browser reports normal destroy as reason=destroyed; the test maps it to unknown to simulate an unexpected driver failure.' };
      });
    }

    const recoveryText = 'The browser lost the 3D view. Restore it to continue with your current camera settings.';
    await page.waitForFunction(text => {
      const veil = document.querySelector('#veil');
      return veil?.getAttribute('role') === 'alert'
        && veil.classList.contains('err') && !veil.classList.contains('off')
        && document.querySelector('#veil-msg')?.textContent === text
        && document.querySelector('#veil-reload')?.textContent === 'Restore 3D view'
        && document.querySelector('#pins')?.classList.contains('held');
    }, recoveryText);
    test.lostUI = await page.evaluate(() => ({
      role: document.querySelector('#veil').getAttribute('role'),
      visible: !document.querySelector('#veil').classList.contains('off'),
      error: document.querySelector('#veil').classList.contains('err'),
      message: document.querySelector('#veil-msg').textContent,
      action: document.querySelector('#veil-reload').textContent,
      pinsHeld: document.querySelector('#pins').classList.contains('held'),
    }));
    test.settleAfterLoss = await page.evaluate(async () => {
      const started = performance.now();
      try {
        await window.p2p.settle();
        return { rejected: false, elapsedMs: performance.now() - started };
      } catch (error) {
        return { rejected: true, message: String(error), elapsedMs: performance.now() - started };
      }
    });
    assert.equal(test.settleAfterLoss.rejected, true, `${backend}: settle rejects after device loss instead of hanging`);
    assert.ok(test.settleAfterLoss.elapsedMs < 250, `${backend}: settle rejects promptly after device loss`);
    test.lostGeometry = await capture(page, backend, 'lost');
    test.screenshots.push(`${backend}-lost-canvas.png`);
    await page.screenshot({ path: `${output}/${backend}-lost-page.png` });
    test.screenshots.push(`${backend}-lost-page.png`);

    // Change levels while the real camera asset is still pending, then allow its
    // completion to emit the ordinary late piece-loading event.
    await page.evaluate(() => {
      window.p2p.set({ fno: 8, iso: 800 });
      window.p2p.piece('cone');
    });
    test.restoreUrl = page.url();
    test.restoreState = await page.evaluate(() => ({ scenario: window.p2p.scenario(), piece: window.p2p.framing().piece }));
    releaseBodyRequest(); releaseBodyRequest = null;
    await page.evaluate(() => window.p2p.pieces.camera.ready());
    test.lateAssetCompleted = true;
    await context.unroute(bodyPattern);
    const stillVeiled = await page.evaluate(text => {
      const veil = document.querySelector('#veil');
      return veil.getAttribute('role') === 'alert' && veil.classList.contains('err')
        && !veil.classList.contains('off') && document.querySelector('#veil-msg').textContent === text
        && document.querySelector('#pins').classList.contains('held');
    }, recoveryText);
    assert.equal(stillVeiled, true, `${backend}: level change and late loading cannot dismiss recovery`);
    assert.equal(test.restoreState.piece, 'cone');
    assert.equal(test.restoreState.scenario.iso, 800);
    assert.equal(test.restoreState.scenario.fno, 8);

    const previousTimeOrigin = await page.evaluate(() => performance.timeOrigin);
    const navigation = page.waitForFunction(old => performance.timeOrigin !== old, previousTimeOrigin);
    await page.locator('#veil-reload').click();
    await navigation;
    await page.waitForFunction(expected => window.p2p?.backend() === expected
      && window.p2p.framing().piece === 'cone', backend);
    await page.waitForFunction(() => !document.querySelector('#veil').classList.contains('err')
      && document.querySelector('#veil').classList.contains('off'));
    await page.waitForFunction(() => window.p2p.render()?.scenario.iso === 800
      && window.p2p.scenario().fno === 8 && !window.p2p.framing().moving);
    test.urlAfterRestore = page.url();
    test.afterState = await page.evaluate(() => ({ scenario: window.p2p.scenario(), piece: window.p2p.framing().piece }));
    assert.equal(new URL(test.urlAfterRestore).pathname + new URL(test.urlAfterRestore).search,
      new URL(test.restoreUrl).pathname + new URL(test.restoreUrl).search,
      `${backend}: Restore returns to the latest scenario and piece URL`);
    assert.deepEqual(test.afterState, test.restoreState, `${backend}: Restore retains scenario and piece`);
    test.restoredGeometry = await capture(page, backend, 'restored');
    test.screenshots.push(`${backend}-restored-canvas.png`);
    await page.screenshot({ path: `${output}/${backend}-restored-page.png` });
    test.screenshots.push(`${backend}-restored-page.png`);
    assert.ok(test.restoredGeometry.changedPixels > 500, `${backend}: Restore reloads real rendered geometry`);
    assert.ok(test.restoredGeometry.variedFraction > 0.02 && test.restoredGeometry.brightPixels > 25,
      `${backend}: restored central image has variation and visible details`);

    const unexpected = errors.filter(message => !/Device Lost|WebGL context lost/i.test(message));
    test.unexpectedErrors = unexpected;
    assert.deepEqual(unexpected, [], `${backend}: no errors beyond the deliberately injected renderer loss`);
    test.passed = true;
    return test;
  } catch (error) {
    test.failure = String(error?.stack || error);
    throw error;
  } finally {
    report.cases.push(test);
    releaseBodyRequest?.();
    await context.close();
  }
}

try {
  for (const backend of ['webgl2', 'webgpu']) {
    const test = await exercise(backend);
    console.log(`PASS ${backend} graphics recovery`, JSON.stringify({ initial: test.initialGeometry,
      lost: test.lostGeometry, restored: test.restoredGeometry, urlAfterRestore: test.urlAfterRestore }));
  }
  report.passed = true;
} finally {
  writeFileSync(`${output}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
