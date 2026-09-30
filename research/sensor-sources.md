# Sensor sources

Research pass by agent "sensor", 09/28/2026. Companion to `data/sensors.json`, which carries the
same figures machine-readably as `{ v, unit, ev, src, loc, accessed }`. This file is the prose
version: why each sensor was picked, what each source actually says, and where sources conflict.
Evidence kinds follow `src/engine/lens-types.ts`'s `EvidenceKind`: spec, vendor, reported, derived,
assumed.

All web lookups in this file were done 09/28/2026; that is the `accessed` date everywhere below
and in the JSON.

## What this covers, and its central limitation up front

`photonstophotos.net` (Bill Claff) is the brief's suggested primary source for read noise, PDR and
"Characteristics" data. Its charts are rendered client-side by JavaScript; my WebFetch tool
converts pages to static text/markdown and does not execute JavaScript, so every attempt to load
a photonstophotos chart page (`RN_e.htm`, `PDR.htm`, `Sensor_Characteristics.htm`) came back with
navigation and disclaimer text only, no numbers. One older, non-chart photonstophotos page (the
Sony A7S DR-Pix write-up) *is* static prose and did fetch cleanly — it's used below as a
fully-numeric worked example of Sony's dual-conversion-gain mechanism, but it's a different camera
(the original a7S) than any of the three picks.

A second obstacle: DPReview's forum (`dpreview.com/forums/...`) returned HTTP 403 to my fetch tool
on every attempt, including the two threads where the OM-1 and E-M1 III photonstophotos numbers
are discussed. Where I only have those numbers via my search tool's own summary of a blocked page,
I've flagged it explicitly as lower-confidence and unverified by me directly, both here and in the
JSON (`confidence: 'low'`). I did not invent any number to fill these gaps — see "Open problems"
at the end.

Given that, the read-noise-in-electrons curve at base ISO and above the DCG switch — one of the
requested fields — is the weakest-covered figure across all three records. Everything else
(active area, pixel count/pitch, full well by at least one method, DCG-switch ISO, ADC bit depth,
QE, readout timing, dark current) has at least one solid citation per sensor.

## Full frame — Sony a7R IV / Sony IMX455

**Pick rationale:** the a7R IV's 61MP BSI sensor is the most thoroughly measured full-frame sensor
I could find, on two independent fronts: (1) it is widely identified by the enthusiast/press
community as the Sony IMX455, for which Sony Semiconductor Solutions publishes an actual public
datasheet flyer (a real vendor spec sheet, not a rumor); and (2) that same chip is sold undisguised
in ZWO's ASI6200 and QHY's QHY600 astrophotography cameras, whose product pages carry full
well/QE/dark-current/ADC numbers Sony doesn't publish for the camera-grade part directly.
Jim Kasson's blog (`blog.kasson.com`) separately did photon-transfer-curve analysis of actual a7R
IV raw files, giving an in-camera (not bare-silicon) full well and the exact DCG-switch ISO.

**Chip identity caveat:** one search result identified the a7R IV's sensor via teardown as
"IMX451AQL" rather than IMX455. I did not resolve this discrepancy — I could not get a clean direct
read of the DPReview thread titled "IMX455 datasheet (A7RIV) published" (blocked), and the
numerical match between the IMX455 datasheet (9576×6388 effective pixels, 3.76 µm pitch, 43.3 mm
diagonal) and the camera's own reported specs is close enough to be persuasive but not certain.
Flagged for the lead.

**Sony IMX455AQK-C datasheet** (spec, vendor primary):
<https://www.sony-semicon.com/files/62/pdf/p-13_IMX455AQK_BQK_ALK_Flyer.pdf>
- "Number of effective pixels 9576 (H) × 6388 (V) approx. 61.17 M pixels"
- "Unit cell size 3.76 μm (H) × 3.76 μm (V)"
- "Diagonal 43.3 mm (Type 2.7)"
- ADC: "Built-in 11-bit/12-bit/14-bit/16-bit A/D converter"; the "-C" suffix variant is explicitly
  "designed for use in consumer use digital still camera" (as opposed to the "-K" security/
  surveillance variant, whose datasheet is otherwise identical).
- Characteristics table is given at "Tj = 60 °C" — i.e. Sony's own reference condition for this
  chip assumes a 60 °C junction temperature, which I used below to extrapolate a dark-current
  estimate at realistic operating temperature.

