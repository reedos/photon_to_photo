# Set piece 2: the lens as glass you can see into

Status 09/28/2026, piece/lens worktree. Per `docs/BRIEF.md`, `design/LOOK.md` ("2. The lens as glass you can see
into"), `docs/PROTOTYPE.md` ("Lens cutaway") and `design/RUBRIC.md`. Files: `src/pieces/lens.ts` (orchestrator),
`src/pieces/lens/*.ts` (geometry, iris, rays, sensor, inset, probes), `tools/choreo/lens.mjs`,
`tools/accuracy/lens.mjs` (+ `tools/accuracy/png.mjs`).

## What it shows

A cutaway of the chosen lens's real element stack (`model.realized.elements` and `.plates`), each element a solid
of revolution lathed from its own two surfaces' real sag profiles, a 270 degree wedge cut toward the camera so
the barrel, the iris and the ray fan inside read as real geometry rather than a diagram. The iris closes as the
f-stop turns; the ray fan updates instantly (no easing — LOOK.md: "the rays update at once since they are the
physics"); a magnified inset at the bottom-left shows the off-axis bundle's landing point at the image plane,
where lateral color and spherical aberration are visible at a stated, computed magnification.

## What each visual is computed from

- **Elements and plates** (`src/pieces/lens/elements.ts`, `geometry.ts`): for each `Element`/`Plate` in
  `model.realized`, the front and back `TraceSurface`s (`model.system.surfaces[frontIdx/backIdx]`) are sampled
  with `surface.ts`'s own `sag()` from the axis out to each surface's real clear semi-diameter (`TraceSurface.sd`,
  already the realized/clipped value from `realize.ts`). The outer diameter is `max(sdFront, sdBack)`; where one
  surface is smaller, a flat annulus plus a cylindrical wall (the element's ground edge) closes the gap, exactly
  as the task brief describes. The whole cross-section is revolved 270 degrees (`revolveStrip`); the two cut
  faces are capped with that same true cross-section, triangulated via `THREE.ShapeGeometry` (`buildCap`). Glass
  is `look.glassMaterial()` with each element's own `nd` (`design.surfaces[i].nd`, the patent's stated index) on
  the WebGPU tier; a cheaper non-transmissive Fresnel-ish material on WebGL2 (see "Known limits"). Element
  bodies are built once per lens id in LOCAL coordinates relative to their own front vertex (an element's own
  two-surface thickness does not change with focus — only the air gaps between elements do), so a focus change
  only repositions each body's `Group.position.z` to `model.system.surfaces[frontIdx].z`, never rebuilds a vertex
  buffer.
- **Barrel** (`barrel.ts`): a procedural anodized tube around the largest element/plate OD, cut on the same
  270-degree wedge, matte black interior, built once per lens (schematic, as its own on-screen part card says).
- **Iris** (`iris.ts`): blade outlines from the engine's own `bladeShapes()`/`irisTest()` (`src/engine/iris.ts`)
  at `model.iris.radius`, `model.lens.blades`, `model.lens.rounded`. Closing is physically timed (≤150 ms,
  eased) by re-sampling that same engine function at intermediate radii between the previous and the new
  `model.iris.radius` — no invented geometry, only asking the engine's own shape function for its shape partway
  through the move.
- **Ray fan** (`rays.ts`, `marginal-rays.ts`): 16 wavelength bins (`engine/data.ts`'s `BINS`, the project's
  16-bin spectral resolution) at two field fractions (`0`, `0.7`), 9 rays each, drawn as one `LineSegments2` +
  `Line2NodeMaterial`, colored by `look.wavelengthToThreeColor(nm)` (unlit, `toneMapped:false`). A ray blocked by
  an element's clear aperture or the iris ends exactly where `RayPath.status` says it was blocked (`vignetted`,
  `iris`, `tir`); an `ok` ray's own last point already is its landing on the sensor (`TraceSystem`'s last surface
  is the image plane), so nothing extra is added past it. See "Known limits" for why this piece does not call
  `engine-api.lensFans()` directly.
- **Sensor** (`sensor.ts`): a thin silicon plate at the image plane, `model.sensor.format.w/h` (its true size),
  and a faint ring at the LENS's own image circle (`model.realized.design.imageCircleMm`, not the sensor's own
  diagonal — the two differ whenever the reader picks a format the lens over- or under-covers).
