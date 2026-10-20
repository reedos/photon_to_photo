# Exteriors research: lens barrels, the generic body, the sensor stack and the shutter

_Exteriors agent, 09/28/2026. Data files: `data/hardware/lens-exteriors.json`, `data/hardware/body.json`.
American English, dates M/D/Y, all sources accessed 09/28/2026 unless noted._

This note covers three tasks: (A) exterior dimensions and control layout for all 12 lenses in
`data/lenses/*.json`, (B) a representative generic full-frame mirrorless body envelope, and (C) the sensor
filter stack and focal-plane shutter. It records what was found, what conflicts, and what had to be assumed
and why -- the JSON files carry the actual figures with per-field evidence labels; this file is the prose
account of the reasoning behind them.

## Task A: lens exteriors

### The five tied lenses

Five of the twelve lens designs in `data/lenses/*.json` carry a `representativeOf` field tying them to a
real product (p20, p50, p85, p105, p135). For these, this task pulled the maker's own published exterior
spec -- diameter, length, filter thread, weight, aperture ring, focus-ring type, distance scale, hood --
directly from the manufacturer's own spec page where it loaded, and from a specification aggregator
(Wikipedia infobox transcribing the maker's own numbers, B&H/Imaging-Resource/DPReview spec tables, or a
professional review site) where the manufacturer's own page returned an error or omitted a field. Every
figure in `data/hardware/lens-exteriors.json` for these five lenses carries its own source URL and location.

Two patterns held across all five, and across every DSLR-mount lens looked at in this task more broadly:

- **No aperture ring.** Every DSLR-era autofocus lens checked here -- Sigma's DG HSM Art line, Nikon's G-
  and E-type Nikkors, Canon's EF USM L-series -- controls aperture from the camera body, with no ring on the
  barrel. This has been true of every mainstream AF lens since roughly the late 1980s/1990s transition away
  from manual-aperture rings, with Nikon's G-type designation (no ring) formalizing it in 2000 and E-type
  (electromagnetic diaphragm) continuing it. The one exception in this whole lens table is p135 (Sony FE
  135mm F1.8 GM), a mirrorless-native design: Sony's GM prime line brought aperture rings back, with a
  de-click switch for video use. That is a real, sourced difference, not an inconsistency in the data.
- **Focus ring is mechanically coupled**, direct to a ring-type ultrasonic (or, for Nikon, Silent Wave)
  motor, with full-time manual override by turning the ring during autofocus -- not focus-by-wire -- for
  every DSLR-mount lens in this table. p135 (Sony, mirrorless-native, linear-motor AF) is again the
  exception: it is focus-by-wire, following Sony's uniform E-mount design (this specific fact was not
  independently confirmed in a source read this session for the 135mm GM in particular; it is derived from
  Sony's documented FE/GM-wide linear-motor, focus-by-wire manual-focus implementation, and flagged `derived`
  rather than `spec` in the JSON).

**p20 (Sigma 20mm F1.4 DG HSM Art)** has no filter thread at all -- its front element is bulbous and
protrudes past the barrel, so Sigma supplies a fixed, non-removable hood in place of a normal filter ring.
This is worth flagging for the modeler explicitly since every other lens in the table has a conventional
flat front filter thread.

**p135 (Sony FE 135mm F1.8 GM)** is the one figure set assembled from a search-engine summary of a Sony
regional spec page (`sony-mea.com`/`sony-asia.com`) rather than a page this session could load directly --
every direct WebFetch attempt at Sony's own spec pages returned HTTP 403. The 89.5 x 127mm diameter x
length and 950g weight figures were corroborated by a second, independent B&H product-listing fetch for
weight and filter size (950g, 82mm), so confidence is reasonable despite not reading Sony's own page text
directly. No source found this session states whether p135's real counterpart has a distance-scale window;
Sony's modern GM primes are consistently reviewed and photographed without one (focus distance instead
appears as an on-screen overlay), so `distanceScale` is recorded `false` but labeled `assumed`, not `spec`.

### The seven class-representative (untied) lenses

For p24, p28, p35, p200, p300, p400 and p500, the brief asks for representative values for the class from
two or three real lenses of the same focal length and aperture, each cited, with the chosen value labeled
assumed. The method used throughout: pull the same figure (diameter, length, filter, weight) for every
cited real lens, note the range, and take a rounded value near the mean -- documented per-field in
`classSources` arrays in the JSON, so the modeler can see exactly which real lenses fed each number and
recompute a different weighting if needed.

