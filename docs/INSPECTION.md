# Camera inspections and playback

Local buildout, 10/1/2026. The camera is the parent view; Optics, Focus, and Pixel inspect the same shot in the existing renderer pieces. Their breadcrumb returns to the relevant camera part. Camera in the navigation strip opens the overview.

The URL keeps `piece=camera|lens|cone|loupe` for existing links and automation. Optional `part=lens|focusRing|iris|glass|mount|sensor|shutter|viewfinder` preserves camera context. Legacy inspection links without a part return to glass, focus ring, or sensor respectively. Invalid parts are ignored. Changing views does not change the scenario or request another final-image render.

Fire creates a replayable exposure. Pause and the native timeline slider freeze the mechanisms, photons, counters, and well at one playhead position. Scrubbing always pauses; Resume continues there. Leaving the camera pauses playback. A changed scenario cancels the previous shot. Reduced motion starts a shot paused, with explicit Resume. The elapsed readout is the center row's exposure time; the timeline includes the separate mechanism phases and their labeled time factors.

The focus distance slider now covers closest focus to a lens-dependent finite distance, followed by a separate infinity position. Its spacing and finite upper bound are UI choices, not an optical definition of infinity.

The field scene uses deterministic, assumed generic bird and bark markings with spectral pigment stand-ins. The materials still pass through the sensor pipeline. The billboards, scene distances, and glint light spectra are retained. At silhouette boundaries, four subpixel samples are accumulated with their own blur depths before readout. This applies with motion enabled too. Sub-grid features and the existing temporal/depth approximation for moving objects remain limited by sampling; these are illustrated billboards, not photorealistic geometry.

## Guided learning and comparisons

Learn opens eight stops from the scene to the finished photo. It starts paused, preserves the shot, and offers
Previous, Next, jump, Play/Pause, Restart and Close. Explicit Play advances every 14 seconds; interacting with
settings, navigating away from the guided stop, opening Compare, or hiding the browser pauses it. Closing returns
to the original view while retaining any deliberate setting changes. `?tour=1` opens the tour from the introduction.

Sensor readout and Image pipeline are also available beneath Controls and from the introduction using
`?lesson=readout|pipeline`. Lessons occupy the model view, preserve the sidebar, pause exposure playback, and make
covered canvas controls inert. Their close button restores keyboard focus. Inspection transitions respect reduced motion.

The readout diagram shows equal-duration row exposure windows with staggered starts. Eight rows and their direction
are schematic. Scan time is distinct from shutter duration. D850 full-frame silent Mode 1 uses the 64 ms value
directly checked against [Kasson's original measurement](https://blog.kasson.com/d850/how-fast-is-the-nikon-850-electronic-shutter/)
on 10/01/2026. The existing Z8 3.6 ms estimate is explicitly low confidence; other sensor picks use a labeled
illustrative 50 ms placeholder. The charge slider passes electrons through the engine's gain, black level, rounding
and ADC clipping; it displays zero sampled read noise and names the RMS noise separately. The existing pixel view
shows stochastic noise. The lesson does not add rolling-shutter distortion to the photo.

The pipeline uses the current render's `raw`, `demosaic`, `wb`, `ccm` and final RGBA buffers. The Bayer view removes
black level and tints one channel per RGGB site. Intermediate linear buffers are displayed directly, without an
unannounced second encoding. Final-stage bytes equal Your photo. A center crop exposes individual samples. Every
sample still represents a block of sensor pixels; the crop is not a full-resolution raw sensor capture.

Pin A copies a finished photo and its effective settings into page-session memory. B follows the current render;
stale renders cannot be pinned or shown as current. Compare opens a keyboard-trapped native dialog. Three experiments
create an A shot, wait for it to finish, then allow Apply B. They demonstrate background blur at equal nominal
exposure, shorter shutter versus ISO for motion, and longer exposure versus ISO at dusk. Manual changes cancel the
recipe explanation. Restore my shot restores all starting settings. Pins intentionally expire on page reload.

## Release checks

`tools/test-learning.mjs` verifies tour continuity, pipeline byte identity and layout, accessible slider names,
focus restoration, clamped focus, stale-render rejection, experimental pairing, restore and four viewport sizes.
`tools/test-accessibility.mjs` runs axe WCAG 2/2.1/2.2 A/AA checks on the workspace, both lessons, comparison,
phone pipeline and introduction. Its incomplete contrast checks require visual review; zero automated violations
is not a complete accessibility certification. `tools/test-compatibility.mjs` checks WebGL2, 4× main-thread CPU
throttling, overlay keyboard isolation, a CSS viewport equivalent to 200% laptop zoom, and close-focus field glints.

Physical validation is still pending: an iPhone in Safari, an Android phone in Chrome, an ordinary laptop outside
the development machine, and a screen reader. On each, follow the tour, use the row/charge sliders, pin/compare,
run an experiment, restore the shot, and return from an inspection. Record device/browser, any clipping, input or
focus failures, and whether changing settings stays responsive. Browser emulation does not count as those runs.

Validation:

```powershell
npm test
npx tsc --noEmit -p .
node tools/test-perf.mjs
$env:P2P_PREVIEW_PORT='47594'
node tools/test-inspection.mjs
```

`tools/test-inspection.mjs` requires system Chrome and real WebGPU. It checks desktop and phone navigation, shared links after reload, return to camera parts, finite telephoto focus adjustment, and horizontal overflow. Set `P2P_URL` to reuse an existing preview. The three gates under `tools/accuracy/` continue to check the rendered optics against the engine.