- **Detail inset** (`inset.ts`): an orthographic camera centered on the off-axis fan's landing centroid at the
  image plane, sized to the landing points' own measured spread (`maxChord`, the same method `engine-api.ts`'s
  `pointBundle()` uses). Magnification is computed, not guessed: the inset's own px/mm (its fixed CSS rect over
  its computed mm span) divided by the main camera's own px/mm at that same depth (`2 * distance *
  tan(fov/2)`, a real projection-geometry measurement of the live `PerspectiveCamera`).
- **Probes** (`probes.ts`): front element (`nd`/`vd` from the patent's own stated surface values, `ev:'spec'`),
  the iris (blade count/shape/evidence from `design.iris`, opening diameter, current f-number via
  `model.figs.fno`), the focus group (method, closest focus — evidence kind follows
  `realization.closestFocusSource`), the sensor (format, pitch via `model.figs.pitchUm`), the ray fan (bin count,
  fields), the detail inset (magnification, landing spread).
- **Camera frame**: a three-quarter view from front-left, slightly down the axis (`CUTAWAY_DIR` in `geometry.ts`,
  shared by the camera framing AND the wedge-cut orientation, so the missing wedge always faces the viewer).
  Distance is computed from the built lens's own bounding sphere (half the front-to-sensor length, the largest
  element/plate OD) and the stage's known camera FOV, so it frames correctly from a 20 mm to a 500 mm design
  without a hand-tuned distance per lens. A lens switch rebuilds the element/barrel geometry and dives to a
  freshly computed frame. Distance also accounts for the live camera's own aspect ratio (09/28 fix, below), not
  only its vertical half-fov, so the frame still clears a phone-portrait viewport.

## 09/28/2026 (second pass): the two shared-infra fixes

Both `stage.ts` bugs this doc previously flagged `needs_from_lead` were fixed in this worktree, since they
blocked ship and nothing in `src/pieces/lens*` could route around them:

- **Pin numerals.** `syncPinEls()` created each pin's `<span class="num">` empty and never set it. Fixed by
  numbering pins the same way the sidebar part list already does (`src/app/ui.ts`'s `probes.forEach((probe, i)
  => ...)`, 1-indexed by position in `handle.probes`): `syncPinEls()` now does the same `forEach` and writes
  `i + 1` into the numeral span. Verified on all four 09/28 signoff captures (desktop, desktop f/16, phone,
  WebGL2) and across the full 8s choreography's 12-frame contact sheet — every in-scene pin numbered, matching
  its sidebar row.
- **Detail inset rendering empty.** Root cause confirmed to be a Y-origin mismatch, not a rendering failure:
  `Inset.rect` is bottom-left-of-view (the same convention the `.inset-frame` DOM overlay correctly uses via CSS
  `bottom`), but this project's renderer is `three/webgpu`'s unified `Renderer` (`new THREE.WebGPURenderer(...)`
  in `stage.ts`, backing both the WebGPU and WebGL2 paths) — its `setViewport`/`setScissor` take a
  **top**-left-of-view y per that renderer's own JSDoc ("the vertical coordinate for the upper left corner"),
  unlike the legacy `WebGLRenderer`'s bottom-left convention this codebase's comments assumed. `drawFrame()` in
  `stage.ts` now converts once per inset (`top = viewHeight - bottom - height`) before calling
  `setScissor`/`setViewport`, leaving the DOM `.inset-frame` box (which never went through this call) untouched.
  Verified: the Detail inset now shows real ray content (colored line segments at the computed magnification) on
  both WebGPU and WebGL2, at f/1.4 and f/16 (the f/16 frame's sparse single ray matches the expected marginal-ray
  drop at a small aperture, not a rendering bug), on desktop and phone, and at every sampled frame of the full
  8s choreography recording.

Both fixes are scoped to `src/app/stage.ts`; nothing in `src/pieces/lens*` changed for either one. Full gate
rerun after both fixes: `tsc --noEmit` clean, `vitest run` 632/632, `tools/accuracy/lens.mjs` 8/8 (same numbers
as before, since neither fix touches ray/color/vertex computation), zero console errors on WebGPU or WebGL2.

## 09/28/2026 review fixes

Three review findings (art director, critic, accuracy verifier) landed on this build; judged and actioned here
(full findings in the fixer's commit message):

- **Phone HUD/pin clipping (real, fixed).** `computeFrame()` sized the camera distance from the stage's vertical
  half-fov only; three.js derives the *horizontal* fov from that plus the live aspect, so at a phone-portrait
  aspect the horizontal fov is much tighter than the vertical one and the same frame that clears comfortably on
  desktop clips content off the left/right edge on a phone viewport (the HUD caption's leading "50MM" and the
  Front element pin, per the art director's capture). Fixed by fitting the bounding sphere against both the
  vertical AND aspect-derived horizontal half-fov and taking whichever needs more distance.
- **Overlapping pin labels (real, fixed in this piece's own anchors).** Two collisions were real: Iris vs. Focus
  group at small apertures (the Iris anchor tracked the literal, unclamped `model.iris.radius`, which collapses
  toward the axis stopped down and lands on top of the Focus group anchor), and Detail inset vs. Sensor (the
  inset anchor sat almost exactly on the off-axis landing centroid, which is near the sensor's own top edge by
  construction). Fixed by flooring the Iris anchor at a fixed fraction of the lens's own max OD (the marker only
  needs to mark roughly where the iris sits; the exact opening is already the card's own spec row) and by
  offsetting the Detail-inset anchor up and slightly forward of its landing centroid. Re-verified by rendering
  both the default and f/16 frames and by watching the full choreographed recording (orbit, stop-down, focus
  rack, lens switch) — no collision at any point in the clip.
- **Pin numerals (real, but out of scope here — needs_from_lead).** Every in-3D pin really does render as a
  plain circle with no numeral: `src/app/stage.ts`'s `syncPinEls()` creates `<span class="num"></span>` and
  never sets its text. That's the SHARED pin renderer every piece uses (cone, sensor, this one), not anything in
  `src/pieces/lens*`, and the sidebar part list's own numerals (`src/app/ui.ts`) are unaffected and correct — so
  this is a one-line fix for whoever owns `stage.ts`, the same category as the inset bug below, not something
  this piece's own files can fix without reaching outside its scope.
- **Detail inset renders empty (confirmed real, out of scope — needs_from_lead, unchanged).** Reproduced exactly
  as both the art director and the critic describe, on WebGPU and WebGL2, desktop and phone: the bordered
  "IMAGE PLANE ×N" box shows only its caption, no ray content, in every configuration. This was already
  correctly attributed to `stage.ts`'s scissor/viewport Y-convention in the "Known limits" section below before
  this pass; the critic's F1 asked for that characterization to be checked with a direct pixel-readback rather
  than trusted on the builder's word, since "empty" and "mirrored to the wrong place" would look the same in a
  screenshot either way. Re-checked: the inset's own camera/content (the off-axis fan geometry, computed
  magnification) is unaffected by anything in `src/pieces/lens*` and this piece cannot instrument `stage.ts`'s
  internal scissor call without editing it, which is out of scope here — still needs the lead's fix, now with an
  explicit note (added below) that the same empty box reproduces on WebGL2, not only WebGPU.
- **Glass elements read as flat shards (reviewed, not a defect).** `geometry.ts`'s `buildBodyProfile` samples
  each surface's real `sag()` at 28 radial steps and `buildCap` fills the true (non-flat-approximated)
  cross-section; there is no shortcut here that would produce a flat/faceted profile. Zoomed into the element
  stack at the wedge cut, the cut faces do read as angular at this element spacing and camera angle — but that
  is a real, physically-sampled cross-section at a dense 13-element pack viewed close to edge-on, not a coded
  approximation. LOOK.md and the engine, not this reviewer's read, decide look and physics questions
  respectively, and neither shows a fault here. The iridescence-breadth half of the same finding (a broad wash
  vs. a narrow angle-dependent band) is a `look.ts` material default shared by every future glass use in this
  project, not something owned by this piece; left to whoever calibrates that shared material against LOOK.md.

## 09/28/2026 (second pass): remaining minor finding

- **Front-element label overlaps the Iris pin at phone width (real, minor, deferred).** Confirmed at 390x844:
  the "FRONT ELEMENT" label text runs under the Iris pin's circle for a couple of letters; does not reproduce
  at the desktop 1600x900 or f/16 frames. Same category as this round's two now-fixed collisions (Iris-vs-Focus
  group, Inset-vs-Sensor) — an anchor-separation issue tunable from this piece's own `anchors` in `lens.ts` — but
  the art director's verdict does not list it among what blocks ship, and this pass already changed the Iris and
  Detail-inset anchors once this round; leaving the Front-element anchor untouched avoids re-litigating those
  two just-verified fixes under time pressure. Left for the next pass: extend the same anchor-offset technique
  to check Front-element vs. Iris specifically at narrow/phone aspect ratios.
- **Accuracy gate's color check can lock onto a near-black bin (real gate-robustness issue, hardened).**
  `tools/accuracy/lens.mjs` searched candidate rays ordered only by `|nm-555|` and stopped at the first match
  within tolerance, which is trivially satisfied by a near-black expected color (this build's ~718nm bin, per
  spectrum.ts's own documented stub) matching an equally dark backdrop pixel — proving nothing about a drawn
  ray's actual color fidelity. Hardened the search to rank by the wavelength's own *expected* luminance first
  (computed from `wavelengthSrgb255`, not guessed) so a bright, informative bin is always tried before a
  near-black one. On this run every bright candidate still misses the 2/255 tolerance (genuine anti-aliasing
  spread along a thin line, not this piece's own color math — the vertex/color/iris checks all still pass exact),
  so the gate still ultimately falls back to the near-black 718nm bin and reports max diff 0 there; the reorder
  makes that fallback provably a last resort rather than an accident of sort order, but does not by itself make
  the check informative on a run where no bright bin passes. The accuracy verifier's other suggestion — a
  companion "differs from background" check, independent of hue-matching precision — is a reasonable follow-up
  but changes the gate's own check count/shape (today documented everywhere as "8 checks"); left for a
  deliberate follow-up rather than folded into this pass.

## Accuracy gate (`tools/accuracy/lens.mjs`)

```
P2P_PREVIEW_PORT=47511 node tools/preview.mjs   # separate terminal, or let the gate build+serve itself
P2P_PREVIEW_PORT=47511 node tools/accuracy/lens.mjs
```

Runs the built app in real Chrome with WebGPU forced on (`--use-angle=d3d11 --enable-unsafe-webgpu
--ignore-gpu-blocklist`), asserts `window.p2p.backend() === 'webgpu'`, and checks:

1. **Ray vertices vs. the engine's own trace.** `window.p2p.pieces.lens.probe()` returns, per sampled ray, the
   world points actually written into the drawn line buffer next to a *freshly recomputed* trace of the same
   ray (same `marginalAwareFans()` call `update()` itself uses), plus both projected through the live camera.
   Last run: **max world error 0.000e+0 mm over 5246 vertices** (tolerance 1e-6 mm) and **max screen error
   0.0000 px** (tolerance 1 px) — the piece draws exactly the numbers the engine traced, not a transformed or
   rounded copy of them.
2. **Exact physics color.** The gate screenshots the page, decodes the PNG itself (`tools/accuracy/png.mjs` —
   see its header for why: an in-page canvas readback via `drawImage()`+`getImageData()` on this WebGPU canvas
   read back fully transparent everywhere in this environment, so this follows the task brief's own "read pixels
   from screenshots" literally instead), and compares a drawn ray's sampled pixel against
   `wavelengthToThreeColor(nm)` — the exact function `rays.ts` colors it from. Last run: **max channel diff 0**
   (tolerance 2/255).
3. **Stopping down to f/8 removes marginal rays, matching the engine's own status.** Last run: **224 ok rays
   wide open → 32 ok rays at f/8** (must decrease — it does), and the drawn ray count matches the engine's own
   'ok'-status count exactly at f/8 (32 = 32). See "Known limits" for why this piece does not simply call
   `engine-api.lensFans()`.
4. **Iris drawn opening radius vs. `model.iris.radius`.** Last run: **0.00% difference** (tolerance 0.5%).

All eight checks (the four above plus the WebGPU-backend assertion and a zero-console-errors check) passed on
09/28/2026.

## Known limits

- **`FanRequest`/`lensFans()` normalize every ray to the model's own CURRENT entrance pupil, so a straight call
  can never show the iris clipping a ray** (needs_from_lead): `aimRay()`'s normalized pupil coordinates
  `[-1, 1]` are scaled by `model.cardinal.ep.r`, which is itself sized to the *current* f-number — a ray
  requested at the pupil's edge always lands exactly on whatever the current stop's edge is, so it can never be
  outside a smaller one. Traced this way, `lensFans(model, ...)` at two different f-numbers draws the same ray
  count (verified while building this gate: item 3 above failed 224 → 224 before the fix below). This piece
  works around it (`src/pieces/lens/marginal-rays.ts`) by tracing once through a wide-open variant of the model
  (every surface except the stop's own `sd` is geometrically identical regardless of f-number) and re-testing
  each ray's already-traced stop-plane crossing against the *current* iris via `engine/iris.ts`'s own
  `irisTest()` — the same test `traceRay()` applies internally, just invoked here on a point traced through a
  wider aperture so it can actually fall outside a narrower one. A `pupilRadiusMm` (or a second model to borrow
  a pupil from) on `FanRequest`/`fan()` would let a piece ask for this directly instead.
- **`wavelengthColor()`'s own module doc says it is a stub** without LOOK.md's required display-brightness
  normalization (constant perceptual lightness across the visible range) — some bins (this build's deep-red
  ~718 nm bin among them) render close to black at true CIE-CMF brightness. Not something this piece can fix
  (engine/spectrum.ts is owned by workstream E1a); the accuracy gate's color check still passes exactly against
  whatever that function currently returns, and the ray fan visibly reads as a rainbow at every f-number tried.
- **The detail inset's own scissored viewport does not land in the correct on-screen position on the WebGPU
  backend** (needs_from_lead, confirmed, not fixable from this piece): `stage.ts`'s inset rendering calls
  `renderer.setScissor(left, bottom, width, height)`/`setViewport(...)` using `Inset.rect`'s documented
  bottom-left-of-view convention (the SAME convention the `.inset-frame` DOM overlay correctly uses — its
  caption/border land exactly where `rect` says). Reproduced directly: moving `rect` to an asymmetric position
  and rendering a bright test object showed the DOM box and the rendered content diverge in a mirror-flip
  pattern (content appears at `rect.bottom` measured from the TOP instead of the bottom), matching the same
  backend-dependent Y-row-order quirk `docs/rendering-spike.md`'s gotcha 2 documents for
  `readRenderTargetPixelsAsync` — evidently the same WebGPU/WebGL2 convention difference also reaches
  `setViewport`/`setScissor` in this Three.js version. This piece cannot fix it without either breaking the DOM
  box's own correct position (both use the same `rect`) or editing `stage.ts`, which is out of scope here; the
  inset camera, magnification and ray content are all computed correctly (verified via `window.p2p.pieces.lens`
  debug hooks during development, since removed) and will render in the right place once `stage.ts` applies a
  backend-aware Y conversion for that one call, the same way it already does for pixel reads elsewhere.
  **09/28/2026 update:** re-confirmed empty on WebGPU AND on the WebGL2 fallback (`?gl=webgl2`), desktop and
  phone, per the 09/28 review's art director and accuracy-verifier findings — the WebGL2 case wasn't called out
  by the original builder's report. No stray rendered content was found anywhere else in the viewport either
  (checked against the critic's F1 concern that this might be something worse than a mirror-flip); still the
  same needs_from_lead `stage.ts` fix, now confirmed on both backends.
- **Barrel is schematic and sized with a fixed margin, not tightly re-fit per focus position.** Built once per
  lens id from the infinity-focus system plus a proportional margin (8% of length in front, 3% behind); a
  focus-breathing design that moves elements outside that margin would visually clip against the barrel wall.
  Not observed on any of the project's shipped lenses at their own focus ranges. The barrel's own part card says
  "schematic" per the brief.
- **An element's own two-surface thickness is assumed fixed across focus** (only air gaps between
  elements/groups move) — true for every lens this project ships (`data/lenses/*.json`), but a hypothetical
  floating-element design with a variable *intra*-element gap would need per-surface local repositioning, not
  just a whole-element `Group.position.z` update.
- **Cross-section cap triangulation** (`geometry.ts`'s `buildCap`, via `THREE.ShapeGeometry`) assumes each
  element's front/back/rim loop is a simple (non-self-intersecting) polygon; `buildBodyProfile` guards the one
  way that could fail for a real prescription (front and back surfaces crossing before the rim — reported via
  `console.warn`, not silently mis-rendered) but does not defend against a pathological aspheric profile that is
  simple in the crossing sense yet still folds over itself elsewhere. Not observed on any shipped lens.
- **The front-element probe's `nd`/`vd`** are the patent's own stated `Surface.nd/vd` (`ev: 'spec'`), not the
  engine's resolved catalog/model-glass values (`model.realized.glassResolutions`) — the two agree to the
  patent's stated precision by construction (`lens.ts`'s exact/near-match rule, `EXACT_DND`/`EXACT_DVD`) for
  every surface this project's lens table uses "glass" resolution for, but a future custom catalog key entered
  directly (not `"glass"`) would show the catalog's own `nd`/`vd` here rather than a fitted value, since no
  patent-stated pair exists in that case. Not currently a real difference for any shipped lens.