**24mm f/1.4 (p24):** Sigma 24mm F1.4 DG HSM Art, Canon EF 24mm f/1.4L II USM, Nikon AF-S NIKKOR 24mm f/1.4G
ED. This is the cleanest of the seven classes -- all three are genuine same-focal-length, same-aperture
primes from the DSLR era, and their figures cluster tightly (diameter 83-86.9mm, filter unanimously 77mm).
High confidence.

**28mm f/1.8 (p28) -- flagged low-confidence.** This is the one class where the patent design's own marked
aperture (f/1.8) does not match what the real-lens market actually sells at 28mm. The only genuine 28mm
f/1.8 product found is Canon's small, old, consumer-grade EF 28mm f/1.8 USM (73.6 x 55.6mm, 310g, 58mm
filter, 7 elements) -- a much simpler, smaller design than p28's own patent prescription (15 elements in 13
groups, per `data/lenses/p28.json`). The two other real lenses found at 28mm are both faster, f/1.4 designs
(Sigma 28mm F1.4 DG HSM Art and Nikon AF-S NIKKOR 28mm f/1.4E ED), which are considerably larger (83mm
diameter, 100.5-108mm length, 645-960g). Rather than either (a) averaging all three straight, which would
silently blend an f/1.8 consumer lens into an f/1.4 premium-lens average and produce a number that matches
neither real population, or (b) picking one arbitrarily, the chosen figures in the JSON interpolate: sized
closer to the f/1.4 pair than to the small Canon design, on the reasoning that p28's element count (15/13)
is architecturally much closer to a fast premium design than to Canon's simple 7-element consumer lens. This
is explicitly a judgment call, not a mechanical average, and it is marked `lowConfidence: true` in the JSON
alongside the reasoning per field. If the lead or the lens-and-optics-rendering agent has a stronger view on
how big p28 should read (e.g. deliberately building it as a compact consumer lens to match the real f/1.8
product, contradicting the patent's own higher element count, or leaning fully into the f/1.4-class size),
this is the figure set to revisit.

**35mm f/1.4 (p35):** Sigma 35mm F1.4 DG HSM Art, Nikon AF-S NIKKOR 35mm f/1.4G, Canon EF 35mm f/1.4L II
USM. Clean same-focal-length, same-aperture match across all three; the main variance is Canon's L-series
being noticeably longer and heavier (105.5mm, 760g) than the Sigma/Nikon pair (89.5-94mm, 600-665g),
consistent with Canon's L-series build generally running larger. Filter size is 2-of-3 (Sigma, Nikon at
67mm; Canon at 72mm) so 67mm was taken as representative.

**200mm f/2 (p200), 300mm f/2.8 (p300), 400mm f/2.8 (p400), 500mm f/4 (p500):** these four
super-telephoto classes share a pattern -- Nikon and Canon both publish full DSLR-era figures for their
own f/2, f/2.8/2.8 and f/4 primes in this range, and those two anchor every class. A third real lens was
added where one could be confirmed with a full figure set:

- p200: only Nikon (AF-S NIKKOR 200mm f/2G ED VR II) and Canon (EF 200mm f/2L IS USM) were used; Sigma's
  2025-era 200mm F2 DG OS Sports exists and is real, but no independent dimension set for it was found in
  this session's searches, so it was left out rather than guessed.
- p300: Nikon (AF-S NIKKOR 300mm f/2.8G ED VR II) and Canon (EF 300mm f/2.8L IS II USM) anchor the average;
  Sony's FE 300mm F2.8 GM OSS (a genuinely lighter, more modern mirrorless-native design at 1470g vs.
  2400-2900g for the DSLR-era pair) was found and is noted in the JSON, but excluded from the numeric
  average since p300's own patent (US 6,115,188, filed 2000) is architecturally a DSLR-era design, and
  blending in a 20-years-newer, deliberately lightened mirrorless design would understate what a design
  from that era should weigh.
- p400: Nikon (AF-S NIKKOR 400mm f/2.8E FL ED VR), Canon (EF 400mm f/2.8L IS III USM) and Sony (FE 400mm
  F2.8 GM OSS) were all used for length and weight; Sony's own diameter figure was not obtained as text in
  any search this session (only length and weight extracted cleanly), so the diameter average uses only
  Nikon and Canon.
