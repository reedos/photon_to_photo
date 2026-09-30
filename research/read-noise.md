# Read noise (electrons) and Photographic Dynamic Range vs. ISO

Research pass by agent "read-noise", 09/28/2026. Companion to `data/read-noise.json`, which carries
the same figures machine-readably. Fills the gap `research/sensor-sources.md` left open: per-ISO
read noise in electrons for the three camera picks in `data/sensors.json` (full frame Sony a7R IV /
IMX455, APS-C Sony a6400, MFT OM System OM-1). Evidence kinds follow `src/engine/lens-types.ts`'s
`EvidenceKind`: spec, vendor, reported, derived, assumed. Every number below is `reported` (Bill
Claff's own published measurement) except the DCG-switch ISO, which is `derived` (this session's
own reading of his published curve — see "Method" below).

All web lookups were done 09/28/2026; that is the `accessed` date everywhere below and in the JSON.

## Method — why the earlier pass saw no numbers, and how this one got them

`research/sensor-sources.md` recorded that `photonstophotos.net`'s charts are "rendered client-side
by JavaScript" and that a text-only fetch "came back with navigation and disclaimer text only, no
numbers." That is correct as far as it goes — the chart itself only *appears* after a JavaScript
library (Highcharts) draws it — but it undersells what's actually in the page. This pass used
Playwright (headless Chromium, this repo's `node_modules/playwright`)
to load `Charts/RN_e.htm`, `Charts/PDR.htm` and `Charts/Sensor_Characteristics.htm`, and the full
per-camera dataset for every camera the site tracks (445 cameras on RN_e.htm, 552 on PDR.htm, 396 on
Sensor_Characteristics.htm) turned out to be sitting in the page's own HTML source as a plain
JavaScript array literal inside an inline `<script>` tag — e.g.
`{ name: 'Sony ILCE-7RM4_14', fwc: 34452, unityEv: 6.12, loEv: 5, hiEv: 12, data: [[5,1.54],...] }`.
The server writes this literal directly into the page; Highcharts only reads it at render time to
draw the SVG. **Confirmed independently of Playwright**: a plain `curl` (no JS engine at all) against
the same three URLs returns byte-identical series data (diffed after normalizing whitespace) to what
Playwright captured — see `.local/read-noise/captures/*_curl.html` and the diff commands in this
session's transcript. So the earlier pass's tool most likely stripped `<script>` tag contents when
converting the page to text/markdown, not that the numbers require a JS engine to exist at all. This
pass still used Playwright as the task asked, and it was genuinely useful for the Highcharts-rendered
pages' interactive camera-picker (see caveat below), even though the raw-data extraction itself would
have worked with a plain HTTP fetch too.

**Extraction**: for each page, the full page HTML was saved
(`.local/read-noise/captures/{rn_e,pdr,sensorchar}_initial.html`), the `series: [ ... ]` (or, for
Sensor_Characteristics.htm, the flat per-camera object array) was located and extracted with a
bracket-balanced scan, then evaluated as plain JavaScript data with `new Function('return '+text)()`
(safe: the extracted text is marker/data object literals only, no executable logic) — scripts in
`.local/read-noise/parse_rn.cjs` and `.local/read-noise/build_tables.cjs`. This reads the exact
numbers Highcharts plots, not a screen-read of rendered pixels.

**One real Playwright-relevant finding**: in this sandboxed session, `code.highcharts.com`'s CDN
script returned **HTTP 403** to the headless browser (`PAGEERROR: Highcharts is not defined`), so the
chart itself never actually rendered/painted in our headless Chromium, and the on-page camera-picker
list (`#seriesList`, built by a `$(document).ready` handler that never got to run) stayed empty. That
blocked the "click a camera name, screenshot the plotted curve" visual-confirmation approach; it did
**not** block the data extraction, since that reads the page's static source, not the live chart. The
curl cross-check above is offered in its place as independent, non-Playwright confirmation of every
number in `data/read-noise.json`. Screenshots of the (blank, due to the 403) chart shell are saved at
`.local/read-noise/captures/rn_e_initial.png` and `pdr_initial.png` for the record.

**Axis conversions** (both charts, exactly reproducing the site's own formulas):
- ISO is on a log2 x-axis in 1/3-stop steps; the site's own axis-label formatter is
  `ISO = round(3.125 * 2^x)`. This project used the same formula (not rounded to the nearest whole
  ISO at higher precision) to convert every `x` value.
- `RN_e.htm`'s y-axis is titled "Input-referred Read Noise (log2(electrons))", so
  `readNoiseE = 2^y`.
- `PDR.htm`'s y-axis is "Photographic Dynamic Range" directly in EV; `y` is used as-is.

**Marker semantics**, per the RN_e.htm page's own on-screen notes ("Click on the camera model in
list to toggle visibility... Open symbols indicate values outside the normal analog range...
Triangle up indicates scaling, triangle down indicates noise reduction, and diamond indicates
both"): each series also carries `loEv`/`hiEv` (the ISO range Claff considers "normal analog" for
that camera) and `fwc`/`unityEv` (full well and the chart's own "Unity ISO", shown in the site's own
legend-click popup). Points outside `[loEv, hiEv]` are drawn as open/white-fill markers (an extended
low or high ISO reached by a digital push/pull, not a real analog-gain step); `data/read-noise.json`
carries this as `outsideNormalAnalogRange`. A `triangle-down` marker means in-camera noise reduction
is active at that point; `triangle-up` means additional digital scaling; carried as `digitalMarker`.

**DCG-switch ISO is derived, not read off a labeled field.** Neither chart states a single "dual
conversion gain switches here" number in text. This pass found it programmatically: for each
camera's plain (unmarked, in-normal-range) points only, it computed the slope of
`log2(read noise) vs log2(ISO)` between every adjacent pair and took the steepest negative one — the
DCG step shows up as one sharp cliff on an otherwise near-flat curve. Restricting to unmarked,
in-range points matters: naively taking the single biggest point-to-point drop for the a7R IV finds
the boundary between the extended-low-ISO digital pull (ISO 80, before the analog range even starts)
and ISO 100 — a real drop, but not a conversion-gain switch. See `meta.dcgDetectionMethod` in the
JSON and `.local/read-noise/build_tables.cjs`.

**A second, independent dataset** exists on `Charts/Sensor_Characteristics.htm`, titled "DxOMark
Derived Sensor Characteristics" — a different derivation Claff separately publishes *from DxOMark's*
published scores, not his own direct chart measurement. It gives one `unitygain`, `fwc`, `qe`,
`readnoise` (a single floor value), `adcnoise` and `isoinvariantat` per camera. Recorded under each
camera's `dxomarkDerived` in the JSON as a cross-check, kept separate from (not averaged with) the
RN_e.htm/PDR.htm figures. DxOMark has not tested the OM-1 or the E-M1 Mark III, so this cross-check
exists only for the full-frame and APS-C picks.

## Full frame — Sony a7R IV (ILCE-7RM4 / IMX455)

- RN_e.htm series: `Sony ILCE-7RM4_14` — <https://www.photonstophotos.net/Charts/RN_e.htm>
- PDR.htm series: `Sony ILCE-7RM4` — <https://www.photonstophotos.net/Charts/PDR.htm>
- Sensor_Characteristics.htm row: `Sony ILCE-7RM4_14` —
  <https://www.photonstophotos.net/Charts/Sensor_Characteristics.htm>

Full well 34,452 e- (RN_e.htm `fwc`) / 35,520 e- (Sensor_Characteristics.htm `fwc`, DxOMark-derived
— close but not identical, recorded separately). Unity-gain ISO 217 (RN_e.htm `unityEv` converted)
and 217.1 (Sensor_Characteristics.htm `unitygain`) — near-exact agreement between Claff's two
independent datasets. Normal analog range ISO 100-12,800 (`loEv`/`hiEv`).

| ISO | Read noise (e-) | PDR (EV) | Note |
|---:|---:|---:|---|
| 100 | 2.908 | 11.62 | start of normal analog range |
| 200 | 2.868 | 10.41 | |
| 251 | 2.770 | 10.12 | last low-conversion-gain point |
| **318** | **1.301** | 10.27 | **first high-conversion-gain point — DCG switch** |
| 400 | 1.248 | 9.99 | |
| 800 | 1.214 | 9.07 | |
| 1600 | 1.173 | 8.02 | |
| 3200 | 1.133 | 7.08 | |
| 6400 | 1.133 | 6.08 | |
| 12800 | 1.087 | 5.14 | end of normal analog range |
| 25600 | 0.717 | 4.53 | outside normal range, noise-reduction marker |
| 102400 | 0.642 | 2.54 | outside normal range, noise-reduction marker |

**DCG switch: ISO 251 -> 318** (i.e. essentially ISO 250 -> 320), a -3.21 stops/stop cliff versus a
near-flat curve either side. This is an exact, independent match to Jim Kasson's blog post already
cited in `research/sensor-sources.md`: "the camera switches the conversion gain into its high mode
on the transition from ISO 250 to ISO 320" — his prose description of this same photonstophotos
chart, and this session's own programmatic slope-read of the chart's underlying data, agree.

Full points table (34 points, ISO 50-102,400): `data/read-noise.json`,
`cameras["Sony a7R IV (ILCE-7RM4)"].points`.

## APS-C — Sony a6400 (ILCE-6400), with a6300/a6500 as same-generation cross-checks

- RN_e.htm series: `Sony ILCE-6400_14` — <https://www.photonstophotos.net/Charts/RN_e.htm>
- PDR.htm series: `Sony ILCE-6400` — <https://www.photonstophotos.net/Charts/PDR.htm>
- Sensor_Characteristics.htm row: `Sony ILCE-6400_14`

Full well 36,443 e- (RN_e.htm) / 37,104 e- (Sensor_Characteristics.htm, DxOMark-derived). Unity-gain
ISO 230 (RN_e.htm) / 229.6 (Sensor_Characteristics.htm). Normal analog range ISO 100-25,600.

| ISO | Read noise (e-) | PDR (EV) | Note |
|---:|---:|---:|---|
| 100 | 3.249 | 10.51 | start of normal analog range |
| 200 | 2.908 | 9.79 | |
| **318** | **2.751** | 9.16 | last low-conversion-gain point |
| **400** | **1.173** | 9.25 | **first high-conversion-gain point — DCG switch** |
| 800 | 1.087 | 8.17 | |
| 1600 | 1.050 | 7.21 | |
| 3200 | 1.028 | 6.17 | |
| 6400 | 0.779 | 5.03 | |
| 12800 | 0.747 | 3.94 | |
| 25600 | 0.722 | 3.21 | end of normal analog range |

**DCG switch: ISO 318 -> 400** (essentially ISO 320 -> 400), a -3.73 stops/stop cliff. **This
directly resolves the open conflict `research/sensor-sources.md` flagged and left unaveraged**: one
source (cuchara.photography) said "the charts for the a6300 (and a6400) indicate the dual gain ISO
kicks in at ISO 400," while a second, unnamed source it mentioned put it at "ISO 320." Reading
Claff's own chart directly shows both were right about the same transition, from opposite sides of
it: ISO 320(318) is the last point still in low-conversion-gain, ISO 400 is the first point already
in high-conversion-gain — there is no real disagreement, just two ways of naming one boundary.

**Same-generation cross-check** (siblings tracked separately on RN_e.htm, not the project's chosen
camera, extracted as a consistency check on the a6400 pick):

| Camera | RN_e.htm series | Full well (e-) | Unity ISO | DCG switch |
|---|---|---:|---:|---|
| Sony a6300 | `Sony ILCE-6300_14` | 38,355 | 241.7 (DxOMark: 241.7) | ISO 318 -> 400 |
| Sony a6400 | `Sony ILCE-6400_14` | 36,443 | 230 (DxOMark: 229.6) | ISO 318 -> 400 |
| Sony a6500 | `Sony ILCE-6500_14` | 38,207 | 240.7 (DxOMark: 240.7) | ISO 318 -> 400 |

All three land on the identical ISO 318 -> 400 conversion-gain step, consistent with
`data/sensors.json`'s premise that the a6300/a6400/a6500 share one 24.2MP BSI sensor generation.
Full well varies a little (36.4-38.4 Ke) across the three, within ordinary unit-to-unit/measurement
variation for what is reported to be the same silicon.

Full points tables for all three: `data/read-noise.json`,
`cameras["Sony a6400 (ILCE-6400)"].points` and `.familyCrossCheck["Sony a6300 (ILCE-6300)"/"Sony a6500 (ILCE-6500)"].points`.

## Micro Four Thirds — OM System OM-1, with Olympus E-M1 Mark III as a lineage cross-check

- RN_e.htm series: `Olympus System OM-1_12` — <https://www.photonstophotos.net/Charts/RN_e.htm>
- PDR.htm series: `Olympus System OM-1` — <https://www.photonstophotos.net/Charts/PDR.htm>
- No Sensor_Characteristics.htm row (DxOMark has not tested the OM-1).

Full well 19,491 e- (RN_e.htm `fwc`). Unity-gain ISO 1013 (RN_e.htm `unityEv` converted). Normal
analog range ISO 200-102,400.

`research/sensor-sources.md` previously could not load photonstophotos.net directly for this camera
and instead used a search-engine summary of two HTTP-403-blocked DPReview forum threads, flagged
`confidence: low` throughout, borrowing the Olympus E-M1 Mark III's full well (21,320 e-) as a
stand-in for the OM-1's own. **This pass reads the OM-1's own chart series directly** — it is tracked
on RN_e.htm/PDR.htm in its own right, so the E-M1 III stand-in is no longer needed; the OM-1's own
full well (19,491 e-) is about 9% lower than the E-M1 III figure that had been standing in for it.

| ISO | Read noise (e-) | PDR (EV) | Note |
|---:|---:|---:|---|
| 200 | 3.972 | 9.54 | start of normal analog range |
| 400 | 3.138 | 8.69 | |
| **800** | **2.657** | 7.83 | last low-conversion-gain point |
| **1006** | **1.705** | 7.73 | **first high-conversion-gain point — DCG switch** |
| 1600 | 1.602 | 7.06 | |
| 3200 | 1.444 | 6.11 | |
| 6400 | 1.310 | 5.12 | |
| 12800 | 1.283 | 4.13 | |
| 25600 | 0.979 | 3.16 | noise-reduction marker begins near here |
| 102400 | 0.973 | 1.18 | end of normal analog range, noise-reduction marker |

**DCG switch: ISO 800 -> 1006** (essentially ISO 800 -> 1000), a -1.94 stops/stop cliff — a real but
visibly gentler cliff than the two Sony full-frame/APS-C sensors' (-3.2 to -3.7 stops/stop). This
confirms, from the primary chart rather than a blocked-page search summary, the
`research/sensor-sources.md` note (itself sourced from a DPReview-forum discussion and a 43rumors
summary) that "the OM-1 sensor shows some advantage due to the dual-gain at ISO1000."

**Lineage cross-check** — Olympus OM-D E-M1 Mark III (`Olympus OM-D E-M1 Mark III_12` on RN_e.htm,
`Olympus OM-D E-M1 Mark III` on PDR.htm), the OM-1's direct predecessor and the same sensor
`research/sensor-sources.md` previously used as an OM-1 stand-in: full well 21,320 e-, unity ISO
1108. Its own curve has **no comparably sharp cliff** anywhere in its normal analog range — the
steepest candidate found is ISO 1600 -> 2011 at only -1.27 stops/stop, a soft knee rather than a real
second conversion-gain region — consistent with the existing research note that the OM-1's dual-gain
step is new relative to its predecessor, not shared. Full table:
`data/read-noise.json`, `cameras["OM System OM-1"].crossCheck_emIII["Olympus OM-D E-M1 Mark III"].points`.

## Unity-gain / conversion-gain figures, summarized

| Camera | Unity ISO (RN_e.htm) | Unity ISO (DxOMark-derived) | Full well, RN_e.htm (e-) | Full well, DxOMark-derived (e-) |
|---|---:|---:|---:|---:|
| Sony a7R IV | 217 | 217.1 | 34,452 | 35,520 |
| Sony a6400 | 230 | 229.6 | 36,443 | 37,104 |
| OM System OM-1 | 1013 | n/a (not DxOMark-tested) | 19,491 | n/a |

"Unity ISO" is photonstophotos' own term (shown verbatim in the chart's legend-click popup: `'Unity
ISO ' + Math.round(3.125 * Math.pow(2, unityEv))`) for the ISO at which the sensor's analog
conversion gain is exactly 1 DN per electron equivalent — the reference point its saturation/EDR
tooltip math is built from. It is not itself a "recommended" or "base" ISO.

