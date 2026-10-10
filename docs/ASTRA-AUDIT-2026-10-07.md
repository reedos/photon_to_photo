# Photon to Photo audit — 10/07/2026

Branch: `astra/ex-1`, based on `5e44c65`. Local preview: `127.0.0.1:49754`.

## Look list

Compared `intelligence_factory/src/styles.css`, live IF at desktop and 360 px, and this repository's existing `design/LOOK.md` approval. The shared accent is **#e6ba82**. IF's three-bar mark, evidence categories and approved level identifiers keep their distinct semantic colors; ray wavelengths and Bayer channels are physical encodings.

| Component | Finding and status |
|---|---|
| Top bar / three-bar mark | Mark geometry, widths and family colors already match IF. Fixed the brand link's 16 px hit area to 44 px. |
| Amber mono counters | Existing counters use the shared mono stack. Removed the stage-level accent override that made controls and selected part counters change color with the current level. |
| Condensed uppercase titles | Fixed workspace and studio overrides that replaced the level titles with small mixed-case Manrope. Study headings now inherit the display stack. |
| Segmented groups | Existing shared borders and selection structure retained. Study controls now use house amber and square corners. |
| Stat row | Existing numeric labels and tabular figures retained. Corrected aperture and shutter values rather than changing their layout. |
| Level strip | Four level names retain the approved IF-family semantic identifiers. Their colors no longer replace the page accent. |
| Outlined buttons | Replaced separate orange shutter/player accents and cyan/mint study-control accents. Removed rounded dialog/control chrome where it departed from IF. |
| Numbered pins | Existing 22 px visible circles have a 44 px pseudo-element hit area. Kept that geometry; selected pins now remain amber. |
| Part list | Existing numbered rows and compact inspector retained. Selected rows stay amber across inspections. |
| Evidence chips | Shared five-category colors retained. Fixed incorrect, missing and generic figure provenance as listed below. |
| Study dialogs | Diffraction, ghosts, perspective, photon rain and shot player use shared surface, border, title and control tokens. Scientific plot colors are retained. |

## Claim list

[Machine-readable inventory](audits/EX-1-claim-inventory.json) contains 42 scenarios (seven lineup lenses × infinity/3 m × f/2, f/8, f/16), every model figure and camera card for those scenarios, and all 4,076 string/template literals longer than two characters in app/piece/reference code. The deliberately inclusive literal list also contains selectors and markup. File/line locators and proof-family tags make hidden study copy and dynamic templates reviewable. Tags are a review index, **not** an automated truth score. Numerical scenarios are representative cases, not a claim to enumerate a continuous slider's every value.

The physical-source basis is the existing lens, sensor, glass, color and hardware ledgers, including their locators and stated assumptions. This audit does not newly certify every external webpage. Patents remain representative designs, not proof that every production lens uses that exact prescription. Recorded photographs retain their metadata and the distinction between supplied JPEGs and illustrative sensor experiments.

