# Visual critic rubric — Photon to Photo

Status 09/28/2026, art-director. For the critic agent reviewing screenshots and short screen recordings at each
gate, per `docs/BRIEF.md`. Score every axis for every reviewed set piece; a gate does not pass until every axis
below passes for every set piece it covers, on both a desktop and a phone capture. See `design/LOOK.md` for the
reasoning behind each check; this document is the pass/fail test, not the argument.

## How to use this

For each screenshot or clip under review:

1. Identify which set piece(s) it shows and at what quality tier (desktop/phone, and which governor tier if known).
2. Score each of the five axes below: **pass**, **fail**, or **n/a** (with a one-line reason n/a applies).
3. Separately, run the "looks cheap" smell list against the same material — a smell hit is a fail on **polish**
   even if nothing else on this list catches it; list every smell found, don't stop at the first.
4. A gate passes only when every axis is a pass (or a justified n/a) for every set piece the gate covers, on both
   desktop and phone.
5. Write findings as concrete, falsifiable statements tied to a specific frame/timestamp and location on screen —
   "the iris blade edges alias at f/16, timestamp 0:03, visible against the dark barrel interior" not "the iris
   looks rough."

## Axis: Legibility

Can a reader who has never seen this before tell what they're looking at, in under a few seconds, without opening
a part card?

**Pass tests**

- The set piece's subject (what's the point of this shot) is identifiable from the framing alone, before reading
  any label — check the composition notes in `design/LOOK.md` for what each set piece's camera/framing/labeling is
  supposed to achieve, and verify the actual shot achieves it.
- Every number on screen is readable at its rendered size against its actual background (not just against a solid
  swatch) — check HUD numbers, spec rows and pin labels against the busiest part of the frame they appear over, not
  just a clean corner.
- The scale badge is present and correct wherever `design/LOOK.md`'s Scale badge section says it must be, and
  absent where the shot is already at legible native scale.
- Labels don't compete with each other for the same screen region — see "overlapping labels" in the smell list.
- Color alone is never the only channel carrying a distinction that matters (e.g., ray wavelength should be
  distinguishable by more than hue where two close wavelengths would be hard to tell apart at small size — check
  whether a legend, position, or secondary cue exists).

**Fail tests**

- A reader would need a caption to know what set piece this is.
- A HUD/label readable in isolation is not readable in the actual frame (low contrast against a bright glass
  highlight or a light material behind it).
- The scale badge is missing where required, present with a stale/incorrect exponent, or shown on a shot that's
  already true-scale (over-use that trains readers to ignore it).

## Axis: Correctness

Does the rendered frame match what the engine actually computed for that exact setting state? This is the visual
accuracy gate from `docs/BRIEF.md`, made concrete per set piece.

**Pass tests**

- **Ray landing points** (set piece 2, 5): sample a rendered ray's exit point at the image plane and compare to the
  engine's own traced landing point for the same wavelength bin and field angle; must agree within a documented
  pixel tolerance.
- **Airy disk radius** (set piece 4): measured on-screen radius (converted through the known pixel-to-physical
  scale of that shot) matches `1.22 λ N` for the current wavelength and f-number within tolerance.
- **Bokeh/CoC disk diameter** (set piece 3): measured disk diameter matches the engine's predicted circle of
  confusion for the current focus distance, subject distance and f-stop within tolerance, including its cat's-eye
  distortion shape toward the frame edge (not just its on-axis diameter).
- **Noise standard deviation** (set piece 1, 6): sampled pixel-value spread in a uniform region of the rendered
  test scene matches `sqrt(signal)` (shot noise) within tolerance for the current exposure and ISO.
- **Well fill** (set piece 6, 9): rendered fill height and rendered fill brightness both equal
  `electrons / fullWellCapacity` from the engine for that pixel — check both channels independently, since the
  Materials rule requires them to agree redundantly, and a bug could break one while the other still looks right.
- **Iris blade geometry**: rendered blade count and rounding match the lens's own `iris.blades`/`iris.rounded`,
  and the aperture opening at a given f-stop matches the engine's geometric aperture diameter, not an eyeballed
  animation.
- **Spectral color consistency**: two on-screen swatches/rays for the same wavelength (e.g., a ray inside the lens
  and the same wavelength's dot in a legend) render pixel-identical color — sample both and diff them.
- **A changed setting visibly and correctly changes the frame**: pick any control the set piece exposes, change it,
  and confirm the rendered frame changes in the direction and rough magnitude the engine predicts — this is the
  brief's own bar ("changing any setting visibly and correctly changes the photo") and it's the cheapest test to
  run wrong (a screenshot pair where nothing actually looks different is an automatic fail regardless of what the
  numbers say happened underneath).

**Fail tests**

- Any of the above measured off by more than its documented tolerance.
- A control changes the readout numbers but the rendered image doesn't visibly change (numbers and picture have
  drifted apart — this is a correctness fail, not just a legibility one).
- A "representative"/schematic lens is shown or labeled in a way that implies it's a specific real commercial
  lens's true prescription, when `docs/BRIEF.md`'s discipline requires it be marked schematic.

## Axis: Polish

Does this look like a finished, professional visualization, or a work-in-progress? This axis absorbs the "looks
cheap" smell list below — any smell hit is logged here.

**Pass tests**

- Materials read as their real-world counterpart at a glance (glass reads as glass, brushed metal as metal, matte
  black as painted metal, not as "default gray plastic") — compare directly against the material swatches on
  `design/reference-board.html`.
