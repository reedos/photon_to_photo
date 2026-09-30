# Rendering spike: Three.js WebGPURenderer + TSL vs. its WebGL2 fallback

Workstream: render-spike. 09/28/2026. Machine: this dev box (RTX 5090), Windows 11 Pro
10.0.26200, Three.js 0.186.1 (as installed in `package.json`), headless Chromium via Playwright
1.63, driven from `node_modules`. Pages served from `http://127.0.0.1:47510` (Vite dev server,
stopped when this spike finished). Code lives in `spike/`, one small page per sub-test plus a
~130-line shared harness (`spike/common/harness.ts`). Every number below came from a script
actually running against real hardware, not estimated.

**Bottom line: yes, build on `WebGPURenderer` + TSL.** All seven sub-tests work on the real WebGPU
backend, at costs that are noise next to a 16.7ms frame budget. The WebGL2 fallback carries six of
the seven; the one real gap (a compute shader writing a storage texture) has a clean, cheap,
same-code-shape fallback. The rest of this doc is the evidence and the gotchas that cost the most
time to find.

## Results table

fps numbers are from `requestAnimationFrame` wall-clock pacing; see the "fps is not GPU time"
gotcha below for why the GPU-timestamp `ms` columns, not fps, are the trustworthy cost numbers.

| Test | WebGPU | WebGL2 fallback |
|---|---|---|
| (a) 1M particles: TSL compute + instanced sprites | **works.** compute 0.029 ms, render 0.61 ms (GPU timestamps), init 1M particles 91-114 ms, fps loop pegged at the 240 fps rAF ceiling | **works**, same code path (`forceWebGL: true`). compute 22.3 ms, render 18.2 ms. One WebGL driver warning (below), numerically correct anyway |
| (a) readback accuracy gate (30 steps, 200 sampled particles) | **pass**, max abs diff 1.0e-5 vs. tolerance 1e-3 | **pass**, max abs diff 1.1e-5 |
| (b) 20k ray segments, thin lines (`LineSegments`+`LineBasicNodeMaterial`) | **works.** gpu render 0.10 ms, CPU rebuild+upload 1.2-1.3 ms/frame | **works**, gpu render 0.10 ms, CPU cost 1.1-1.3 ms/frame |
| (b) 20k ray segments, fat lines (`LineSegments2`+`Line2NodeMaterial`, addons) | **works.** gpu render 0.24 ms, CPU rebuild 2.1 ms/frame (`setPositions`/`setColors` reallocate every call) | **works**, gpu render 0.23 ms, CPU rebuild 1.5 ms/frame |
| (c) biconvex lens (`LatheGeometry` + `MeshPhysicalNodeMaterial`, transmission/ior/dispersion) + ray fan through it | **works.** one frame (transmission pass + 15-ray fan + orbit) costs 0.037 ms GPU time | **works** but **~1,150x more expensive**: 42.1 ms/frame for the transmission pass alone (vs. 0.037 ms). Same visual result, pixel-verified |
| (d) exact-sRGB marker vs. tone-mapped scene (`RenderPipeline`) | **the naive pattern fails, exactly like the brief's EffectComposer/OutputPass pitfall; a working pattern exists.** See below | Same three outcomes, byte-identical marker pixel on the "fails" case (251,16,20 on both backends) |
| (d) GTAO (`ao()` from `three/addons/tsl/display/GTAONode.js`) | **fails with `antialias: true`** (the renderer default): WGSL compile error, `textureGather` doesn't support a multisampled depth texture. **Works with `antialias: false`** | **works regardless of antialias** -- the WebGL2 backend doesn't hit this bug at all |
| (e) compute-written 1536x1024 storage texture, Poisson noise | **works.** compute 0.066-0.069 ms (GPU timestamp), wall 7.9-8.6 ms. Sampled mean 12.75 vs. lambda=12, std 3.83 vs. sqrt(12)=3.46 (40 8-bit-quantized samples -- a sanity check, not a precision claim) | **fails**, and not gracefully the first time (see gotcha below). Clean error once isolated: `THREE.NodeBuilder: Uniform "storageTexture" not implemented.` Fragment-shader fallback (below) works: 7.4 ms GPU, 17-19 ms wall |
| (f) `getArrayBufferAsync` readback for an accuracy gate | **works**, folded into (a)'s accuracy gate above and (e)'s noise sanity check | **works**, same |
| (g) GPU timestamp queries for a quality governor | **works.** `renderer.hasFeature('timestamp-query')` true; `trackTimestamp: true` + `resolveTimestampsAsync('compute'\|'render')` returns real numbers, used throughout (a)-(e) above | **works** via `EXT_disjoint_timer_query_webgl2` (confirmed present; three.js maps that extension name to the same `'timestamp-query'` feature string). Also used throughout (a)-(e) |

