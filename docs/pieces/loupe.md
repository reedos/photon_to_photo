# Set piece 9: the loupe

Status 09/28/2026, piece/loupe workstream. Reads with `docs/BRIEF.md` #9, `design/LOOK.md` "9. The loupe" and
"One signature style," `design/RUBRIC.md`, `docs/PROTOTYPE.md`'s loupe section, and `src/pieces/loupe.ts`
itself (every claim below cites the exact line/function it comes from).

## What it shows

Tap any pixel in the final-image panel (or open the loupe directly, which defaults to the frame's center) and
the view dives from that photo, straight down through scale, to the microlens, color filter, photodiode and
glass electron well beneath that one real sensor pixel. A breadcrumb inset keeps the source photo, with the
tapped pixel marked, always in view. Back (or Esc) reverses the same dive.

## What each visual is computed from

- **The photo plane.** The current render's own `rgba` (`render-client.ts`'s `currentRender()`/`onRender()`),
  painted into a `CanvasTexture` (`loupe.ts`'s `paintPhoto`). Not a separate image -- pixel-identical to the
  final-image panel.
- **The tapped pixel's numbers.** `pixelAt(renderId, x, y)` (`render-client.ts`, backed by `render.ts`'s
  `pixel(bx, by)`): a real sampled `PixelState` (photons, electrons, full well, read noise, DN, CFA color, and
  its object point/depth). Every "the pixel" and "the well" part-card number is this value, not a recomputation.
- **The well's fill.** Height (`chargeMesh.scale.y`) and the charge material's own brightness multiplier
  (`look.chargeMaterial(frac)`) both come from the exact same `electrons / fullWell` fraction, computed once
  per pixel in `updateWellFill()` -- the "encoded twice, redundantly, on purpose" rule from `design/LOOK.md`.
- **The neighbor grid's colors.** The real Bayer pattern around the tapped site, read from the engine's own
  `cfaColorAt('RGGB', x, y)` (`pipeline.ts`), not an assumed alternating scheme -- `updateGridColors()`.
- **The ray bundle.** `pointBundle(model, { pointDistMm, fieldFrac, rays: 192, nms: [8 bins] })`
  (`engine-api.ts` → `camera.ts`), a real trace through the current lens. `pointDistMm` is the pixel's own
  axial object depth (`pixelAt`'s `objectPoint[2]`, the same "distance from sensor" convention `pointBundle`
  itself expects -- see `camera.ts`'s own `distanceFromSensorToP` and `render.ts`'s axial-vs-Euclidean note).
  `fieldFrac` is the pixel's radial distance from the frame center, as a fraction of the lens's own realized
  half field (`realized.realization.halfFieldDeg`) -- the honest fraction to use, since `camera.ts`'s
  `pointBundle` only supports a meridional (one-axis) field point and the lens is rotationally symmetric, so a
  radial fraction is the physically meaningful generalization (see "Known limits" below for what this does
  and does not preserve). Each traced ray's real arrival angle (`RayPath.dirOut`) is drawn as the last segment
  of its own path, converging on the microlens apex -- see `updateRayBundle()`'s basis-rotation comment for
  exactly how the engine's meridional (radial) and sagittal (tangential) components map onto this piece's own
  local axes without distorting the real angle, only its drawn length.
- **The photon-rate badge.** `1 DOT = N PHOTONS`, with `N = round(photonsMean / 40)` chosen so the drawn dot
  count times `N` reproduces the pixel's real `photonsMean` to within one dot (`badgeFor()`) -- this is the
  accuracy gate's own check #4.
- **The scale badge's magnification.** Read live from the camera's actual current distance to the target
  (`tick()`), log-interpolated between the two named camera frames' own distances -- not a re-derivation of
  the stage's dive timing, so it stays honest under any easing curve or reduced-motion snap.
- **The noise-vs-prediction hook** (`grayPatchNoise()`). Locates the ColorChecker's "neutral 5 (.70 D)" patch
  by calling the engine's own `projectToRenderedPixel`/`renderSetup` (`render.ts`) on that patch's known world
  position (the same convention `scenes.ts`'s `colorCheckerBillboard` places it with), measures the raw DN
  standard deviation of its own G-channel pixels (least-squares plane-detrended -- see the function's own
  comment for why a flat patch this far off-axis still needed detrending), and predicts the same figure from
  `Model`'s own already-exposed sensor figures (`unityGainIso`, `readNoiseE`, `figs.darkCurrentEPerS`,
  `figs.blackLevelDn`) plus the representative PRNU figure the engine's own data uses project-wide
  (`data/sensors.json`, `generic.prnu.typicalPercent`, 1.5% RMS).

## The gate

`P2P_PREVIEW_PORT=47513 node tools/accuracy/loupe.mjs` -- eleven checks, each prints PASS/FAIL with its numbers:

1. Drawn fill height / well height equals `electrons/fullWell` within 1%, and the fill's own emissive
   brightness multiplier equals the same fraction (a scene-graph check -- see check 5).
