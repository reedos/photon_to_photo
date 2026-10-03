# Traced light ribbons

Optics and Focus animate the existing computed paths with a tapered 22% trail,
a short bright head, and restrained halo. Each segment remains on its original
traced leg; no smoothing crosses a refracting surface. Wavelength determines
color. The six-second travel time and displayed brightness are presentation,
not propagation speed, interference, or radiometry.

At most 96 paths share four draws and two reusable geometry buffers. Playback
stops when its piece hides, a dialog opens, the canvas becomes inert, the page
hides, or the exposure pause event fires. Scrubbing is deterministic.

Validation:

- `vitest run src/pieces/light-ribbon.test.ts src/pieces/trace-playback.test.ts`
  checks segment clipping, refraction corners, endpoint preservation and scrubbing.
- `P2P_PREVIEW_PORT=47723 node tools/test-light-ribbons.mjs` checks the actual GPU
  geometry against original traced legs and endpoints in Optics and Focus at
  desktop and 390 px; it also measures update cost, playback pause and hiding.
- Before/after screenshots and measurements go to ignored `shots/light-ribbons/`.

The measured maximum geometry error was below 0.000002 mm (float-buffer packing).
The four rendered cases changed 752–2157 scene pixels and measured 0.10–0.40 ms
for the 95th-percentile ribbon update on the validation machine. These timings
describe that machine, not a performance guarantee for other devices.
