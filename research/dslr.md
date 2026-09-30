# DSLR body — research note

Agent: dslr. Covers `data/hardware/dslr.json` only: what is specific to the generic full-frame
DSLR body (mirror box, sub-mirror, focusing screen, pentaprism, viewfinder, mirror-up timing,
the mirror's back-focus constraint on lens design, and the focal-plane shutter position). Body
envelope is included per the task, but the mount/flange-distance table and the exterior-styling
work belong to the mounts and exteriors agents, and the mirrorless body belongs to whichever
agent covers that. Accessed date for every source in this note: 9/28/2026. Dates M/D/Y.

## Summary table

| Figure | Value | Basis | Source |
|---|---|---|---|
| Body envelope (rounded representative) | ~145 x 115 x 80 mm (W x H x D) | assumed, from a 136.5-150.7 x 104.2-124 x 75.9-85.5mm range across 4 bodies | Nikon, Canon, Pentax, Sony spec pages |
| Main mirror rest angle | 45deg to the optical axis | spec | US 8,979,400 |
| Mirror hinge | top edge (nearest focusing screen, farthest from lens) | spec | US 7,824,114 |
| Main mirror size (derived floor) | 36mm (w) x >=34mm (h) | derived | geometry from the 24x36mm frame |
| Sub-mirror | hinged to main mirror's rear edge, folds against its back when mirror is up | spec | US 7,824,114, US 8,979,400 |
| Focusing screen | optically the same path length from the lens as the sensor | spec | Wikipedia, Single-lens reflex camera |
| Pentaprism path | mirror -> screen -> prism (2 internal reflections net) -> eyepiece | spec | Wikipedia, Single-lens reflex camera |
| Viewfinder magnification (4 bodies) | 0.70-0.76x | spec | Nikon/Canon/Pentax spec pages |
| Viewfinder coverage (4 bodies) | 100% | spec | same |
| Shutter lag incl. mirror flip (D850) | 76 ms | reported (3rd-party measurement) | Imaging Resource |
| Fastest mechanical-shutter frame rate found | 16 fps (Canon 1D X Mark III) | spec | Canon spec pages |
| Mirror clearance rule of thumb | ~40 mm for 35mm-format SLR | reported (uncited within its own source) | Wikipedia, History of photographic lens design |
| Focal-plane shutter position | immediately in front of the sensor stack | spec | Wikipedia, Focal-plane shutter |
| Shutter travel (vertical) | 24 mm | spec | Wikipedia, Focal-plane shutter |

## Body envelope

Four current-or-recent full-frame bodies, four different makers, all ordinary (non-integrated-
grip) body class so they're comparable to each other and to a generic mirrorless body:

| Body | W x H x D (mm) | Source |
|---|---|---|
| Nikon D850 | 146 x 124 x 78.5 | [nikonusa.com/p/d850](https://www.nikonusa.com/p/d850/1585/overview), Specifications tab |
| Canon EOS 5D Mark IV | 150.7 x 116.4 x 75.9 | [Wikipedia](https://en.wikipedia.org/wiki/Canon_EOS_5D_Mark_IV), infobox (citing Canon's own sheet) |
| Pentax K-1 Mark II | 136.5 x 110.0 x 85.5 | [DPReview specs](https://www.dpreview.com/products/pentax/slrs/pentax_k1ii/specifications) |
| Sony a99 II | 142.6 x 104.2 x 76.1 | [Wikipedia](https://en.wikipedia.org/wiki/Sony_%CE%B199_II), infobox (citing Sony's own page) |

Rounded representative value used in the JSON: **~145 x 115 x 80 mm**, the approximate midpoint
of each dimension's range across the four (labeled `assumed`, not any one product's spec). A
fifth body, the Canon EOS-1D X Mark III (167.6 x 158 x 82.6mm — note W/H are usually listed as
158 x 167.6 in that order because of the integrated vertical grip), was deliberately **excluded**
from this range: it's a pro integrated-grip body, a different class from the other four, and
including it would badly skew the height figure. It's still cited below for its viewfinder
magnification and its mechanical frame rate, since those aren't envelope-class-dependent.

**One caveat that matters for the whole rest of this file:** Sony's only current full-frame
SLR-type body, the a99 II, is a **fixed semi-transparent mirror (SLT)** design with an
electronic viewfinder (0.78x, 2.4M-dot OLED), not a swinging reflex mirror and an optical
pentaprism. It's kept in the envelope table above purely for maker diversity (the task asked
for "at least four current or recent full-frame DSLRs of different makers"), but it is
**excluded from every mirror-box, sub-mirror, focusing-screen, pentaprism and viewfinder figure**
in this note and in `dslr.json`, because this project models the swinging-mirror/pentaprism
mechanism the brief describes (mirror box, mirror, sub-mirror, pentaprism), which the a99 II
doesn't have. The mirror-box figures below rest on Nikon, Canon and Pentax only — three makers,
all of them true swinging-mirror pentaprism designs.

## The mirror box

**Rest angle and hinge.** US patent 8,979,400 ("Drive mechanism for movable mirror of camera")
states the main mirror sits in the photographing optical path at approximately 45 degrees to it
in the mirror-down (viewing) position — the standard, expected figure, corroborated in general
terms (angle not restated numerically) by [Wikipedia's Single-lens reflex camera
article](https://en.wikipedia.org/wiki/Single-lens_reflex_camera). US patent 7,824,114 ("Mirror
device of single-lens reflex camera") is more specific about the geometry: the main mirror pivots
on a "main mirror rotation axis" orthogonal to the taking lens's optical axis, on bearings in the
mirror box's left and right walls, at the mirror's **upper edge** — the edge farthest from the
lens, nearest the focusing screen. That's consistent with the general camera-wiki/Wikipedia
description of an instant-return mirror: it swings up and back out of the light path when the
shutter fires, and springs back down afterward.

**Main mirror size.** No maker publishes an exact main-mirror size in mm for any current body —
I searched Nikon, Canon and Pentax spec/support pages, DPReview and Imaging Resource reviews,
several camera-mirror-related patents (US 3,376,800; US 3,487,760; US 2,992,602; US 4,119,982;
US 2,891,454; US 2,949,073; US 7,824,114), and general web search for a stated dimension, and
none gave one. So `dslr.json` carries a **derived lower bound** instead, not a spec: at a 45-
degree tilt, the mirror's dimension along the optical-axis direction foreshortens by cos(45deg)
when projected onto the sensor's 24mm height, so the minimum mirror height to clear the full
frame is 24 / cos(45deg) = 24 x 1.41421 = **33.94mm**, rounded to 34mm; the width (parallel to
the hinge axis, unaffected by the tilt) must be at least the sensor's 36mm. Real mirrors are cut
somewhat larger than this bound to clear the full angular spread of a large-aperture lens's exit
pupil at the frame corners without vignetting the viewfinder image — third-party replacement-
mirror listings (not independently verified here, so not carried as a source) put real mirrors
in roughly the 38-44mm range on this axis, consistent with the derived bound plus a working
margin, but that's not cited as a fact in the JSON.

**Semi-transparent zone and the sub-mirror.** US 8,979,400 states the main mirror is "configured
as a half-mirror," and that a sub-mirror mounted behind it picks up only the light transmitted
through that half-mirrored region (not the whole main mirror) and reflects it down to the AF
module. That describes the semi-transparent zone as a central patch roughly matching the
sub-mirror's own footprint, not the whole mirror surface. For the actual transmittance split,
no current full-frame DSLR publishes its own number; the closest citable figure is general
half-mirror-coating practice described in patent US 7,012,751 B2, which puts visible-light
reflectance and transmittance for mirrors of this kind both in roughly the 30-70% band — carried
as `reported`, not `spec`, since it isn't any one maker's stated figure for a current product.

US 7,824,114 gives the sub-mirror's own mechanics: it's mounted on a holding frame that pivots
on its own rotation axis, quasi-parallel to the main mirror's hinge axis, at the main mirror's
rear (lens-side, lower) edge. When the main mirror flips up, the sub-mirror folds back against
the main mirror's own rear face and retracts from the optical path along with it — it isn't a
separately-actuated mechanism, it rides the main mirror. US 8,979,400 separately states the
sub-mirror sits at an acute angle relative to the main mirror (folded back toward the lens, not
coplanar with it), which is what redirects the transmitted beam down to the floor-mounted AF
module rather than letting it continue straight through.

**Focusing screen.** [Wikipedia's SLR
article](https://en.wikipedia.org/wiki/Single-lens_reflex_camera) states plainly that "the image
is projected onto the film or sensor in exactly the same manner as on the focusing screen" — the
mirror-reflected path up to the screen is folded to the same total optical length as the direct
path down to the sensor, which is *why* focus confirmed by eye in the viewfinder matches focus
on the sensor. This is also why the mirror box has a hard minimum depth: the screen has to sit
above the mirror at a height equal to the lens-to-sensor distance, not wherever is convenient.

## The pentaprism, viewfinder magnification and coverage

All four full-frame bodies sampled for the envelope table use a **glass roof pentaprism**, not a
pentamirror — Pentax's own K-1 Mark II spec page states "Optical (pentaprism)" explicitly, and
the others are all higher-tier bodies where a pentaprism (heavier, brighter, one solid glass
block using an internal roof-edge reflection to correct the image's left-right reversal) is
standard; pentamirrors (lighter, hollow, several separate mirrored facets, dimmer) are a lower-
tier/APS-C-class DSLR feature not represented among these four full-frame bodies. [Wikipedia's
SLR article](https://en.wikipedia.org/wiki/Single-lens_reflex_camera) describes the path: light
reflects up off the main mirror, through the focusing screen (image right-side-up but left-right
reversed at that point) and a condensing lens, into the pentaprism, which reflects it internally
to correct the reversal, and out through the eyepiece.

Viewfinder magnification across the sampled bodies:

| Body | Magnification | Coverage | Eyepoint | Source |
|---|---|---|---|---|
| Nikon D850 | 0.75x | 100% | 17mm | [Imaging Resource](https://www.imaging-resource.com/PRODS/nikon-d850/nikon-d850A4.HTM) |
| Canon EOS 5D Mark IV | 0.71x | 100% | ~21mm | [Canon UK specs](https://www.canon.co.uk/cameras/eos-5d-mark-iv/specifications/) |
| Canon EOS-1D X Mark III | 0.76x | 100% | ~20mm | Canon regional spec pages (canon.co.uk / canon-europe.com) |
| Pentax K-1 Mark II | 0.70x | 100% | not stated in source pulled | [DPReview specs](https://www.dpreview.com/products/pentax/slrs/pentax_k1ii/specifications) |

Nikon states the D850's 0.75x is its highest-magnification optical finder to date, up from the
D810's 0.70x — a `spec` claim about that specific comparison, cited to Nikon's own materials via
Imaging Resource's writeup, not an independent measurement. All four state 100% frame coverage;
that's standard for this pentaprism/full-frame tier and isn't a property of the prism type
itself so much as a tier/cost signal — pentamirror bodies commonly ship with less (often ~95%).

## Mirror-up timing, blackout and frame rate

No maker publishes a bare mirror flip-up/down duration in milliseconds for any of the sampled
bodies — this was searched directly (Nikon/Canon/Pentax spec and support pages, DPReview and
Imaging Resource reviews, and the patents already cited) and came up empty; see "Open problems"
below. Two adjacent, sourced figures stand in for it, clearly labeled as what they actually are:

- **Total mechanical shutter lag, Nikon D850: 76 ms.** [Imaging Resource's own lab
  measurement](https://www.imaging-resource.com/PRODS/nikon-d850/nikon-d850A4.HTM) states this
  explicitly includes the mirror's flip-up time — it's the full release-to-exposure lag, not the
  mirror's own share of it isolated. Carried as `reported` (one reviewer's lab measurement on one
  body), not `spec`.
- **Fastest mechanical-shutter, mirror-flipping frame rate found: 16 fps, Canon EOS-1D X Mark
  III.** Canon's own spec/feature pages state 16 fps with the mechanical shutter through the
  optical viewfinder, and separately that the body uses direct-drive motors to flip the reflex
  mirror up and down and return it to rest "swiftly and accurately with minimal mirror bounce."
  That's a pro integrated-grip body outside the envelope class above; it sets a practical ceiling
  of roughly 62.5 ms for one complete shutter-and-mirror cycle at that rate (1000/16), which
  includes shutter curtain travel and AF/AE computation time, not mirror motion in isolation. A
  same-tier standard-class body like the D850 or 5D Mark IV runs at 7 fps (each maker's own
  published continuous-shooting spec), well under that ceiling.
- **Blackout fraction.** One independent reviewer's [own stopwatch/video
  measurement](https://www.photoartfromscience.com/single-post/measure-camera-mirror-blackout-time-yourself)
  at 10 fps on an unspecified body found the viewfinder blacked out for roughly two-thirds of
  each frame's shooting cycle (~0.0667s blacked out vs. ~0.0333s visible). Carried as `reported`
  for that one body/rate, explicitly not generalized to a DSLR-wide constant, since the ratio
  scales with frame rate and each body's own shutter/mirror timing.

## The mirror's back-focus constraint on lens design

Wikipedia's [History of photographic lens
design](https://en.wikipedia.org/wiki/History_of_photographic_lens_design) article states, in
its retrofocus wide-angle lens section: "SLR cameras require that lenses be mounted far enough
in front of the film to provide space for the movement of the mirror (the 'mirror box'); about 40
mm for a 35mm SLR compared to less than 10 mm in non-SLR 35mm cameras." That sentence carries no
inline citation within the Wikipedia article itself, so it's recorded here as `reported`
(a widely repeated rule of thumb), not `spec`. It's consistent with, but not identical to, the
mount flange distances (Canon EF 44.0mm, Nikon F 46.5mm, Pentax K 45.46mm — the mounts agent's
figures, not re-derived here): flange distance is measured all the way from the mount to the
sensor and has to exceed the bare mirror-swept clearance plus margin for the shutter and the
sensor's filter/cover-glass stack, so it's always somewhat larger than the ~40mm mirror-clearance
figure alone.

[Camera-wiki's Retrofocus article](https://camera-wiki.org/wiki/Retrofocus) and the same
Wikipedia article both explain the design response: a conventional (non-retrofocus) short-
focal-length lens's rear principal plane sits close to its back focal point, which for a wide-
angle lens would place the physical rear element inside the mirror's swept clearance zone. A
retrofocus (inverted-telephoto) design puts a diverging (negative-power) group at the front and
a converging (positive-power) group at the rear, keeping the *effective* focal length short while
pushing the *physical* back focal distance out past the mirror box — at the cost of a larger,
heavier, more complex lens, and (per camera-wiki) generally more even corner illumination as a
side effect of the rear element sitting farther from the sensor.

**No single cited minimum back-focus number in mm was found** as a hard design floor distinct
from the ~40mm rule of thumb above — camera-wiki's Retrofocus article, the Wikipedia lens-design
history article, and two secondary explainers (coinimaging.com, rondexter.com) were all checked
and none states one. This is left `null`/`assumed` in `dslr.json` rather than invented; see
"Open problems" below for where a real number might still be found.

## The focal-plane shutter

[Wikipedia's Focal-plane shutter article](https://en.wikipedia.org/wiki/Focal-plane_shutter)
states the shutter sits "immediately in front of the focal plane of the camera" — the last
element in the optical path before the sensor stack (cover glass/AA filter assembly and the
photodiodes beneath it) — which is also why interchangeable lenses on an SLR/DSLR don't need
their own shutters and can be swapped with the body's own shutter closed. It further states that
"modern digital SLR cameras use vertical travel metal blade shutters," two curtains, the first
opening and the second closing behind it after the timed delay, and that vertical travel crosses
only the sensor's short (24mm) dimension "as opposed to 36 mm" for the older horizontal-travel,
fabric-curtain designs it displaced — shorter travel means a shorter minimum flash-sync time and
faster curtain transit.

## Open problems (for whoever picks these up next)

- **No cited main-mirror size in mm.** `dslr.json` carries a derived geometric lower bound
  (36 x ~34mm) instead of a measured or spec'd figure. If another agent's patent access turns up
  a numerical example that states an actual main-mirror or mirror-box dimension (the lens-20,
  lens-normal, lens-wide and lens-tele notes already in this repo work from full patent
  prescriptions and might have incidentally captured mirror-box clearance data from the same
  patents), that would upgrade this from `derived` to `spec`.
- **No cited mirror flip-up/down duration in ms.** Every DSLR review site discusses "blackout"
  qualitatively; only one reviewer's own stopwatch measurement (cited above, one body, 10fps,
  not independently corroborated) gives an actual timing breakdown, and it measures the whole
  cycle, not the mirror's motion isolated from shutter travel and electronics.
- **No cited minimum back-focus distance in mm**, distinct from the general ~40mm mirror-
  clearance rule of thumb. A specific SLR wide-angle patent's own numerical example (again, the
  wide-primes/lens-20 notes in this repo may have this already for their own patent examples,
  just not extracted for this purpose) would be the way to get a real, checkable number here.
- **Semi-transparent-mirror transmittance** is carried as a general ~30-70% band from patent
  language about half-mirror coatings generally, not any current DSLR maker's own published
  split for a specific body. No maker was found publishing this.
