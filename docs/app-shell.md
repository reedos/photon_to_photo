# The app shell (app/shell workstream, 09/28/2026)

The look prototype's UI shell: the page, the scenario builder, the stage (renderer, camera, HUD, pins), the
right panel, and the final-image panel. Ports The Intelligence Factory's CSS and DOM patterns per Reed's "one
signature style" call in design/LOOK.md. Talks to the physics only through `src/app/engine-api.ts`.

## Structure

```
index.html              the page: topbar, page head, scenario builder, stage, final-image panel
src/main.ts              bootstraps: store -> stage (async) -> registers pieces -> mounts UI -> installs hooks
src/styles/
  tokens.css              :root tokens, lifted from design/LOOK.md's "Palette" section verbatim
  base.css                ported Intelligence Factory components (topbar, scenario, stage, panel, pins/HUD...)
  app.css                 the few rules that are this project's own, not a port
src/app/
  store.ts                Scenario + active piece state, subscribe(), URL query <-> scenario
  engine-api.ts           THE adapter -- see "The engine" below
  stage.ts                WebGPU/WebGL2 renderer, camera rig, PMREM env, resize/pause, pins/labels, dives
  look.ts                 design/LOOK.md's materials as factory functions, + wavelengthToThreeColor()
  ui.ts                   scenario builder, level strip, right panel, final-image panel -- all DOM wiring
  hooks.ts                window.p2p test hooks
src/pieces/
  types.ts                the piece contract (BuildPiece / PieceHandle / PieceContext)
  lens.ts, cone.ts, loupe.ts   MINIMAL STUBS for this pass -- see "What is stubbed"
tools/
  preview.mjs             builds to dist-gates/, serves `vite preview` on 127.0.0.1:47501
  shot.mjs                Playwright + system Chrome + WebGPU: asserts the backend and zero console errors,
                           saves shots/shell/{desktop,phone}-{lens,cone,loupe}.png
```

## The three pieces and the level strip

The level strip (`#steps`) has one entry per prototype set piece, per docs/BRIEF.md's numbering:

| # | id | title | dot token |
|---|----|-------|-----------|
| 1 | `lens` | The lens | `--lens` |
| 2 | `cone` | Focus and bokeh | `--focus` |
| 3 | `loupe` | The loupe | `--loupe` |

Clicking a step, a top-bar nav item, or tapping the final-image canvas (-> `loupe`) calls `store.setPiece(id)`.
The store notifies `ui.ts`, which re-renders the scenario readouts, the level strip's sublines, the right
panel and the final image, then calls `stage.showPiece(id, title, lede)`. The stage lazily builds the piece
(`ensureBuilt`, memoized) and animates the camera from the previous piece's `frame()` to the new one's, per
design/LOOK.md's "Dive between scale levels" (a logarithmic-feeling ease, duration scaled by decades crossed,
skipped for `prefers-reduced-motion`).

## Pieces plug in through `src/pieces/types.ts`

```ts
type BuildPiece = (ctx: PieceContext) => PieceHandle;
interface PieceContext { renderer; look; labels: LabelLayer; badge: ScaleBadge }
interface PieceHandle {
  group: THREE.Group;
  update(model: Model, scenario: Scenario): void;
  frame(): { position: THREE.Vector3; target: THREE.Vector3 };
  probes: { id; label; anchor: THREE.Vector3 }[];
  dispose(): void;
}
```

`main.ts` registers each piece's `build` function with the stage (`stage.registerPiece(id, build)`); the stage
calls `build(ctx)` once, the first time that piece is shown, and calls `.update(model, scenario)` on every
scenario change afterward. `ctx.labels` and `ctx.badge` are how a piece talks to the HUD overlay (a pin label
anchored to a 3D point, the scale badge) without touching the DOM itself. A piece's `probes` become the pins the
stage projects to screen space every frame and the numbered part list `ui.ts` builds in the right panel;
clicking a part calls `stage.selectPin(id)`.

## The engine (`src/app/engine-api.ts`)

A thin adapter, not a new physics model. `compute(scenario)` wires together real `src/engine/**` calls
(`loadLens`/`realize`/`systemAt`/`cardinal`/`stopRadiusFor`/`irisOutline`/`bladeShapes`, `dof.ts`,
`diffraction.ts`, `exposure.ts`, `sensor.ts`) into the `Model` shape `src/engine/model-types.ts` defines.
`lensFans`/`pointBundle` wrap `trace.ts`'s `fan`/`spot` for whichever piece needs ray/bundle detail.
`renderImage` is a placeholder gradient (see below). Every field is either a real engine result or is marked
`STUB` in a comment at the point it's set, so the lead's swap to the real `camera.ts`/`render.ts` (workstream
E4) is mechanical: replace this file's four exports, keep `Model`'s shape, and no view code changes.

