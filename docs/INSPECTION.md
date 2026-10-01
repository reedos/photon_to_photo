# Camera inspections and playback

Local buildout, 10/1/2026. The camera is the parent view; Optics, Focus, and Pixel inspect the same shot in the existing renderer pieces. Their breadcrumb returns to the relevant camera part. Camera in the navigation strip opens the overview.

The URL keeps `piece=camera|lens|cone|loupe` for existing links and automation. Optional `part=lens|focusRing|iris|glass|mount|sensor|shutter|viewfinder` preserves camera context. Legacy inspection links without a part return to glass, focus ring, or sensor respectively. Invalid parts are ignored. Changing views does not change the scenario or request another final-image render.

Fire creates a replayable exposure. Pause and the native timeline slider freeze the mechanisms, photons, counters, and well at one playhead position. Scrubbing always pauses; Resume continues there. Leaving the camera pauses playback. A changed scenario cancels the previous shot. Reduced motion starts a shot paused, with explicit Resume. The elapsed readout is the center row's exposure time; the timeline includes the separate mechanism phases and their labeled time factors.

The focus distance slider now covers closest focus to a lens-dependent finite distance, followed by a separate infinity position. Its spacing and finite upper bound are UI choices, not an optical definition of infinity.

The field scene uses deterministic, assumed generic bird and bark markings with spectral pigment stand-ins. The materials still pass through the sensor pipeline. The billboards, scene distances, and glint light spectra are retained. Silhouette antialiasing remains limited by the renderer's spatial sampling.

Validation:

```powershell
npm test
npx tsc --noEmit -p .
node tools/test-perf.mjs
$env:P2P_PREVIEW_PORT='47594'
node tools/test-inspection.mjs
```

`tools/test-inspection.mjs` requires system Chrome and real WebGPU. It checks desktop and phone navigation, shared links after reload, return to camera parts, finite telephoto focus adjustment, and horizontal overflow. Set `P2P_URL` to reuse an existing preview. The three gates under `tools/accuracy/` continue to check the rendered optics against the engine.
