# Reusing The Intelligence Factory's pattern for Photon to Photo

Read against `~/projects/intelligence_factory` at its current HEAD (`0f75d87`, 123 commits). Every reference below
is `file:line` in that repo unless marked otherwise. IF = Intelligence Factory, P2P = Photon to Photo (this project).

IF's shape: one pure engine (`compute(scenario)`) feeds a content layer (`data.js`) that turns numbers into scene
content; a 3D stage (`stage.js`) renders one Three.js scene per "level" built by `src/scenes/*.js`; every number on
screen carries an evidence label (`evidence.js`) checked by a claims walker (`claims.js` + `tools/claims.mjs`); a
tour player (`story.js` + `journeys.js`) narrates the same content the cards show; Playwright probes (`tools/*.mjs`)
gate every merge on the real page, not a mock. P2P's brief asks for the same discipline over a camera/lens/sensor
model instead of a data-center power model. Below, for each piece: what it does, the key API, and copy / adapt / skip.

## 1. The pure engine — `src/model/engine.ts` (426 lines) + `engine.test.ts` (208 lines)

**What it does.** One function, `compute(s: Scenario)` (line 209), takes a small scenario object (`meterMW, accel,
power, cooling, site?, stage?`, lines 15-22) and returns one big plain object with everything the page shows:
per-rack numbers (`rackOf()` line 167), a fabric solve that pins two-tier vs. three-tier topology by checking each
candidate's own port budget rather than guessing (`tierConfig`/`fabricOf`, lines 183-200, and the campus solve at
242-253), a full power ledger as an array of `{label, mw, kind, scene, basis, ev, link}` rows (lines 290-315) that
sums exactly to the meter (`gpuSiliconMW` as the actual physical remainder, not "whatever's left", lines 316-323),
a voltage staircase (341-353) and a bandwidth ladder (360-366) each row of which states its own measurement basis
(`aggregate`/`each way`/`shared`, comment at 355-359), and facility layout counts (`layout`, 376-392). It returns
`{ scenario, accel, power, cooling, meterMW, IT_MW, pue, ..., ledger, gpuSiliconMW, marks, staircase, bandwidth,
layout, ... }` (394-415). Nothing here touches the DOM or Three.js (line 3 comment) — it is tested directly, with
no mocks. A second small pure function, `waterM3h(M, frac)` (423-425), is a good model for any post-hoc derived
figure that needs to warn against a wrong-but-tempting alternate formula (see the WUE test below).

**engine.test.ts's style is worth copying whole-cloth.** It reads as documentation: `run(s)` merges a partial
scenario over `DEFAULT_SCENARIO` (line 4); tests state the exact expected numbers in their own titles ("the default
100 MW scenario: 86.3506 MW IT × 0.16 L/kWh × 24 h = 331.6 m³/day, not the 384 a meter-based figure would give",
line 7) and then assert the *wrong* formula's answer too, in a comment, so the two can never silently converge
(line 11). A `describe` block walks every accelerator × power × cooling combination checking a conservation
invariant (energy in = ledger + silicon, lines 25-39) — P2P's exact analogue is "every lens × format × setting
combination has zero claims problems" (see §10) and "DOF/hyperfocal/Airy/EV closed-form checks" from BRIEF.md. The
boundary-case tests (139-147, "reproduces the audit's exact GB300-at-27-MW case") record a bug that was found and
fixed, at the exact input that found it — do this for P2P's own audit fixes.

