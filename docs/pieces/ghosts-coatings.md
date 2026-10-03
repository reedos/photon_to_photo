# Ghosts and coatings: a representative plate

The Optics launcher opens a standalone plane-parallel glass experiment. It does
not use or claim the selected lens's coating prescription or flare pattern.
Air, glass and film indices are explicitly assumed to be 1, 1.5 and 1.38,
constant with wavelength and lossless. Glass thickness is 1–6 mm; angle is 0–65°.

`src/engine/ghost-plate.ts` uses the engine's existing vector refraction and
reflection helpers to intersect two planes. The primary path crosses the plate
once. The first transmitted ghost reflects at the back face, then front face,
before emerging at the back. At normal incidence the two paths overlap; the
display preserves that result. At oblique incidence their displacement on a
plane parallel to the plate is 2 d tan(theta_glass).

Each interface's amplitude reflection is computed for a single coherent film
using optical admittances n cos(theta) for s and n/cos(theta) for p. The phase
per film pass is 2 pi n_f d cos(theta_f)/lambda. The complex-film amplitude
ratio is evaluated as its squared modulus. Reverse incidence is evaluated
explicitly. Since the media are lossless and propagating, power T=1−R.
The two polarizations propagate independently through each path and only their
final powers are averaged. Separate millimetre plate passes are treated as
mutually incoherent; this is not a coherent plate etalon.

Normal uncoated n=1.5 gives R=.04, primary power .96²=.9216, and first transmitted
ghost .96²×.04²=.00147456 of incident power. The 99.6 nm candidate film is near
quarter-wave at 550 nm at normal incidence. It is not the ideal index-matching
film, so it reduces reflection without eliminating it. The graph shows bare
and candidate-film single-surface reflectance at the selected incidence angle.

The paths have explanatory line brightness; film outlines are exaggerated for
visibility. Power badges are numerical. Travel timing is illustrative. No
absorption, dispersion, surface curvature, scatter, further reflected paths or
production-lens flare are shown.

Source: [MIT 6.974, §2.3, Mirrors, Interferometers and Thin-Film Structures](https://ocw.mit.edu/courses/6-974-fundamentals-of-photonics-quantum-electronics-spring-2006/98fcc94d2216c26db424e294c28d459a_mirror_inter_thn.pdf),
especially the quarter-wave condition (eq. 2.170) and scattering/transfer matrices.

Validation:

- `vitest run src/engine/ghost-plate.test.ts src/engine/surface.test.ts`
- `P2P_PREVIEW_PORT=47723 node tools/test-ghost-plate.mjs`
- The browser gate checks rendered path vertices and orange pixels, numeric
  powers, normal-incidence overlap, coating controls, keyboard, phone overflow,
  pause, Escape/focus return and piece deactivation at 1366, 390 and 320 px.
- Screenshots/results go to ignored `shots/ghost-plate/`.