| Figure or causal claim family | Source / independent check | Status |
|---|---|---|
| Marked focal length, patent aperture, glass indices, Abbe numbers, element/group counts | `data/lenses/*.json` names patent URL/table; `lenses.test.ts`, `glass.test.ts`, `trace.test.ts` compare optical paths against analytic singlets and lensmaker results. | Fixed patent aperture card: previously displayed product f/1.8 while chip described patent f/1.86. Now explicitly shows prescription f/1.86. |
| Barrel dimensions, filter size, blade count and mount geometry | `data/hardware/lens-exteriors.json`, `data/hardware/mounts.json`, each lens's `iris.source`; hardware body ledgers. | Filter/blade sources now preserve exact records. Mount values are secondary **Reported** evidence; lugs and contacts have separate rows. Focus view blade count no longer cites a patent table that does not establish it. |
| EFL, pupils, aperture diameter/area, refraction, dispersion | `paraxial.test.ts`: thin/thick lensmaker and two-lens reference calculations, pupil imaging; `trace.test.ts`: independent Snell and thick-lens expectations; `doe.test.ts` for diffractive surfaces. | Added missing pupil-area calculation. Replaced the universal claim that front glass makes the opening larger with “can differ in size.” |
| Focus motion, near/far limits, CoC and magnification | `camera.test.ts`: ray-traced points at the DOF limits and independent similar-triangle blur; exit-pupil cone check; `focus-sharp.test.ts`, `focus-travel.test.ts`, `dof.test.ts`. | CoC is explicitly this model's assumed viewing criterion. Removed unsupported “most calculators” wording. Focus setting gets an assumption chip. |
| Measured bokeh, predicted blur, pixel scale and inset magnification | Independent ray landing positions; `tools/accuracy/cone.mjs` measures rendered diameter, angular blade structure, noncircular aspect and image-plane scale. | Replaced “aberrations make it larger” with the qualified statement that they can change it. Removed universal sub-pixel color-separation prose. |
| Airy radius, first dark ring, encircled energy and MTF | `diffraction.test.ts`: Bessel integral quadrature and tabulated landmarks, first zero, energy and half-cutoff MTF; `tools/test-diffraction.mjs`: independently locates the rendered dark ring. | Added pixel-radius calculation pointer. Stated approximations remain visible. |
| Exposure time, ISO, scene illuminance | Selected inputs / preset assumptions, not measured outputs. `units.test.ts`, shutter regression in `rig-cards.test.ts`. | Corrected “Calc.” classification. Fixed 0.6 s → 1/2 s and 0.8 s → 1/1 s rounding defects. |
| Photon energy, exposure/EV, spectral irradiance and incident photons | `exposure.test.ts`: SI-energy reference, reciprocity and independent numeric examples; `spectrum.test.ts`: spectral/photometric integration; `exposure-eq.test.ts`. | Replaced a vacuous absolute photon-energy tolerance (~1e-9 for a ~1e-19 J value) with relative checks. Added spectral sum provenance. |
| Electron count, QE, read noise, full well, SNR and shot noise | Sensor/read-noise source ledgers; `sensor.test.ts`: hand-computed QE result, clipping/DCG boundaries, fixed-seed 20,000-draw mean/variance check; `pixel-sample.test.ts`; loupe image gate on both backends. | Added electron calculation pointer. Sensor card now distinguishes incident photons from converted electrons. Typical microlens IOR and dye transmission remain marked Assumed. |
| Motion blur, rolling scan and shutter mechanisms | `camera.test.ts` independently checks subject-distance magnification; `exposure.test.ts`, `shot-model.test.ts`, `shot-capture.test.ts`, hardware ledgers. | No mathematical changes. Time and scan intervals remain distinct. |
| Color filters, demosaic, white balance, color matrix, sRGB and clipping | `color.test.ts`, `pipeline.test.ts`, `pipeline-sample.test.ts` use synthetic channels and reference transforms. | Existing explicit illustrative-sample scope retained. No inference of RAW data from a JPEG. |
| Fresnel reflection, double-reflection ghosts and coatings | `ghost-plate.test.ts`: normal-incidence reflectance and exact power ledger; rendered plane-bounce/coating gate. | Shared UI chrome corrected; physical model unchanged. |
| Field of view, crop, perspective and subject distance | `perspective.test.ts`, `formats.test.ts`: projective geometry / framing cases; perspective browser gate. | No mathematical changes. |
| Photo narrative, metadata, nominal pupil size, elapsed exposure and explanatory animation | `public/examples/examples.json`, `connected-story.test.ts`, `photo-shot.test.ts`, `photo-opening.test.ts`. | Recorded values and illustrative diagrams remain explicitly distinguished. |
| Optical-view numeric sampling choices | Nine rays per field and wavelength bins are drawing/model selections; active array follows sensor record and even-pixel crop. | Added missing ray-count, array, format and focus chips. Nominal image circle is Assumed coverage, not a computed or measured illuminated circle. |

All computed model figures name their calculation, and every camera-card numeric row has a source or calculation in the seven-lens regression. These provenance checks complement the mathematical tests above; a nonempty source label by itself is not numerical validation.

## Phone list

`tools/test-astra-phone.mjs` checks all five built HTML entries and every reference/view route: opening, camera, optics, focus, pixel, models, lens preview, scene preview, story, evidence, method, glossary and parts. Each runs at **360, 390 and 430 px**, height 900. All 39 pass horizontal-overflow, visible-control minimum 24 px, page-error and shared-accent checks. Brand/story links and view sliders now have 44 px hit boxes. Reference source links and disclosure controls below the first viewport have explicit target sizes. Both standalone preview cameras previously cropped models on portrait screens. They now fit their bounding sphere against the limiting horizontal/vertical field of view, and await GLB loading before framing. Eight projection checks inspect 1,432 body and 1,384 lens bounding-box corners across desktop and all three phone widths. Existing compact controls remain at least 24 px; pin hit testing includes their documented pseudo-element expansion.