**ZWO ASI6200 product page** (vendor): <https://www.zwoastro.com/product/asi6200/>
- Full well capacity: 51.4 Ke
- Read noise: 0.86 e- "across all gain settings" (current 2025 hardware revision — an earlier
  manual I could not get readable text from is reported elsewhere as 1.5–3.5 e-; I did not use
  that unverified number)
- Dark current: 0.0017 e-/s/pix at 0 °C
- ADC: 16-bit native; QE peak 91% (mono) / 80% (color)
- Format printed as "36×24mm ... diagonal of 43.3mm", resolution "9576×6388" — matching the Sony
  datasheet exactly, which is the strongest evidence tying this product to the IMX455 part.

**Jim Kasson, "Sony a7RIV FWC, PDR, and input-referred read noise"** (reported):
<https://blog.kasson.com/a7riv/sony-a7riv-fwc-pdr-and-input-referred-read-noise/>
- "the base ISO full well capacity (FWC) of the a7RIV is about 37000 electrons" — this is measured
  in-camera from raw-file photon transfer analysis, so it is not the same quantity as the 51.4 Ke
  bare-chip figure above. Both are recorded in the JSON, not averaged, per the brief's rule for
  conflicting measurements (they're not really "conflicting" so much as two different measurement
  contexts of probably the same silicon).

**Jim Kasson, "Speculating on the Sony a7RIV photographic dynamic range"** (reported):
<https://blog.kasson.com/a7riv/speculating-on-the-sony-a7riv-photographic-dynamic-range/>
- "the camera switches the conversion gain into its high mode on the transition from ISO 250 to
  ISO 320" — DCG switch ISO = 320.
- Defines Claff's PDR: "full scale divided by the mean signal level that, when referenced to a
  1600-pixel-high print, gives a signal-to-noise ratio of 10" — recorded in the generic section
  since it's the standard PDR definition, not an a7R IV-specific number.

**Rolling-shutter readout** (reported): horshack-dpreview's community-measured database,
<https://horshack-dpreview.github.io/RollingShutter/> (methodology/README at
<https://github.com/horshack-dpreview/RollingShutter>, an LED strobe at a known frequency
photographed through each camera's rolling shutter). Row "Sony A7R IV", "Photo mode": **100.30 ms**
full-sensor readout. For comparison the same table gives Sony A7 III 62.33 ms and Sony A6400
46.13 ms — the a7R IV's much larger pixel count reading out over a comparatively modest number of
column ADCs make it the slowest of the group.

**Mechanical shutter / ISO range / raw bit depth** (reported), Wikipedia infobox
<https://en.wikipedia.org/wiki/Sony_%CE%B17R_IV>: sensor 35.7×23.8 mm; ISO 100–32000 native
(expandable 50–102400); mechanical shutter 1/8000 s to 30 s, bulb; "HI 8fps Uncompressed RAW or
HI+ 10 fps in Compressed RAW" (14-bit uncompressed / 12-bit compressed is the commonly reported
pairing for this camera generation, but I did not find a first-party Sony page stating the bit
depths outright, so both are recorded as `reported`, not `spec`).

**Dark current at realistic operating temperature (derived):** the ZWO figure (0.0017 e-/s/pix)
is measured in a cooled astro-camera housing at 0 °C, not an uncooled mirrorless body at its actual
operating temperature. Using the generic doubling-temperature relation (~6.5 °C, see below) and
Sony's own Tj = 60 °C reference point for this chip's other characteristics, I extrapolated:
`0.0017 * 2^(60/6.5) ≈ 1.02 e-/s/pix`. This is explicitly a rough, derived order-of-magnitude
estimate (shown with its calc in the JSON), not a measurement — an uncooled body's real junction
temperature varies with ambient, exposure length, video/IBIS heat, etc.

## APS-C — Sony a6300 / a6400 / a6500 family

**Pick rationale:** these three bodies are widely reported to share the same 24.2 MP BSI APS-C
sensor generation (a6400 pairs it with a newer Bionz X processor); this generation is the most
discussed APS-C sensor on both Kasson's blog and in the DCG/ISO-invariance enthusiast literature,
and DxOMark separately ran a full lab test on the a6400 giving an independent, citable Dynamic
Range/Color Depth/Low-Light-ISO score. I was not able to identify a public Sony IMX part number for
this chip, so unlike the full-frame record, the pixel-level figures (full well beyond the one
in-camera number, QE, dark current, ADC bit depth of the bare chip) borrow from the Sony IMX571 —
a different, 26 MP APS-C BSI Sony sensor sold raw in ZWO's ASI2600 / QHY's QHY268 astro cameras —
explicitly flagged in every such field as **not confirmed** to be the a6x00's actual chip, just the
best-documented same-format Sony part.

