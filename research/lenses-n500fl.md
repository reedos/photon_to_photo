# 500 mm f/4 fluorite telephoto (n500fl) — research note

File: `data/lenses/n500fl.json`. Accessed date for every source below: 9/28/2026.

## What this lens is for

The DSLR carries two 500 mm lenses on the same F mount (docs/PLAN.md, "Telephotos" section) to show what a
diffractive element does to length and weight: Reed's own AF-S NIKKOR 500mm f/5.6E PF ED VR (Phase Fresnel, p500pf
data file elsewhere) against the conventional AF-S NIKKOR 500mm f/4E FL ED VR (2018 in the plan's table; actually
announced 7/2/2015 — see below). This file is the conventional one's patent example.

## The tie

The Photons to Photos hub's lens-construction-data table, `.local/lens-normal/modeldata.tsv`, has:

```
JP2015-215560	Example01P		Nikon AF-S Nikkor 500mm f/4E FL ED VR
```

— i.e. Example 1 of patent JP 2015-215560 A is the hub's identification for this lens. (The same file also has a
row `JP2015-215560	Example02P		Nikon AF-S Nikkor 500mm f/4D IF-ED II`, tying the *same patent number*'s
"Example 2" to a different, much older 1996-era AF-D lens. That looks like a data-entry slip in the hub table —
JP2015-215560A has only three numerical examples, at f = 490.00 / 392.00 / 588.00 mm, none of them an obvious
match for a 500mm f/4D from two decades earlier — but it wasn't investigated further since Example 1 is the one
this task needs and it checks out independently, below.)

**Independent corroboration**, not just trusting the hub table:
- Element/group count from Example 1's own cementing pattern (front protective filter excluded as a plate,
  same convention as p500.json): **16 elements in 12 groups**. Nikon's own published spec for the AF-S NIKKOR
  500mm f/4E FL ED VR, https://www.nikonusa.com/p/af-s-nikkor-500mm-f4e-fl-ed-vr/20053/overview, reads
  "Lens Construction Elements: 16" / "Lens Construction Groups: 12" — an exact match.
- Two elements (L11, L12, surfaces 3 and 5) share nd=1.43385, vd=95.25 — the dispersion of a fluorite-class
  (CaF2) glass. Nikon's own 7/2/2015 press release,
  https://www.nikon.com/company/news/2015/0702_lens_01/, and the "FL" in the product name itself, both say
  this lens uses 2 fluorite elements. Match.
- Minimum focus distance (Nikon spec, 3.6 m) and the general architecture (3-group inner-focus telephoto with
  a floating anti-vibration subgroup in the rear group) are consistent with a 2015-era Nikon 500mm f/4 IS
  super-telephoto.

This is a stronger tie than the p20/p24/.../p500 telephoto family in `research/lenses-tele.md`, where no public
source ties any of those five patents to a named product — here the hub table names the product directly, and
the element/group count and fluorite count both check out against Nikon's own spec page independently of the
hub table.

## Patent bibliographic data

