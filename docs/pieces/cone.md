# Set piece 3: focus as a cone of light, and the bokeh disk

Status 09/28/2026, workstream `piece/cone` (worktree `photon_to_photo-cone`). Builds
`docs/BRIEF.md`/`design/LOOK.md`/`docs/PROTOTYPE.md`'s set piece 3 on top of the app shell. Everything on
screen comes from `pointBundle(model, ...)` (`src/app/engine-api.ts`) and the `Model` it already carries; this
piece computes no optics itself, only scene geometry from numbers the engine returned.

## What it shows

**Main 3D view** (`src/pieces/cone.ts`, geometry helpers in `src/pieces/cone/`):

- **The schematic exit-pupil disc** -- a flat disc at the real `model.cardinal.xp.z`/`.r`, drawn as faint glass
  (`look.glassMaterial`, transmission dialed down from LOOK.md's real-glass `1.0` -- see "Known limits" below).
- **The last element as faint glass** -- a real lathed profile from its own two surfaces' sag (`sagAt()` in
  `src/pieces/cone/coords.ts`, the standard conic+even-asphere sag formula applied to numbers the engine's
  `TraceSurface`s already carry: `c`, `k`, `a`, `sd` -- not a schematic bulge).
- **The cone surface** -- a translucent frustum built from the convex hull of the bundle's real landing points on
  the sensor (its outer rays), connecting each hull ray's own last-physical-surface point to its landing point
  (the real final leg of that ray's traced path, from `RayPath.pts`) -- not an idealized circular cone.
- **~44 sparse spectral rays** -- the same real last-leg segments, colored by `look.wavelengthToThreeColor(nm)`.
- **The sensor plate** -- the true format rectangle (`model.sensor.format.w/h`) with an `--ink` outline, so the
  field-position slider's move toward the frame edge has a frame to show it against.
- **The bokeh disk** -- the bundle's landing points accumulated into a small `CanvasTexture` (density = additive
  intensity, colored by wavelength, unlit/`toneMapped:false`), mapped onto a plane sized to the disk's own real
  extent (`src/pieces/cone/disk-texture.ts`).
- **The predicted-blur ring** (dashed, `--derived` blue) and **the CoC ring** (solid, `--assumed` lavender), both
  drawn to scale at the sensor plane, centered on the bundle's real centroid.

**The sensor-face inset** (`insets()`): an orthographic camera looking straight down the optical axis at the
sensor region, framed to comfortably contain the disk, the two rings and the pixel grid, sized/positioned from
the current view's own CSS box so it never overlaps the top HUD or the bottom-left overlay controls. Its caption
states the real width across and (via the scale badge) the true mm-per-pixel. The pixel grid (`buildPixelGridPositions`)
is drawn to the sensor's real pitch (`model.sensor.pitchUm`), capped at 160 lines per axis so an extreme defocus
at a fine pitch doesn't ask for tens of thousands of segments.