2. The rendered final image's measured raw DN standard deviation over the ColorChecker's flat neutral-5 patch
   (G channel, plane-detrended) matches the engine's own predicted sigma within 5%.
3. `pixelAt()` is deterministic: two calls at the same `(renderId, x, y)` return byte-identical `PixelState`.
4. The badge's `N` times the dots drawn reproduces the pixel's real photon count within one dot.
5. The charge fill is visible and responsive on a REAL rendered pixel, not just the scene graph: two taps with
   very different `electrons/fullWell` fractions each sample a real screenshot at the charge mesh's own
   projected screen position and must read as distinguishable from that frame's background, and differ from
   each other in the direction the engine's own fraction gap predicts. Added 2026-09-28 after the accuracy
   verifier's own independent review found check 1 alone cannot tell a genuinely-drawn fill from an
   invisible/occluded one (`shots/review-loupe/independent.mjs`).
6. The breadcrumb inset actually shows the photo (real pixel variance over its own rendered rect) and its own
   tapped-pixel marker is visible. Added 2026-09-28 as a regression test for a real bug found the same day (see
   "Known limits").
7. WebGPU is really the backend in use (not a silent WebGL2 fallback), and `?gl=webgl2` renders with zero
   console errors.
8. Zero console errors on the main page.

A real run (default scenario, a highlight-edge pixel the gate finds itself):

```
PASS -- backend is webgpu: got "webgpu"
PASS -- found a highlight-edge pixel to tap: (175, 179)
PASS -- drawn fill height / well height == electrons/fullWell: drawn 0.5081 vs electrons/fullWell 0.5081 (0.00%)
PASS -- fill brightness follows the same fraction: brightness multiplier 0.6163 vs expected 0.6163 (0.00%)
PASS -- measured noise vs predicted sigma (ColorChecker gray patch, G channel): measured 3.279 DN vs predicted 3.388 DN (3.20%, n=145 samples)
PASS -- pixelAt() is deterministic at the same (renderId, x, y): two calls returned identical PixelState
PASS -- badge N x dots drawn == photon count within one dot: 2223 x 40 = 88920 vs photonsMean 88913.3 (off by 6.7, one dot = 2223)
PASS -- charge fill renders as a real, non-background pixel [bright tap, fillFrac=0.508]: color-distance from background 62.1
PASS -- charge fill renders as a real, non-background pixel [dark tap, fillFrac=0.086]: color-distance from background 39.3
PASS -- rendered charge color tracks electrons/fullWell in the right direction (real pixel, not scene graph): fracGap 0.422, color distance 28.9
PASS -- breadcrumb inset shows real image content, not a flat/empty box: luma range 42.2-240.7 (spread 198.5)
PASS -- breadcrumb marks the tapped pixel: crumbMarkerVisible=true
PASS -- WebGL2 fallback (?gl=webgl2) renders with zero console errors: backend "webgl2", 0 console error(s)
PASS -- zero console errors on the main (WebGPU) page: none
```

## Known limits

