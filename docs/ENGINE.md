# The physics engine

`src/engine/` is a typed, pure TypeScript library with no Three.js and no DOM. Views read it; it never reads views.
Shared types live in `src/engine/types.ts` and `src/engine/lens-types.ts` (the lead owns both). Every module ships
with Vitest tests next to it (`*.test.ts`), including golden tests against closed-form results.

Conventions: see the header of `types.ts` (mm, nm, s, radians; z is the optical axis, light travels +z). Keep hot
loops allocation-free and data flat (Float32Array/Float64Array) so the same math can be ported to WGSL/TSL compute
and checked against the CPU version, which stays the reference.

## Modules

Workstream E1a, optics tracing (`engine/optics-trace`):
- `spectrum.ts`: Fraunhofer lines (d 587.5618, F 486.1327, C 656.2725, e 546.0740, g 435.8343, F' 479.9914,
  C' 643.8469 nm); `bins(n, lo, hi)` returning `Bins`, with `BINS16` and `BINS24` (proposal in data/color when it
  lands); `wavelengthColor(nm)` returning linear and encoded sRGB for drawing light (a stub fitted to the CIE 1931
  CMFs until data/color lands, e.g. the Wyman-Sloan-Shirley 2013 multi-lobe fit, cited).
- `surface.ts`: `sag(s, h)`, `normalAt(s, x, y)`, `intersect(s, ray) -> t | null` (sphere in closed form, conic and
  even asphere by Newton iteration from the sphere guess), `refract(d, n, n1, n2) -> Vec3 | null` (vector Snell,
  null on TIR), `reflect(d, n)`.
- `trace.ts`: `traceRay(sys, ray, opts?) -> RayPath` (sequential; vignettes at each surface's sd, applies
  `sys.iris` at the stop, stops at the image surface); `aimRay(sys, ep, field, px, py, nm)` building a ray from an
  object point (finite distance) or field angle (infinity) through normalized pupil coordinates (px, py) on the
  paraxial entrance pupil, with optional real-ray aiming so the chief ray crosses the stop center;
  `fan(sys, ep, field, n, nms, axis)` for the meridional ray fans the cutaway draws; `spot(sys, ep, field, grid,
  nms) -> landing points + weights + stats (centroid, rms radius, geometric radius)`, pupil sampling for bokeh and
  PSF work (square grid, hexapolar and Fibonacci patterns). Ghost paths (two reflections) come later.

Workstream E1b, lens systems (`engine/lens-systems`):
- `glass.ts`: `indexAt(entry, nm)` (Sellmeier and any other formula data/glass carries), `catalog()` loading
  data/glass/catalog.json, `resolveGlass(nd, vd) -> { entry, dnd, dvd }` (nearest by a normalized nd/vd distance),
  `abbe(entry)`, `partialDispersion(entry)`.
- `paraxial.ts`: y-nu trace at a wavelength on a `TraceSystem`: `cardinal(sys, nm, stopRadius?) -> Cardinal`,
  `imageOf(sys, nm, objectZ) -> image z and magnification`, Petzval sum.
- `lens.ts`: `loadLens(design) -> ResolvedLens` (applies `scale`, resolves glasses, lists elements and cemented
  groups with their bounding surfaces, keeps the evidence), `systemAt(lens, focusFromSensorMm | null) -> TraceSystem`
  for the focus method the design declares (variable gaps interpolated by the paraxial solve that puts the object's
  image on the fixed sensor plane; unit focus moves the whole lens forward), `sensorZ(lens)`.
- `iris.ts`: `stopRadiusFor(lens, fno)` (the stop radius that gives that infinity f-number, from the paraxial pupil
  magnification), `irisOutline(blades, radius, rounded, rotation, segments) -> Vec2[]`, `irisTest(...)` for
  `TraceSystem.iris`, and `bladeShapes(...)` for drawing each blade (schematic pivot geometry, labeled as such).