## Open items for the lead / next pass

1. **DCG-switch ISO is a derived reading of Claff's published curve**, not a value either chart
   states as a single labeled field — see "Method" above. It is a robust, reproducible reading (same
   slope-based rule applied identically to all six series here, agreeing with Kasson's prose for the
   a7R IV and with the DPReview-forum-sourced claim for the OM-1), but it is `derived`, not
   `reported`, and should be labeled that way anywhere it's quoted.
2. **This session could not get the interactive chart itself to render** in headless Chromium
   (`code.highcharts.com` returned HTTP 403 to this sandbox — see Method). Every number here was
   independently cross-checked against a plain `curl` fetch of the same three URLs instead of a
   rendered-chart screenshot; see `.local/read-noise/captures/*_curl.html`. Someone with a working
   Highcharts CDN path could still get a pixel-level visual confirmation as a belt-and-suspenders
   check, but it is not expected to change any number.
3. **The a7R IV's RN_e.htm also carries a `Sony ILCE-7RM4(APS-C)` series** for the camera's in-camera
   APS-C crop mode; not used here, since `data/sensors.json`'s full-frame pick is the native
   full-frame readout.
4. **`data/sensors.json` should be updated** to use this file's OM-1 full well (19,491 e-, direct)
   in place of its current E-M1 III stand-in (21,320 e-, low-confidence), and to add per-ISO read
   noise / DCG-switch-ISO / unity-gain-ISO to all three records, which it currently lists as an open
   problem. Left for the lead to merge, since this agent's assigned paths are
   `research/read-noise.md` / `data/read-noise.json` / `.local/read-noise/` only.
5. **Per-channel (R/G/B) read noise** was not requested by this task and was not extracted;
   `RN_e.htm`/`PDR.htm` are both panchromatic (whole-pixel) figures.

## Scripts

Extraction and build scripts (not part of the shipped data, kept for reproducibility):
`.local/read-noise/explore.cjs` (initial page-structure probe), `.local/read-noise/parse_rn.cjs`
(bracket-balanced series extractor), `.local/read-noise/build_tables.cjs` (ISO/electron conversion +
DCG-slope detection), `.local/read-noise/build_final.cjs` (assembles `data/read-noise.json`),
`.local/read-noise/check_errors.cjs` / `screenshot_verify.cjs` / `inspect_serieslist.cjs` (the
CDN-403 / empty-legend investigation described in Method). Raw captures in
`.local/read-noise/captures/` (`*_initial.html` = Playwright, `*_curl.html` = plain curl,
`*_initial.png` = screenshots, `*.selected.json`/`built_tables.json` = intermediate extracted data).
