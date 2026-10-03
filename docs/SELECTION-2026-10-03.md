# Selected-part framing and level colors — 2026-10-03

The selected part now owns the guided camera target throughout navigation. The fixes address these reproduced paths:

- Cold-loading a shared part link could fit an empty model box, producing non-finite camera coordinates that broke every subsequent view. Empty bounds now use the provisional rig framing until the model arrives, and the stage rejects non-finite targets.

- Outside/Cutaway previously flew to the whole camera while retaining a selected part. It now frames that part.
- Desktop Optics, Focus and Pixel selections previously changed the card without moving the view. Every probe now gets a stable frame derived from the level overview and its real geometry anchor.
- Successive phone selections previously computed their next frame from an unfinished animation, accumulating offsets and zoom. Desktop and phone now share deterministic framing.
- A late lens housing, changed shot, resized view or moved traced point could replace a selected frame with an overview. The stage reapplies the current selected target to those updates.
- Orbit damping could compete with a guided flight. A selection clears leftover damping; manual orbit, pan or zoom interrupts a flight and preserves the reader's control until the next guided selection.
- Reset retains the selected part. Overview returns to the whole view even when the state was already Overview. Returning from a pixel inspection to its photo clears the obsolete pixel-part selection.
- Inactive pieces cannot move the active camera. Rapid transitions are clamped at zero elapsed time, and target vectors are copied when a flight begins.

Camera uses amber, Optics cyan, Focus violet and Pixel mint, from the Intelligence Factory palette. Each level's accent follows its tab, HUD, selected pin, card and controls. Labels, outlines and pressed states remain available independently of color. Evidence chips, wavelength colors and sensor filters retain their meanings.

`tools/test-selection.mjs` checks actual positions and orbit targets with animation enabled at desktop and phone sizes. It exercises rapid selections, manual takeover, body/lens swaps, every deep-view part, reset, resize, traced-point changes, inactive loupe callbacks, level colors and automated accessibility. Existing navigation and optical gates cover the surrounding experience. Physical-device testing remains separate from browser viewport emulation.
