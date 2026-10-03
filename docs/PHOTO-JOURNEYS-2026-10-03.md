# Real-photo journeys — 2026-10-03

Each of the six supplied photographs now has a **Play this photo** action. The existing Play the shot dialog also offers a Source selector with those photos and the original bird simulation.

The real-photo journey starts with the whole photograph, follows illustrative reflected-light paths through the associated representative lens, explains the recorded exposure interval, shows generic charge collection and sensor readout, and returns to the supplied JPEG. A luminous reveal and an editorial detail crop lead into an unobstructed final hold. Each photo ends with a specific lesson about focus, background separation or foreground blur. Portrait and landscape images retain their proportions.

**View photo** opens a larger, aspect-preserving image with its title and credit. It pauses the journey and returns to the same timeline position. Close/Escape restores keyboard focus. The Source and Follow controls permit comparison without changing the workspace. **Explore lens model** explicitly applies recorded settings; a note explains that the workspace can adapt values to model limits.

## Evidence boundary

The catalog contains lens mappings, aperture, shutter time, ISO and coarse recorded focus distance. It does not identify the original sensor, light level, subject speed, RAW samples or processing recipe. The player therefore shows recorded metadata separately from representative optical calculations and generic sensor illustrations. It does not fabricate RAW buffers from the JPEG, animate subject movement, claim measured electron counts, or simulate an edit to the supplied photograph. ISO 64 and f/5.6 remain visible as recorded even when the engine's supported values differ.

Photo detail anchors were selected by visually inspecting the supplied images. They are editorial crop locations, not autofocus points or a recovered depth map. In the final hold the crop disappears, preserving the sheep scenes' foreground/background context and the portrait squirrel's full composition.

## Review and validation

Independent reviewers examined physics/provenance, subject framing, caption length, phone readability and interaction state. Their feedback shortened captions, distinguished a fixed photograph from an actually stationary subject, changed camera-original wording to supplied JPEG, retained whole compositions and added the larger photo viewer. The final experience review used current screenshots and source; browser interaction coverage came from the automated harness.

The new browser gate exercises all six photographs at desktop and two phone widths, checks the final drawn image against a direct draw of the same JPEG, verifies source switching, loading failures/retry, close cancellation, source/timeline retention, enlargement, accessibility and full playback. The existing simulation player gate remains a regression requirement. Unit tests distinguish recorded metadata from model defaults.

Release results: 1,206 unit tests passed (4 skipped, 60 files), typecheck and production build passed. Both player browser gates passed, including all six photos at 1366/390/320-pixel widths and complete real-photo playback across all six chapters. Final JPEG comparisons differed by at most one raster channel level. Delayed loads, error/retry, keyboard focus, reduced motion, phone reflow and accessibility checks passed with zero GPU/runtime errors. Final independent visual reviews approved the desktop finales and 320px portrait enlargement.
