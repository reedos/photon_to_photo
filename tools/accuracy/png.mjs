// A minimal PNG decoder (8-bit, colortype 2 RGB or 6 RGBA, non-interlaced -- what Playwright/Chromium screenshots
// produce) for the accuracy gates' exact-pixel checks. Node has no image-decoding package in this project
// (tools/accuracy/lens.mjs's own header explains why: an in-page canvas readback of a WebGPU canvas via
// drawImage()+getImageData() reads back fully transparent everywhere in this environment, so the gate reads an
// actual screenshot PNG instead, per the task brief's own "read pixels from screenshots"), and adding a new npm
// dependency for one decoder felt heavier than the ~80 lines PNG's spec actually needs on top of node:zlib.
import { inflateSync } from 'node:zlib';

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/** Decodes a PNG Buffer into { width, height, channels, data: Uint8Array } (data is un-filtered, row-major,
 *  `channels` bytes per pixel: 3 for RGB, 4 for RGBA). Throws on anything this decoder doesn't handle
 *  (interlaced, palette, <8-bit, 16-bit) -- none of which a browser screenshot ever produces. */
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a) {
    throw new Error('png.mjs: not a PNG (bad signature)');
  }
  let offset = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idatChunks = [];
  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + len;
  }
  if (bitDepth !== 8) throw new Error(`png.mjs: unsupported bit depth ${bitDepth} (only 8-bit)`);
  if (interlace !== 0) throw new Error('png.mjs: interlaced PNG not supported');
  if (colorType !== 2 && colorType !== 6) throw new Error(`png.mjs: unsupported color type ${colorType} (only RGB/RGBA)`);
  const channels = colorType === 6 ? 4 : 3;

  const raw = inflateSync(Buffer.concat(idatChunks));
  const stride = width * channels;
  const out = new Uint8Array(height * stride);
  let pos = 0;
  const prevRow = new Uint8Array(stride);
  let curRow = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    for (let x = 0; x < stride; x++) {
      const raw8 = raw[pos + x];
      const a = x >= channels ? curRow[x - channels] : 0;
      const b = prevRow[x];
      const c = x >= channels ? prevRow[x - channels] : 0;
      let v;
      switch (filter) {
        case 0: v = raw8; break;
        case 1: v = raw8 + a; break;
        case 2: v = raw8 + b; break;
        case 3: v = raw8 + ((a + b) >> 1); break;
        case 4: v = raw8 + paeth(a, b, c); break;
        default: throw new Error(`png.mjs: bad filter type ${filter} at row ${y}`);
      }
      curRow[x] = v & 0xff;
    }
    out.set(curRow, y * stride);
    pos += stride;
    prevRow.set(curRow);
    curRow = new Uint8Array(stride);
  }
  return { width, height, channels, data: out };
}

/** RGBA (alpha 255 if the source has no alpha channel) at (x, y), or null if out of bounds. */
export function pngPixel(img, x, y) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return null;
  const i = (y * img.width + x) * img.channels;
  return img.channels === 4
    ? [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]]
    : [img.data[i], img.data[i + 1], img.data[i + 2], 255];
}