## Working code patterns

**Renderer, either backend** (`spike/common/harness.ts`):
```ts
const renderer = new THREE.WebGPURenderer({
  canvas, antialias: true, forceWebGL /* true = WebGL2 backend */, trackTimestamp: true,
});
await renderer.init();
const gpuTimingWorks = renderer.hasFeature('timestamp-query');
```

**1M-particle compute + instanced sprites** (spike a): a storage buffer per attribute, a `Fn().compute(count)`
kernel, and `SpriteNodeMaterial.positionNode = positionBuffer.toAttribute()` with `sprite.count = particleCount`
on a plain `THREE.Sprite` -- three.js reads `object.count` to instance-draw it:
```ts
const positionBuffer = instancedArray(particleCount, 'vec3');
const computeUpdate = Fn(() => {
  const pos = positionBuffer.element(instanceIndex);
  pos.addAssign(velocityBuffer.element(instanceIndex).mul(dt));
})().compute(particleCount);

material.positionNode = positionBuffer.toAttribute();
const particles = new THREE.Sprite(material);
particles.count = particleCount;         // <- this is the whole trick
particles.frustumCulled = false;
```

**GPU timing** (spikes a, b, c, e): timestamp queries are per-dispatch, isolated from any other work:
```ts
renderer.compute(computeUpdate);
const ms = await renderer.resolveTimestampsAsync('compute'); // also updates renderer.info.compute.timestamp
renderer.render(scene, camera);
const renderMs = await renderer.resolveTimestampsAsync('render');
```

**GPU-to-CPU readback for an accuracy gate** (spikes a, e; `f`):
```ts
const raw = await renderer.getArrayBufferAsync(positionBuffer.value); // .value is the StorageInstancedBufferAttribute
const positions = new Float32Array(raw);
```

**The exact-sRGB-marker-under-tone-mapping pattern** (spike d) -- this is the one the brief asked us to
find. Three tests, all read back pixel-exact with `renderer.readRenderTargetPixelsAsync`:

1. **Direct `renderer.render()`, no post pipeline.** Each `NodeMaterial` already carries its own
   `toneMapped` flag and applies (or skips) tone mapping per-object, inline, while building its
   shader. No pipeline stage re-touches the frame afterward. **Marker pixel: exact (255,0,0,255).**
   If a level doesn't need post-processing, this is enough by itself.
2. **`RenderPipeline` fed by one `pass(scene, camera)`, default `outputColorTransform: true`.**
   `pass()` renders the scene to an offscreen texture at full precision -- tone mapping is
   deliberately *not* applied inside that pass, deferred instead to the pipeline's single
   `renderOutput()` step at the very end, applied uniformly to the whole frame. This is structurally
   the same shape as `EffectComposer`'s `OutputPass`, and it reproduces the same pitfall: **marker
   pixel (251,16,20,255), not exact**, even though the marker material has `toneMapped: false`. That
   flag is meaningless once the pixels are already in the pass's texture.