- Publication: **JP 2015-215560 A**, "光学系、光学装置、光学系の製造方法" ("Optical system, optical device, and
  method for manufacturing the optical system"), published 12/3/2015.
- Application: JP2014-099625, filed 5/13/2014 (this is also the priority date — a single JP filing, no earlier
  foreign priority).
- Granted as JP 6344044 B2 on 6/20/2018.
- Assignee: Nikon Corporation (applicant "Nikon Corp" per Google Patents' bibliographic panel).
- URL: https://patents.google.com/patent/JP2015215560A/en — Google Patents itself returned HTTP 503 on a direct
  `curl`/WebFetch; both the raw table (surface data) and the bibliographic panel (publication/priority/assignee
  dates) were read via `https://r.jina.ai/https://patents.google.com/patent/JP2015215560A/en`, which worked.
  Raw fetched text is kept at `.local/n500fl/jp2015215560_raw.txt` and `.local/n500fl/jp2015215560_raw2.txt`
  (scratch, not committed as a project deliverable).
- Three numerical examples share this one patent family: Example 1 (f=490.00 mm, Fno 4.122 — used here for the
  500 mm f/4E FL slot), Example 2 (f=392.00 mm, Fno 2.868 — near a 400 mm class), Example 3 (f=588.00 mm,
  Fno 4.080 — near a 600 mm class, plausibly the sibling AF-S NIKKOR 600mm f/4E FL ED VR announced the same
  day, 7/2/2015; not investigated, out of scope for this task).

## Self-check

`.local/n500fl/paraxial.py` (a copy of `.local/lens-tele/paraxial.py`, unmodified) traces Example 1's 31
surfaces:

```
computed EFL = 489.9999 mm   stated f = 490.0000 mm   error = -0.000%  OK  (tol 0.5%)
computed BF  = 87.7719 mm    stated Bf = 87.7720 mm    diff = -0.0001 mm  (tol 0.8777 mm)  OK  (tol 1% / 0.2 mm)
```

Both pass comfortably — the patent's own Bf value (87.772, directly printed in the "various data" table, not a
`D(last)=0.000` table-terminator ambiguity like the Canon 300/400/500 mm family in `research/lenses-tele.md`)
matches our trace to 0.1 um.

Fno / semi-diameter check (same honesty caveat as `lenses-tele.md`: the patent prints no effective/clear
diameter for any surface, so the entrance-pupil size is set *from* the stated Fno, not discovered independently;
the genuinely non-circular results are EFL, BF, and the sd values at every *other* surface, all downstream of the
real ray trace):

```
entrance-beam semi-diameter at surface 1 = EFL/(2*Fno) = 59.4371 mm
stop is surface index 16 (0-based); TRACED sd there = 18.651 mm
```

`npx vitest run src/engine/lenses.test.ts src/engine/realize.test.ts`: every `n500fl` test passes (EFL/BF
tolerance, glass-catalog match, element/group count, stop radius, on-axis and off-axis ray-fan pass fractions,
closest-focus reachability). The run also reported 27 pre-existing failures in `m500.json`, `n500.json` and
`z35.json` — unrelated files from other workstreams (catalog-glass mismatches for m500/n500, an EFL/BF mismatch
for z35) — not touched here.

## Size and weight comparison (the point of the two-lens pairing)

Both figures below are Nikon's own published specs (evidence "spec"), read from the current nikonusa.com product
pages, not computed by the engine:

| | AF-S 500mm f/5.6E PF ED VR (Phase Fresnel) | AF-S 500mm f/4E FL ED VR (conventional, this file) |
|---|---|---|
| Source | https://www.nikonusa.com/p/af-s-nikkor-500mm-f56e-pf-ed-vr/20082/overview | https://www.nikonusa.com/p/af-s-nikkor-500mm-f4e-fl-ed-vr/20053/overview |
| Announced | 8/23/2018 (https://www.nikon.com/company/news/2018/0823_nikkor-f_01.html) | 7/2/2015 (https://www.nikon.com/company/news/2015/0702_lens_01/) |
| Max aperture | f/5.6 | f/4 |
| Lens construction | 19 elements in 11 groups | 16 elements in 12 groups |
| Minimum focus | 3.0 m | 3.6 m |
| Diaphragm blades | 9 | 9 (rounded, per Nikon's press release) |
| Filter size | 95 mm | 40.5 mm (rear drop-in) |
| **Length** | **237 mm** | **387 mm** |
| **Max diameter** | **106 mm** | **140 mm** |
| **Weight** | **1,460 g** | **3,090 g** |

The PF version is 150 mm shorter, 34 mm slimmer, and 1,630 g (53%) lighter than the conventional design at the
same focal length and nearly the same class of speed (a stop slower, f/5.6 vs f/4) — the diffractive element's
whole point, and the reason the two lenses sit side by side in the plan's telephoto pair. (docs/PLAN.md notes the
engine is only now "gaining diffractive surfaces" for the PF lenses on branch `engine/doe` — this file does not
attempt a PF prescription, just the conventional lens data and the published comparison figures.)

## Element/group counting method (per the brief: "count elements the way Nikon does, and say how")

Nikon's spec page states 16 elements / 12 groups. This file's raw patent transcription has 17 physical glass
elements if the front protective filter (surfaces 1-2, `plate: "filter"`, nd=1.51680/vd=63.88, a plane-parallel
element with no optical power, explicitly described in the patent text as "実質的に屈折力を有しない" — "having
substantially no refractive power") is counted. Excluding that plate, exactly like p500.json's drop-in filter,
gives 16 elements in 12 groups — matching Nikon's own count, which evidently uses the same convention (a
protective filter glass is not a "lens element" in Nikon's own marketing language either). Groups, by cementing:

- G1 (positive): L11 | L12 | L13 | (L14+L15 cemented) = 4 groups, 5 elements (2 of them fluorite, L11/L12)
- G2 (negative, inner-focus group): L21 | (L22+L23 cemented) = 2 groups, 3 elements
- G3a (positive): (L31+L32 cemented) = 1 group, 2 elements
- G3b (negative, image-stabilizer/VR group): L33 | (L34+L35 cemented) = 2 groups, 3 elements
- G3c (positive): L36 | L37 | L38 = 3 groups, 3 elements

Total: 4+2+1+2+3 = **12 groups**, 5+3+2+3+3 = **16 elements**.

## Open problems

1. **ED-glass assignment is ambiguous.** Nikon markets 2 ED elements in this lens, but the patent has *three*
   elements sharing nd=1.49782/vd=82.57 (L15, L32, L35 — surfaces 10, 19, 24), each the rear/cemented half of a
   different doublet. The patent gives no glass names, only nd/vd/θgf, so which two of the three (if any exactly
   two) correspond to Nikon's marketed "ED" elements cannot be determined from the patent text alone. Recorded
   as an open note in the JSON rather than guessed.
2. **No VariableGap entries are recorded**, unlike some of the wide/normal lens files. The patent's focus table
   gives three focus states (infinity / intermediate / close) for the two moving air gaps (d11, d16), but the
   close-focus row is stated only as a magnification (β = -0.153), not an object distance — unlike p200.json's
   Nikon patent, which printed a raw object distance (D0) directly. Converting β to an object distance would
   require re-deriving the close-focus system's own principal-plane shift (the whole prescription changes
   between focus states, since G2 physically moves), which is possible but is a multi-step derivation rather
   than a patent-stated number, so it wasn't done. The raw d11/d16 values at all three focus states are recorded
   verbatim in the two variable-gap surfaces' own `label` fields for whoever picks this up next.
3. **No aspheric surfaces** are printed for Example 1 (checked the full surface table; no aspheric-coefficient
   section follows it for this example), consistent with an all-spherical, conventional (non-PF) telephoto.
4. Every semi-diameter is `estimated-from-marginal-ray` (the patent prints none), same situation and same method
   as the 200/300/400/500 mm Canon/Nikon family in `research/lenses-tele.md`.
5. The plan's lens table (docs/PLAN.md) lists this lens's release year as "2018" in its `p500pf`/`n500fl`
   pairing text — Nikon's own press release dates the AF-S NIKKOR 500mm f/4E FL ED VR to 7/2/2015, three years
   before the PF version (8/23/2018). Flagging the discrepancy here rather than silently correcting the plan
   document, since that file is the lead's.