- Edges (element rims, barrel machining lines, pixel grid boundaries) are clean at the render resolution actually
  shipped, not just at a downsampled screenshot.
- Motion (where the clip shows it) matches the Motion section of `design/LOOK.md`: physics-driven numbers snap,
  mechanisms move at their stated real-ish speed, dives follow the logarithmic-dolly/easing-curve rule.
- No default/unmodified Three.js material anywhere in frame (see smell list).

**"Looks cheap" smells — check every one, log every hit, not just the first**

- Flat, unlit shading (a surface with no specular response, reading as a paint swatch rather than a lit 3D object).
- Aliasing on thin lines — ray traces, barrel machining lines, iris blade edges, pixel-grid lines at small scale.
- Z-fighting — coincident or near-coincident surfaces flickering or striping (check element-to-element gaps in the
  lens cutaway especially; also glass-wall-to-fluid boundaries in the wells).
- Clipped text — any label, HUD readout or part-card value truncated by its own container, especially long unit
  strings or large tabular numbers at the size scale's largest sizes.
- Default Three.js materials — the unmistakable flat-gray or unlit-magenta/checkerboard fallback appearance,
  anywhere.
- Uniform glow / bloom-everywhere — any material or region emitting an even soft glow that isn't the single
  permitted tightly-thresholded highlight bloom described in `design/LOOK.md`.
- Jitter — a value, label or geometry that trembles frame to frame when nothing in the underlying state changed
  (a resampled position without hysteresis, a label anchor that isn't stable).
- Color banding — visible stepping in a gradient (environment reflections, the Airy pattern's falloff, bloom edge
  if used), especially over the black ground where banding is most visible.
- Overlapping labels — two or more text labels/pins whose bounding boxes intersect in the reviewed frame.
- Black voids on phone — any region on the phone-tier capture that reads as pure undifferentiated black where
  desktop shows geometry (a symptom of an effect being dropped without checking what it leaves behind — e.g. AO
  radius cut so far that a crevice goes to pure black, or the PMREM environment dropped so far that glass shows no
  reflection at all and reads as a hole).
- Perfectly flat black interiors reading as a void rather than a material (see Materials, matte black internals —
  zero reflectance is itself a smell, not just an efficiency win).
- A zero-height mesh's stray top face visible from a grazing angle (the brief's own named pitfall).
- An opaque container where the brief calls for glass (wells; any other "see what's inside" shot).
- A top-down/near-top-down shot where quantity is legible only by area/diameter, with no brightness cue backing it
  up.

## Axis: Phone

Every set piece must stay readable at phone width per `design/LOOK.md`'s Phone rules — effects drop, content
doesn't.

**Pass tests**

- The subject is still identifiable at a glance at phone width (same bar as the desktop legibility test, run
  again against the phone capture specifically).
- HUD numbers, spec rows and pin labels are still legible at their phone-tier rendered size — not shrunk below the
  type scale's stated minimums.
- The scale badge is present wherever required, at legible size, not crowded out by other phone-width UI.
- Whatever effect budget was dropped for the phone tier (AO radius, PMREM resolution, particle count) is
  specifically what the Phone rules table in `design/LOOK.md` says may drop — nothing on the "keeps always" side
  of that table is missing.
- Where photon/particle count was reduced, the scale badge's stated ratio was re-derived for the actual reduced
  count, not left describing the desktop count.

**Fail tests**

- Pinch-to-zoom or squinting is required to read any HUD number or label that desktop shows clearly.
- A "keeps always" item from the Phone rules table (real geometry, spectral color accuracy, evidence chips,
  physically-timed motion) is visibly missing or degraded on the phone capture.
- Any "black voids on phone" smell (see Polish) present.

## Axis: Desktop

The full-effect tier, judged against what the brief calls for when nothing is budget-constrained.

**Pass tests**

- Full AO/GTAO, full PMREM environment resolution, full ghost-path count are all actually present in the capture
  (not silently running at a lower tier by mistake) — compare against the Phone rules table's desktop-high row.
- 60fps target is met or the capture states the measured frame time next to the screenshot/clip (a screenshot alone
  can't prove frame rate; a recording or a stated measurement must accompany any desktop-tier review that claims
  the perf bar is met).
- If the single permitted highlight-bloom pass is enabled for this capture, its threshold and extent match
  `design/LOOK.md`'s post-processing rule (strictly above any normal physics-color value, on the brightest physical
  highlight only) — flag any bloom that looks like it's catching more than that.

**Fail tests**

- Desktop-tier capture is visually indistinguishable from a phone-tier capture (effects claimed as desktop-only
  aren't actually visible) — a real regression, not just a missed opportunity.
- Frame rate claims are unverifiable (no recording, no stated measurement) on a capture reviewed specifically for
  the desktop perf bar.

## Reporting format

For each set piece reviewed, report:

```
Set piece: <name/number>
Tier: <desktop|phone> <quality tier if known>
Legibility: pass|fail — <one line>
Correctness: pass|fail|n/a — <one line, cite the measured value vs. expected>
Polish: pass|fail — <one line per smell found, or "none found">
Phone: pass|fail|n/a
Desktop: pass|fail|n/a
```

A finding without a specific frame/timestamp and screen location is not actionable — reject it back to the
reviewer rather than let it block or pass a gate on vibes.
