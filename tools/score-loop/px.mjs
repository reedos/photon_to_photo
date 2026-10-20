// Pixel samples from a screenshot: node tools/score-loop/px.mjs file.png x,y [x,y ...]   or   file.png box x0,y0,x1,y1
// A box prints the mean, the max and the mean B-R of its pixels (CSS px in a 1x capture; scale by hand for 2x).
import { readFileSync } from 'node:fs';
import { decodePng } from '../accuracy/png.mjs';

const [file, ...args] = process.argv.slice(2);
const img = decodePng(readFileSync(file));
const at = (x, y) => { const i = (y * img.width + x) * img.channels; return [img.data[i], img.data[i + 1], img.data[i + 2]]; };
if (args[0] === 'box') {
  const [x0, y0, x1, y1] = args[1].split(',').map(Number);
  const sum = [0, 0, 0], max = [0, 0, 0];
  let n = 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const p = at(x, y);
    for (let k = 0; k < 3; k++) { sum[k] += p[k]; max[k] = Math.max(max[k], p[k]); }
    n++;
  }
  const mean = sum.map((v) => +(v / n).toFixed(1));
  console.log(`${file} box ${args[1]}: mean ${mean} max ${max} B-R ${(mean[2] - mean[0]).toFixed(1)}`);
} else {
  for (const a of args) { const [x, y] = a.split(',').map(Number); const p = at(x, y); console.log(`${file} (${x},${y}) = ${p} B-R ${p[2] - p[0]}`); }
}