- `lenses.test.ts`: for every data/lenses/*.json: EFL within 0.5% and BFD within 1% (or 0.2 mm) of the patent's
  stated values, the paraxial f-number at the max stop matches the stated Fno, every non-air medium resolves to a
  catalog glass (report the match distance), and the element and group counts match the file.

Workstream E2, closed-form optics and exposure (`engine/closed-form`):
- `formats.ts`: FF 36 x 24, APS-C 23.5 x 15.6 (and Canon's 22.3 x 14.9 as a variant), MFT 17.3 x 13, with sources;
  crop factor; `fov(f, dim, imageDistance?)` including focus breathing; equivalence (focal length, f-number for the
  same depth of field and total light), stated as the physics, not a marketing claim.
- `thinlens.ts`: thin-lens equation, magnification, thick-lens versions using principal planes and pupil
  magnification.
- `dof.ts`: `cocFor(format, divisor = 1500)` labeled assumed with the convention cited; `hyperfocal`, `dofLimits`,
  `blurDiameter(f, N, focus, point, pupilMag)` (the image-side blur disk of an out-of-focus point, thin lens and
  pupil-corrected), golden tables against published DOF calculators' formulas.
- `diffraction.ts`: Bessel J1 (cited approximation, error bound tested), `airyIntensity(r, nm, N)`,
  `airyRadius(nm, N) = 1.22 nm N` (first zero, image space, working f-number), `psfOnPixels(pitch, N, bins, weights,
  offset, fill)`, `mtfDiffraction(nu, N, nm)`, and the f-number where diffraction starts to cost resolution for a
  pitch, with the criterion named.
- `exposure.ts`: EV and EV100, reciprocity, the reflected-light meter constant K (ISO 2720), the camera equation for
  image-plane irradiance with cos^4 and working f-number N(1 + |m| / pupilMag), photon flux per pixel per bin
  (E = hc / lambda, CODATA constants), T-stop from transmission, motion blur length in pixels, rolling-shutter
  skew from readout time.

Workstream E3, sensor, pipeline and scene (`engine/sensor`):
- `rng.ts`: seeded PCG32 with `next`, `normal` (Box-Muller or ziggurat), `poisson` (Knuth below mean 10, PTRS
  above — matching NumPy's legacy Poisson crossover, see rng.ts/docs/engine/e3.md), tested by moments and a
  chi-square.
- `sensor.ts`: sensor models from data/sensors.json (evidence carried); photons -> electrons (QE by channel and
  wavelength, fill factor, Poisson), dark current, PRNU, full-well clipping, read noise by ISO and conversion-gain
  mode, analog gain from ISO (ISO 12232 definitions, unity-gain ISO), ADC quantization and black level, `PixelState`
  for one pixel; analytic mean/variance, SNR, engineering and photographic dynamic range.
- `color.ts`: camera RGB from spectra (QE curves), CIE XYZ from spectra, XYZ <-> linear sRGB, sRGB encode, a
  camera-to-XYZ matrix fitted on the ColorChecker (documented), white balance gains from an illuminant.
- `pipeline.ts`: each stage separately so set piece 8 can scrub: black level, demosaic (bilinear and
  Malvar-He-Cutler), white balance, color matrix, tone curve, encode; simple noise reduction and sharpening.
- `scene.ts`: synthetic scenes only: objects at real distances with spectral reflectances (ColorChecker patches, a
  Siemens star, point highlights for bokeh, a subject), illuminant by CCT and lux; `radiance(scene, ray) -> spectral
  radiance per bin and depth`.

Workstream E4 (after E1-E3 merge): `camera.ts` (`compute(scenario) -> Model`, pure and memoized, every figure a
`Fig`) and `render.ts` (the CPU reference renderer of the final image, per pixel: scene radiance, blur by defocus
with the iris shape, diffraction, motion, photons, sensor, pipeline; low resolution, seeded, the truth the GPU
renderer and the visual accuracy gate check against).