**Verdict: adapt heavily.** The domain doesn't transfer (no racks, fabrics or PUE), but the *architecture* transfers
completely: one pure `compute(scenario) -> Model` function; a `Scenario` type with a `DEFAULT_SCENARIO` constant;
per-component data tables (`ACCELERATORS`, `POWER`, `COOLING` here become `LENSES`, `SENSOR_FORMATS`, `SHUTTER_TYPES`
etc., matching `src/engine/lens-types.ts`'s `LensDesign`); a `basis: EvidenceKind` field carried on every table entry
(engine.ts:50, 95, 107, matching P2P's own `EvidenceKind` in lens-types.ts:16); rows that carry a `link: {scene,
mode, part}` back into the 3D view (engine.ts:162-163) so a claim can jump to where it is drawn. P2P's engine
computes photon transport, not power flow, but the same shape applies: `compute(scenario)` returns everything a
level needs, each figure with a `basis` and, for `derived` figures, a `calc` id (see §9) that the method page can
show the formula for. Given P2P targets Three.js's WGSL/TSL compute shaders for the photon simulation, keep the
*classical/closed-form* physics (thin-lens, DOF, hyperfocal, Airy radius, EV arithmetic, shot-noise SNR) in this
kind of plain TS function with unit tests exactly like engine.test.ts — the compute-shader Monte Carlo pieces are a
separate, harder-to-unit-test layer that should still be checked against these closed forms (see BRIEF.md's "visual
accuracy gate").

## 2. The content/glue layer — `src/data.js` (1,102 lines)

Not in the brief's explicit list, but it is the layer that turns `Model` into everything the stage and tours read:
`content(M)` builds `SCENES`, `PARTS`/`PARTS_DATA`/`PARTS_HEAT` (per-level, per-layer part lists with `specs` rows
carrying `[label, value, basis, ev]`), `BOM`, `TEMPS`, `LEDGER_END`, and the walk order each layer's tour uses.
`VOLT` (data.js:8-29) is the single source of truth for every flow/legend/chart color, keyed by a short id ('hv',
'mv', 'nvl', 'hot', ...) that `kit.js`'s `flow()` (kit.js:225) and `stage.js`'s `legends()` (stage.js:36-68) both
read. **Verdict: adapt.** P2P needs the equivalent glue file (say `src/content.ts`) turning the engine's `Model`
into level/part lists, plus a `COLOR`-equivalent table (wavelength-band colors for rays, one entry per named flow
type: photon ray by wavelength bin, charge, heat, data-out). Keep `content(M)` pure and synchronous like this one —
`store.js` (below) calls it on every scenario change with no async boundary.

## 3. Global state — `src/app/store.js` (32 lines)

**What it does.** The whole reactive core in one file: a `Map` of event listeners (`on`/`emit`, lines 14-19), a
`store` object holding `scenario`, the computed `M` and content `C`, a `pinned` comparison model, and `ui` (`scene,
selected, mode`). `setScenario(patch)` (21-26) recomputes `M = compute({...store.scenario, ...patch})`, **then reads
the scenario back off `M.scenario`** (comment: "the engine falls back on options an accelerator cannot take") so
the UI never shows a setting the engine silently rejected. `pin()` (27-30) snapshots the current model for an A/B
compare view. Called once at import time with `{}` (line 32) so the store has a model before anything else runs.

**Verdict: copy nearly as-is.** This is domain-agnostic. P2P's store is identical in shape: `scenario` (lens id,
format, f-stop, shutter, ISO, focus distance, focal length...), `M` from `compute(scenario)`, `C` from `content(M)`,
`ui: {level, selected, mode}` where `mode` becomes P2P's toggle among rays/waves/charge-noise layers (BRIEF.md's
"Layers to toggle... rays, waves, charge and noise" — direct analogue of IF's power/data/heat). Keep the
fallback-read-back pattern: if a reader picks a lens/format combination the engine can't honor (e.g., a lens whose
image circle doesn't cover a format), read the corrected scenario back off the compute result exactly as here.

## 4. The 3D stage — `src/app/stage.js` (892 lines)

The biggest single file and the one with the most to adapt for WebGPU. Read in full; organized by subsystem below.

### 4a. Levels and per-level look — lines 1-68, 184-196
`BUILDERS` (line 24) is an ordered array of scene-builder modules, one per level/scale (`across, campus, hall,
rack, tray, chip` — P2P's six: scene, lens, image-circle, sensor, readout, pipeline). `LOOK` (28-35) is a parallel
array of per-level rendering defaults (`bloom, threshold, ao, exposure`), overridable by a scene's own `build()`
return (`look: {...}`, comment 26-27). `getScene(i)` (185-196) lazily builds level `i` by calling
`BUILDERS[i].build({quality, state, model})`, tags it with the model it was built from (`b.model = store.M`, so a
stale build can be detected — see `go()` §4f), and applies the level's lighting environment. **Verdict: copy the
pattern (lazy per-level build, look table, environment tagging), adapt the per-level `LOOK` values and add P2P's own
`envFor()` kinds** (studio/indoor/sky/night here, lines 152-177 — P2P likely wants a lab/bench environment for the
lens cutaway and a "deep space" or neutral void for the sensor/pixel levels, per BRIEF.md's "glass, anodized metal,
silicon" material direction).

### 4b. The quality governor — lines 109-145, 257-333
Measures real frame cost (GPU timer queries where available, `EXT_disjoint_timer_query_webgl2`, lines 131,
285-297) and CPU draw time, and steps a per-level `TIERS` array (117-125: mirror → AO/DOF → 4×MSAA/live shadows →
resolution 1.25→1→0.75) down when frames run slower than ~40 fps *because of drawing* (comment 305-309: separates
"the GPU is the bottleneck" from "something else is," e.g. a battery-saver 30 fps cap, via `throttle` mode in
`tools/govern.mjs`). `felt()` (line 304) computes frame cost as the mean interval **excluding the slowest 5%**,
specifically because a falling-behind GPU delivers frames in bursts and the median alone reads 60 fps on a page
actually running at 15 (comment 301-303, and commit `1a35961`'s postmortem, §20). Tiers persist per-GPU-name in
`localStorage` (140-144). `looksLike()`/`stepFrom()` (269-274) skip a tier that changes nothing this level actually
has (an air-cooled hall with no floor mirror). **Verdict: adapt.** The tier *shape* (shed most expensive effect
first, remember what a GPU settled on, separate GPU-bound from elsewhere-bound) transfers directly to P2P's phone
tier requirement (BRIEF.md: "a phone tier that keeps every set piece readable even when effects are reduced"). What
changes for WebGPU: `EXT_disjoint_timer_query_webgl2` doesn't exist there — WebGPU's `GPUQuerySet` timestamp
queries are the replacement, gated behind the `timestamp-query` feature (not universally available, especially on
the WebGL2 fallback path, which keeps this exact extension). P2P likely needs **two governor implementations**
gated on which renderer is live, sharing the `TIERS`/`stepFrom`/`felt` logic but not the query mechanism.

### 4c. Camera framing — `frame()`, `onScreen()`, `clearLine()`, `safeBox()` — lines 354-414
Before flying to a part, `frame(b, h)` (399-414) checks the hand-set preset view against two things: (1) **on
screen** — `onScreen()` (384-393) projects the part through a camera clone at the *current* viewport aspect (a
documented past bug, commit `a850ed1`: projecting with a stale aspect because the `ResizeObserver` fires after
layout put pins off-screen when a clock strip's close changed the view's height mid-flight) and inside a
`safeBox()` (372-383) computed from what HUD chrome is actually on screen right now; (2) **line of sight** —
`clearLine()` (394-398) raycasts from the candidate camera position to the part and requires no solid hit before
85% of the distance, against a cached `solidsOf(b)` list (360-371) that excludes sprites and low-opacity
transparents. If the preset fails either check, `frame()` first slides the look-at target toward the part in
quarter-steps (402-403), then — if still blocked — orbits the camera through a fixed list of polar/azimuthal
offsets, trying higher angles before lower ones ("never below the floor," comment 407) until both checks pass
(405-412). **Verdict: copy the algorithm essentially unchanged.** This is exactly the mechanism P2P needs for the
"loupe" signature interaction (BRIEF.md #9: "dive straight down to that pixel's well") and every tour stop through
a lens cutaway where glass elements can occlude the part being described. `tools/views.mjs` (§13) is the gate that
gave this its 210-stop regression coverage — build the P2P equivalent early, not after visual polish starts.

### 4d. Dive transitions — `irisTo`, `portalOf`, `jumpLabel`, `go()` — lines 612-747
Level changes are a two-phase iris wipe: closing on the part that holds the next level (`portalOf()`, 612-620,
finds whichever part in the *current* mode's hotspot map has `drill === into`, falling back through power→data→heat
so a level change works even if the current layer doesn't happen to draw that hotspot), a name card
(`jumpLabel()`, 645-648) that stays up for a minimum real time regardless of transition speed (`Math.max(800,
1400 * T)`, line 729 — the fix in commit `eff651a` after Reed reported the name "flashed by too quickly"; the view
now only reopens once the new level has drawn 3 frames behind the veil, line 731, so first-frame stutter is
hidden), then opening from close-in on the *matching* part of the level just entered. `go()` (653-747) is the
whole state machine: queues a newer request over a busy one rather than dropping it (655, 745), detects "the
scenario changed mid-switch" and re-runs itself once the switch lands (746). **Verdict: adapt the mechanism,
rewrite the specifics.** The iris/portal/name-card sequence is a strong, tested pattern for "diving" through scale
levels and should carry over almost verbatim for P2P's scene→lens→image-circle→sensor→readout→pipeline dive.
`TRANSITIONS = {full: 1, quick: 0.6, instant: 0}` (436) and reduced-motion always cutting (438) are worth keeping
as-is.

### 4e. Test hooks — `window.ifx` — `main.js:22-27` (not stage.js itself)
Every Playwright probe drives the page through one object: `window.ifx = {store, setScenario, pin, state: store.ui,
go, select, setMode, camera, controls, composers, built, renderer, renderScale, quality, forceTier, setTransitions,
show, THREE, journeys, openClock, closeClock, enterStory, exitStory}`. This is what makes every `tools/*.mjs` gate
possible without a testing framework baked into the app — `p.evaluate(() => window.ifx.setScenario(s))` from a bare
Playwright script. **Verdict: copy exactly.** P2P needs the identical seam: `window.p2p = {...}` exposing scenario
control, level navigation, quality/tier control, the tour/story API, and `THREE` itself (so a probe can raycast or
inspect materials, as `tools/coplanar.mjs` does). Keep the hook name project-specific (`window.p2p`, not `window.ifx`
copy-pasted) since a probe hard-codes it everywhere.

### 4f. Visibility pause and the render loop — lines 822-875
`timer.connect(document)` (823) plus the comment "no rAF runs while the tab is hidden: resume without a jump" (824)
— THREE's `Timer` handles the hidden-tab case so `getDelta()` doesn't report one huge frame when the tab regains
focus; `hush(1500)` on `visibilitychange` (826) additionally tells the quality governor to ignore frames right after
a tab comes back (they say nothing about steady-state cost). A second, separate mechanism — an `IntersectionObserver`
on `.view` (854) — sets `visible` false when the canvas scrolls off-screen (e.g., behind a tall Evidence page
section), and `loop()` (855-875) skips all per-frame work, not just rendering, when `!visible || document.hidden ||
ui.scene < 0 || !built[ui.scene]`. **Verdict: copy exactly**, including keeping the two checks separate (tab hidden
vs. element off-screen are different conditions and both matter for a phone reader scrolling past the stage).

## 5. The scenes contract — `src/scenes/*.js`

**The API every scene module implements:** `export function build({quality, state, model})` returns `{ scene,
camera: {pos, target, near, far, min, max}, hotspots: {id: {pos: [x,y,z], view: {pos, target}}}, flows,
dataHotspots?, dataFlows?, heatHotspots?, heatFlows?, look?: {...}, dispose?(), update(t, dt) }`. Read in full:
`src/scenes/chip.js` (317 lines, the GPU-package level — closest analogue to P2P's sensor/pixel level: exploded
layers via a `Y = {...}` height table, line 66; instanced BGA balls and bump arrays, lines 73-77, 85-88; live token
sprites streamed from a separate pure model (`token-script.js`) so the 3D view and a 2D console never disagree,
comment 165-170 — direct precedent for P2P's live photon-rain / histogram views staying in lock-step with the
engine). A scene never edits shared state directly: it reads `quality` (governor flags), `state` (the `ui` object,
read-only), and `model` (the current `Model`), and returns fresh geometry/flows every build — `stage.js` disposes
the old build and calls `build()` again on every scenario change (`on('scenario', ...)`, stage.js:774-781).
`hotspots`/`dataHotspots`/`heatHotspots` map a part id to a 3D position and a preset camera view; `data.js`'s
`PARTS`/`PARTS_DATA`/`PARTS_HEAT` lists (per level) are what turns those ids into numbered pins (`stage.js`'s
`partsFor`/`pinNumber`, lines 75-86) — a hotspot with no matching part-list entry is drawn but never numbered
(comment stage.js:74).

**A real, fixed bug worth designing around from day one:** `scenes.test.ts` (31 lines) is a static text scanner
for one exact anti-pattern — `group.children.forEach(m => target.add(m))` — because `Object3D.add()` mutates the
source's `children` array as it reparents, so a forward `forEach` walking that same array silently skips every
other child. `campus.js` and `across.js` both did this to *every* instanced multi-material part (see commit
`0443f6e`, §20): trees with no canopy, hut with no roof. `kit.js`'s `Builder.build()`/`.instance()` (kit.js:155-171)
each return **one mesh per material**; the fix is always to add the returned group as a whole
(`scene.add(builder.instance(...))`), never to iterate its live children. **Verdict for the scenes contract: copy
nearly as-is** (the `build({quality,state,model}) -> {scene, camera, hotspots, flows, update}` shape, the
per-layer hotspot maps, the dispose hook, the "return fresh geometry every build" discipline) **and port
`scenes.test.ts` verbatim** — it is cheap, exact, and this exact bug class (`Builder` returns a multi-material
group; something later iterates and reparents it) will recur in any new Three.js codebase built the same way.

## 6. `src/fx.js` (195 lines) and `src/kit.js` (373 lines) — shared helpers

**kit.js**: `MAT` (10-23) is a flat table of `MeshStandardMaterial`s built by a `std()` helper; every entry gets
procedural triplanar surface detail for free via `withDetail()`/`DETAILS` (68-104) — grain/brushed/traces canvas
noise textures sampled in *world space* so detail keeps real physical scale across levels (`DETAIL.unit`, line 33,
set per-scene in `stage.js:694`). `Builder` (119-172) merges many small parts sharing a material into one draw call
per material (`mergeGeometries`, `prep()` strips all attributes but position/normal, 112-118) — this is the
performance backbone that lets a scene draw thousands of small parts (bolts, cables, BGA balls) as a handful of
draw calls. `Flow`/`flow()` (176-225) is the animated-pulse-along-a-path primitive every power/data/heat line uses,
with a `setLevel(gain, bright)` the clock system (not covered here) drives to speed up/slow/stop a flow without a
position jump (198-199 comment). `insulator()`/`latticeTower()`/`catenary()`/`person()`/`spinners()` (228-372) are
IF-specific recurring parts (transmission hardware, a person for scale) with no P2P equivalent, but the *pattern* —
small parametric builders for parts that repeat across many scenes — is exactly what P2P needs for lens elements
(a `lensElement(b, r1, r2, thickness, glass, mat, ...)` builder from `lens-types.ts`'s `Surface` records), aperture
blades, a microlens array, and a Bayer-filter grid.

**fx.js**: `rbox`/`tube`/`bundle` (16-44) — rounded-box and cable geometry for a `Builder`. `blinkers()` (48-65) —
instanced status LEDs blinking at their own phase-offset rates. `lamps()` (76-87) — bright face + additive halo
sprite, useful for P2P's light sources / flare sources. `plumes()` (91-137) — GPU-cheap particle system (custom
`ShaderMaterial`, point-size scaled to viewport so particle size stays in world units regardless of resolution,
comment 112) for vapor/exhaust; the **direct precedent for BRIEF.md's "photon rain"** signature visualization
(scaled-and-badged particle density, per-particle age/alpha driven from a typed array, no per-frame allocation).
`floorMirror()` (169-194) — a `Reflector`-based soft floor reflection, desktop-only because it renders the scene
twice (comment 8, and the quality governor's first-shed tier, §4b) — **note for the WebGPU migration**: `Reflector`
is a WebGLRenderer-era addon; Three.js's WebGPU examples use a different reflection approach (a render-target pass
through `RenderTarget` + a custom TSL node, or `THREE.Reflector` may not have a WebGPU port at all as of R183) —
check before assuming this ships unchanged.

**Verdict: copy `kit.js`'s `Builder`, `Flow`/`flow()`, `MAT`/`withDetail()` pattern and the canvas-texture/detail
system essentially as-is** (all pure Three.js geometry/material code, renderer-agnostic at the `BufferGeometry`
level). **Copy `fx.js`'s `blinkers`, `lamps`, `plumes`, `movers`, `wires`/`catenary` as-is; treat `floorMirror` as
adapt-or-skip** pending a WebGPU-native reflection technique. Add P2P-specific builders alongside (lens elements,
aperture iris blades, wavefronts) rather than growing `kit.js`'s existing exports.

## 7. Evidence labels — `src/evidence.js` (278 lines)

**This is the file BRIEF.md names directly, and its five basis labels are already exactly the five the brief
specifies** (BRIEF.md: "spec, vendor, reported, derived or assumed" ↔ `evidence.js:24-33`'s `spec/vendor/reported/
derived/assumed`, each with a `label/short/meaning`). `CITED = new Set(['spec','vendor','reported'])` (34) marks
which bases require at least one source reference. `STRICT = true` (37) — once flipped on, a legacy label
(`typical`/`est`, kept only as a migration aid, 30-32) or a claim with no evidence object at all is a hard failure,
not a warning (`problems()`, 257-277, branches on `strict`). `evOf(row)` (40-43) reads evidence off either a
`[label, value, basis, ..., ev]` array row (the trailing object if it has `refs`/`calc`/`assume`) or an `{ev}`
field on an object row — one accessor for both shapes used across the codebase. `CALCS` (48-142) is a **register**:
id → `{title, how, inputs}` in plain words + a checkable formula (e.g. `'line-current'`: "Per-phase current =
campus MW ÷ (√3 × 345 kV × power factor)", line 50) — a `derived` claim's `ev.calc` names one of these, and the
method page (§14) renders the whole register. `ASSUMPTIONS` (146-249) is the parallel register for `assumed`
claims: id → `{title, value, why}`, and — notably — several entries document a **correction to an earlier, wrong
citation**, left in place as a paper trail (e.g. lines 184-190's dated note: "this row previously cited
'arxiv-gpu-power-visibility' for [...] Opened that paper directly today: it [...] never states an HBM-share-of-TDP
percentage for any GPU [...] this is carried as the model's own picked share, not a cited spec"). **Copy that
practice**: when an adversarial pass downgrades a claim's basis, leave the reasoning in the `why` field rather than
silently swapping the number. `problems(claim, SOURCES, strict)` (257-277) is the actual checker logic: unknown
basis; a legacy label under strict; no evidence at all under strict; a cited basis with no `refs`; a `vendor` claim
missing its `vs` baseline; a `derived` claim naming an unknown `calc`; an `assumed` claim naming an unknown
`assume`; each `ref` checked for a source that exists, a non-empty location string, an access date, and a
primary/secondary `kind`; a `spec` basis additionally requires at least one *primary* source among its refs.

**Verdict: copy essentially verbatim**, including keeping `STRICT` as a named, flippable constant (IF's own commit
history shows it was `false` during a long tracing pass and flipped to `true` only once every claim was covered —
commit `051fb45` "Evidence: every claim traced, so STRICT is on" — P2P should plan the same soft-launch-then-strict
sequence per BRIEF.md's "claims checker... reports zero problems before anything ships"). Populate `CALCS` with
P2P's own formulas (thin-lens, DOF/hyperfocal, Airy radius, EV, cos⁴ falloff, shot-noise SNR, dual-conversion-gain
ISO) and `ASSUMPTIONS` with its own picked constants (CoC assumption, an assumed core-glass Abbe number when a
patent doesn't state one, etc.) using the exact same two-field discipline (a checkable `how`/`value` plus a
`why`/`inputs`).

## 8. Claim keys — `src/claims.js` (36 lines)

`allClaims(M, C)` (15-34) is a single flat walker that visits **every** figure the page shows and returns one
record per claim: `{key, group, ..., label, value, basis, ev}`. The `key` scheme is the whole design: `card:
<layer>:<sceneId>:<partId>:<row>` for a 3D card's spec row, `ledger:<i>`, `bom:<group>-<row>`, `links:<id>`,
`clock:<simId>:<i>`, `site:<id>:<i>`, `tour:<tourId>:<beat>:<row>`, `temps:<i>` — every one of these strings is
documented in the file's own header comment (lines 3-6) and is what a basis chip's `data-src` attribute carries
(`evidence.js:253-254`'s `chip()`), what `tools/claims.mjs` iterates, and what the Evidence page groups by. The
same source-of-truth discipline matters as much as the code: "The popovers, the Evidence page and the tests all
walk the same list, so they cannot disagree about what is claimed" (line 1-2 comment). `claimByKey(M, C, key)` (36)
is the reverse lookup a popover uses to render one claim's evidence on click.

**Verdict: copy the pattern exactly, replace the key namespaces.** P2P's groups become, e.g., `card:<layer>:
<levelId>:<partId>:<row>` (a part's spec row — e.g. a lens element's index of refraction), `lens:<lensId>:<row>`
(a `LensDesign` field, sourced to a patent per `lens-types.ts`'s `source` field), `format:<id>:<row>` (sensor
format facts), `calc:<id>` cross-refs if needed, `tour:<tourId>:<beat>:<row>`. Keep `allClaims` as one function that
walks every content surface — resist the temptation to check claims ad hoc in each view; the whole strict-mode
guarantee depends on this being exhaustive.

## 9. `tools/claims.mjs` — the claims gate (32 lines)

Walks a fixed cross-product of scenarios — here every `accel × power × cooling × {10,100,1000,5000} MW` plus every
real-campus preset (lines 13-16) — computing `M`/`C` for each, running `allClaims` + `problems(..., strict=true)`,
and deduplicating problems by a normalized key (digits blanked out, `:\d+$` trailing index blanked, line 24) so one
systemic defect reports once, not once per scenario instance, while still printing one concrete example scenario
per line (line 25). Exits 1 if any problem was found (line 31) — this is what BRIEF.md's "reports zero problems
before anything ships" gate should look like operationally. Takes optional key-prefix filters on argv so a
workstream can run just its own slice (`node tools/claims.mjs card:power:hall ledger bom`, header comment line 3).
**Verdict: copy nearly as-is.** Replace the scenario cross-product with P2P's own (every lens × format × f-stop ×
ISO combination BRIEF.md's ACCURACY DISCIPLINE section calls for), and the SOURCES/SITES imports with P2P's
equivalents. Keep the dedup-by-normalized-key trick — it's what keeps this gate's output readable at scale.

## 10. `src/sources.js` (571 lines, only lines 1-171 read in full — the rest is more of the same shape)

A flat `SOURCES` object, id → `{title, publisher, url, published?, dated?, accessed, kind: 'primary'|'secondary',
marketing?, via?, unchecked?}`. `kind` distinguishes the maker/standards-body/agency itself (`primary`) from
someone reporting on it (`secondary`) — required by `evidence.js`'s `problems()` for a `spec` basis (§7). `marketing:
true` flags a vendor's own page so a reader can weigh it accordingly; `via:` documents when a source was read
through an indirect copy (a Wayback Machine snapshot, a syndicated republish) — worth doing given how often a
primary source blocks bots (`unchecked: "blocked: ..."` entries, e.g. lines 36, 86, 95, 102, 109, 152, each stating
*which specific tool* failed and how, rather than silently omitting the citation). The file's own header (lines
1-4) states the ground rule: "Every URL here appears verbatim in research/*.md or in the footer of index.html —
never invented." **Verdict: copy the shape exactly**; this is what BRIEF.md's "research and sources" workstream
needs as its deliverable format — one `SOURCES` map with `kind`, `accessed` (M/D/Y, per CLAUDE.md's dates rule),
and honest `unchecked:` entries when a source could not be verified rather than silently dropped. Note P2P's own
accessed-date convention should be `09/28/2026` per the task's instructions, matching this file's `accessed:
'09/27/2026'`/`'09/28/2026'` pattern throughout.

## 11. The tour player — `src/app/story.js` (551 lines) + `src/app/journeys.js` (partially read, 200+ lines)

**journeys.js** is where narrated tours live as data: exported functions (`story(M)`, `watt(M)`, `request(M)`, each
returning an array of "beats") that read the *current* model and produce fully-worded prose with inline numbers —
"retells itself when a setting changes" (journeys.js:4 comment). A beat is `{link: {scene, mode, part}, k, title,
text, tally?, sim?, specs?, specKey?, figure?}`; `specs` reuses a card's own spec row wherever the card already
backs the figure (`cardRow()`, 28-31) "so entering a tour never strips a number of its qualification" (comment 9-10)
— **critical discipline to copy**: a tour never invents an unbacked number; it either points at a card's existing
evidence-bearing row or states a fresh one with its own `ev`. `TOUR_NOTES` (38-41) is a once-per-tour caveat shown
above the beat list for numbers that need a caveat no single beat carries (e.g., "An illustrative timeline... not a
benchmark of the selected hardware"). `keyed(id, beats)` (35) stamps every beat with `specKey: tour:<id>:<i>` for
claims.js to pick up (§8). `story()` (44-130) is the "grid to token" overview: one pass down every level, in every
relevant layer, each beat computing its own numbers from `M`/`C` (`ledger`/`card` helpers, 46-48) rather than
hard-coded strings. `watt()` (132-169) follows one literal watt with a running `tally` that shrinks at each stage
(`take(f)`, line 137) — direct precedent for BRIEF.md's "follow one photon" tour: track a running quantity (photon
count, or optical power in lumens) that visibly shrinks/converts stage by stage, exactly mirroring the ledger.
`request()` (174+) follows one user request through time with a running elapsed-time tally, explicitly calling out
where its numbers are illustrative-and-labeled-as-such vs. computed (comment 172-173, `ASSUMPTIONS
'request-timeline'`).

**story.js** is the player: a `TOURS` registry (37-47) mapping tour id → `{label, short, beats, group}`, with
`beats` either a fixed function of `M` or, for "This level"/"Every part" tours, a function reading live `here`
state. `CHAIN`/`OUTWARD` (imported from journeys.js, not shown here) define which tours hand off into which when
one finishes, and — a real, documented bug (finding 16, comment 118-121) — that a *heat* "This level" walk runs
**outward** (package toward the cooling plant) while power/data run inward, so "next" must follow the layer's real
flow direction, not always numerically-higher-level. `dwell(b)` (138-143) computes reading time from word count at
~260 wpm, clamped to [6s, 30s], with a floor of 16s for any beat that opens a running "clock" simulation (`b.sim`)
so the sim has time to reach something worth showing before the tour moves on — and a documented follow-on
refinement (`simKeyReached()`, 465-469, and the `SIM_HOLD_MAX_MS` backstop, 459): a beat with `sim` set doesn't
just wait out its dwell time, it waits for that sim's clock to reach a *named key event* (`KEY_EVENT` table,
451-456) before advancing, up to a hard ceiling so a stalled clock can never hang the tour forever. The whole
`onTick` handler (470-495) is worth reading closely: pauses under six independent conditions (reader dragging the
view within `HOLD_MS`, a chip's source popover open, camera not yet arrived, dwell not elapsed, sim key not
reached) before it will step to the next beat or hand off to the next tour. Play/pause is the *only* thing that
stops autoplay — looking around resumes automatically after `HOLD_MS` (4s, line 62). `enter()`/`exit()` (361-391)
capture `entry = readerAt()` (line 363) **before** anything else moves the camera, specifically so a "This level"
tour started after another tour finished remembers where the reader actually was, not wherever the other tour's
last beat left the camera (finding 9, the extended comment at lines 28-33, and its own regression coverage in
`tools/tours.mjs`'s `thisLevelCase()`, §13). **Verdict: adapt heavily but keep the mechanism.** P2P's tours become
BRIEF.md's named set pieces (overview, "follow one photon" ↔ `watt()`'s pattern, per-level playthroughs ↔ "This
level"/"Every part"); the `dwell`/pause/chain/sim-gating machinery, the `specKey` claim-tagging, and the
"tour beats reuse a card's own evidence row" rule should all carry over essentially unchanged. Do **not** skip the
sim-key-gating idea if P2P has any beat that opens a running simulation (a photon-rain accumulation, a well filling)
— the same "reading time alone isn't enough, wait for the thing being shown to actually happen" problem will recur.

## 12. Share links — `src/app/share.js` (46), `src/app/scenario-links.js` (19), `src/app/links.js` (51)

**share.js**: the address bar always carries `?view=<scene>.<mode>.<selected>` (debounced write, `write()`,
9-18), and a link with a `view` param on load waits for the first scene to exist (`setInterval` poll, line 27) then
calls `show()` to jump straight there. The Share button additionally guards `window.IFX_ARTIFACT` (line 33) —
because a claude.ai-hosted artifact build carries no query string, a "copy link" button there would produce a URL
that silently loses the view. **scenario-links.js** (`withScenario(search, href)`, 9-18) is a tiny, dependency-free
function — deliberately kept free of `document`/`location` so it's unit-testable without a DOM (comment 2-3) —
that copies whichever of `['mw','accel','power','cooling','site']` keys are present onto another page's link, so
navigating from the visualizer to the Evidence/Method/Glossary pages keeps the reader's campus. **links.js**: any
element with `data-go="scene:mode:part"` jumps the stage there (`goAttr()` builds the attribute + ARIA label, line
11); the reverse direction — a part selected in 3D highlighting its own ledger/BOM rows elsewhere on the page — is
`on('select', ...)` (34-50), building a small "In the ledger: ..." button list that scrolls-and-flashes the target
row. **Verdict: copy all three essentially as-is.** These are pure UI-glue patterns with no domain content. P2P's
`SCENARIO_KEYS` becomes its own scenario fields (lens id, format, f-stop, shutter, ISO, focus distance, focal
length); the `IFX_ARTIFACT` guard pattern matters again if a P2P "look prototype" (BRIEF.md deliverable #3) ships as
a claude.ai artifact before the real site exists.

## 13. Evidence, Method, Glossary pages — `src/pages/{evidence,method,glossary}.js`

**evidence.js** (87 lines): computes one **fixed reference scenario** (`compute(DEFAULT_SCENARIO)`, line 13) and
says so explicitly to the reader (line 20's message: "Figures below are fixed to one reference scenario... Change
the campus on the main page and its own numbers follow; the claims and sources on this page always describe this
one scenario") — a real, considered decision (this page cannot read the visualizer's own URL-carried scenario, so
rather than silently disagree with whatever the reader last set, it says which scenario it's showing). Renders
stats per basis (22-24), a filterable/searchable claim list grouped by level then by part (56-67) plus flat groups
for ledger/bom/links/clock/temps/site/tour (68-71), and a bibliography grouped by publisher with a per-source
citation count (80-86). **method.js** (37 lines): written prose sections (`method-data.js`, not read) plus two
*generated* sections appended at the end — "Calculations" and "Assumptions" — built directly from `CALCS`/
`ASSUMPTIONS` (evidence.js §7), each entry anchored `#calc-<id>`/`#assume-<id>` so a claim's popover can deep-link
straight to its own formula or rationale (method.js:14-15). A scroll-spy highlights the current section in a
sticky contents list (27-33). **glossary.js** (39 lines): A-Z terms with in-3D deep links (`?view=scene.mode.part`)
and per-term source citations, `letter()` sorting numbers/symbols under `#` (line 10-11) so e.g. "34.5 kV" files
correctly. **Verdict: copy the three-page structure and the fixed-reference-scenario pattern exactly**; these are
what BRIEF.md's "a glossary, a method page and a sources page" deliverable literally names. `CALCS`/`ASSUMPTIONS`
auto-rendering into the method page (rather than hand duplicating prose) is the single highest-leverage pattern
here — it makes it structurally impossible for the method page to drift from what the engine's `evidence.js`
registers actually say.

## 14. Every `tools/*.mjs` gate

All are standalone Playwright (`chromium.launch`) scripts driving the dev server through `window.ifx` (or, for the
static-build variant, `tools/artifact.mjs`, §15). None import a test framework; each prints readable lines and sets
`process.exitCode` on failure — CI-friendly without CI-specific tooling. Two GPU modes recur throughout:
**SwiftShader** (`--use-angle=swiftshader --enable-unsafe-swiftshader`) for correctness probes that need *some*
WebGL implementation but not real GPU performance, and **real ANGLE/D3D11** (`--use-angle=d3d11
--ignore-gpu-blocklist`) for anything measuring frame cost or visual quality, which explicitly aborts if it detects
it landed on SwiftShader anyway (`perf.mjs:17`: `if (/swiftshader|software/i.test(gpu)) { ...; process.exit(1); }`).
Everything targets the dev server on `127.0.0.1:47400` by default, overridable via `URL` env — `tools/views.mjs`
and `tools/tours.mjs` additionally take a `SHOTS=1` env to dump screenshots for human review alongside the pass/fail
output.

- **`views.mjs`** (99 lines, SwiftShader by default via its own args but usable on real GPU) — the camera-framing
  regression gate for §4c: for every tour stop (or, with an `all` arg, every hotspot in every layer) across six
  named scenarios, checks the raycast-to-part and pin-on-screen-clear-of-chrome conditions `frame()` itself
  computes, from *outside* the app (re-deriving the same check in the probe, not just calling `frame()` and
  trusting it). **Verdict: copy structure, port to P2P's hotspot/pin system.**
- **`perf.mjs`** (58 lines, real GPU, vsync/frame-cap disabled) — median/p95 frame time, draw calls, triangles,
  texture/geometry counts per scenario × level × layer, printed as a table plus a "slowest 5" summary.
  **Verdict: copy as-is**, retarget scenarios/levels.
- **`coplanar.mjs`** (97 lines, SwiftShader) — a from-scratch z-fighting detector: walks every visible mesh's
  triangles in world space, clusters same-axis same-facing faces within a depth-precision-derived tolerance
  (`tol = 2.5e-5 * viewDistance`, line 17 — 24-bit depth buffer precision at the default view distance), then
  rasterizes overlapping regions onto a jittered grid per source mesh and flags cells two different meshes both
  cover, above an area threshold. Caught real bugs (commit `0443f6e`'s fan-cap-vs-housing z-fight, found only
  *after* fixing the reparenting bug exposed it). **Verdict: copy essentially as-is** — this is renderer-agnostic
  (pure geometry math against `matrixWorld`) and equally relevant to a WebGPU build; the "cluster by tolerance
  derived from view distance and depth-buffer bit depth" trick applies whether the depth buffer is 24-bit WebGL or
  whatever P2P's WebGPU target's swap-chain depth format is (check the actual bit depth — don't assume 24-bit).
- **`parts.mjs`** (48 lines, real GPU) — walks every accelerator/power/cooling/size combination (plus two real-site
  stages) confirming every part a level's content lists has a matching hotspot (so tour pin numbers never silently
  shift), and separately reports (but allows) hotspots with no matching part-list entry. **Verdict: copy as-is**,
  retarget the scenario cross-product to P2P's lens × format × setting space.
- **`tours.mjs`** (276 lines, SwiftShader) — the most elaborate probe: regression-tests seven specific, numbered
  tour-audit findings (§11) by literally driving the UI the way a reader would (click `#story-btn`, open the
  "Every part" disclosure, click a specific tab, `waitForFunction` on the resulting state) rather than calling
  `window.ifx` internals directly wherever the *UI path* itself is what's being verified (e.g. the "This level"
  entry-context bug can only be caught by going through the real click sequence, comment 39-41). Documents its own
  limits honestly (the sim-key-gating check, lines 103-141, explains exactly why it can't wait out a real
  clock-reaches-its-key-event pass under software rendering, and settles for a narrower but still-meaningful
  regression check). **Verdict: copy the discipline (numbered findings, each with its own scoped test, comments
  that explain what a check does and doesn't prove) even where P2P's specific findings will differ.**
- **`ui.mjs`** (99 lines, SwiftShader) — for `{explore, clock, tour, tourclock}` states at `{desktop, phone, tablet,
  landscape}` sizes: no two visible chrome elements share pixels (`overlaps`, computed from real
  `getBoundingClientRect()`s, with a beat card specifically measured by its *inked* content, not its padded box,
  lines 44-46), exactly one play control and one speed control on screen at a time, and — mobile only — the stage
  fills the screen with near-zero slack below the last line of text (`beatSlack`, budget 24px, line 90).
  **Verdict: copy as-is**, retarget selectors to P2P's own chrome.
- **`artifact.mjs`** — see §15.
- **`claims.mjs`** — see §9.
- **`cycle.mjs`** (46 lines, SwiftShader) — the broadest smoke test: cycles every scenario × level × layer, clicks
  every part button once, runs every named clock for 1.5s in every layer, and just watches for page errors and a
  parts-count/pins-count mismatch. Cheap and useful as a first gate before the more targeted ones. **Copy as-is.**
- **`flicker.mjs`** (46 lines, SwiftShader) — freezes animation, nudges the camera ±0.0015 rad, diffs two
  screenshots pixel-by-pixel (threshold: RGB delta sum > 90) and reports the flipped-pixel fraction — a
  visual-diff proxy for z-fighting/flicker that complements `coplanar.mjs`'s static geometric analysis with an
  actual-rendered-pixels check. Also writes a highlighted diff PNG. **Copy as-is.**
- **`govern.mjs`** (113 lines) — exercises the quality governor's `watch/soft/climb/res/throttle/load` modes
  (§4b); `res` mode injects a fill-bound synthetic shader cost (`HEAVY(n)`, 67-75: `n` iterations of `sin` per
  pixel, calibrated against a specific real GPU, comment 65-66) to prove GPU time actually falls when resolution
  drops a tier. **Verdict: adapt** — the governor logic it tests changes for WebGPU (§4b), so this needs a parallel
  rewrite, but the six-mode structure (steady-state, software-GPU floor, climb-back, resolution-actually-helps,
  battery-saver-is-not-GPU-bound, load-then-relief) is exactly the coverage P2P's own governor needs.
- **`gpushot.mjs`** (20 lines) / **`shot.mjs`** (28 lines) / **`hero.mjs`** (49 lines) / **`look.mjs`** (27 lines) —
  four flavors of "screenshot the page in a given state," differing in GPU mode, what chrome is stripped, and
  whether the output feeds a hero-image WebP pipeline (`hero.mjs` additionally hides all HUD via an injected
  style tag, forces the viewer full-screen, and encodes the PNG to WebP in-page via `canvas.toBlob`). **Verdict:
  copy the pattern, consolidate if reasonable** — four near-identical scripts is arguably more than P2P needs;
  worth merging shot/gpushot/look into one parameterized script for a fresh codebase rather than reproducing the
  duplication.
- **`links.mjs`** (27 lines, SwiftShader) — clicks every `[data-go]` element found on the page and confirms it
  lands on the right scene/mode/selected-with-a-lit-pin. **Copy as-is.**
- **`costs.mjs`** (42 lines, real GPU, vsync off) — turns off exactly one costly effect at a time, cumulatively
  (mirror → AO → shadows-frozen → bloom → 4×MSAA), timing 240 frames after each, printing the ms saved by each
  step — this is literally how the quality governor's own tier-shedding order (§4b) was chosen (commit `1a35961`'s
  message cites this tool's own numbers: "the floor mirror is about half the frame and ambient occlusion about a
  fifth"). **Copy as-is**; re-run against P2P's own effect stack (WebGPU compute passes, spectral ray count, photon
  particle count) to derive its tier order the same evidence-based way, rather than guessing.

## 15. `tools/artifact.mjs` (31 lines)

Turns the Vite production build into a claude.ai-artifact-compatible single page: extracts `<title>`, the
description meta, Google Fonts `<link>`s, and the built CSS/JS asset paths out of `dist/index.html`, inlines the
CSS (artifacts only permit Google Fonts external stylesheets, not arbitrary ones — comment line 2-3), sets
`window.IFX_ARTIFACT = true` (line 24, read by `share.js:33`, §12) so the Share button hides itself since an
artifact URL carries no query string, and writes `dist-artifact/index.html` + a copied JS asset. **Verdict: copy
essentially as-is** once P2P has a real Vite build to point it at — directly useful for BRIEF.md deliverable #3's
"look prototype" if that's shared as a claude.ai artifact link before the real site is public.

## 16. CSS tokens and type system — `src/tokens.css` (41 lines) vs. `src/styles.css` (762 lines)

**Naming trap worth flagging up front**: despite the name, `src/tokens.css` is *not* the design-token file — it is
the stylesheet for the live-generation token console (`src/app/tokens-ui.js`, the LLM-token-stream UI mounted into
a card or tour beat). **The actual CSS custom-property design tokens live inline in `src/styles.css:4-24`**, a
`:root` block setting `--ground/--surface/--raise/--line/--line-2/--ink/--muted/--faint/--accent` (dark-first
palette), a `--gutter: clamp(16px, 4.4vw, 72px)` fluid margin, a flat set of per-voltage/per-flow colors
(`--hv/--mv/--lv/--dc/--nvl/--eth/--hbm/--hot/...`, lines 16-18 — the CSS-side mirror of `data.js`'s `VOLT` table,
§2), per-basis colors (`--spec/--typical/--est/--vendor/--reported/--derived/--assumed`, lines 19-20, mirroring
`evidence.js`'s `BASIS` keys), and three named font stacks (`--display: "Barlow Condensed"...`, `--sans:
"Manrope"...`, `--mono: "IBM Plex Mono"...`, lines 21-23). **The whole site is dark-only** — `color-scheme: dark`
(line 5) with no `@media (prefers-color-scheme: light)` override and no `[data-theme]` hook anywhere in this block;
if P2P ever publishes a piece of this as a claude.ai Artifact, note that `artifact-design`'s dual-theme contract
(light-mode override under `:root:not([data-theme="light"])`, etc.) is **not** what this site does and would need
adding separately for that context — this repo is a standalone site, not an Artifact. Typography is fluid-scaled
via `clamp()` throughout (`h1`: `clamp(52px, 9vw, 136px)`, line 36) rather than fixed breakpoint jumps.

**Verdict: adapt.** Rename the token file so the naming trap doesn't repeat (`src/tokens.css` → keep for its actual
purpose, i.e. photon/pixel console styling if P2P has an equivalent live readout; put the real `:root` custom
properties in their own clearly-named file, e.g. `src/design-tokens.css`). Reuse the `--display/--sans/--mono`
three-font-stack pattern and the fluid `--gutter`/`clamp()` typography approach directly. Build a new palette per
BRIEF.md's "dark-first... glass, anodized metal, silicon" direction, keeping the same *structure*: one flat color
per named flow/layer type (rays-by-wavelength-bin instead of `--hv/--mv/--lv`; a lens-material-adjacent set instead
of `--nvl/--eth/--hbm`) plus the same five basis colors reused unchanged (`--spec/--vendor/--reported/--derived/
--assumed` — BRIEF.md's own evidence labels match these exactly, so the color mapping can copy over token-for-token).

## 17. WebGLRenderer + EffectComposer → Three.js WebGPURenderer: what has to change

BRIEF.md commits P2P to WebGPU-first with a WebGL2 fallback (Three.js `WebGPURenderer`/TSL). Concretely, against
every WebGL-specific piece IF relies on:

- **`EffectComposer`/`RenderPass`/`UnrealBloomPass`/`GTAOPass`/`ShaderPass`/`BokehPass`/`OutputPass`**
  (`stage.js:5-11`) are all `three/addons/postprocessing/*` — WebGLRenderer-era. WebGPURenderer's post-processing
  path is `three/addons/postprocessing/Pass.js` webgpu-flavored nodes / `THREE.PostProcessing` + TSL node passes
  (bloom, AO, DOF each need their TSL-node equivalents, which exist in recent Three.js but have a different API
  surface — not a drop-in swap). **BRIEF.md's own pitfall list already flags the OutputPass tone-mapping gotcha**
  (line 126: "EffectComposer's OutputPass tone-maps everything, so toneMapped:false does nothing and bright colors
  bleach") — this is a *documented, known-bad* interaction in the WebGL pipeline IF ships (`stage.js:232`'s
  `c.addPass(new OutputPass())`); confirm whatever TSL-node tone-mapping stage P2P uses has an equivalent
  per-material opt-out before relying on `toneMapped: false` anywhere.
- **The custom "finish" `ShaderPass`** (grain/vignette/contrast, `stage.js:198-213`) is raw GLSL
  (`vertexShader`/`fragmentShader` strings) — needs a TSL rewrite (`Fn`, node functions) for the WebGPU path,
  and, if the WebGL2 fallback keeps the GLSL version, **two implementations to keep visually matched**.
- **`Reflector` (`fx.js`'s `floorMirror`)** — see §6; verify WebGPU support before assuming this ships unchanged;
  if the WebGL2-fallback path keeps it, that's one more effect gated behind renderer choice, not just quality tier.
- **`GTAOPass`, `BokehPass`** likewise need WebGPU/TSL equivalents or a fallback-only gating.
- **The quality governor's GPU timing** (`EXT_disjoint_timer_query_webgl2`, §4b) has no meaning under
  WebGPURenderer; use `GPUQuerySet` timestamp queries (feature `timestamp-query`, not guaranteed available) with a
  graceful "no timers" degradation exactly like the existing `timerExt` null-checks already do for WebGL
  (`stage.js:141` and throughout) — the *pattern* of "count frame time as ground truth, treat GPU/CPU timers as an
  optional refinement that lets a tier climb back" transfers even where the specific API doesn't.
- **Compute shaders for the photon simulation and spectral ray tracing** (BRIEF.md's own requirement) are new
  territory IF has no analogue for at all — IF's animated flows (`kit.js`'s `Flow` class) are simple CPU-updated
  `InstancedMesh` position arrays (`kit.js:199-211`), fine for hundreds of pulses but not for BRIEF.md's photon
  counts. P2P needs its own WebGPU compute-shader pipeline design (storage buffers, compute passes feeding a
  render pass) with no direct precedent in this codebase to copy from — budget real design time here, and keep
  the classical closed-form physics (§1) as the independent check that compute-shader output is validated against
  (BRIEF.md's "visual accuracy gate").
- **`RoomEnvironment`, `PMREMGenerator`** (`stage.js:150,174`) — PMREM/IBL environment maps are supported under
  WebGPURenderer too, but confirm the specific addon paths/APIs used here (`three/addons/environments/
  RoomEnvironment.js`) have current WebGPU-compatible versions in whatever Three.js version P2P pins.
- **`OrbitControls`** (`stage.js:4`) is renderer-agnostic (operates on the camera, not the renderer) — copy as-is.
- Playwright's `--use-angle=d3d11`/`--use-angle=swiftshader` launch args (used throughout `tools/*.mjs`) assume
  WebGL's ANGLE backend selection; a WebGPU-targeting probe needs Chromium launched with WebGPU enabled
  (`--enable-unsafe-webgpu` on older Chromium, or it may be stable-on-by-default depending on the Playwright/
  Chromium version P2P pins) and a real-vs-software GPU distinction that isn't the same `swiftshader` string check
  `perf.mjs:17` uses today — this needs its own verification early, since every perf/quality gate depends on
  correctly detecting "am I on the real GPU."

## 18. Gotchas collected from comments and commit messages (would bite a new Three.js site too)

1. **Reparenting a `Builder`'s output by iterating `.children.forEach(m => target.add(m))` silently drops ~half a
   multi-material group's meshes**, because `Object3D.add()` mutates the source array `forEach` is walking.
   Always `scene.add(builder.instance(...))` as a whole. (`kit.js:155-171`; commit `0443f6e`; guarded permanently
   by `src/scenes/scenes.test.ts`, a static text scanner — port that scanner verbatim.)
2. **`EffectComposer`'s `OutputPass` tone-maps everything downstream of it, so `toneMapped: false` on a material
   does nothing there and bright/emissive colors bleach.** Already called out in BRIEF.md itself (line 126) as a
   "pitfall from earlier work" — i.e. this exact codebase. Verify the WebGPU/TSL tone-mapping stage's per-material
   opt-out before relying on it. (`stage.js:232`.)
3. **A zero-height box still draws its top face** (BRIEF.md line 127, again sourced from this codebase's own
   experience) — watch for it in lens-element stacks and sensor-well geometry where a "flat" surface is modeled as
   a degenerate box rather than a plane.
4. **Seen from directly above, the eye reads area and misses height** — encode quantities as brightness too, not
   position alone (BRIEF.md line 128). Relevant to P2P's pixel-well-fill and photon-density visualizations.
5. **Coplanar, same-facing, opaque faces z-fight regardless of near/far plane tuning** — this needs its own
   geometric detector (`tools/coplanar.mjs`), not just "set a good near plane." One real instance: a cooling
   fan's cap sat 0.015 world units above its housing ring — invisible until the reparenting bug (#1) was fixed and
   both faces started actually drawing (commit `0443f6e`). Tolerance should derive from view distance and the
   actual depth-buffer bit depth of the target (`coplanar.mjs:17`), not a fixed epsilon — this is exactly the class
   of bug flagged in the user's own standing memory as "absolute-epsilon-on-scale-free-data."
6. **A fixed near-clipping plane far closer than what's in view wastes depth precision and causes hidden-surface
   flicker.** Keep `near` at roughly 1% of the camera-to-target distance and only update it when it drifts more
   than 5% (`stage.js`'s `fitDepthRange()`, lines 817-820) — recompute per-level, since scale changes by orders of
   magnitude between levels here and will for P2P too (a whole lens vs. one pixel well).
7. **Projecting a part's screen position with a stale camera aspect** (because a `ResizeObserver` fires *after*
   layout, not synchronously with a DOM change that resizes the canvas) can put a pin off-screen right after a
   sibling UI element (a clock strip, here) opens or closes and changes the view's height. Read the *current*
   `clientWidth`/`clientHeight` directly inside the projection function rather than trusting a cached camera aspect
   (`stage.js`'s `onScreen()`, lines 384-393; regression: commit `a850ed1`).
8. **A dependent-clock/reading-timer needs to wait for the thing it's showing to actually happen, not just for a
   fixed dwell time to elapse** — a fast tour pace can otherwise leave a beat before its own simulation reaches the
   moment being described. Gate on a named key event with a generous absolute backstop, never dwell time alone
   (`story.js`'s `simKeyReached()`/`SIM_HOLD_MAX_MS`, lines 443-469; finding 17).
9. **The camera-arrival "reading" clock and the tour's chain-to-next-tour logic both need one single, captured
   "where was the reader when they opened this" value, read once before anything else can move the camera** — not
   a live read of current UI state, which by the time a slow level-build or a parallel event finishes may already
   describe somewhere else. (`story.js`'s `entry`/`here` distinction and its extended comment, lines 28-34, 361-369;
   finding 9.)
10. **A heat-flow (or any outward-radiating) "walk one level at a time" tour runs in the opposite direction from a
   power/data tour** — encode direction per-layer (`OUTWARD` set), don't assume "next" always means "one level
   deeper." (`story.js` finding 16, lines 118-121.)
11. **Frame-time judged by median reads falsely healthy when a GPU falls behind and delivers frames in bursts** —
    use the mean of the fastest 95% instead (`stage.js`'s `felt()`, lines 300-304).
12. **`EffectComposer` (and by extension any post-process render-target chain) keeps the pixel ratio it was built
    at** — a resolution-based quality tier that only shrinks the final canvas while every pass still draws at full
    size saves nothing. Explicitly re-`setPixelRatio()` on the composer/render-target chain when a tier changes,
    and verify GPU time actually falls (`stage.js`'s `sizeComposer()`, lines 252-255; commit `1a35961`'s own
    before/after measurement, and `tools/govern.mjs`'s `res` mode that regression-tests it).
13. **`EffectComposer.dispose()` frees only its own two render targets — bloom/AO/DOF passes each hold render
    targets of their own that leak on every scenario rebuild unless disposed explicitly**, along with
    shadow-casting lights' own shadow-map render targets. ~100 leaked textures per scenario change before the fix.
    (`stage.js`'s `disposeComposer()`/`disposeScene()`, lines 239-249; commit `4513bc1`.)
14. **A material reused across very different lighting/zoom contexts can blow out to featureless white under a
    closer/brighter environment even though it looked fine at the original review distance** — check every
    hotspot's actual close-up framing, not just a wide establishing shot, and give a part its own locally-scoped
    material variant rather than reusing a shared one when the metalness/roughness needs differ by context.
    (Commits `86aff7b`, `fc88dbe`, `5edd51f` — the same class of bug found three separate times across three
    different scenes during the fidelity pass.)
15. **Instanced/procedural background elements (clouds, particles) placed on a geometric ring or random scatter
    can sit entirely outside every actual camera preset's frustum** — solve their placement by re-projecting
    candidates through each real camera view and keeping only the ones that land in-frame and under a view-angle
    budget, rather than trusting "it's somewhere in the scene" to mean "it's visible from where the tour actually
    looks." (Commit `207a851`.)
16. **A source blocked from live re-verification (bot-challenge, WAF, timeout) should be recorded as `unchecked:
    "blocked: <what was tried and how it failed>"`, not silently dropped or left un-flagged** — several of IF's
    own primary sources are in exactly this state today (`sources.js` lines 36, 86, 95, 102, 109, 152). Expect the
    same for lens-patent and glass-catalog sources; plan for it in the sources schema from day one (§10).
17. **Vite's dev-server file watcher needs to ignore any in-repo agent-worktree directories and shot/dist output
    dirs**, or a parallel agent's own edits under e.g. `.claude/` reload the shared dev server out from under
    another agent's session (`vite.config.ts`'s `server.watch.ignored`, line 12) — relevant the moment P2P runs
    multiple worktrees per BRIEF.md's "workstreams in separate git worktrees."
18. **A shared `vite` dependency cache directory (`cacheDir`) lets sibling worktrees invalidate each other's dev
    server's "optimized deps"** if they share `node_modules`, producing a confusing "504 Outdated Optimize Dep"
    error — give each worktree (or at least the cache) its own resolved path (`vite.config.ts:6-8`).

## Summary table

| Piece | File(s) | Verdict |
|---|---|---|
| Pure engine shape | `src/model/engine.ts` + test style | adapt (architecture copies; domain rewritten) |
| Content/glue layer | `src/data.js` | adapt |
| Reactive store | `src/app/store.js` | copy nearly as-is |
| Levels/look/dive/framing/test-hooks/visibility (stage.js) | `src/app/stage.js` | adapt (WebGPU changes composer/governor internals; mechanism copies) |
| Scenes contract | `src/scenes/*.js`, `scenes.test.ts` | copy the contract + port the reparenting-bug test verbatim |
| Geometry/material/flow helpers | `src/kit.js`, `src/fx.js` | copy most exports; `Reflector` pending WebGPU check |
| Evidence labels/registers | `src/evidence.js` | copy nearly verbatim (bases already match BRIEF.md) |
| Claim keys/walker | `src/claims.js` | copy pattern, rewrite key namespaces |
| Claims gate | `tools/claims.mjs` | copy nearly as-is |
| Sources registry | `src/sources.js` | copy shape |
| Tour player | `src/app/story.js`, `src/app/journeys.js` | adapt heavily, keep the pause/dwell/sim-gate/chain mechanism |
| Share/link glue | `share.js`, `scenario-links.js`, `links.js` | copy as-is |
| Evidence/Method/Glossary pages | `src/pages/*.js` | copy structure |
| Every `tools/*.mjs` gate | `tools/*.mjs` | copy nearly all as-is; `govern.mjs` needs a WebGPU rewrite |
| Artifact export | `tools/artifact.mjs` | copy as-is |
| CSS tokens/type | `styles.css` `:root`, `tokens.css` (misnamed) | adapt: same structure, new palette, fix the naming trap |
| WebGL post-processing stack | `EffectComposer` + addon passes | rewrite for WebGPURenderer/TSL; keep WebGL2-fallback versions in sync |