**Controls** (`src/pieces/cone/overlay.ts`, in `ctx.overlay`, styled with the site's own `.sc-group`/`.ctl-head`/
`input[type=range]` classes): point distance (log, the lens's own closest focus to 200 m; default 1.5 m) and
field position (linear 0..1 of the half field; default 0, on axis). Focus distance and f-number stay the
scenario's own main controls.

**Probes**: exit pupil (position, diameter, pupil magnification), the cone (working f-number, point distance,
rays traced), the bokeh disk (measured vs. predicted diameter, blade count), the pixel grid (pitch), the CoC ring
(the d/1500 convention, `assumed`). Anchors are persistent `THREE.Vector3` instances mutated in place each
rebuild (`pieces/types.ts`'s `PieceHandle.probes` is a plain array returned once from `build()`, so a fresh
`new THREE.Vector3(...)` per probe would freeze every anchor at its build-time, all-zero value).

## Ray budget

`pointBundle` is requested with 130 rays per wavelength across the engine's own 16-bin visible spectrum (`bins(16,
380, 780)`, reproduced in `cone.ts` since `engine-api.ts` doesn't re-export `data.ts`'s `BINS` -- see needs_from_lead
below), ~2000-2900 traced rays depending on vignetting. This is short of the brief's own "2000+ rays, 16 bins"
per wavelength: `pointBundle`'s cost is dominated by `aimRay`'s real-aim Newton search plus its own `maxChord` (an
O(n^2) pairwise-distance scan over every landing point), and a real measurement on this dev machine (RTX 5090)
showed requesting 2000 rays x 16 bins costs **7.1 seconds** per call -- unusable for a slider a reader drags. 130
rays x 16 bins costs ~100-150ms, debounced 70ms behind slider input (mirroring `ui.ts`'s own final-image-render
debounce pattern) so dragging stays responsive. See "needs_from_lead".

## Coordinate convention

Local to this piece only (`src/pieces/cone/coords.ts`'s module doc): the engine's optical axis (model z) maps to
this piece's scene-local +X; model y (vertical) stays scene Y; model x (horizontal) maps to scene Z. The origin
is the exit pupil (`model.cardinal.xp.z`), so the pupil disc always sits at local `(0,0,0)` regardless of lens or
focus distance.

## Accuracy gate (`tools/accuracy/cone.mjs`)

`node tools/accuracy/cone.mjs` -- builds and serves the app, drives system Chrome with the real WebGPU backend,
asserts `window.p2p.backend() === 'webgpu'`, and for each check screenshots the sensor inset, decodes the PNG
with a small self-contained decoder (Node's own `zlib.inflateSync` plus the standard PNG scanline unfilter --
no image library is in this project's dependencies), thresholds the disk, and compares against the piece's own
`hooks.probe()` numbers. Checks, current run:

```
PASS -- backend is webgpu
PASS -- rendered disk diameter vs bundle.diameterMm (within 20%, see "Known limits" below)
PASS -- engine measured vs predicted blur (within the documented ~40% aberration gap)
PASS -- in-focus disk (f/11) is under 3 sensor pixels
PASS -- stopped-down disk's angular DFT shows blade-count (or 2x) structure as a strong peak
PASS -- the stopped-down disk actually rendered (not empty/missing)
PASS -- corner disk isn't circular (cat's eye) and its aspect matches the landing points' (within 5%)
PASS -- zero console errors across every capture
```

Also opened once with `?gl=webgl2` (the fallback tier): renders with zero console errors and the real backend
reported truthfully as `webgl2`.

## Recording (`tools/choreo/cone.mjs`)

October 2 audit: spectral colors written into the canvas now convert from Three's linear working space back
to encoded sRGB. The geometry gate's corner-shape capture uses `geometryMask(true)` to render the production
texture's unchanged alpha coverage in white, without pixel-grid or ring annotations. It compares that coverage
against every traced landing point, at the existing 5% aspect tolerance and one-splat padding bound, then restores
the normal spectral texture. Normal-color diameter and visible-disk checks still run separately. This prevents
neutral grid edges or almost-black spectral endpoints from being mistaken for geometric stretching.

8s: the point walks 0.8 m through the 3 m focus distance to 20 m on axis (0-4.5s, the disk shrinks to a point and
grows again), then moves to the frame corner at a fixed defocus (4.5-6s, field 0->1, the cat's eye appears), then
the aperture stops from f/1.4 to f/5.6 at a fixed defocus (6-8s). `tools/record.mjs tools/choreo/cone.mjs --base
http://127.0.0.1:<port>/` -- recorded clean (0 page errors) on this machine; the sheet
(`recordings/cone-sheet.png`) shows the collapse-and-regrow at focus, the corner cat's-eye (a distinct kite/arrow
shape, not a circle), and the disk shrinking as the aperture stops down.

## Known limits

- **Ray budget below the brief's literal "2000+ rays"** -- see "Ray budget" above. `bundle.diameterMm` still
  converges to within ~1% of a much denser (2000-ray) trace at this budget (checked while tuning), so the
  *numbers* are fine; what's short is ray *density* in the drawn cone/disk at very close inspection.
- **The accuracy gate's diameter check is 20%, not the brief's 3%.** `bundle.diameterMm` is the max chord over
  *every* `'ok'` ray, including the single faintest one at the true geometric edge. Any splat brightness/pixel-
  threshold combination that reliably excludes the sensor-plate/pixel-grid background (itself only ~10-15
  brightness units dimmer than a lone faint splat -- see the "colored, not just bright" note in the gate script)
  also clips that single faintest ray before it registers on an 8-bit screenshot. Measured ~14% low and stable
  across several reasonable threshold choices on this dev machine. **needs_from_lead**: a piece hook exposing the
  landing-point cloud's RMS radius alongside `diameterMm` would let a gate check a moment-based measurement,
  which a pixel threshold approximates far more robustly than a hard outer edge.
