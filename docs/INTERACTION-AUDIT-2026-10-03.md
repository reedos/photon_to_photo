# Interaction and visual audit — 2026-10-03

Independent usability, physics and visual reviewers examined the camera, optics, focus, pixel inspection and shot-player flows. Implementation and browser checks were coordinated so concurrent GPU tests did not obscure failures.

## Controls and visual processes

The Camera exposure strip permanently exposes Fire shutter, focus distance and aperture. The two native ranges share the calibrated mappings used by the existing controls, support touch and keyboard input, and show their current values. Reset view sits beside Previous/Overview/Next. Exterior overview labels no longer expire after a first-visit timer. They yield to numbered pins and pause during cutaway, inspection and playback, where the control strip remains available.

Play the shot adds a Follow selector: All processes, Light, Charge and Image data. Each process has a distinct color and timeline range. Selecting a process pauses at its beginning; completion holds its last chapter. Selecting a chapter outside that process returns to the complete journey. This does not change the workspace scenario until Explore these settings is pressed.

The visual sequence connects reflected light, traced lens paths, exposure timing, photodiode charge collection, native raw codes and actual processing buffers. Dim full paths and bright moving traces make direction legible. The optics and focus workspaces also gain a soft halo around their existing traced-light playback.

## Reproduced problems and corrections

- A resized inset could leave an invalid GPU clipping rectangle while HTML pins continued moving. Main/inset rendering now restores complete viewport/scissor state and reconciles canvas size with current layout before drawing.
- Drawing and settling now share the renderer's animation loop; actual canvas resizing occurs once at frame start, with an equality guard. The camera compiles through the normal rendering path rather than overlapping speculative shader warmup with body/view switches.
- Chrome measurements now precede fitting, rendering and pin projection. Cold selected links and opened part cards invalidate the measurements immediately. Reduced-motion jumps update camera orientation in the same frame; Reset measures before fitting, and teaching labels respond to projection changes. This corrects a phone-only jump between the initial selected view and Reset.
- Longer stress tests isolated destroyed textures to viewport-transmission samplers in both the camera and Pixel views. The camera sensor cover/electronic-viewfinder glass and the target pixel's microlens/filter now use stable alpha materials in their illustrations. Tint and highlights remain legible, matching the existing treatment of neighboring pixel domes and well walls. The underlying lens tracing and photo simulation are unchanged. Both normal- and reduced-motion Pixel recovery gates pass with zero GPU errors.
- A loading failure from an inactive piece could cover the current piece and leave stale error styling. Loading, errors and pins now derive from the active piece, with retry/success resetting the veil.
- Rapid body/lens changes could complete out of order, including A → B → A. Generation checks reject obsolete successes and failures. Failed asset promises are evicted so later attempts can retry.
- Late inactive camera work could change inspection styling or leave its pupil/scale labels over another piece. These updates now respect piece visibility and clean up on exit.
- Pixel inspection could reuse a saved render ID or accept data from an older camera configuration. It now requires a matching scenario, rebinds/clamps saved coordinates, rejects obsolete queries and waits for valid data before diving. Loading and retry states are visible; Back/manual navigation cancels pending automatic dives.
- The prior photo remained clickable during a new render. Inspection now waits for the current photo, with an accessible updating/retry hint.
- Slider changes could queue many obsolete CPU renders. The client retains one active render and only the latest waiting request. Pixel queries no longer accidentally cause completed renders to be evicted from the worker cache.
- Electronic captures on a DSLR body incorrectly played the mechanical curtain sequence. Playback now honors the shutter mode and selected sensor scan duration, with separate reset/read fronts and the live-view mirror/curtains held clear.

## Scientific limits

Travel speeds, schematic routes and packet counts are illustrative. Light packets and charge markers have separate weights. The charge cutaway shows a green-filter 18% gray reference; its accumulated count is distinguished from the full-exposure total. The raw mosaic display is brightened fourfold for visibility without changing its native codes or the final photo. Processing wipes reveal real buffers, but do not represent processor timing. The final photograph retains the existing renderer's approximations, including no rolling-shutter skew.

## Regression coverage

Focused unit tests cover render coalescing, worker recovery/retention, pixel lifecycle, process endpoints and calibrated controls. Browser gates capture console GPU errors as well as JavaScript exceptions. They exercise rapid body/view switching, selected-part framing, resize/insets, pixel loading/recovery, persistent controls, reduced motion, phone layouts and deterministic shot playback.

Release validation: 1,200 unit tests passed (4 skipped across 59 files), typecheck and production build passed. Browser gates passed for the shot player, Pixel lifecycle in normal/reduced motion, selected-part tracking, animations, learning, navigation, workspace, compatibility, stage lifecycle, and crash/retry/reference-page audit. Navigation passed at 1440/1366/390/320 pixels; workspace passed at six widths from 1440 to 320. The camera stress matrix covered seven lenses, three views and three widths, with zero GPU errors.

The lens, focus-cone and Pixel visual accuracy gates passed on the integrated build, including WebGL2 fallback. Ray vertices matched engine traces exactly; drawn well-fill fraction matched the electron/full-well ratio exactly. Blur and noise checks passed their documented tolerances. The optional directional brightness comparison was skipped because the two sampled pixels' charge difference was too small for that check; both fills were visibly distinct from the background. Automated checks do not replace physical-device or human screen-reader review.

## Final review round

A fresh first-use reviewer walked through the default camera, keyboard aperture adjustment, Cutaway, mobile firing and the background-blur comparison experiment. A visual director inspected desktop and 390/320-pixel player layouts, scrubbing and charge playback. A separate educator review checked causal claims against the implemented model.

Their findings prompted a larger desktop animation column with explanations beside it, short timed causal captions, optional model notes that pause playback, named mobile chapter controls, essential phone diagram labels, a representative photon-arrival/conversion/charge-collection beat and a gradual feather-detail reveal. The slower capture's 16× exposure and 1/16 ISO tradeoff is explicit in its model note. Charge is labeled as expected electrons. The bird example is identified separately from firing the current workspace camera.

No material usability, visual-layout or physics blocker remained in those reviews. The strongest next opportunities are a larger mobile photo preview, more visible practical experiments, a direct fast/slow comparison at the final reveal, and continuous visual handoffs between scales. Reviewers considered the current result a clear, attractive educational animation; matching the Optics chapter's spectacle everywhere remains a design direction, not a claim of this release.