**Sony a6400 Help Guide** (reported): sensor 23.5×15.6 mm; 24.2 effective MP.
<https://en.wikipedia.org/wiki/Sony_%CE%B16400> (infobox) and
<https://helpguide.sony.net/ilc/1810/v1/en/contents/TP0002279217.html> (RAW file format page:
14-bit RAW, dropping to 12-bit in some burst/silent-shutter modes). Mechanical shutter 1/4000 s
to 30 s.

**Pixel pitch** (derived): not published directly; computed as
`sqrt(23.5mm * 15.6mm / 24.2e6) ≈ 3.9 µm`, shown with its calc in the JSON.

**Jim Kasson, "Sony a6300 — read noise modeling"** (reported):
<https://blog.kasson.com/the-last-word/sony-a6300-read-noise-modeling/>
- Full well capacity ≈ 45,000 e- (in-camera, base ISO 100, low-conversion-gain regime).
- "the a6300 has a conversion gain multiplier of 4, since the change in conversion gain first
  takes effect at ISO 400" — the ratio between the low- and high-conversion-gain analog stages.

**cuchara.photography, "ISO Invariance, Dual Gain, and the Sony a6500"** (reported):
<https://cuchara.photography/2019/06/iso-invariance-and-the-sony-a6500/>
- "the charts for the a6300 (and a6400) indicate the dual gain ISO kicks in at ISO 400" — this is
  the DCG-switch ISO recorded. The same article separately notes the author's own a6500 test
  landed on ISO 400 too, but flags an ISO 320 figure they'd seen cited elsewhere for this family —
  **unresolved conflict, recorded as a note rather than averaged.**

**DxOMark, Sony a6400 sensor review** (reported): <https://www.dxomark.com/sony-a6400-sensor-review/>
- Color Depth (Portrait): 24.1 bits at base ISO
- Dynamic Range (Landscape): quoted as both "13.6 EV at base (ISO 100)" and, elsewhere on the same
  page, "13.7 EV at 100 ISO" — DxOMark's own page is internally inconsistent by 0.1 EV; both
  numbers are recorded, not averaged.
- Low-Light ISO (Sports): 1431 ISO
- DxOMark's Dynamic Range (Print) metric is its own normalization, not directly comparable to
  photonstophotos' EDR/PDR without conversion — noted in the JSON so the engine team doesn't treat
  these as interchangeable.

**Rolling-shutter readout** (reported): same horshack-dpreview database as above. Row "Sony A6400",
"Photo mode": **46.13 ms**.

**Sony IMX571 (ZWO ASI2600MM/MC Pro product page, vendor)**, recorded as a same-format stand-in,
not the confirmed a6x00 chip: <https://www.zwoastro.com/product/new-asi2600mm-mc-pro/>
- Full well: 73 Ke; read noise 1.0–3.3 e- across gain settings; dark current 0.0022 e-/s/pix at
  0 °C and 0.00012 e-/s/pix at −20 °C; ADC 16-bit; QE peak 91% (mono) / 80% (color); pixel 3.76 µm;
  format 23.5×15.7 mm, 28.3 mm diagonal; 6248×4176 (26 MP).
- **Derived cross-check:** the two dark-current figures above (0.0022 e-/s/pix at 0 °C, 0.00012 at
  −20 °C) imply a doubling temperature for *this specific chip* of `20 / log2(0.0022/0.00012) ≈
  4.8 °C` — close to, and on the fast end of, the commonly cited generic 5–8 °C range. Shown with
  its calc in the JSON as a nice internal consistency check, even though this chip isn't confirmed
  to be in the a6x00 bodies.

## Micro Four Thirds — OM System OM-1 (primary) / Olympus E-M1 Mark III (full-well cross-reference)

**Pick rationale:** the OM-1 is the newest and most technically interesting MFT sensor (first
stacked-BSI design in the format), with a DPReview lab review that independently measured its
rolling-shutter readout speed, and an enthusiast community actively comparing its photonstophotos
measurements against its direct predecessor, the E-M1 Mark III. This is the weakest-sourced of the
three records: OM Digital Solutions/OM System has not disclosed the sensor's silicon supplier or
part number anywhere I found, and my two best leads for its photonstophotos-derived numbers (a
DPReview forum thread specifically about "OM-1 Sensor Measurements at PhotonsToPhotos", and the
equivalent E-M1 III thread) both returned HTTP 403 to my fetch tool. I have those specific numbers
only via my search tool's own summary of the blocked pages — **flagged low-confidence throughout,
both here and in the JSON**, and should be re-verified directly by whoever can load
photonstophotos.net or an authenticated DPReview session.