- p500: Sony does not make an FE 500mm F4 GM lens (a targeted search for one turned up only the FE 600mm
  F4 GM OSS and the newer, slower FE 400mm F4.5 GM OSS -- confirmed absent from Sony's current lineup, not
  a search failure), so Sigma's 500mm F4 DG OS HSM Sport was substituted as the third/primary real lens
  alongside Nikon (AF-S NIKKOR 500mm f/4E FL ED VR) and Canon's predecessor-generation EF 500mm f/4L IS II
  USM (the current III-series lens's own dimensions were not found as text this session; the II's figures
  are used and flagged).

All four super-telephoto classes use a rear drop-in filter rather than a front screw thread (52mm for
Nikon/Canon 200-300mm and Canon 400mm, 40.5mm for Nikon/Sony 400mm and Sigma 500mm, 46mm for Sigma 500mm);
the `filterMm` field in the JSON for these four lenses should be read as "drop-in gel/filter size," not a
front thread diameter, and this is noted per-entry. All four are also given a removable, rotating tripod
collar (`tripodCollar` field) since every real lens checked in this size class ships with one; no source
was needed to establish this as it is near-universal in the category and is labeled `assumed` accordingly.

### What could not be found, for any lens

No source found in this session, for any of the twelve lenses (tied or class-representative), states where
along the barrel the focus ring physically sits. Reviews describe the ring's feel, width, resistance and
rotation angle (Sigma 50mm Art's 92-degree quarter-turn was the one specific figure found) but not its
axial position on the lens. Every `focusRing.positionOnBarrel` field in `data/hardware/lens-exteriors.json`
is `null` with a note pointing the modeler to derive it instead from each lens's own focus-group position,
which the physics files in `data/lenses/*.json` already encode via the `focus.gaps` entries (the surface
index whose air gap changes between infinity and close focus marks where the moving focus group sits, and
the focus ring is conventionally positioned on the barrel roughly over that group).

## Task B: the generic body envelope

Reed's 09/28/2026 decision: the body is generic and unbranded, representative rather than any one maker's
product, modeled in high detail and exact wherever the physics depends on it (sensor position, mount
opening, flange distance -- those live in this project's lens/sensor/mount data elsewhere, not in this
file). This task gathered published dimensions from four current full-frame mirrorless bodies across four
different makers -- Sony a7 IV, Canon EOS R5, Nikon Z6III, Panasonic Lumix S5II -- and rounded toward the
middle of the range for each figure, recorded in `data/hardware/body.json`'s `envelope` block with each
maker's own number in a `classSources` array.

The width and height figures cluster reasonably tightly (131.3-138.5mm wide, 96.4-102.3mm tall). Depth is
the outlier: 74mm (Nikon Z6III) to 90.1mm (Panasonic S5II), a range wide enough to flag on its own, because
makers are not consistent about what "depth" includes -- some measure body-only from the mount flange to
the back of the screen, others include the EVF hump or the grip's forward protrusion. This project's
representative 83mm depth is a straight rounded mean across the four regardless, since no source separated
out the measurement convention cleanly enough to normalize before averaging; the modeler should treat depth
as the softest of the three envelope figures.

**Grip depth** has no independent published figure from any maker; it was derived as roughly half the
representative body depth, based on how grip protrusion typically reads in full-frame mirrorless body
photos and CAD renders compared to total body depth, and is flagged `assumed` with no numeric source. This
is the weakest figure in the whole body block and should be replaced with a measurement from an actual body
reference drawing if the lens-and-optics or UI rendering agents have access to one.

**Top-plate dials:** a mode dial, front command dial and rear command dial are near-universal across the
four cited bodies (3 of 4 have a physical mode dial; Canon uses a mode button instead, and all four have
front/rear command dials under different maker names -- Nikon's "sub-command"/"main command," Canon's "Main
Dial"/"Quick Control Dial"). A dedicated exposure-compensation dial is genuinely a 2-of-4 feature (Sony and
Panasonic have one; Canon and Nikon's Z6III assign exposure comp to a button+dial combination instead) --
it is still included as `true` in the representative body because it reads as a natural, common top-plate
control point worth modeling, but this is flagged explicitly as not unanimous, unlike the mode/command
dials.

**EVF hump and rear screen:** included qualitatively (present, roughly central) rather than as a precise
dimensioned housing, since no maker publishes external EVF-housing dimensions separately from full-body
dimensions. Screen size (3.0in for 3 of 4 cited bodies; Nikon Z6III uses a larger 3.2in) and EVF resolution
(a genuinely wide 3.68M-5.76M dot range across the four) are recorded for completeness but are not
load-bearing for this project's physics.

**The image plane mark:** the circle-with-a-line (Phi) symbol engraved on nearly every camera's top plate
does mark the sensor plane, confirmed by two independent consumer-explainer sources (havecamerawilltravel.com
and PetaPixel) that describe its purpose (macro-photography and panorama-stitching subject-distance
measurement) consistently. This is a well-established, unambiguous convention across virtually every
interchangeable-lens camera made, film or digital, DSLR or mirrorless.

## Task C: sensor stack and shutter

**Sensor filter stack.** The clearest, most citable figure found is Roger Cicala's (LensRentals) own
measurement convention: an "air-equivalent thickness" computed via a non-contact optical method, which
"assuming a refractive index of 1.52... typically has a thickness of 0.7mm" -- but that 0.7mm is the
air-equivalent figure, not the physical glass thickness, and Cicala is explicit that raw physical-thickness
measurements across the DSLR/mirrorless cameras he tested varied roughly 2-4.5mm and that his own numbers
are "guesstimates, probably accurate to 0.5mm or perhaps 0.25mm." A second source (a Phillip Reeve blog post
comparing filter stacks across Sony E, Nikon Z, Leica M and a Kolari Vision "Ultra-Thin" modification)
confirms the stack's composition (cover glass, IR/UV-cut filter, and an anti-aliasing/low-pass filter on
some cameras) and states plainly that two stacks of the same physical thickness can behave differently
depending on the glass's actual refractive index -- but its own main text does not give numerical
thicknesses; a specific Sony E approx. 2.5mm vs. Nikon Z approx. 1.6mm pairing showed up only in this
session's search-summarized version of that page's comments, not in a passage this session read directly,
so it is not used as a citable figure. Given that spread, `data/hardware/body.json` records a rounded 2.0mm
representative physical thickness, explicitly flagged as a placeholder pending a direct, first-person read
of a Kolari Vision or LensRentals numeric table (both sites returned incomplete or non-numeric content to
this session's search and fetch tools). The refractive index used, 1.52, is Cicala's own stated convention
figure (close to ordinary N-BK7 optical borosilicate, nd approx. 1.517) rather than a measurement of any
specific camera's actual glass.

Why it matters optically: a lens's rear-element prescription is computed assuming a specific stack thickness
and index sits between the last glass surface and the photodiode. Change that stack (by removing it for an
infrared conversion, thinning it, or adapting a lens designed for a different mount's stock stack) and the
effective back focal distance shifts, with fast, wide-aperture lenses showing the largest resulting
spherical aberration and coma -- this is precisely why Kolari Vision sells "thin filter" conversion kits
targeted at legacy rangefinder-lens adapter use, and why this project's docs/BRIEF.md calls out "lenses are
designed for a given stack thickness" as something the model needs to represent.

**Focal-plane shutter.** This project's own default exposure is f/4, 1/250s, ISO 100 (stated in the prior
status update this task's harness relayed as context). 1/250s is also a very common flash sync speed for a
full-frame mechanical shutter, which gives a clean way to derive a representative curtain travel time: the
X-sync speed is, to a first approximation, the shutter speed at which the first curtain finishes opening
just as the second curtain begins to close, so sync speed and curtain travel time are close to the same
number. A period-correct camera that explicitly advertised its own curtain speed, the Nikon FE2, measured
3.3ms of curtain travel supporting exactly a 1/250s sync -- used here as the empirical cross-check. A more
general exposure-technique source states that curtain travel for a 1/250 sync speed camera runs "about 1/300
to 1/400 second" (2.5-3.3ms), consistent with the FE2 figure. `data/hardware/body.json` records 4ms
(1/250s) as the representative curtain travel time, derived from -- and cross-checked against -- these two
sources, rather than a single camera's own from-datasheet number, since no full-frame mirrorless maker
publishes curtain travel time directly; sync speed is the number they do publish, and it stands in for it.

For the electronic-shutter comparison the brief asks for, this file borrows a figure this project's own
`data/sensors.json` already carries rather than re-deriving one: the Sony a7R IV / IMX455 record's own
measured full-sensor electronic rolling-shutter readout time, 100.3ms, sourced there to the
horshack-dpreview.github.io RollingShutter LED-strobe measurement project. At roughly 25x slower than the
derived 4ms mechanical curtain sweep, this is the physical reason rolling-shutter skew on a fast-moving
subject is dramatic in full electronic-shutter mode and essentially invisible with a mechanical or
electronic-first-curtain shutter -- exactly the comparison the task asked this file to make.

**IBIS.** No camera maker publishes a sensor-shift travel range in millimeters for any current full-frame
mirrorless body; this is treated by every manufacturer as an internal mechanical detail, not a marketing
spec (stops of compensation, e.g. "7 stops," is what gets published instead, and that is a measure of
shake-correction effectiveness at a given shutter speed and focal length, not a distance). A 2015 LensRentals
teardown of the Sony a7 II's IBIS mechanism describes qualitatively "a surprising amount of range" without a
number; general forum discussion of how 5-axis IBIS works states informally that "just one millimeter is
enough for it to work, and two millimeters in each direction would probably make a huge difference" -- again
not a citable spec, just informed commentary. `data/hardware/body.json` records a 2mm order-of-magnitude
placeholder for total in-plane sensor travel budget, explicitly labeled not authoritative, constrained only
by the physical logic that the sensor must stay within the lens's image circle margin to avoid vignetting.
The 5-axis description itself (pitch, yaw, roll, X, Y) is well and consistently documented across every
major maker's own marketing language and is recorded with ordinary confidence.

## Summary of what is genuinely uncertain, for the lead

1. **p28's exterior size** is a judgment call between a real f/1.8 lens's small size and two real f/1.4
   lenses' larger size; flagged `lowConfidence` in the JSON. Worth a second opinion before it drives a
   rendered model.
2. **Sensor stack thickness** (2.0mm) is a rounded placeholder from an unclear source spread, not a solid
   citation; whoever builds the sensor-and-readout 3D set piece should try to get a direct, numeric read of
   Kolari Vision's or LensRentals' own tables before this number goes into anything the accuracy gate checks
   against.
3. **IBIS travel range** (2mm) is frankly a guess bounded only by physical plausibility, not a citation;
   treat it as a placeholder the modeler can adjust freely, not a number worth defending.
4. **Body depth** (83mm) and **grip depth** (38mm, fully derived with no source at all) are the softest
   envelope figures; grip depth in particular should be replaced by a real reference drawing if one turns
   up.

## Addendum, 09/28/2026: the PANE.md lineup lenses (s35, n50, n500, n500fl, z35, m50, z800)

docs/PANE.md replaces the three-tab layout with one camera-and-lens 3D model, DSLR (s35, n50, n500, n500fl on
Nikon F) and mirrorless (z35, m50, z800 on Nikon Z). None of these seven ids were in the original 12-lens
table above; this addendum researches their real exterior dimensions and control layout directly (live
WebSearch/WebFetch this session, 09/28/2026), rather than reusing the p-prefixed class-representative
figures, since all seven are tied to a specific real product already named in their own data/lenses/*.json
`representativeOf` field (or, for n500/n500fl/z800, named directly by the lens-exterior workstream's own
brief). Every field's own `src`/`loc` in `data/hardware/lens-exteriors.json` carries the exact page and quote;
this section is the prose account of what took more than one search to pin down.

- **s35 (Sigma 35mm F1.4 DG HSM Art).** Sigma's own global spec page states length varies by mount: SA-mount
  94.0mm, L-mount 118mm, with Nikon F-mount not broken out as its own row. Used SA-mount's figure (94.0mm) as
  the F-mount stand-in, on the reasoning that SA and Nikon F are both older DSLR-era mechanical builds for
  this lens (unlike L-mount, whose 24mm longer figure reflects L-mount's own different flange distance/
  mechanical adapter design inside the barrel) — flagged `spec` with the caveat, not silently treated as an
  exact F-mount number.
- **n50 (Nikon AF-S NIKKOR 50mm f/1.8G).** Clean, fully spec'd on Nikon USA's own page: 72 x 52.5mm, 185g,
  58mm filter, distance scale confirmed separately on Imaging Resource's spec table.
- **n500 (AF-S NIKKOR 500mm f/5.6E PF ED VR).** Nikon USA's own overview page did not print diameter/length
  in this session's fetch; Imaging Resource's specifications page (transcribing Nikon's own figures) gave
  106 x 237mm and 1,460g. The exact rear drop-in filter size was not found stated for this specific lens in
  any source this session; n500fl's own confirmed 40.5mm drop-in size (same maker, same PF-telephoto design
  era) is used as the representative figure and flagged `assumed`, not `spec`, for that one field only.
- **n500fl (AF-S NIKKOR 500mm f/4E FL ED VR).** Fully spec'd directly from Nikon USA's own page: 140 x 387mm,
  3,090g, 40.5mm slip-in filter, tripod collar confirmed removable with ball-bearing rotation by a Digital
  Camera World piece covering the same lens family.
- **z35 / m50 (NIKKOR Z 35mm f/1.8 S / Z 50mm f/1.8 S).** Both fully spec'd from Nikon's own pages (USA for
  z35, Nikon Asia for m50 — both load the same maker-published figures). Neither has a barrel distance-scale
  window; this matches every Z-mount S-line prime's own product photography and is recorded `assumed` rather
  than `spec` since no source states the absence directly, only its absence from every photo and spec table
  checked. Both have Nikon's standard programmable control ring, confirmed on Z-system reference pages.
- **z800 (NIKKOR Z 800mm f/6.3 VR S).** Nikon USA's own page gives 140 x 385mm and 2,385g directly. The 46mm
  filter is a **rear drop-in holder, not a front thread** — the front element sits behind a fixed hood mount
  with no front filter ring, the same mechanical pattern as n500/n500fl's rear slip-in filters but scaled up.
  No source found this session states its diaphragm blade count (data/lenses/z800.json's own `iris.blades: 9`
  is itself labeled `assumed` for the same reason) or confirms a tripod collar/control ring by spec-table text
  specifically for this model; both are recorded `reported`/`assumed` from this lens's own official product
  photography and Nikon's uniform Z S-line telephoto convention (matching n500/n500fl's own confirmed
  collars), not from a spec-table line item.

**Open problem carried forward, same shape as the original file's:** no source found this session for where
along any of these seven barrels the focus ring physically sits (front third / middle / near mount); every
`focusRing.positionOnBarrel` is `null` here too, same as the original 12-lens table, with the same fix: derive
it from the lens's own focus-group position in `data/lenses/*.json` rather than guess a barrel location no
maker publishes.

## Body depth convention: open (score loop r2, 10/11/2026)

The two body models read Nikon's depth figure two different ways. The DSLR's shell is 78.5 mm from the
rear plate (y -24) to the grip front (y 54.5), the D850's published depth, with the eyepiece block and
eyecup outside it (93.1 mm overall). The mirrorless shell is 74 mm (rear plate y -32 to grip front y 40)
and reaches the Z8's published 83 mm only with the EVF eyecup (to y -42.9). One of the two is wrong by
about 9 mm.

What the sources say. Nikon's own spec pages for both cameras (D850:
<https://onlinemanual.nikonimglib.com/d850/en/19_technical_notes_11.html>; Z8:
<https://onlinemanual.nikonimglib.com/z8/en/specifications_384.html>, both accessed 10/11/2026) give
"Approx. 146 × 124 × 78.5 mm" and "Approx. 144 × 118.5 × 83 mm" with no note on what depth includes;
on the same pages only the battery charger's row says "excluding projections". The industry rule is
CIPA DCG-005 ("Measurement and notation method for mass and dimensions of digital cameras"), listed on
CIPA's guideline page (<https://www.cipa.jp/e/std/std-sec-guideline.html>). Its text sits behind a
download page that asks the reader to accept CIPA's disclaimer, which this build did not do without
Reed's say-so, so the rule was not read. A secondary summary, read only through this session's web-search tool (the page itself returned HTTP 403 to a direct fetch)
(<https://cameradecision.com/size-comparison/La4A-4tAc>, 10/11/2026), says CIPA lets protrusions
be left out and keeps built-in parts of the shell such as the grip and the viewfinder hump; on that
reading the eyecup is out, the DSLR is right, and the mirrorless shell is about 9 mm too thin.

Decision: not changed this round. Deepening the mirrorless shell by 9 mm moves its rear plate, screen,
controls and EVF and rests on a secondary source. To close it: Reed accepts the CIPA disclaimer and reads
DCG-005's rule on protrusions (or a Nikon dimensioned drawing turns up). If eyecups are excluded, move the
mirrorless rear plate back so rear plate to grip front is 83 mm (`blender/mirrorless_v2.py` YB), and
re-run the GLB tests.

### Score loop r3 (10/11/2026): the CIPA rule as Impress Watch reported it

DCG-005 itself is still unread (CIPA's disclaimer page). But the news report on the guideline's launch,
Impress Digital Camera Watch, "CIPA, デジタルカメラの質量・寸法の測定・表記方法のガイドラインを制定"
(<https://dc.watch.impress.co.jp/docs/news/315584.html>, fetched 10/11/2026), gives its rule in the
guideline's terms, as summarized here from the article:

- dimensions are the three sides of the smallest box that encloses the body;
- a protrusion may be left out of a dimension if it covers 20% or less of that face's area (the rule taken
  over from JIS 27-1997);
- but a protrusion that stands out more than 10% of the dimension at right angles to that face cannot be
  left out;
- a lens that cannot be detached cannot be left out.

The rule is permissive: a maker *may* leave a small protrusion out and may also keep it in. Applied to the two
models:

- **Mirrorless (Z8).** The eyecup covers well under 20% of the rear's area (8% in the model, 11% in Nikon's
  rear drawing), but it stands 10.9 mm behind the
  74 mm shell's rear plate (14.7% of the depth), so under the rule it cannot be left out: the box runs from the
  grip front to the back of the eyecup, 82.9 mm, which is Nikon's 83 mm. The model's reading is the rule's, and
  the reviewers' concern (a shell 9 mm too thin) does not hold. **Closed; nothing moved.** Test:
  `blender-glb.test.ts`, "measures the published 83 mm from the grip front to the back of the eyecup".
- **DSLR (D850).** The model's 78.5 mm runs from the grip front to the rear plate, leaving out the screen
  (3.4 mm proud), the eyepiece housing (4 mm) and the eyecup (14.6 mm behind the rear plate in all). Under the
  rule a 14.6 mm protrusion on a 78.5 mm depth (18.6%) cannot be left out, so either the real D850's
  eyepiece stands out no more than about 7.9 mm (10% of 78.5), or Nikon's 78.5 mm does not follow the rule as
  reported. Nikon's top drawing (research/d850.md) shows the eyepiece only about 3 mm behind the rear outline,
  but that drawing is slightly tilted and was not used for depth. **Open:** the model's eyepiece length needs a
  published D850 eyepiece or eyecup dimension (the DK-17F eyepiece or the supplied eyecup), which this round did
  not find. The DSLR was not changed.

The mirrorless body was also checked against Nikon's drawings in x (research/z8.md, research/d850.md,
"Exterior traced from Nikon's manual drawings"): both bodies had the lens axis too far from the port-side end
(62 against the Z8's 56.5, 64 against the D850's 54.6), which this round corrects.

## Rear controls from Nikon's manual drawings (score loop r2, 10/11/2026)

Source: the rear views in Nikon's online manuals, D850 "Getting to Know the Camera"
(<https://onlinemanual.nikonimglib.com/d850/en/02_introduction_01.html>, image `img/d850_bd_rear_add.png`) and
Z8 "Camera Body" (<https://onlinemanual.nikonimglib.com/z8/en/camera_body_9.html>, image
`img/guid-065e3cee-f1e7-34fc-adf0-adfba8f061f6.png`), both accessed 10/11/2026. They are line drawings, close to
orthographic but not dimensioned; positions read off them are photo-derived, to about ±2 px (about ±1 mm).

D850 (`blender/dslr_v2.py`): the left column has six buttons, top to bottom MENU; protect / Picture Control /
help; zoom in; zoom out / thumbnails; OK; Fn2 (smaller), with playback and delete as a pair beside the eyepiece.
The model had seven identical buttons at an even 11 mm pitch. Scaled by the model's own screen frame (its top,
bottom and left edges match the drawing's at 0.326 mm per pixel; the frame's size itself is the model's, not
Nikon's), the column's centers are z 21.3, 8.6, -1.5, -12.6, -24.0, -35.4 at x -55.5, and the pair z 34.6 at
x -55.5 and -45.7.

Z8 (`blender/mirrorless_v2.py`): there is no column of buttons down the left of the screen; protect / Fn3 and
delete sit beside the viewfinder. On the right, from the top: AF-ON, the sub-selector, the i button, the
multi-selector, then zoom in and MENU over zoom out and playback in a two-by-two block. The model had five
buttons down the left and two below the multi-selector. Scaled across by the body's 144 mm (0.417 mm per pixel)
and up by its bottom-to-shoulder height (0.426 mm per pixel), the offsets from the multi-selector's center are:
i (-5.6, +15.0), zoom in (-6.2, -14.6), MENU (+6.7, -14.6), zoom out (-6.2, -27.2), playback (+6.7, -27.2) mm.
The drawing also shows the model's absolute positions are off by several mm in places (its multi-selector sits
about 8 mm left and 5 mm low of the drawing's, its sub-selector about 15 mm high, and its shoulder about 5 mm
high of the drawing's proportions); these were left as they were and are open.

Still open: button shapes and icons; the D850 hump outline and the eyepiece's relation to it; the grips' finger
recess. The same drawings (and the top views, `img/d850_bd_parts_top_add.png` and the Z8 page's top view) are the
source to use for them.

**Score loop r3 (10/11/2026):** the absolute positions are now the drawings', scaled by the published envelopes, for
both bodies' rear controls, the shoulder line and the top-plate controls; the hump outlines seen from behind and the
D850's eyepiece surround are traced too (research/z8.md and research/d850.md, "Exterior traced from Nikon's manual
drawings"). Still open: the grips' finger recess and flare in elevation and the humps' front rake, which need a
square-on front or side view that the manuals do not have; button shapes and icons.

### Score loop r4 (10/11/2026): the D850 eyepiece length is still not sourced

Searched again for a D850 eyepiece or eyecup protrusion (DK-17 and DK-17F listings, Nikon's specification page, Nikon
USA, DPReview, Imaging Resource, camera-size comparison sites) and for a CIPA-style depth measured without the eyepiece.
Nikon's own page gives "Approx. 146 x 124 x 78.5 mm" with no qualifier on the camera's row and no eyepiece dimension;
the eyepoint (17 mm from the eyepiece lens) is the only eyepiece figure, and it is not a protrusion. Nothing was
changed in the geometry: **the DSLR's depth is not reconciled**. The shell is 78.5 mm (rear plate to grip front), the
eyepiece housing and eyecup stand 4 and 14.6 mm behind the plate (93.6 mm overall), and the two bodies keep opposite
conventions (the mirrorless counts its eyecup inside its 83 mm). The Models page no longer claims the whole model is
"built to the published envelope": it quotes the number and says what the model's 78.5 mm covers
(public/models/bodies.json `depthNote`). To close it: a Nikon dimensioned drawing or a measured side view of the
eyepiece, or DCG-005's text read in full.

### Score loop r5 (10/11/2026): the DSLR eyepiece set to the CIPA ceiling

No D850 eyepiece or eyecup dimension turned up in a further search (listings for the DK-17, DK-19 and the body, Nikon's
pages, comparison sites). The DSLR's eyepiece housing and eyecup now stand **7.8 mm** behind the rear plate instead of 14.6,
so the two bodies read the rule the same way: the Z8's 10.9 mm eyecup on a 74 mm shell is 14.7% of the depth and counts in
its 83 mm; the D850's 7.8 mm on a 78.5 mm shell is 9.9% and can be left out of Nikon's 78.5 mm. The 7.8 mm is the model's
own length, chosen as the largest value the reported rule leaves out, and is flagged as such in `bodies.json` `depthNote`
(shown on the Models page). The open item is unchanged: a Nikon dimensioned drawing or a measured side view of the
eyepiece, or DCG-005's text read in full, would replace this number with a sourced one.

### Body depth convention: what the Models page says (score loop r6, 10/11/2026)

The convention above is unresolved, so the page now says it instead of leaving the two figures side by side: the DSLR's 78.5 mm
leaves its eyepiece out (the eyepiece stands 7.8 mm behind the plate, the model's own length, since no source gives a D850 eyepiece
or DK-17 depth: searched again 10/14/2026, nothing), and the mirrorless body's 83 mm includes its eyecup, so the two depths
are not directly comparable (`public/models/bodies.json` `depthNote`, shown with each body's size).
