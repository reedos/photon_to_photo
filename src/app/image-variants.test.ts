import { existsSync, readFileSync } from 'node:fs';
import catalog from '../../public/examples/examples.json';
import { exampleSrcset, exampleVariants } from './image-variants';

/** Width and height of a JPEG (its SOF marker) or a WebP (VP8 / VP8L / VP8X header). */
function size(path: string): [number, number] {
  const b = readFileSync(path);
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i < b.length) {
      const marker = b[i + 1], len = b.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
      i += 2 + len;
    }
    throw new Error(`no SOF in ${path}`);
  }
  const chunk = b.toString('ascii', 12, 16);
  if (chunk === 'VP8X') return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
  if (chunk === 'VP8 ') return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
  if (chunk === 'VP8L') { const bits = b.readUInt32LE(21); return [1 + (bits & 0x3fff), 1 + ((bits >> 14) & 0x3fff)]; }
  throw new Error(`unknown image ${path}`);
}

describe('smaller copies of the example photographs (score loop r3)', () => {
  it('every example main image wider than 800 px has copies, and the table matches the files', () => {
    const table = exampleVariants();
    for (const ex of catalog.examples) {
      const [w, h] = size(`public/examples/${ex.image}`);
      const v = table[ex.image];
      expect(v, ex.image).toBeDefined();
      expect(v.width, ex.image).toBe(w);
      expect(v.widths, ex.image).toEqual([800, 1200, 1600, 2400].filter((x) => x < w));
      for (const x of v.widths) {
        const file = `public/examples/${ex.image.replace(/\.jpg$/, '')}-${x}.webp`;
        expect(existsSync(file), file).toBe(true);
        const [vw, vh] = size(file);
        expect(vw, file).toBe(x);
        expect(Math.abs(vh - h * x / w), file).toBeLessThanOrEqual(1);
      }
    }
  });

  it('srcset lists the copies and the JPEG', () => {
    expect(exampleSrcset('chipmunk-2026.jpg')).toBe('examples/chipmunk-2026-800.webp 800w, examples/chipmunk-2026-1200.webp 1200w, examples/chipmunk-2026-1600.webp 1600w, examples/chipmunk-2026.jpg 2400w');
    expect(exampleSrcset('unknown.jpg')).toBe('');
  });
});
