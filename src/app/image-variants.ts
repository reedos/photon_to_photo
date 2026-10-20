// Smaller WebP copies of the example photographs, so a phone does not fetch a 2400 or 3200 px JPEG for a 350 px picture
// (score loop r1 for the flycatcher, 10/11/2026; score loop r3 for every example's main image). The JPEG stays the src
// fallback and the full-width candidate. The copies are made from the JPEG by tools/make-photo-variants.py with Pillow
// (Lanczos, WebP quality 80, its ICC profile kept): public/examples/<name>-<width>.webp, for each of 800, 1200, 1600 and 2400
// that is narrower than the JPEG. image-variants.test.ts checks this table against the files.
const VARIANTS: Record<string, { width: number; widths: number[] }> = {
  'flycatcher-2026.jpg': { width: 3200, widths: [800, 1200, 1600, 2400] },
  'mallard-color1-preview.jpg': { width: 3200, widths: [800, 1200, 1600, 2400] },
  'fox-snow-color1-preview.jpg': { width: 3200, widths: [800, 1200, 1600, 2400] },
  'squirrel-color1-preview.jpg': { width: 3200, widths: [800, 1200, 1600, 2400] },
  'fox-portrait-color1-preview.jpg': { width: 2401, widths: [800, 1200, 1600, 2400] },
  'sheep-flock-color1-preview.jpg': { width: 2400, widths: [800, 1200, 1600] },
  'sheep-close-color1-preview.jpg': { width: 2400, widths: [800, 1200, 1600] },
  'sheep-portrait-color1-preview.jpg': { width: 2400, widths: [800, 1200, 1600] },
  'chipmunk-2026.jpg': { width: 2400, widths: [800, 1200, 1600] },
  'bears-color1-preview.jpg': { width: 3200, widths: [800, 1200, 1600, 2400] },
};

const variantPath = (image: string, w: number) => `examples/${image.replace(/\.jpe?g$/i, '')}-${w}.webp`;

/** The images that have smaller copies, with the JPEG's width and the copies' widths (for the tests). */
export function exampleVariants(): Readonly<Record<string, { width: number; widths: number[] }>> {
  return VARIANTS;
}

/** A srcset for public/examples/<image>, or '' when the image has no smaller copies. */
export function exampleSrcset(image: string): string {
  const v = VARIANTS[image];
  if (!v) return '';
  return [...v.widths.map((w) => `${variantPath(image, w)} ${w}w`), `examples/${image} ${v.width}w`].join(', ');
}

/** The smallest copy of public/examples/<image> (the image itself when it has none), for small inline artwork. */
export function exampleSmallest(image: string): string {
  const v = VARIANTS[image];
  return v ? variantPath(image, Math.min(...v.widths)) : `examples/${image}`;
}