3. **The fix: split into two passes, composite manually.**
   ```ts
   const pipeline = new THREE.RenderPipeline(renderer);
   pipeline.outputColorTransform = false;               // we apply renderOutput() ourselves

   const litPass = pass(litScene, camera);               // scene WITHOUT the marker
   const markerPass = pass(markerOnlyScene, camera);      // ONLY the marker, transparent bg

   const litOut = renderOutput(litPass, renderer.toneMapping, renderer.outputColorSpace);
   const markerOut = renderOutput(markerPass, THREE.NoToneMapping, renderer.outputColorSpace);
   pipeline.outputNode = vec4(mix(litOut.rgb, markerOut.rgb, markerPass.a), 1.0);
   ```
   **Marker pixel: exact (255,0,0,255)** again, while the lit sphere in the same frame is still
   tone-mapped. `renderOutput(color, toneMapping, colorSpace)` is the primitive that lets each
   branch pick its own tone-mapping treatment; the pipeline-level `outputColorTransform` flag is
   what decides whether that choice is made once for everything (pitfall) or left to the app
   (working pattern). Same three outcomes, same byte-identical "fails" pixel value, on WebGL2.

**Poisson noise via a bounded Knuth sampler in TSL** (spike e), works as both a compute kernel and a
per-fragment shader from the same function:
```ts
function poissonSample(seed) {
  const L = float(Math.exp(-LAMBDA));
  const k = int(0).toVar(), p = float(1).toVar();
  Loop({ start: int(0), end: int(MAX_ITERS), type: 'int', condition: '<' }, () => {
    p.mulAssign(hash(seed.add(k.toFloat()).add(1.0)));
    k.addAssign(1);
    If(p.lessThanEqual(L), () => { Break(); });
  });
  return k.sub(1).max(0).toFloat();
}
```
`MAX_ITERS = 48` is enough headroom for lambda around 12 (mean iteration count is lambda+1). A real
engine should switch to a Gaussian approximation once lambda gets large, both for accuracy and
because the loop bound has to be static in TSL.

## What fails on WebGL2, and the fallback for each

- **Storage-texture compute writes** (`new THREE.StorageTexture()` + `textureStore()` inside a
  `compute()` kernel) are WebGPU-only. Three's own doc comment on `StorageTextureNode` already says
  so ("This node can only be used with a WebGPU backend"); this spike confirms it and the concrete
  fallback: **run the identical noise/compute math per-fragment in a normal render pass instead**,
  writing into a `RenderTarget` via a full-screen quad and `MeshBasicNodeMaterial.colorNode`. Same
  `poissonSample()` function, just fed `screenCoordinate` instead of `instanceIndex`-derived
  coordinates. Cost on WebGL2 was fine either way (7.4 ms GPU for the whole 1536x1024 frame) --
  this is a correctness/availability gap, not a performance one, for anything that only needs to
  write a full-screen image (the final-image render, most likely). Something that genuinely needs
  **scattered/random-access** writes into a texture (not full-screen) would need a different
  fallback (e.g., accumulate into a storage buffer instead and blit); we didn't hit that case here.
- **GTAO on WebGPU with the renderer's default `antialias: true`** fails (WGSL `textureGather`
  doesn't support a multisampled depth texture); **WebGL2 doesn't have this problem at all**
  (different depth-resolve path). The fallback that works on both: **render the GTAO-feeding
  depth/normal prepass into a non-multisampled target**, e.g. a dedicated `antialias: false`
  renderer/pass for that prepass while the main scene keeps MSAA, or just don't MSAA the level
  that uses GTAO and get anti-aliasing from TAA/FXAA instead.
- **Transmission (`MeshPhysicalNodeMaterial.transmission`) is ~1,150x more expensive on WebGL2**
  (42.1 ms vs. 0.037 ms per frame for one small lens element) even though it renders correctly.
  This isn't a hard failure, but it is a real budget problem: one transmissive lens element alone
  blows a 16.7 ms frame budget on WebGL2. If the WebGL2 tier needs to show glass at all, either
  cap it to very few transmissive elements on screen at once, fake it with a cheaper
  refraction-free glass shader (Fresnel rim + a static environment reflection, no live
  background-copy pass), or accept a lower frame rate specifically on that layer for that tier.

Everything else in the table -- 1M-particle compute, both line styles, the accuracy/readback gate,
and GPU timing itself -- works the same way on both backends, at costs that don't matter next to a
frame budget.

## Gotchas (roughly in the order they cost time)