Two STUB chains worth calling out explicitly (both are load-bearing for the stat row, so they're implemented
with real formulas from `src/engine/exposure.ts`/`sensor.ts` rather than left at zero -- see the comments in
`engine-api.ts`'s `compute()` for the exact derivation):

- **`photonsMidGray`/`electronsMidGray`/`snrMidGray`** assume the current settings are a correctly-metered
  exposure of an 18% gray card (the ISO 2720 reflected-light meter equation) and use a monochromatic 555nm
  approximation for the radiometric<->photometric conversion. This is why the mid-gray photon estimate is
  *invariant* across an equivalent exposure (same EV, same ISO) and only moves with ISO -- see the test
  `engine-api.test.ts`, "the mid-gray photon estimate is invariant...". Real spectral scene radiance
  (`src/engine/scene.ts` + `data/color/*`) replaces this in E4.
- **Sensor figures not in `data/sensors.json`** (unity-gain ISO, a per-mode LCG/HCG read-noise split, per-channel
  QE curves) fall back to a same-format vendor stand-in chip or a flat assumed constant -- every fallback is
  commented at its assignment in `sensorInfoFor()`/`sensorSpecFor()`.

## What is stubbed

- **`src/pieces/lens.ts`, `cone.ts`, `loupe.ts`**: an axis line and one HUD label each, per the lead's scope for
  this pass. No lathed elements, iris, cone surface, microlens/CFA/well geometry yet. Each still exercises the
  real `Model` for its label text (lens name/element count, focus distance/CoC, sensor pitch), so the numbers
  are real even though the geometry is a placeholder.
- **`renderImage()`**: a smooth vertical gradient, not `render.ts`'s per-pixel scene/blur/noise/pipeline render.
  The final-image panel and its caption say so.
- **`engine-api.ts`'s exposure chain and sensor spec fallbacks**: see above.
- **The layer toggle**: Rays is the only live layer; Waves and Charge are visible but `disabled`, captioned
  "soon" per THE PAGE's spec -- there is no diffraction or charge-electron piece yet to switch to.
- **Evidence chips**: a plain `<span class="chip">`, not Intelligence Factory's click-to-open source popover
  (`src/sources-ui.js` there). The five colors and basis short-labels (Spec/Vendor/Reported/Calc./Assumed) are
  ported; the popover interaction is out of scope for this pass.
- **Tours, glossary, method and sources pages**: not built. The top bar's "Method" link is present and disabled
  ("Not built yet"), matching docs/BRIEF.md's site layout without claiming pages that don't exist.
- **"Pin to compare"**: design/LOOK.md's "one signature style" section names it among the scenario builder's
  carried-over elements. Not built in this pass -- there is no multi-scenario compare state yet, only the single
  live scenario the URL query mirrors. Deferred, not a silent drop.

## The `window.p2p` test hooks (`src/app/hooks.ts`)

```ts
p2p.set(partial)      // store.set(partial) -- merges into the current scenario, normalizes, re-renders
p2p.piece(id)         // store.setPiece(id) -- 'lens' | 'cone' | 'loupe'
p2p.settle()          // Promise, resolves after the next frame the stage actually draws
p2p.backend()         // 'webgpu' | 'webgl2', the backend actually obtained (not just what was asked for)
p2p.gpuIdle()         // Promise, awaits device.queue.onSubmittedWorkDone() on WebGPU
p2p.model()           // compute(store.get().scenario) -- the current Model
p2p.scenario()        // the current normalized Scenario
p2p.pins()            // the active piece's pins in screen space: { id, label, x, y, on }[]
```

The URL query mirrors the scenario 1:1 (`?lens=p50&fno=4&focus=3&shutter=1/250&iso=400&format=ff&piece=lens`;
`focus=inf` for infinity), read on load (`createStore()`) and written on every change (`history.replaceState`,
no history spam). `src/app/store.ts`'s `scenarioFromQuery`/`queryFromState` are the tested, pure half of that;
`Store` is the thin stateful wrapper.

## Running it

```
npm run dev                  # http://127.0.0.1:47500, live
node tools/preview.mjs       # builds to dist-gates/, serves http://127.0.0.1:47501, stays running
node tools/shot.mjs          # builds+serves+screenshots shots/shell/*.png, asserts webgpu + zero console errors
npx vitest run                # unit tests (store.ts, engine-api.ts's wiring)
npx tsc --noEmit -p .         # typecheck
```

`?gl=webgl2` on either server forces the WebGL2 backend, to check the fallback path.

## Known limits of this pass

- The quality governor (`stage.ts`'s `governQuality`) adjusts pixel-ratio tier from measured frame time, but
  with three axis-line-and-a-label pieces there is nothing expensive enough on screen yet to exercise the
  "mid"/"phone" tiers in practice -- the plumbing is real and testable once the real geometry lands.
- `look.ts`'s material factories (glass, CFA dyes, the well, charge) are written and typed against
  design/LOOK.md but unused by the current stub pieces; they are there for the set-piece builders to pick up.
- No visual-accuracy gate (`tools/accuracy.mjs`, docs/PROTOTYPE.md) yet -- there is nothing to check the
  rendered frame against until the real pieces trace rays. `tools/shot.mjs` covers this pass's actual bar:
  same site family, real backend, no console errors.
