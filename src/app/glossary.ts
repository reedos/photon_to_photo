/** The glossary: one list for the Glossary page (src/reference.ts) and the term notes in the app (gloss.ts).
 *  [term, definition, piece, part, lesson?]: the piece, part and lesson are where the page's link opens the term. */
export type GlossaryEntry = [string, string, string, string, string?];

export const GLOSSARY: GlossaryEntry[] = [
  // score loop r2 (10/11/2026): Aperture, Focal length and ISO rewritten in plain words
  ['Aperture', 'The adjustable opening inside the lens, formed by the iris blades. A wider opening lets in more light and makes the sharp zone shallower. Its apparent size seen through the front glass is the entrance pupil.', 'camera', 'iris'],
  ['Bayer filter', 'A repeating color-filter pattern over the sensor pixels. Each site measures one color band; demosaicing estimates missing color samples.', 'loupe', 'sensor'],
  ['Bokeh', 'The look of the out-of-focus parts of a photo: how smooth or rough the blur is, and the shape of each blurred point. Aperture shape and the ray bundle help determine that shape.', 'cone', 'focusRing'],
  ['Blur disk', 'The spot a point of light makes when it is out of focus: its rays reach the sensor spread over a disk instead of meeting in one point. The farther out of focus, the bigger the disk.', 'cone', 'cone'],
  ['Circle of confusion', 'A chosen limit for a blur disk to count as acceptably sharp, also called the blur criterion. Depth-of-field limits depend on this assumption.', 'cone', 'focusRing'],
  ['Depth of field', 'The range judged acceptably sharp under a stated blur criterion. It is not a second plane of perfect focus.', 'cone', 'focusRing'],
  ['Diffraction', 'Spreading of light at an opening. Stopping down increases the diffraction blur even while reducing many other aberrations.', 'lens', 'iris'],
  ['Entrance pupil', 'The apparent aperture seen from the subject side through the glass in front of the stop. It need not equal the physical iris diameter.', 'camera', 'iris'],
  ['Exposure', 'Light collected during the shutter interval. Aperture and shutter time affect collection; ISO does not create photons.', 'camera', 'shutter'],
  ['F-number', 'The lens’s focal length divided by the width of its opening, written f/ and the number. A 500 mm lens with an opening 89 mm wide is f/5.6. A bigger f-number means a smaller opening: less light, a deeper sharp zone and more diffraction blur.', 'camera', 'iris'],
  ['Focal length', 'The distance behind the lens at which a distant subject comes to focus. A longer focal length magnifies more and shows a narrower view; perspective itself depends on where the camera stands.', 'camera', 'lens'],
  ['Full well', 'The most charge a pixel’s photodiode can store (its potential well) before it saturates, in electrons.', 'loupe', 'sensor'],
  ['ISO', 'The camera’s brightness setting. Raising it amplifies the signal after the light is collected, so the picture comes out brighter, but the sensor collects no more photons.', 'loupe', 'sensor'],
  ['Microlens', 'A tiny lens over a sensor pixel that helps direct incident light into its photosensitive area.', 'loupe', 'sensor'],
  ['Read noise', 'Noise introduced when the collected signal is measured and read out. It matters especially when little light was collected.', 'loupe', 'sensor'],
  ['Shot noise', 'Variation caused by the discrete arrival of photons. More collected signal improves relative shot-noise performance.', 'loupe', 'sensor'],
  ['Shutter speed', 'The exposure duration. A longer interval collects more light and can increase motion blur.', 'camera', 'shutter'],
  // Terms the app's cards and lessons use (score loop r1, 10/11/2026); each links to where it appears.
  ['Abbe number', 'How little a glass spreads the colors apart, written vd. A higher Abbe number means less dispersion; lens designers pair high and low ones to bring colors back together.', 'lens', 'glass'],
  ['ADC (analog-to-digital converter)', 'The circuit that measures each pixel’s collected charge and turns it into a whole number, the raw value.', 'camera', 'sensor', 'readout'],
  ['Black level', 'A small fixed offset added to every raw value, so that noise below zero is kept rather than cut off. Processing subtracts it again.', 'camera', 'sensor', 'readout'],
  ['Chromatic aberration', 'Color fringing: glass bends each wavelength by a slightly different amount, so the colors from one point do not land in the same place.', 'lens', 'glass'],
  ['Color matrix', 'A small table of numbers that maps the camera’s own red, green and blue responses to a standard color space for display.', 'camera', 'sensor', 'pipeline'],
  ['Demosaicing', 'Estimating the two missing colors at each pixel of a Bayer sensor from its neighbors, so every pixel ends up with red, green and blue.', 'camera', 'sensor', 'pipeline'],
  ['DN (raw value)', 'Digital number: the whole number the ADC reports for a pixel, before any color processing.', 'camera', 'sensor', 'readout'],
  ['Electronic shutter', 'Starting and ending the exposure by resetting and reading the sensor itself, row by row. Because rows are read in turn, a fast subject can lean or bend: rolling-shutter skew.', 'camera', 'sensor', 'readout'],
  ['EV (exposure value)', 'One number for a combination of f-number and shutter time; each step of 1 halves or doubles the light. EV100 states it for ISO 100, so a higher EV100 suits a brighter scene.', 'camera', 'shutter'],
  ['Exit pupil', 'The opening the light appears to leave the lens through, as seen from the sensor. Its size and distance set the angle of the cone of light reaching each point.', 'cone', 'focusRing'],
  ['Flange distance', 'The fixed gap between the lens mount and the sensor. Every lens made for a mount is designed around it.', 'camera', 'mount'],
  ['Pentaprism', 'The five-sided prism above a DSLR’s focusing screen. It turns the image the mirror sends up so the eye at the viewfinder sees it right side up and left to right.', 'camera', 'viewfinder'],
  ['Pixel pitch', 'The distance from the center of one pixel to the next, usually a few micrometers.', 'loupe', 'sensor'],
  ['Quantum efficiency', 'The fraction of arriving photons that free an electron in the photodiode. It depends on wavelength.', 'loupe', 'sensor'],
  ['Refractive index', 'How much a material slows light compared with a vacuum, written nd when measured with yellow light. A higher index bends light more strongly at a curved surface.', 'lens', 'glass'],
  ['Signal-to-noise ratio (SNR)', 'The signal divided by its random variation. Higher is cleaner; collecting more light raises it.', 'loupe', 'sensor'],
  ['sRGB', 'The standard color space and brightness curve most screens and JPEG files use. The last pipeline step encodes linear light into it.', 'camera', 'sensor', 'pipeline'],
  ['White balance', 'Channel gains that make neutral surfaces look neutral under light of a given color, such as warm room light.', 'camera', 'sensor', 'pipeline'],
  ['Working f-number', 'The f-number in effect at the current focus distance. Focusing closer moves the image farther from the lens, so the cone of light usually narrows and the working f-number rises above the marked one.', 'cone', 'focusRing'],
  // Terms cards, dialogs and lessons use without a definition (score loop r2, 10/11/2026)
  ['Bit depth', 'How many different numbers the ADC can report. A 14-bit converter has 2¹⁴ = 16,384 levels, numbered 0 to 16,383.', 'camera', 'sensor', 'readout'],
  ['Dispersion', 'The way glass bends each color by a different amount, usually blue more than red. It splits white light into colors and causes chromatic aberration.', 'lens', 'glass'],
  ['Electron (e−)', 'The charged particle a photon frees in the photodiode. A pixel counts its light as electrons, written e−.', 'loupe', 'sensor'],
  ['Paraxial', 'Describes rays that stay close to the lens axis at small angles. Simple lens formulas hold exactly for them; rays farther out bend differently, which is why this app also traces real rays.', 'cone', 'focusRing'],
  ['Phase Fresnel (diffractive) element', 'A lens element with a surface of fine concentric rings that bends light by diffraction. It bends red more than blue, the opposite of glass, so pairing it with glass cancels much of the color fringing.', 'lens', 'glass'],
  ['Photodiode', 'The light-sensitive part of each pixel. A photon absorbed there can free an electron, and the freed electrons collect as the pixel’s charge.', 'loupe', 'sensor'],
  ['PRNU (pixel-to-pixel variation)', 'Photo-response non-uniformity: small differences in sensitivity from pixel to pixel, so equal light gives slightly unequal signals. Its noise grows in step with brightness.', 'loupe', 'sensor'],
  ['RMS (root mean square)', 'A typical size for a random error: square the errors, average them, take the square root. A read noise of 3 electrons RMS means readings typically stray by about 3 electrons.', 'camera', 'sensor', 'readout'],
  ['Rolling shutter', 'Reading a sensor one row after another rather than all at once. A subject that moves during the scan can lean or bend in the picture.', 'camera', 'sensor', 'readout'],
  // Terms the reviewers found undefined (score loop r4, 10/14/2026): the site's own name, plain words for the sensor and
  // its pixels, the two spreads the Optics inset shows, and the aberrations and glass numbers the cards name.
  ['Photon', 'One indivisible packet of light, the smallest amount there is. Light reaches each pixel as photons: hundreds to tens of thousands per pixel in a photo, depending on the settings, and far fewer in the dim demos. That is why the site is called Photon to Photo.', 'loupe', 'sensor'],
  ['Pixel', 'One tiny light-collecting spot on the sensor. It counts the light that lands on it and reports one number; a photo is a grid of millions of them.', 'loupe', 'sensor'],
  ['Sensor', 'The chip behind the lens that catches the light. It is a grid of pixels, each turning the light it receives into an electrical charge that is later read out as a number.', 'camera', 'sensor'],
  ['Stop', 'One doubling or halving of the light, for example f/2.8 to f/4 (half the light) or 1/250 s to 1/125 s (twice the light). Stopping down means choosing a larger f-number, which lets in less light.', 'camera', 'iris'],
  ['Wavelength', 'The color of light written as a length, in nanometers (nm, a billionth of a meter). Visible light runs from about 380 nm (violet) to 780 nm (deep red); green is near 550 nm.', 'lens', 'glass'],
  ['Poisson distribution', 'The natural spread of random arrivals. Photons do not arrive evenly, so equal light gives counts that scatter around their average by about its square root: 10,000 photons varies by about 100. That scatter is shot noise.', 'loupe', 'sensor'],
  ['Point spread function (PSF)', 'The pattern of light that one point makes after passing through the lens: not a point but a small spot, bright in the middle and sometimes ringed. It is how a lens blurs a single point.', 'camera', 'iris'],
  ['Airy pattern', 'The bright disk and faint rings that diffraction makes from a point of light passing through a round opening. The first dark ring marks the edge of the bright disk; the disk grows as the f-number rises.', 'camera', 'iris'],
  ['Spherical aberration', 'Rays through the edge of a lens focus at a slightly different distance than rays through its center, so a point comes out soft. Stopping down reduces it by blocking the edge rays.', 'lens', 'glass'],
  ['Coma', 'A flaw that smears points away from the center of the frame into a comet shape, a bright head with a tail, because rays through different parts of the lens land at different heights. It grows toward the corners.', 'lens', 'glass'],
  ['Longitudinal color', 'Different colors coming to focus at different distances behind the lens, so no single sensor position is sharp in every color at once. It is one kind of chromatic aberration; the other is a sideways shift of color across the frame.', 'lens', 'glass'],
  ['Partial dispersion (θgF)', 'How a glass spreads the blue end of the spectrum compared with the rest, written θgF. Two glasses with the same Abbe number can still leave a faint color fringe if their θgF differs, so designers match it too.', 'lens', 'glass'],
  ['RAW', 'The unprocessed numbers the sensor recorded, before the camera makes a JPEG. A RAW file keeps the full range of each pixel’s value; the JPEG keeps only the processed result.', 'camera', 'sensor', 'readout'],
  ['cos⁴ falloff', 'The natural darkening toward the corners of an image. Light arriving at an angle sees a smaller, tilted opening and travels farther, so it loses about cos⁴ of the angle in brightness.', 'camera', 'sensor'],
];