1. **This machine's Playwright-pinned Chromium build cannot create a real WebGPU device.** The
   exact launch flags from the brief (`--use-angle=d3d11 --enable-unsafe-webgpu
   --ignore-gpu-blocklist`) do get `navigator.gpu.requestAdapter()` to correctly see the RTX 5090
   (`vendor: "nvidia", architecture: "blackwell"`), but `adapter.requestDevice()` on
   chromium-1243 (153.0.8010.12, Playwright 1.63's current pin) fails every time with
   `DynamicLib.Open: dxil.dll Windows Error: 87` from Dawn's D3D12 backend -- even though
   `dxil.dll`/`dxcompiler.dll` are physically present next to `chrome.exe` and load fine via a
   bare `LoadLibraryEx` test. Three.js's own fallback then silently swallows this and runs WebGL2
   instead, with only a console warning (`THREE.WebGPURenderer: WebGPU is not available, running
   under WebGL2 backend`) -- easy to miss, and it would have made every "WebGPU" number in this
   report actually be a WebGL2 number. **Fix found:** an older Chromium already cached on this
   machine from an earlier Playwright pin, chromium-1234 (151.0.7922.34), creates the device fine
   with identical flags. `run-one.mjs` in the runner script (`.local/render-spike/run-one.mjs`)
   picks that `executablePath` when present. Before trusting *any* "webgpu" result on a new
   machine, check the console for that fallback warning, or check
   `renderer.backend.isWebGPUBackend` / that `adapterInfo` came back non-null.
2. **`readRenderTargetPixelsAsync`'s row order is backend-dependent.** Row 0 of the returned buffer
   is the *top* of the image on the real WebGPU backend, and the *bottom* of the image on the
   WebGL2 fallback backend -- verified directly (a quad placed only in the top half of an
   orthographic view lands at low raw row indices on WebGPU, high raw row indices on WebGL2). Any
   pixel-accuracy code -- this spike's (d), and the project's later visual-accuracy gate -- needs
   `spike/common/harness.ts`'s `readPixelRGBA(renderer, rt, backend, x, y, height)` helper or
   equivalent, not a hardcoded flip. Got this wrong on the first pass and it produced pixel
   readbacks that looked plausible (still valid RGBA values) but were quietly sampling the wrong
   row -- the kind of bug an accuracy gate exists to catch, and would have hidden other real bugs
   underneath it.
3. **`Vector3.project(camera)` silently uses a stale `camera.matrixWorldInverse`** if the camera's
   position/orientation changed since the last `render()` call and you haven't called
   `camera.updateMatrixWorld(true)` yourself. Projecting *before* the first render of a given
   camera pose gives a wrong-but-plausible screen position (no error, just off by however much the
   camera moved from its constructed pose). `spike/d-post.ts`'s `projectToPixel()` calls
   `camera.updateMatrixWorld(true)` defensively for this reason.
4. **WebGPU pipeline-creation validation errors are async and console-only by default** -- a
   `try/catch` around `pipeline.render()` does not see them (confirmed: the GTAO/`textureGather`
   failure above produced zero JS exceptions; the page happily "succeeded" and returned stale
   render-target contents from a previous draw). Wrap risky WebGPU-only calls with
   `device.pushErrorScope('validation')` / `await device.popErrorScope()` (see
   `spike/d-post.ts`'s `runGtao()`) to get a JS-visible error instead of a silent wrong frame.
5. **A failed `StorageTexture` compute write on WebGL2 doesn't always fail cleanly -- it can hang
   the renderer.** The first time we hit this, the write itself produced a flood of
   `WebGL: INVALID_OPERATION: getQueryParameter: 'query' is not a query object yet` /
   `beginQuery: a query is already active for target` warnings and the page never finished: the
   renderer's `trackTimestamp` bookkeeping got left in a bad state, and it stayed bad for every
   *later* `render()` call on that same renderer instance too (the harmless fragment-shader
   fallback test hung right along with it, on the same page). **Fix:** run the risky attempt on
   its own throwaway renderer/canvas (`spike/e-noise-texture.ts`), and guard it with a hard
   timeout (`harness.ts`'s `withTimeout()`) since `try/catch` alone doesn't help against a hang.
   Once isolated, the real failure is fast and clean: `THREE.NodeBuilder: Uniform "storageTexture"
   not implemented.`
6. **fps measured via `requestAnimationFrame` wall-clock pacing is not a GPU cost measurement in
   this headless setup**, and can be actively misleading. Every fps number in the results table
   landed within a few percent of exactly 240 fps regardless of what was actually being drawn --
   including spike (c)'s WebGL2 run, where the GPU timestamp for the *same frame* showed 42 ms
   (23 fps-equivalent) of real GPU work. Submission is not backpressured against GPU completion in
   this environment, so the CPU-side rAF loop just keeps requesting frames at whatever cadence
   headless Chrome's compositor allows, independent of whether the GPU finished the previous one.
   **GPU timestamp queries (test g) are the only numbers in this report that should be trusted for
   cost**; fps is included in the table only because the brief asked for it, with this caveat.
7. **`instancedArray`/`Fn`/etc. must all come from the same module instance.** Importing
   `instancedArray` from three's raw source path (`three/src/nodes/accessors/Arrays.js`) instead
   of the public `three/tsl` barrel produced `THREE.TSL: No stack defined for assign operation`
   at every `.assign()` call inside a `Fn()` -- two separate copies of the node-system module
   graph, each with its own "current stack" singleton. Only import from `three/webgpu`, `three/tsl`,
   and `three/addons/*`; never reach into `three/src/*` directly.
8. **A zero-alpha "transparent" pass isn't automatic.** `scene.background = null` on the
   marker-only scene in spike (d) test 3 was enough here (default clear alpha for an offscreen
   `pass()` render target was 0), but this was observed, not verified against three.js's source --
   worth a real test before depending on it for the actual project's compositing.

## GPU/adapter identity (for the record)

`adapter.info` via the real WebGPU backend: `vendor: "nvidia"`, `architecture: "blackwell"` (RTX
5090). Adapter features included `timestamp-query`, `shader-f16`, `float32-filterable`,
`float32-blendable`, `texture-compression-bc`, `subgroups`, `indirect-first-instance`, among
others -- see `.local/render-spike/gpu-check.mjs`'s output for the full list if a later workstream
needs to check a specific feature.

## Recommendation

**Use Three.js `WebGPURenderer` with TSL, forceWebGL for the WebGL2 tier, as the brief proposed.**
Every signature visualization in the brief (photon rain / particles, spectral ray fans, the glass
lens cutaway, the exact-color pixel-loupe requirement, the final-image compute render, a
timestamp-based quality governor) has a working pattern here on the real WebGPU backend at costs
far under budget, and five of the seven sub-tests carry over to WebGL2 unchanged. The two real
WebGL2 gaps -- no compute-written storage textures, and expensive transmission -- both have
concrete, already-proven fallbacks (fragment-shader noise; budget/fake transmission on that tier)
rather than open questions. The gotchas above cost real time to find and are exactly the kind of
thing that would otherwise surface much later as a "why does this look right on my machine and
wrong in CI / on a phone" bug; now that they're known, they're cheap to route around from the
start (the backend-aware pixel readback helper and the `updateMatrixWorld()` habit in particular
should just become house style everywhere `project()` or pixel-accuracy checks are used).

**Open problems / not covered here:**
- Real ray-tracing through the lens (Snell's law, per-surface, per-wavelength) -- this spike's ray
  fan is a placeholder for the material/geometry/line combination, not physics; that's workstream
  2.
- Phone-tier WebGPU/WebGL support wasn't tested (no phone hardware in this environment) -- the
  brief's phone quality tier should get its own pass on real devices before launch.
- The "transparent second pass" assumption in gotcha 8 should get a real test, since spike (d)'s
  composite depends on it.
- Only one GPU (RTX 5090) and one Chromium build combination were tested; the chromium-1243
  device-creation bug (gotcha 1) is worth a quick check on whatever CI/build machine ends up
  running the project's later visual-accuracy gate headlessly, since that gate's whole point is to
  compare rendered frames against the engine, and it would silently lose most of its value if it
  were secretly running WebGL2 the whole time while believing it was testing WebGPU.
