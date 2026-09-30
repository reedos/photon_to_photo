# Photon to Photo: plan

_Lead, 09/28/2026. Working name; the brief is docs/BRIEF.md._

A reader picks a lens, a body and settings, then follows light from a synthetic scene through every glass element
and the iris onto the sensor, into one pixel's well and out through the pipeline to the finished photo. Every ray,
spot, photon and well level on screen is computed by the engine in `src/engine` for the current settings. The site
keeps The Intelligence Factory's look (Reed, 09/28): the same components, type and amber accent.

## The camera itself (Reed, 09/28/2026)

The primary purpose is high-resolution, accurate visuals of the actual camera, lens and sensor. The prototype's
lead set piece is **The camera**. It's a high-detail lens exterior on a body. You work it directly on the model:
- a focus ring with an engraved distance scale that follows the lens's real focus travel;
- aperture, shutter and ISO controls on the body and lens;
- a cutaway that opens to the glass stack;
- light entering the front element, thinning as you stop down;
- the sensor assembly (filter stack, shutter, sensor) at its true distance from the lens.

There are **two generic, unbranded full-frame bodies, a mirrorless one and a DSLR**, exact where the physics depends
on it: the sensor sits at each lens's own image plane. On the DSLR, add the mirror box, the mirror and sub-mirror,
and the pentaprism.

**Each body gets its own lens designs** (Reed, 09/28/2026): three primes per body, a standard wide, a normal and a
500 mm telephoto. Each body uses a generic mount, with no adapters. A note on the page says that real makers use
different mount designs, with their own flange distances and throats (data/hardware/mounts.json).

