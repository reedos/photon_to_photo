// Minimal, dependency-free PNG decoder (8-bit depth, non-interlaced, color types 0/2/3/4/6) built for this
// review only, because drawImage()/getImageData() on the #gl canvas silently returns transparent-black data
// in this headless WebGPU setup (the canvas presumably composites via a path the main-thread 2D readback
// can't see), while Playwright's own page.screenshot() (which grabs the actually-composited frame) does not
// have that problem. So: screenshot to PNG bytes, decode here, sample the real pixels.
import zlib from 'node:zlib';

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG (bad signature)');
  let off = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0;
  const idatChunks = [];
  let palette = null;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data.readUInt8(8);
      colorType = data.readUInt8(9);
      const interlace = data.readUInt8(12);
      if (interlace !== 0) throw new Error('interlaced PNG not supported');
      if (bitDepth !== 8) throw new Error(`bit depth ${bitDepth} not supported (only 8)`);
    } else if (type === 'PLTE') {
      palette = data;
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    } else if (type === 'IEND') {
      break;
    }
    off += 12 + len;
  }
  const channelsByType = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  const channels = channelsByType[colorType];
  if (channels === undefined) throw new Error(`unsupported color type ${colorType}`);
  const raw = zlib.inflateSync(Buffer.concat(idatChunks));
  const bpp = channels; // bytes per pixel at 8-bit depth
  const stride = width * bpp;
  const out = new Uint8Array(width * height * 4);
  let rawOff = 0;
  const prevRow = new Uint8Array(stride);
  let curRow = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[rawOff]; rawOff += 1;
    for (let x = 0; x < stride; x++) {
      const rawByte = raw[rawOff + x];
      const a = x >= bpp ? curRow[x - bpp] : 0;
      const b = prevRow[x];
      const c = x >= bpp ? prevRow[x - bpp] : 0;
      let val;
      switch (filter) {
        case 0: val = rawByte; break;
        case 1: val = (rawByte + a) & 0xff; break;
        case 2: val = (rawByte + b) & 0xff; break;
        case 3: val = (rawByte + ((a + b) >> 1)) & 0xff; break;
        case 4: val = (rawByte + paeth(a, b, c)) & 0xff; break;
        default: throw new Error(`unsupported filter type ${filter}`);
      }
      curRow[x] = val;
    }
    rawOff += stride;
    for (let x = 0; x < width; x++) {
      const so = x * bpp;
      const dO = (y * width + x) * 4;
      if (colorType === 6) { // RGBA
        out[dO] = curRow[so]; out[dO + 1] = curRow[so + 1]; out[dO + 2] = curRow[so + 2]; out[dO + 3] = curRow[so + 3];
      } else if (colorType === 2) { // RGB
        out[dO] = curRow[so]; out[dO + 1] = curRow[so + 1]; out[dO + 2] = curRow[so + 2]; out[dO + 3] = 255;
      } else if (colorType === 0) { // grayscale
        out[dO] = out[dO + 1] = out[dO + 2] = curRow[so]; out[dO + 3] = 255;
      } else if (colorType === 4) { // gray+alpha
        out[dO] = out[dO + 1] = out[dO + 2] = curRow[so]; out[dO + 3] = curRow[so + 1];
      } else if (colorType === 3) { // palette
        const idx = curRow[so];
        out[dO] = palette[idx * 3]; out[dO + 1] = palette[idx * 3 + 1]; out[dO + 2] = palette[idx * 3 + 2]; out[dO + 3] = 255;
      }
    }
    prevRow.set(curRow);
  }
  return { width, height, data: out };
}