The studio interaction gate additionally exercises desktop, short desktop, 390 and 320 px layouts, expanded models, real-photo views and catalog recovery. Initial screenshot tooling was corrected to await renderer readiness and the end of the loading fade. Chromium's full-page mobile capture omitted some fixed-header paint; a normal viewport capture confirmed the header was present, and final evidence uses viewport captures. This was a capture issue, not a hidden navigation control.

Screenshots: [camera](audits/screens/camera-360.jpg), [optics](audits/screens/optics-360.jpg), [focus](audits/screens/focus-360.jpg), [pixel](audits/screens/pixel-360.jpg), [opening](audits/screens/opening-360.jpg), [models](audits/screens/models-360.jpg), [story](audits/screens/story-360.jpg), [evidence](audits/screens/evidence-360.jpg), [method](audits/screens/method-360.jpg), [glossary](audits/screens/glossary-360.jpg), [parts](audits/screens/parts-360.jpg), [lens preview](audits/screens/lens-preview-360.jpg), [scene preview](audits/screens/scene-preview-360.jpg). All 39 original captures and JSON results are in ignored `shots/astra-ex1/after/`.

## Verification

- `npm ci --ignore-scripts`: installed existing lockfile; no dependency changes.
- `npm run typecheck`: PASS.
- `npm test`: **1,288 passed, 4 existing skips, 78 files**. Shutter cases first failed with the incorrect values; fixed cases pass. Aperture provenance regression also first failed for all seven lenses before the explicit prescription display.
- `npm run build`: PASS.
- `node tools/astra-claims.mjs`: 42 scenarios, 4,076 UI literals. Existing Vite and native TypeScript API only; no listening server or new dependency.
- `$env:P2P_URL='http://127.0.0.1:49754/'; node tools/test-astra-phone.mjs`: 39/39 PASS.
- With the same `P2P_URL`, `node tools/test-studio-workspace.mjs`: PASS.
- `$env:P2P_PREVIEW_PORT='49611'; node tools/accuracy/lens.mjs`: 8/8 PASS, 5,247 ray vertices checked.
- `$env:P2P_PREVIEW_PORT='49734'; node tools/accuracy/cone.mjs`: 9/9 PASS, rendered diameter error 11.91% within documented 20%; aspect error 1.1% within 5%.
- With `P2P_URL` above, `node tools/accuracy/loupe.mjs`: WebGPU and WebGL2 PASS.
- With `P2P_URL` above, `node tools/test-diffraction.mjs`, `node tools/test-ghost-plate.mjs`, `node tools/test-perspective.mjs`: desktop/390/320 PASS.
- With `P2P_URL` above, `node tools/test-photon-rain.mjs`: desktop/390/320 PASS. Updated two obsolete waits for the removed synthetic renderer to camera/model readiness; all photon-count, pixel and lifecycle assertions remain.
- With `P2P_URL` above, `node tools/test-shot-player.mjs`: PASS, 2,007 frames over all six stages, exact scrubbing, mechanical/electronic distinction, desktop/390/320, high-DPR, state isolation, keyboard/focus and axe. Its obsolete hardcoded six-photo count was replaced by exact catalog membership/order.
- With `P2P_URL` above, `node tools/test-astra-preview-framing.mjs`: 8/8 PASS; no projected geometry outside the viewport.
- `git diff --check`: PASS.

## Needs Reed

No publishing or merging was attempted. Review the existing high-severity dependency advisory before any release; dependencies were not changed. The full-branch identifier scan finds inherited matches in `tools/review-app-check.mjs`, `tools/review-server.py` and `tools/review-shot.mjs`; this change adds none. Added text contains no emails, credential-shaped tokens or ntfy URLs. Existing source uncertainty (representative patent/product association, schematic microlenses, assumed scene illumination and nominal coverage) remains disclosed; this pass does not turn those assumptions into measurements.