- **The ray bundle's field angle is meridional-only, radially generalized.** `camera.ts`'s `pointBundle`
  places its object field point purely along the lens system's own y-axis (`ang = halfFieldDeg * fieldFrac`,
  `o = [0, ..., objectZ]`); it has no true 2D (x, y) field-point API. This piece uses the pixel's RADIAL
  distance from the frame center as `fieldFrac` (correct by the lens's own rotational symmetry for the
  bundle's SHAPE and angles), then rotates the drawn cone to point toward the frame center along the pixel's
  own real azimuth. This reproduces the real radial/tangential (meridional/sagittal) split correctly, but a
  genuinely asymmetric off-axis aberration that isn't azimuthally symmetric (vanishingly rare for a
  rotationally-symmetric lens design, but a real limitation of the engine's own tracer, not of this piece)
  would not show up exactly as it would from a true 2D trace. **needs_from_lead:** a 2D-field-point overload
  on `pointBundle` would remove this approximation entirely.
- **Photon sparks are decorative, not a literal fill animation.** The well's drawn fill height/brightness are
  always set to their true, static `electrons/fullWell` value the instant a pixel resolves -- never animated
  up from empty. The falling sparks above the microlens are a continuous, separate decorative loop showing
  that photons keep arriving; they do not make the charge "grow" on screen, by design (a growing charge would
  misrepresent a single-exposure quantity as if it were happening in view-time). Documented here since it is
  the one place this piece's animation and its own accuracy-gate numbers are deliberately decoupled.
- **The well's glass uses alpha blending, not full physically-based transmission, at this piece's own scale.**
  `look.wellGlassMaterial()`'s `transmission: 0.95` is still used for the microlens and CFA layers (correct
  and legible there), but the well's own five wall panels turn transmission off and use ordinary
  `transparent`/`opacity` alpha blending instead (`makeWellShell()`'s own comment covers this in detail): a
  transmission material's coverage renders via its own refraction shader/pass and does not respect
  `opacity`/`transparent` the way ordinary materials do, and at this small, dark-void, deeply-nested scale a
  solid transmissive well read as flat opaque black in practice, hiding the charge inside it entirely (found
  and confirmed directly while building this piece, screenshots and a live camera/NDC projection check both
  cited in that comment). Alpha blending trades away the transmission pass's own refraction/dispersion for
  guaranteed, correct-looking see-through glass at this scale -- an intentional, documented choice for a look
  prototype, not an oversight.
- **The charge fill disables depth test/write.** The stage's shared camera spans one near/far range (0.01 to
  100000, `stage.ts`) across every set piece's wildly different real scale, and float32 depth-buffer precision
  at this piece's own small, close-in well scale turned out too coarse to depth-test the charge mesh against
  its own well walls reliably (confirmed directly: forcing `depthTest` off made an otherwise fully-invisible
  test fill appear exactly where the math said it should be, with nothing legitimately in front of it). The
  charge material disables `depthTest`/`depthWrite` (see `updateWellFill()`'s own comment) so it always draws
  through the glass around it; nothing else in this piece is affected. **needs_from_lead:** a logarithmic
  depth buffer, or a per-piece camera near/far override, would remove the need for this per-object workaround.
- **PRNU is a representative constant, not per-sensor data.** `Model`/`SensorInfo` does not expose
  `SensorSpec.prnuStdDev` (engine-internal). The noise gate's prediction uses the same representative figure
  the engine's own data already uses project-wide (`data/sensors.json`'s `generic.prnu.typicalPercent`, 1.5%
  RMS, cited to one commercial CMOS sensor's datasheet, not a universal constant) rather than inventing a new
  number. **needs_from_lead:** exposing `prnuStdDev` on `SensorInfo`/`Model` would let this gate (and any
  future noise-related view) read the engine's real, current value directly instead of duplicating it.
- **The scale badge's magnification is a heuristic, not a calibrated physical ratio.** It is derived from the
  live camera's own distance to the target, log-interpolated between the `PHOTO_FRAME`/`WELL_FRAME` constants'
  own distances (`tick()`). It correctly increases monotonically and continuously during the dive (per
  `design/LOOK.md`'s own rule that the badge must tick as the camera moves), but its exact numeric value is
  not a literal "real sensor pitch vs. drawn pitch" ratio the way the badge's own photon-count side (`1 DOT =
  N PHOTONS`) is exact. The photon-count ratio is the one this piece's own accuracy gate checks (#4); the size
  ratio is stated qualitatively, honestly, but not gate-checked to a specific closed-form number.
- **Fixed 2026-09-28: the breadcrumb inset used to render this piece's whole group**, not a purpose-built
  thumbnail scene, on the assumption that the far-below well/microlens/grid geometry was sub-pixel at the
  inset's own zoomed-to-the-photo framing and would not visibly interfere. That assumption was wrong (critic,
  "breadcrumb-empty"): the insetCam is orthographic, which draws distant geometry at full size with no
  perspective falloff, and the neighbor grid's own swatches sit well within the inset's XZ footprint -- they
  rendered right through the photo instead of vanishing behind it (worsened by the photo plane and the grid
  both being close in depth from the inset's own top-down view). The inset now renders a dedicated `insetScene`
  containing only a crumb-specific photo mesh and a crumb-specific marker (both share the main scene's own
  geometry/material objects -- no extra texture upload), and the marker is sized and positioned for the small
  inset rather than reusing the on-photo ring built for the zoomed-out `PHOTO_FRAME` (which was well under 2px
  across at the crumb's own scale, effectively invisible). Also fixed the same day: `update()`'s own "default
  to the frame's center" logic only ran once, at piece-show time -- if the render worker's first pass finished
  AFTER the piece was already shown with no target (a script or a direct nav to the loupe piece before that
  ~2 s first render completes), no default target was ever set, and neither the dive nor the breadcrumb (both
  gated on a real target) ever initialized. `onRender()` now carries the same fallback, so a render finishing
  late still triggers it.
- **Field-of-view edge case.** `fieldFrac` is clamped to `[0, 1]`; a tapped pixel right at or beyond the
  frame's extreme corner (which can exceed the lens's own realized half field slightly, depending on format
  crop) draws its ray bundle at the lens's own edge-of-field angle rather than extrapolating past it.

## Accuracy discipline

Every number this piece shows either comes straight from `Model`/`PixelState`/`Bundle` (the engine) or is
explicitly marked otherwise: the microlens IOR, the CFA transmission figure and the badge's dot-count choice
are all cited `assumed`/documented constants (see the part cards' own `fig()` calls and `design/LOOK.md`'s
Materials section), never presented as measured. This piece adds no new physics -- the one engine change in
this same workstream (the highlight-clip fix, `src/engine/pipeline.ts`/`render.ts`) is a bug fix to an
existing pipeline stage, not new behavior this piece depends on beyond "clipped highlights render neutral,"
which is what makes `findHighlightEdge()`'s own tapped pixel land somewhere honest to look at.
