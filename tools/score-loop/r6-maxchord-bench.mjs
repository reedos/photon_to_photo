// Score loop r6: the old all-pairs Math.hypot maxChord against the hull version, on a disk-like cloud of the size pointBundle sees.
//   node tools/score-loop/r6-maxchord-bench.mjs
const oldChord = (points) => { let best = 0; for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) { const d = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y); if (d > best) best = d; } return best; };
const newChord = (points) => {
  const n = points.length; if (n < 2) return 0;
  const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => points[a].x - points[b].x || points[a].y - points[b].y);
  const cross = (o, a, b) => (points[a].x - points[o].x) * (points[b].y - points[o].y) - (points[a].y - points[o].y) * (points[b].x - points[o].x);
  const hull = [];
  for (const i of idx) { while (hull.length >= 2 && cross(hull[hull.length - 2], hull[hull.length - 1], i) <= 0) hull.pop(); hull.push(i); }
  const lower = hull.length + 1;
  for (let k = idx.length - 2; k >= 0; k--) { const i = idx[k]; while (hull.length >= lower && cross(hull[hull.length - 2], hull[hull.length - 1], i) <= 0) hull.pop(); hull.push(i); }
  hull.pop();
  let best = 0;
  for (let i = 0; i < hull.length; i++) for (let j = i + 1; j < hull.length; j++) { const dx = points[hull[i]].x - points[hull[j]].x, dy = points[hull[i]].y - points[hull[j]].y; const d = dx * dx + dy * dy; if (d > best) best = d; }
  return Math.sqrt(best);
};
let seed = 7; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
// pointBundle calls it once for all landing points (about 1,900) and once per wavelength (16 sets of about 120), plus the d line
const all = Array.from({ length: 1900 }, () => { const r = 0.05 * Math.sqrt(rnd()), t = 2 * Math.PI * rnd(); return { x: r * Math.cos(t), y: r * Math.sin(t) }; });
const sets = [all, ...Array.from({ length: 16 }, (_, k) => all.slice(k * 118, k * 118 + 118))];
const time = (f) => { const t0 = performance.now(); let s = 0; for (let k = 0; k < 20; k++) for (const p of sets) s += f(p); return [(performance.now() - t0) / 20, s]; };
time(oldChord); time(newChord);
const [a, sa] = time(oldChord), [b, sb] = time(newChord);
console.log(JSON.stringify({ perPointBundleCallMs: { old: +a.toFixed(2), hull: +b.toFixed(2) }, same: Math.abs(sa - sb) < 1e-9 }));