**OM System OM-1, official/Wikipedia specs** (reported): <https://en.wikipedia.org/wiki/OM_System_OM-1>
- Sensor: 17.3×13 mm (Four Thirds type) — matches the task's target format exactly.
- 20.4 MP (5184×3888), "Stacked BSI CMOS (branded Live MOS)".
- Mechanical shutter 1/8000 s–60 s. Released 3/18/2022.
- Pixel pitch (derived): `sqrt(17.3mm * 13.0mm / 20.4e6) ≈ 3.33 µm`.

**DPReview, OM System OM-1 review, page 2** (reported):
<https://www.dpreview.com/reviews/1501374854/om-system-om-1-review/2>
- "We've measured the rate at around 1/125th seconds, which is twice as fast as that of its
  predecessor" — full-sensor electronic-shutter readout ≈ 8.0 ms. This independently *cross-checks*
  the horshack-dpreview community measurement below almost exactly.
- "Shortest exposure time: 1/8000 sec" (electronic, as stated on this page). Note: I've seen a
  1/32000 s figure commonly cited elsewhere for the OM-1's electronic-shutter top speed, but did
  not confirm it against an accessible primary source in this pass, so I did not record it as a
  value — only this page's own stated 1/8000 s.
- "20MP quad-pixel AF Stacked CMOS sensor" with "20 million microlenses" over "80 million
  individual photodiodes" — i.e. each microlens covers a 2×2 group of four photodiodes (used for
  phase-detect AF as well as imaging), architecturally different from one-microlens-per-photodiode
  BSI designs. Worth the engine team's attention if modeling this format's microlens/fill-factor
  optics in detail.

**Rolling-shutter readout, horshack-dpreview database** (reported):
<https://horshack-dpreview.github.io/RollingShutter/> — row "OMS OM-1", "Photo mode": **7.98 ms**.
(Same table: Olympus E-M5 III 16.16 ms, for scale — the OM-1's stacked design reads out roughly
twice as fast as a contemporary non-stacked Olympus/OM body.)