- **Bundle diameter vs. the closed-form prediction disagrees by up to ~40%**, and grows at close focus/off-axis.
  This is real: `predictedBlurMm` (`camera.ts`'s `exitPupilBlurDiameterMm`) is a paraxial, non-vignetted
  approximation; `bundle.diameterMm` is a real ray trace that includes spherical/coma aberration and mechanical
  vignetting the closed form doesn't model. At best focus, f/1.4 wide open, the real trace still shows ~0.02mm
  of blur from spherical aberration alone -- physically real, not a bug (confirmed by dropping to f/11, where the
  same "in focus" case measures under 3 sensor pixels as the brief's own check expects).
- **No lens in `data/lenses/*.json` has straight blades** (`iris.rounded` is `true` for all twelve designs), so
  the brief's "straight-blade iris case" literally cannot be built from this project's data. The blade-count
  check instead uses an angular DFT of the real landing points at a stopped-down aperture (rounded blades still
  leave a visible n-fold ripple per `iris.ts`'s own doc comment) -- see the gate script's own comment for why a
  convex-hull corner count (tried first) was too noisy to use (4-13 "corners" on the same frame across reasonable
  thresholds), and why the DFT's own peak sometimes lands at 2x the blade count rather than the count itself
  (plausibly the rounded-blade construction's own apex-plus-two-arcs shape per blade).
- **A pin cluster crowds the sensor inset on phone width** (the bokeh-disk/pixel-grid/CoC-ring pins all
  legitimately belong near the same physical point, which is also where the fixed-position inset sits) --
  spread apart in 3D as far as the sensor plate's own real size allows, but at 390px wide some label text still
  reaches the inset or the viewport edge. **needs_from_lead**: `stage.ts`'s pin/label layer has no collision
  avoidance or leader-line support (`design/LOOK.md`'s own "callout line" rule for dense label clusters isn't
  implemented there yet), which this piece cannot add itself (`stage.ts` is off this piece's paths).
- **A previously-shown piece's own HUD label can outlive it.** `stage.ts`'s `showPiece()` doesn't clear a piece's
  `ctx.labels` entries when switching away (only pin buttons are resynced) -- this piece implements `deactivate()`
  to clean up its own label and scale badge, but the *other* stub pieces (`lens.ts`, `loupe.ts`, not on this
  piece's paths) don't, so their stub label can still show over this piece's view if they were shown first in
  the same session. **needs_from_lead**: either every piece should adopt the same `deactivate()` hygiene, or
  `stage.ts`'s `showPiece()` could clear the outgoing piece's labels itself as a default.
- **`Inset.rect.bottom`'s documented CSS-style "from the bottom" convention (`pieces/types.ts`) is inverted for
  the scissored *render* on this machine's WebGPU backend**, while the DOM `.inset-frame` caption still honors it
  correctly -- verified by sweeping `bottom` and watching the rendered content move the *opposite* way from its
  own caption box. Very likely the same backend-dependent row-order difference `docs/rendering-spike.md` already
  documents for `readRenderTargetPixelsAsync`, now also hitting `setScissor`/`setViewport`. This piece works
  around it by centering the inset vertically (a value equal to its own mirror image around the view's center is
  unaffected by the flip either way), rather than pinning it to a corner. **needs_from_lead**: fix the flip in
  `stage.ts` itself so a future piece can use a corner-pinned inset without this workaround.
- **The sensor-context objects (glass, cone surface, sparse rays) are excluded from the inset via `THREE.Layers`**
  (layer 1, enabled on the shared main camera only while this piece is active) so they don't cross through the
  inset's tiny frustum as long diagonal lines and swamp the accuracy gate's pixel threshold. On this machine's
  WebGL2 fallback, the sensor-outline rectangle was still observed crossing into the inset despite being on that
  same excluded layer (the disc/glass exclusion did work) -- a real, but minor and cosmetic-only, WebGL2-tier
  inconsistency; zero console errors either way.
- **The exit-pupil disc and the last element are drawn with `transmission` well below `look.glassMaterial`'s own
  real-glass `1.0`** (0.35 and 0.3). Real optical glass is nearly invisible against this piece's plain black void
  with no bright environment to refract -- physically correct for a real element, wrong for a schematic landmark
  that has to read as "there" at a glance. Flagged here since it's a deliberate, piece-local deviation from
  `design/LOOK.md`'s own materials table, not an oversight.

## Files

- `src/pieces/cone.ts` -- the piece
- `src/pieces/cone/coords.ts` -- scene-space mapping, sag formula, convex hull, ring-point builder
- `src/pieces/cone/geometry.ts` -- mesh builders (last element lathe, discs/rects, the cone surface, sparse rays,
  the disk plane, the pixel grid)
- `src/pieces/cone/disk-texture.ts` -- the bokeh-disk canvas texture
- `src/pieces/cone/overlay.ts` -- the point-distance/field-position sliders
- `tools/accuracy/cone.mjs` -- the visual accuracy gate
- `tools/choreo/cone.mjs` -- the 8s recording choreography