| Body | Wide | Normal | Telephoto |
|---|---|---|---|
| DSLR (SLR designs, Reed's own kit) | s35: Sigma 35mm F1.4 DG HSM Art (being sourced) | n50: Nikon AF-S 50mm f/1.8G (being sourced) | p500: 500 mm f/4, Canon US 6,115,188 |
| Mirrorless (Nikon Z8 sensor, Z mount geometry) | z35: NIKKOR Z 35mm f/1.8 S (being sourced) | m50: NIKKOR Z 50mm f/1.8 S (being sourced) | m500: a NIKKOR Z telephoto without diffractive elements, nearest to 500 mm (Nikon has no Z 500 prime; being sourced) |

Telephotos (Reed, 09/28/2026): the DSLR carries two 500 mm lenses on the same mount, Reed's AF-S 500mm f/5.6E PF ED
VR (Phase Fresnel) and the conventional AF-S 500mm f/4E FL ED VR, to show what a diffractive element does to length
and weight. The mirrorless telephoto is the NIKKOR Z 600mm f/6.3 VR S (PF). The engine is gaining diffractive
surfaces for them (branch engine/doe).
Both bodies are Nikon in everything but their look (Reed, 09/28/2026): D850 and Z8 sensors, F and Z mount geometry.
The pair shows a mirror and a mechanical shutter against a stacked sensor with an electronic shutter only.

The DSLR is Reed's own camera in everything but its look: it has the Nikon D850's sensor (data/d850.json,
Claff's measurements) and Nikon F mount geometry. The body itself stays generic and unbranded.
The other transcribed designs stay in data/lenses (tested) but are out of the lineup for now. Data:
data/hardware/*.json (research/mounts.md, exteriors.md, dslr.md).

## Levels

| # | Level | Scale | Set pieces it hosts |
|---|---|---|---|
| 1 | Scene and light | meters | 1 photon rain, 10 focal length sweep and dolly zoom |
| 2 | The lens | centimeters | 2 lens cutaway with spectral rays and the iris, 5 ghosts and coatings |
| 3 | Image circle and focal plane | millimeters | 3 cone of focus and bokeh, 4 waves (Airy pattern on the pixel grid) |
| 4 | The sensor | micrometers | 6 into the pixel (microlens, color filter, photodiode, well, Poisson histogram) |
| 5 | Readout | micrometers to the whole array | 7 rolling-shutter scan, column ADC steps |
| 6 | Image pipeline and final image | pixels | 8 mosaic to photo, 9 the loupe (dives from a photo pixel down to level 4) |

Layers: rays, waves, charge and noise. The final-image panel stays on screen at every level.

## Engine modules (525 tests passing)

- **Optics:** `spectrum` (bins, wavelength colors), `surface` (sag, sequential intersection, Snell),
  `trace` (rays, fans, spots, real-ray aiming), `glass` (Sellmeier and polynomial formulas, model glasses),
  `paraxial` (cardinal points, pupils), `lens` (loading, focus), `iris` (stop radius, blade geometry), and
  `realize`. `realize` adds three things to a patent lens: an autofocus offset, clear apertures computed from real
  rays, and the closest focus the design can reach.
- **Closed forms:** `formats`, `thinlens`, `dof`, `diffraction` (Airy, pixel PSF, MTF) and `exposure` (EV, the
  camera equation, photons per pixel).
- **Sensor and image:** `rng` (seeded Poisson and normal draws), `sensor` (photons to electrons to DN, dual
  conversion gain, SNR and dynamic range), `color`, `pipeline` (demosaic, white balance, color matrix, tone curve)
  and `scene` (synthetic scenes only).
- **In progress:** `camera` (the model for any setting, every figure with an evidence label) and `render` (the CPU
  reference renderer the GPU renderer and the accuracy gate check against).

## Lens table

Every design is a public patent example. The agents transcribed them, and the engine reproduces each patent's
stated focal length within 0.02% and its back focus within tolerance. Glasses resolve to a catalog glass (1,613
glasses from refractiveindex.info, CC0), or to a model glass built from the patent's own nd and vd where no
catalog glass matches exactly.

| Class | Patent example | Design f, F | Elements / groups | Tied to a product (Photons to Photos) |
|---|---|---|---|---|
| 20 mm f/1.4 | JP 2019-117419 A, Ex. 1 (Sigma, 7/18/2019) | 20.69 mm F1.46 | 15 / 11 | Sigma 20mm F1.4 DG HSM \| Art |
| 24 mm f/1.4 | JP 2021-018277 A, Ex. 1 (Canon, 2/15/2021) | 24.00 mm F1.40 | 16 / 14 | none; representative |
| 28 mm f/1.8 | JP 2021-018277 A, Ex. 3 (Canon, 2/15/2021) | 28.00 mm F1.80 | 15 / 13 | none; representative |
| 35 mm f/1.4 | US 7,663,816 B2, Ex. 1 (Nikon, 2/16/2010) | 36.00 mm F1.45 | 10 / 6 | none; representative |
| 50 mm f/1.4 | JP 2015-114366 A, Ex. 1 (Sigma, 6/22/2015) | 49.58 mm F1.46 | 13 / 8 | Sigma 50mm F1.4 DG HSM \| Art |
| 85 mm f/1.4 | JP 2011-170128 A, Ex. 5 (Sigma, 9/1/2011) | 83.58 mm F1.46 | 11 / 8 | Sigma 85mm F1.4 EX DG HSM |
| 105 mm f/1.4 | WO 2019/116563 A1, Table 3 (Nikon, 6/20/2019) | 102.15 mm F1.45 | 14 / 9 | Nikon AF-S NIKKOR 105mm f/1.4E ED |
| 135 mm f/1.8 | WO 2019/187633 A1, Table 1 (Sony, 10/3/2019) | 130.95 mm F1.85 | 13 / 10 | Sony FE 135mm F1.8 GM |
| 200 mm f/2 | US 5,490,014, Emb. 1 (Nikon, 2/6/1996) | 195.00 mm F2.0 | 12 / 9 | none; representative |
| 300 mm f/2.8 | US 6,115,188, Ex. 1 (Canon, 9/5/2000) | 293.58 mm F2.9 | 15 / 11 | none; representative |
| 400 mm f/2.8 | US 6,115,188, Ex. 7 (Canon, 9/5/2000) | 392.63 mm F2.9 | 15 / 12 | none; representative |
| 500 mm f/4 | US 6,115,188, Ex. 10 (Canon, 9/5/2000) | 490.93 mm F4.1 | 14 / 11 | none; representative |

Full sources, URLs and transcription notes are in research/lenses-*.md. Minimum focus and blade counts are the
maker's spec where a product is tied, and assumed from a same-class lens otherwise.

## Rendering, and the WebGPU fallback

- **Renderer:** Three.js 0.186.1 `WebGPURenderer` with TSL. It renders directly, so every physics color keeps its
  exact value; the spike checked this by reading pixels back. `?gl=webgl2` forces the fallback, and the page
  reports which backend it actually got.
- **What WebGL2 cannot carry, and the fallback for each:**
  - Compute shaders writing a storage texture (the final image) run instead as a fragment pass: same math,
    7 ms per frame.
  - Transmissive glass costs about 42 ms per frame on WebGL2, so that tier gets a Fresnel-and-reflection glass
    with no transmission pass.
  - GTAO needs a non-multisampled depth pass on WebGPU.
- **What carries over:** particles, ray lines, pixel readback and GPU timers all work on both backends.
- **Headless testing:** the gates and recordings use the installed Chrome (`channel: 'chrome'`). The Chromium
  that ships with Playwright can't create a WebGPU device on this PC, and Three.js then falls back to WebGL2
  without saying so.

## Risks

- **Clear apertures are modeled.** No patent lists them, so they come from real rays with an assumed corner
  pupil fraction (0.55). The cat's-eye shape of corner bokeh depends on that assumption, and the site labels it.
- **Patents are not products.** Seven designs are representative of their class, and five are tied to products
  only through Photons to Photos, which notes that production lenses can differ from their patents. The 300,
  400 and 500 mm patents give no focus gaps, so those lenses focus by unit extension (schematic).
- **The accuracy gate has to test rendered frames, not only numbers.** That needs readbacks that are
  row-order-safe (the order differs between backends) and a WebGPU run asserted in every gate.
- **Licenses:** the best camera color curves (Jiang et al. 2013) are CC BY-NC-SA, so the default is the
  unencumbered Gaussian model until you decide. The CIE data is CC BY-SA and needs attribution. sael.net asks for
  permission before anyone reuses its look.
- **Phones:** transmission and compute are heavy, and no phone GPU has been tested yet. The quality governor and
  a phone tier that keeps every set piece readable are part of the build.
- **Scope:** ten set pieces plus the tours is a large build. The prototype proves three of them before the rest
  is planned in detail.