**Full well and DCG-switch ISO (reported, low confidence — see caveat above):**
- Olympus E-M1 Mark III full well ≈ 21,320 e- (in-camera, base ISO 200), via
  <https://www.dpreview.com/forums/threads/olympus-om-d-e-m1-mark-iii-sensor-measurements-at-photonstophotos.4471289/>
  (thread content obtained through my search tool's summary; direct page load returned 403).
- A separate thread, <https://www.dpreview.com/forums/threads/olympus-system-om-1-sensor-measurements-at-photonstophotos.4633822/>,
  and a 43rumors summary of the same data
  (<https://www.43rumors.com/om-1-dynamic-range-results-by-bill-claff/>), both indicate the OM-1's
  dynamic-range curve is "exactly the same as on the E-M1III" except that the OM-1 gains a
  dual-conversion-gain step around **ISO 1000** that the E-M1 III doesn't have there. On that
  basis I used the E-M1 III full-well figure as a stand-in for the OM-1's own base-ISO full well,
  which is *not* independently confirmed for the OM-1 itself.

**Sony IMX294 (ZWO ASI294 product page, vendor)**, same 4/3" sensor format, explicitly **not**
claimed to be the OM-1/E-M1 III chip: <https://www.zwoastro.com/product/asi294/>
- Mono (ASI294MM Pro, 2.3 µm native Bin-1 mode): full well 14.4 Ke; read noise 1.3–2.6 e-; dark
  current 0.0022 e-/s/pix at −20 °C; ADC 14-bit; QE peak ≈90%.
- Color (ASI294MC Pro, 4.63 µm quad-Bayer-binned mode): full well 63.7 Ke; read noise 1.2 e-; QE
  peak 75%.
- Format printed as "4/3″ 19.1 × 13.00 mm" — note this is *wider* than the nominal 17.3×13 mm MFT
  format this project targets; I did not chase down why (possibly a different active-area
  convention or crop). Flagged as a minor unresolved inconsistency, not corrected by guesswork.

**Olympus ORF raw file bit depth** (reported): "12-bit lossless compressed RAW (.ORF)", via
<https://mirrorlesscomparison.com/om-system/om-1-vs-olympus-omd-em1-iii/>.

## Generic facts

**PRNU, typical percentage** (reported): I could not find a figure specific to any of the three
chosen sensors. As a representative, named example: onsemi's NOII4SM6600A datasheet states
**1.5% RMS** photo-response non-uniformity for that commercial CMOS sensor.
<https://www.onsemi.com/pdf/datasheet/noii4sm6600a-d.pdf>. General academic/industry discussion
consistently places typical CMOS PRNU in the roughly 1–2% RMS range, of which this is one
concretely cited data point, not a universal constant.

**Dark current, doubling temperature** (reported): Teledyne Vision Solutions' "Dark Current"
learning-center page states dark-current effects are "halved for every 6-7°C of cooling"
(equivalently, doubles every 6–7 °C): <https://www.teledynevisionsolutions.com/learn/learning-center/imaging-fundamentals/dark-current/>.
Other sources found place the process-dependent range more broadly at 5–10 °C. As a self-consistency
check, the two IMX571 vendor dark-current figures recorded under the APS-C sensor (0.0022 e-/s/pix
at 0 °C, 0.00012 e-/s/pix at −20 °C) imply a doubling temperature of ~4.8 °C for that specific chip
— on the fast end of, but consistent with, the commonly cited range.

**Dark current, typical room-temperature value** (reported, low confidence): a consumer-grade CMOS
sensor referred to as "CIS115" was reported (via my search tool, summarizing an academic
dark-current-measurement paper found on PDXScholar) at **17.0 e-/pix/s** at room temperature. I
could not independently re-verify this by reading the paper directly — its PDF was too large for
this session's PDF-rendering tool (`pdftoppm`/poppler was unavailable). This is much higher than
the cooled-astro-camera figures (0.0017–0.0022 e-/s/pix at 0 °C) recorded per-sensor above; the two
shouldn't be compared directly since they're measured under very different cooling conditions.
Flagged for re-verification.

**ISO 12232 — saturation-based speed, SOS, REI** (spec, via Wikipedia's "Film speed" article
summarizing the standard, since the ISO standard's own full text is paywalled):
<https://en.wikipedia.org/wiki/Film_speed>, "Digital still cameras" section.
- Saturation-based speed: "The factor 78 is chosen such that exposure settings based on a standard
  light meter and an 18-percent reflective surface will result in an image with a grey level of
  18%/√2 = 12.7% of saturation."
- Standard Output Sensitivity (SOS): targets "values of 118 in 8-bit pixels, which is 18 percent
  of the saturation value" — equivalently, SOS specifies the exposure that produces an output of
  118/256 ≈ 0.461 of full scale for an 18%-reflectance mid-gray subject (two phrasings of the same
  constant, both recorded).
- Recommended Exposure Index (REI): the only technique the standard allows for non-sRGB output
  formats; it has no fixed formula — a manufacturer sets it "based solely on their assessment of
  which values yield well-exposed sRGB images."
- The standard itself: ISO 12232:2019, "Photography — Digital still cameras — Determination of
  exposure index, ISO speed ratings, standard output sensitivity, and recommended exposure index",
  <https://www.iso.org/standard/73758.html> (title/scope only — full text not read, it's paywalled).

**How ISO invariance is measured** (reported): shoot the same scene twice at identical aperture and
shutter speed — once at a high ISO (correctly exposed in-camera), once at a low ISO (deliberately
underexposed by the same number of stops the ISO was raised). Push the low-ISO raw file's exposure
in post-processing by that same stop count so both frames match in brightness, then compare shadow
noise and detail. A sensor is "ISO-invariant" over a range when the two results are visually
indistinguishable. <https://expertphotography.com/iso-invariance>, worked example: "take a picture
with ISO 100 ... bump up your ISO to 800 ... [then in post] bump up the exposure to match."

**BSI vs. FSI fill factor** (reported): Tucsen's sensor-model learning page (directly fetched):
"the pixel fill factor approaches 100%" for BSI sensors, because backside illumination removes the
front-side metal routing that otherwise blocks light from reaching FSI photodiodes.
<https://www.tucsen.com/learning/demystifying-specifications-sensor-model/>. A typical FSI fill
factor of 50–60% (partially recovered with microlenses) is reported via a search-engine summary of
a Phantom High Speed article I could not load directly (HTTP 403) — recorded with a
medium-confidence flag since only the BSI half of the comparison was independently verified by
directly reading a page. All three sensors in this project are BSI, so each record's microlens
fill factor is marked `assumed` at ~0.97 (approaching 100%), with this citation as the reasoning,
per the task's expectation that fill factor is "often assumed."

**Dual-conversion-gain mechanics, fully-numeric worked example** (reported): the *original* Sony
a7S (2014) — not one of this project's three chosen sensors, but the one photonstophotos page that
fetched as plain static text rather than a JS chart, and it's a clean, fully-cited illustration of
exactly the LCG/HCG mechanism the three chosen Sony/Sony-family sensors all use:
<https://www.photonstophotos.net/GeneralTopics/Sensors_&_Raw/Sony_A7S_DR-Pix_Read_Noise.htm>
- LCG range ISO 125–1600 (conversion gain ×1); HCG range ISO 2000–25600 (conversion gain ×16).
- Pixel input-referred noise 0.920 e-; conversion noise 3.441 e-.
- LCG pixel output noise 3.562 e-; HCG pixel output noise 15.117 e- — note this is *higher* in raw
  output-noise terms even though HCG is the low-noise mode, because HCG amplifies the signal (and
  noise) 16× before the ADC; the page's own note: "signal in HGC mode is 16x LCG mode but noise in
  HGC mode is a little less than 4x LCG mode," which is why the *input-referred* (electron-
  equivalent) noise is what actually drops at the DCG switch.
- Stated noise model: `output_noise = sqrt((input_noise * conversion_gain)^2 + conversion_noise^2)`.

## Open problems (for the lead / next research pass)

1. **Per-ISO read noise in electrons** (base ISO and above the DCG switch) is missing for all three
   chosen sensors. photonstophotos.net's `RN_e.htm` and `PDR.htm` charts are JS-rendered; this
   session's WebFetch tool returns only static markup, with no numbers. The DPReview forum threads
   that discuss/quote this data returned HTTP 403 on every direct-fetch attempt. Chart/thread URLs
   are recorded as pointers in the JSON (`readNoiseElectrons.src`/`.loc` on each sensor). Whoever
   can load photonstophotos.net interactively, or has an authenticated/different fetch path into
   DPReview's forums, should fill these in directly.
2. **MFT record confidence.** The OM-1/E-M1 III full-well (21,320 e-) and DCG-switch-ISO (1000)
   figures came from my search tool's summary of two DPReview forum threads I could not load
   directly (403 both times). Flagged low-confidence in the JSON and here; re-verify directly
   against photonstophotos.net before treating as solid.
3. **Chip identity.** Full frame: a7R IV = Sony IMX455 is a strong community identification backed
   by a matching public datasheet, but one conflicting "IMX451" mention was found and not resolved.
   APS-C and MFT: no public part number was found for either camera's actual sensor; the IMX571 and
   IMX294 figures used are explicitly same-format stand-ins, not the confirmed parts — every such
   field is labeled accordingly in the JSON.
4. **Per-channel (R/G/B) QE curves** were not obtained as numbers for any of the three sensors —
   every source that publishes them does so only as a graph image, which this pass's tools cannot
   read. Said so and moved on, per the task's instructions.
5. **Dark current at realistic camera operating temperature** is only directly vendor-measured for
   the cooled astro-camera implementations (0 °C / −20 °C). The one in-camera estimate offered (full
   frame, ~1.0 e-/s/pix at the Sony datasheet's own Tj = 60 °C reference point) is explicitly a
   derived extrapolation using the generic doubling-temperature rule, not a measurement.
6. **IMX294 format labeling.** ZWO's ASI294 page states the sensor format as "4/3″ 19.1 × 13.00 mm",
   which is wider than the nominal 17.3×13 mm Micro Four Thirds format this project otherwise uses.
   Not chased down further; noted as an unresolved minor inconsistency rather than silently
   corrected.
7. **OM-1 electronic shutter top speed.** DPReview's own review states "Shortest exposure time:
   1/8000 sec" for the electronic shutter, which is what's recorded. A commonly seen 1/32000 s
   figure elsewhere for this camera was not confirmed against an accessible primary source in this
   pass and was deliberately not recorded.
8. Two Sony Semiconductor PDF flyers (`p-13_IMX455AQK_BQK_ALK_Flyer.pdf`, and the earlier
   `IMX455AQK-K_Flyer.pdf` for the security/surveillance "-K" variant) were fetched and read in
   full; only the consumer "-C"/"color" variant's figures are used in `data/sensors.json`, since
   that's the variant Sony states is for "consumer use digital still camera."
