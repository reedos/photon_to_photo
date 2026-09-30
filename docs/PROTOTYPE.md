# Look prototype: architecture (lead, 09/28/2026)

Three set pieces, all driven by `src/engine`: (2) the lens cutaway with live spectral rays and the iris, (3) the cone
of focus and bokeh, (9) the loupe dive from a final-image pixel to its well. Read with docs/BRIEF.md, design/LOOK.md,
design/RUBRIC.md, docs/rendering-spike.md and docs/ENGINE.md.

## One signature style

Reed (09/28/2026) wants this site to keep The Intelligence Factory's look. The UI shell ports that site's CSS
(`~/projects/intelligence_factory/src/styles.css` tokens and components) and its layout: top bar with the three-bar
mark, section header with the amber mono counter, scenario builder (sliders, segmented groups, stat row), the level
strip, the view chrome (level title, layer toggle, outlined action buttons, hint line, scale bar), numbered pins, the
right panel with the numbered part list, part cards with evidence chips. Same accent (#e6ba82). See design/LOOK.md,
"One signature style", and the screenshots in design/if-style/. The critic checks the prototype against them.

## Rendering decisions

- `THREE.WebGPURenderer` (three/webgpu, TSL from three/tsl). `?gl=webgl2` forces the WebGL2 backend. The page reports
  the backend it really got (`renderer.backend.isWebGPUBackend`) in `p2p.backend()` and in a small HUD chip; the gates
  fail if they asked for WebGPU and got WebGL2 (the silent fallback, spike gotcha 1).
- **Direct `renderer.render(scene, camera)`, no RenderPipeline in the prototype.** Every material carries its own
  `toneMapped` flag, applied inline (spike test 1: exact 255,0,0). Physics colors (rays, photons, spot points,
  charge) use unlit node materials with `toneMapped: false`; lit materials (glass, metal, silicon) are tone-mapped
  (AgX or ACES, the art director picks). This keeps depth and transmission correct between glass and rays. GTAO and
  any bloom wait for the build phase (two-pass composite pattern from spike test 3, antialias off for the AO prepass).
- Transmission glass is WebGPU-tier only. The WebGL2 tier uses a cheap glass (Fresnel rim + environment reflection,
  no transmission pass) because transmission costs ~42 ms per frame there (spike c).
- Lines: `LineSegments2` + `Line2NodeMaterial` (fat, per-vertex color) for ray fans; thin `LineSegments` for dense
  bundles. Points/sparks: instanced sprites; GPU compute only where counts need it (spike a pattern).
- Row order of `readRenderTargetPixelsAsync` differs by backend (spike gotcha 2); call `camera.updateMatrixWorld(true)`
  before any `project()` (gotcha 3). Import only from `three/webgpu`, `three/tsl`, `three/addons/*` (gotcha 7).

## Code layout

```
src/engine/            the physics (pure TS, tested); src/engine/data.ts wires data/*.json; camera.ts compute(); render.ts
src/app/store.ts       scenario state + subscribe; URL query <-> scenario (lens, fno, focus, shutter, iso, format, piece)
src/app/stage.ts       renderer init + backend detection, resize, loop (pauses off screen), quality tier, PMREM env,
                       camera rig with the dive (log dolly), label/pin overlay projection, the scale badge
src/app/look.ts        materials and tokens from design/LOOK.md (glass, edge black, anodized barrel, iris steel,
                       silicon, CFA dyes, microlens, well glass, charge), the one wavelengthColor() from the engine
src/app/ui.ts          the control panel (lens picker, f-stop, focus, shutter, ISO, format), set-piece tabs, readouts
                       with evidence chips, the final-image panel, the loupe breadcrumb
src/app/hooks.ts       window.p2p: set(partial scenario), piece(id), settle(), backend(), gpuIdle(), model(), probe.*
src/pieces/lens.ts     set piece 2
src/pieces/cone.ts     set piece 3
src/pieces/loupe.ts    set piece 9
tools/shot.mjs         GPU screenshots, desktop 1600x900 and phone 390x844, per piece and setting (channel chrome)
tools/accuracy.mjs     the visual accuracy gate (below)
tools/vt.mjs           frame-exact recorder (virtual clock) for the screen recordings
```

A piece module exports `build(ctx) -> { group, update(model, scenario), frame(camera rig), probes, dispose() }` where
`ctx` carries the renderer, the look (materials), the stage's label layer and the badge. Pieces never compute
physics themselves: they read the engine's model and trace results. If a piece needs a number the engine lacks, it
adds it to the engine with a test.

## The three set pieces (engine calls in brackets)

**2. Lens cutaway.** The real element stack of the chosen lens (`loadLens`, `systemAt` at the focus distance) as
lathed glass: each element from its two surface sags (`sag`) out to its clear semi-diameter, a 270 degree lathe with
the cut faces capped by the element's real cross-section so the profile reads, edge blackening at each rim, a
procedural anodized barrel and spacers cut away on the same wedge, the sensor at the image plane. The iris at the
stop (`bladeShapes`, `stopRadiusFor(fno)`), closing as the f-stop turns (physically timed per LOOK.md motion rules).
Ray fans for 16 wavelength bins (`fan`, `wavelengthColor`) from an on-axis and an off-axis field point, traced surface
by surface; marginal rays clip against the real blades and the element clear apertures. Dispersion inside the glass
is tiny at true scale, so a detail inset near the image plane shows the colors separating with a scale badge
("x200"), rather than exaggerating the rays themselves.

**3. Cone of focus and bokeh.** One object point's bundle (`spot` sampling through the real lens, thousands of rays)
from the exit pupil to the sensor, drawn as a translucent cone surface built from the bundle's edge rays plus a few
spectral rays. The sensor plane with its pixel grid to scale (pitch from data/sensors.json) and the bokeh disk as the
landing-point density of the traced rays, shaped by the blades, going cat's-eye toward the frame edge (vignetting by
the element clear apertures). The predicted blur circle (`blurDiameter`, pupil-corrected) and the CoC assumption
(`cocFor`) are drawn to scale against the pixels. One slider moves the point's distance so the disk grows from a
point; another moves it across the field.

