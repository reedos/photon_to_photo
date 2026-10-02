import { rowWindow, movingEdgeFraction } from './learning-model';
const surfaces = new WeakMap<HTMLCanvasElement, HTMLCanvasElement>();

/** Schematic moving-edge test chart. Timing follows the selected body's model; spatial scale is illustrative. */
export function drawReadout(canvas: HTMLCanvasElement, time: number, scan: number, exposure: number, charge: number, dn: number, bits: number) {
  let surface = surfaces.get(canvas);
  if (!surface) { surface = document.createElement('canvas'); surface.width = 760; surface.height = 210; surfaces.set(canvas, surface); }
  const c = surface.getContext('2d')!;
  const w = surface.width, h = surface.height;
  c.clearRect(0, 0, w, h); c.fillStyle = '#0d141c'; c.fillRect(0, 0, w, h);
  const text = (s: string, x: number, y: number, color = '#b9c6d2', size = 12) => { c.fillStyle = color; c.font = `${size}px ui-monospace, monospace`; c.fillText(s, x, y); };
  text('ELECTRONIC SCAN', 18, 23, '#eed7a4'); text('SELECTED PIXEL', 375, 23, '#eed7a4'); text(`${bits}-BIT CONVERSION`, 550, 23, '#eed7a4');
  const rows = 24, cols = 32, x0 = 20, y0 = 38, cw = 9, ch = 5;
  // Fixed speed is an illustrative chart parameter, not a motion estimate for the rendered photo.
  const edge = (t: number) => .22 + 4 * t;
  for (let row = 0; row < rows; row++) {
    const window = rowWindow(row, rows, scan, exposure);
    const dt = Math.max(0, Math.min(exposure, time - window.start));
    const complete = time >= window.end, active = dt > 0 && !complete;
    for (let col = 0; col < cols; col++) {
      const u = (col + .5) / cols;
      // Integral of a translating step edge: lit until the edge crosses this sample.
      const level = movingEdgeFraction(u, window.start, exposure, time);
      const color = row % 2 === 0 ? (col % 2 === 0 ? [255, 90, 112] : [90, 233, 181]) : (col % 2 === 0 ? [90, 233, 181] : [94, 153, 255]);
      c.fillStyle = `rgb(${color.map(v => Math.round(16 + v * level * .75)).join(',')})`;
      c.fillRect(x0 + col * cw, y0 + row * ch, cw - 1, ch - 1);
    }
    if (active) { c.fillStyle = '#f4db9c'; c.fillRect(x0 - 7, y0 + row * ch, 3, ch - 1); }
    if (complete) { c.fillStyle = '#8cc5f1'; c.fillRect(x0 + cols * cw + 4, y0 + row * ch, 3, ch - 1); }
  }
  // Reference edge at first-row exposure midpoint. Clipped to the diagram, not wrapped.
  const referenceX = x0 + edge(exposure / 2) * cols * cw;
  if (referenceX <= x0 + cols * cw) { c.setLineDash([3, 4]); c.strokeStyle = '#e4edf5'; c.beginPath(); c.moveTo(referenceX, y0); c.lineTo(referenceX, y0 + rows * ch); c.stroke(); c.setLineDash([]); }
  text('Gold: collecting · blue: read', 20, 176, '#b9c6d2', 11);
  text('Moving edge: 4 sensor widths/s', 20, 193, '#b9c6d2', 11);
  const gradient = c.createLinearGradient(0, 50, 0, 159); gradient.addColorStop(0, '#9de3ff'); gradient.addColorStop(1, '#26739c');
  c.strokeStyle = '#7c9aab'; c.lineWidth = 2; c.strokeRect(380, 42, 116, 118);
  c.fillStyle = gradient; c.fillRect(383, 157 - 112 * charge, 110, 112 * charge);
  // Markers represent fractions of charge, not individual electrons or a stochastic sample.
  c.fillStyle = '#e0f5ff';
  for (let i = 0; i < Math.floor(charge * 80); i++) { c.beginPath(); c.arc(389 + (i % 10) * 10, 152 - Math.floor(i / 10) * 13, 1.5, 0, Math.PI * 2); c.fill(); }
  text(`${Math.round(charge * 100)}% full well`, 380, 180, '#b9ddf1', 12);
  c.strokeStyle = '#6cbad9'; c.beginPath(); c.moveTo(501, 101); c.lineTo(532, 101); c.lineTo(526, 96); c.moveTo(532, 101); c.lineTo(526, 106); c.stroke();
  const binary = Math.round(dn).toString(2).padStart(bits, '0');
  for (let i = 0; i < bits; i++) {
    const x = 550 + (i % 7) * 24, y = 51 + Math.floor(i / 7) * 33;
    c.fillStyle = binary[i] === '1' ? '#4c9fa5' : '#202d3a'; c.fillRect(x, y, 19, 25); text(binary[i], x + 5, y + 17, '#f2f8fc');
  }
  text(`${dn.toLocaleString()} DN`, 550, 141, '#f0d899', 20);
  text('Gain → offset → rounding', 550, 176, '#b9c6d2', 11);
  text('Schematic · not the photo', 550, 193, '#b9c6d2', 11);
  const compact = canvas.clientWidth < 500;
  const targetWidth = compact ? 380 : 760, targetHeight = compact ? 405 : 210;
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) { canvas.width = targetWidth; canvas.height = targetHeight; }
  const output = canvas.getContext('2d')!;
  output.fillStyle = '#0d141c'; output.fillRect(0, 0, canvas.width, canvas.height);
  if (compact) {
    output.drawImage(surface, 0, 0, 340, 210, 20, 0, 340, 210);
    output.drawImage(surface, 360, 0, 165, 210, 0, 195, 165, 210);
    output.drawImage(surface, 535, 0, 225, 210, 150, 195, 225, 210);
  } else output.drawImage(surface, 0, 0);
  canvas.setAttribute('aria-label', `Schematic electronic scan at ${(time * 1000).toFixed(2)} milliseconds, ${Math.round(charge * 100)} percent full well, digital output ${dn}. A moving edge is sampled at different times by successive rows.`);
}
