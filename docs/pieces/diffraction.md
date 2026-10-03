# Diffraction layer

Open **Waves & diffraction** from Optics or Focus. The layer uses the current
sensor pitch and working f-number; its aperture control updates the actual
scenario. Wavelength selects a monochromatic reference from 450–650 nm.

The 17 × 17 sensor-pixel field has a fixed physical size. The smooth mode samples
the engine's `airyIntensity`; the pixel mode uses `psfOnPixels` to integrate each
square pixel, with unit fill and the point centered on the central pixel. The
first-dark-ring marker uses `airyRadius` (the project's rounded 1.22 λN
convention). Neither mode includes aberrations, defocus or the blade polygon.

Brightness is peak-normalized and raised to the ¼ power to make faint rings
visible. Both the main caption and the model disclosure state this. This view
compares spatial spread, not throughput. The optional moving wavefront strip is
an explanatory schematic, not a numerical propagation or full-wave solution.
It is paused initially and pauses on dialog close, visibility loss or a change
to reduced-motion preference.

Validation:

- `vitest run src/pieces/diffraction-pattern.test.ts src/engine/diffraction.test.ts`
  checks physical radius, wavelength scaling, pixel energy and raster samples.
- `P2P_PREVIEW_PORT=47723 node tools/test-diffraction.mjs` checks actual screenshot
  minima against engine radii at desktop, 390 px and 320 px; it also verifies
  aperture keyboard control, fixed scale, pixel mode, no horizontal overflow,
  pause/close and both Optics/Focus entry points.
- Screenshots and measurements go to ignored `shots/diffraction/`.