**9. The loupe.** The final-image panel shows `render()` of the synthetic scene for the current settings (seeded; a
worker if it is slow). Tapping a pixel dives (log dolly, LOOK.md durations) from the photo into the sensor at that
pixel: neighbors dimmed, the target pixel in full detail: microlens (plano-convex bump), CFA dye, photodiode, and the
glass well whose fill height and brightness are `electrons / fullWell` from the pixel's `PixelState`. Photon sparks
arrive at a badged scale. The ray bundle that fed that pixel is traced from the matching object point through the
lens. A breadcrumb inset of the photo with the pixel marked; the reverse dive returns along the same path.

## Visual accuracy gate (tools/accuracy.mjs)

Runs the built site in system Chrome (WebGPU asserted), sets scenarios through `p2p`, reads rendered pixels and GPU
buffers, and compares with the engine. Prototype checks:
- lens: the projected screen positions of drawn ray vertices at each surface equal the engine's `traceRay` points
  (max error < 1 px); marginal-ray clipping at the iris matches the engine's status per ray.
- lens: an exact-sRGB check: a known wavelength's ray pixel equals `wavelengthColor(nm)` (no tone-map bleaching).
- cone: the rendered bokeh disk's measured diameter on the sensor (from the rendered frame, in pixels of the
  sensor grid) matches the engine's traced spot diameter within 3%, and the thin/thick-lens predicted blur
  diameter within the stated model difference; the disk's polygon order equals the blade count.
- loupe: the rendered well fill height equals electrons/fullWell within 1%; the final image's noise standard
  deviation over a flat patch matches the engine's predicted sigma (shot + read, in DN) within 5% (statistical
  tolerance set from the patch size).
Every check prints PASS/FAIL with the numbers; the commit message carries the summary.