/** Words in the app's copy that open a glossary note, longest first so "read noise" wins over a shorter match.
 *  [pattern, glossary term]. Each pattern matches whole words only. */
export const GLOSS_LINKS: [RegExp, string][] = ([
  [/entrance pupil/i, 'Entrance pupil'],
  [/point spread function|\bPSF\b/, 'Point spread function (PSF)'],
  [/\bAiry\b|first dark ring/, 'Airy pattern'],
  [/\bPoisson\b/, 'Poisson distribution'],
  [/spherical aberration/i, 'Spherical aberration'],
  [/\bcoma\b/, 'Coma'],
  [/longitudinal (?:chromatic aberration|color)/i, 'Longitudinal color'],
  [/partial dispersion|θgF/, 'Partial dispersion (θgF)'],
  [/cos⁴/, 'cos⁴ falloff'],
  [/\b(?:full|one) stops?\b|\bstopping down\b|\bstop the lens down\b/i, 'Stop'],
  [/\bwavelengths?\b/i, 'Wavelength'],
  [/\bphotons?\b/i, 'Photon'],
  [/blur disks?\b/i, 'Blur disk'],
  [/circle of confusion|blur criterion|acceptable blur circle/i, 'Circle of confusion'],
  [/working f-number/i, 'Working f-number'],
  [/chromatic aberration/i, 'Chromatic aberration'],
  [/Phase Fresnel/i, 'Phase Fresnel (diffractive) element'],
  [/quantum efficiency|\bQE\b/, 'Quantum efficiency'],
  [/demosaicing/i, 'Demosaicing'],
  [/white balance/i, 'White balance'],
  [/color matrix/i, 'Color matrix'],
  [/black level/i, 'Black level'],
  [/read noise/i, 'Read noise'],
  [/shot noise/i, 'Shot noise'],
  [/full well/i, 'Full well'],
  [/\bPRNU\b/, 'PRNU (pixel-to-pixel variation)'],
  [/\bRMS\b/, 'RMS (root mean square)'],
  [/\b\d+-bit\b/, 'Bit depth'],
  [/\bEV100\b/, 'EV (exposure value)'],
  [/\bDN\b/, 'DN (raw value)'],
  [/\be−/, 'Electron (e−)'],
  [/paraxial/i, 'Paraxial'],
  [/dispersion/i, 'Dispersion'],
  [/rolling-shutter|rolling shutter/i, 'Rolling shutter'],
  [/photodiode/i, 'Photodiode'],
  [/Abbe number/i, 'Abbe number'],
  [/refractive index/i, 'Refractive index'],
  [/depth of field/i, 'Depth of field'],
  [/diffraction/i, 'Diffraction'],
  [/\bf-numbers?\b|\bf\/\d+(?:\.\d+)?/i, 'F-number'],
  [/\baperture\b/i, 'Aperture'],
  [/\bRAW\b/, 'RAW'],
] as [RegExp, string][]);

export function glossaryEntry(term: string): GlossaryEntry | undefined {
  return GLOSSARY.find((entry) => entry[0] === term);
}

/** Split text into plain runs and glossary terms, linking each term's first appearance only. */
export function glossSegments(text: string, seen = new Set<string>()): { text: string; term?: string }[] {
  const out: { text: string; term?: string }[] = [];
  let rest = text;
  for (;;) {
    let best: { index: number; length: number; term: string } | null = null;
    for (const [pattern, term] of GLOSS_LINKS) {
      if (seen.has(term)) continue;
      const m = new RegExp(pattern.source, pattern.flags.replace('g', '')).exec(rest);
      if (m && (!best || m.index < best.index || (m.index === best.index && m[0].length > best.length))) best = { index: m.index, length: m[0].length, term };
    }
    if (!best) break;
    if (best.index) out.push({ text: rest.slice(0, best.index) });
    out.push({ text: rest.slice(best.index, best.index + best.length), term: best.term });
    seen.add(best.term);
    rest = rest.slice(best.index + best.length);
  }
  if (rest) out.push({ text: rest });
  return out;
}
