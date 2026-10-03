# Play the shot — 2026-10-03

A dedicated, lazy-loaded player follows one bird capture through six chapters: glide, finite-distance optical paths, exposure, reference-pixel charge, readout and the actual raw-to-sRGB buffers. Open **Play the shot** on the Camera view or in the View menu.

## Interaction

The player owns a frozen, normalized scenario and an isolated worker. It never changes the selected part, camera framing, URL or shot controls during playback. **Explore these settings** explicitly applies the selected capture. Close and Escape preserve the existing workspace. Existing exposure/tour playback pauses on entry.

Play/Pause, Restart, chapter buttons, keyboard-accessible scrubbing and half/normal/double speed share one deterministic timeline. Reduced-motion users start paused. Hidden tabs pause. Seeking while the worker is loading cancels pending autoplay. Completion holds the final image. Worker errors expose Retry; closing terminates pending work. Fast and slow renders are cached independently for the lifetime of the player.

Desktop and phone layouts keep primary controls visible. Essential numbers appear in HTML cards; small screens omit canvas annotations. Keyboard focus returns to the launcher or the visible View menu summary.

## Physics and image provenance

Both captures use the same authored, fixed-size 900 × 650 mm bird billboard at 20 m, translating laterally at 6 m/s, a nominal 500 mm lens and the D850 sensor model. The model enforces the realized lens's maximum opening (about f/5.75). Illumination is fixed at 10,000 lux and 5500 K.

- Fast: 1/2000 s, ISO 1600, 3 mm subject displacement.
- Slow: 1/125 s, ISO 100, 48 mm displacement.
- Exposure duration, photon budget and physical sensor blur differ by exactly 16×. ISO compensates nominal display brightness; it does not create photons.
- Both results use 600 × 400 output, seed 1, sixteen midpoint temporal samples and the existing physical rendering pipeline.
- Optics draws finite 20 m ray bundles through the realized lens. Surface silhouettes, packet travel and playback times are illustrative.
- Charge represents the expected response of an on-axis 18% gray, green-filter reference pixel, not a measurement of the bird. Full-well clipping is explicit.
- Readout uses the selected sensor's scan duration and a sparse sample of the actual raw buffer. Its row timing is schematic. The final photo does not model rolling-shutter skew.
- Bayer display is false-colored after black-level subtraction. Intermediate buffers are shown before final display encoding; the final photograph is the actual sRGB output. The feather inset magnifies that same output.

The bird is an illustrated rigid glide, not a measured species or aerodynamic/flapping simulation. The hero uses its shared geometry/pigment regions and a background strip from the same render. The underlying renderer's pinhole scene projection, midpoint-depth motion blur and bounded defocus kernels retain their documented approximations.

## Review and validation

Independent read-only reviewers examined usability, physics and visual appeal during implementation. Their findings led to finite-distance bundles, fixed subject dimensions, readable phone measurements, improved feather geometry, real raw samples, focus restoration, loading-time seek handling and quieter screen-reader announcements.

`tools/test-shot-player.mjs` exercises loading cancellation, deterministic backward scrubbing, distinct fast/slow photographs, all chapter boundaries, playback completion/pause, keyboard Home/End, 1366/390/320 layouts, accessibility, settings/selection isolation, menu focus, reduced motion and explicit application of a capture.

The renderer now precomputes spectral irradiance and sixteen shifted scenes per render. Sampling times and arithmetic order are unchanged. Regression checks compare cached and uncached samples across shutters/illuminants and check highlights/misses. A separate before/after comparison found exact equality in seeded raw, RGBA and all intermediate buffers for both presets at 60 × 40. No global cache can leak illumination between shots.

Release validation: 1,182 unit tests passed (four existing skips), typecheck/build passed, standalone render timing budget passed, player gate passed at 1366/390/320, animated selection gate passed at 1366/390, and the loupe optical/noise gate passed on WebGPU plus WebGL2 fallback. Full playback visited all six chapters and completed at double speed in 14.15 seconds. Reviewers cleared all material source/static-visual findings; physical-device and human screen-reader testing remain separate.
