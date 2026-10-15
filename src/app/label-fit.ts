// Fits one canvas label inside the canvas (score loop r5: on a 320 to 390 px phone the shot player's labels ran past the
// right edge, "Sensor samples illustrated from the JPEG · not the orig"). Pure geometry, so a unit test can check it
// without a browser: the label is wrapped at word breaks to the width that is available, then slid sideways until every
// line sits inside the canvas, and stacked up or down so the block stays inside vertically.

export interface FitInput {
  value: string;
  x: number; y: number;
  align: 'left' | 'center' | 'right';
  /** width of a string at the label's font, in the same units as x */
  measure: (s: string) => number;
  lineHeight: number;
  /** horizontal limits a line's padded box may use */
  lo: number; hi: number;
  /** vertical limits for a line's text box (baseline - ascent to baseline + descent) */
  top: number; bottom: number;
  ascent: number; descent: number;
  padX: number; padY: number;
}
export interface FitLine { text: string; x: number; y: number; w: number }
export interface FitResult {
  lines: FitLine[];
  /** the label was wrapped or moved from where it was asked for */
  adjusted: boolean;
  /** a line's padded box still leaves the canvas (a single word wider than the canvas) */
  outside: boolean;
}

export function wrapWords(value: string, measure: (s: string) => number, maxWidth: number): string[] {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const trial = current ? `${current} ${word}` : word;
    if (current && measure(trial) > maxWidth) { lines.push(current); current = word; } else current = trial;
  }
  if (current) lines.push(current);
  return lines.length ? lines : [value];
}

export function fitLabel(p: FitInput): FitResult {
  const room = p.hi - p.lo - 2 * p.padX;
  const whole = p.measure(p.value);
  const texts = whole > room ? wrapWords(p.value, p.measure, room) : [p.value];
  const widths = texts.map(p.measure);
  const left = (w: number) => p.align === 'center' ? p.x - w / 2 : p.align === 'right' ? p.x - w : p.x;
  // slide the whole block sideways so every line fits (the lines keep their alignment to one another)
  let shift = 0;
  const lows = widths.map((w) => left(w) - p.padX), highs = widths.map((w) => left(w) + w + p.padX);
  const minLeft = Math.min(...lows), maxRight = Math.max(...highs);
  if (maxRight > p.hi) shift = p.hi - maxRight;
  if (minLeft + shift < p.lo) shift = p.lo - minLeft;
  // stack downward from the asked-for baseline in the top half, upward from it in the bottom half
  const n = texts.length, mid = (p.top + p.bottom) / 2, up = p.y > mid;
  let first = up ? p.y - (n - 1) * p.lineHeight : p.y;
  const blockTop = first - p.ascent - p.padY, blockBottom = first + (n - 1) * p.lineHeight + p.descent + p.padY;
  if (blockBottom > p.bottom) first -= blockBottom - p.bottom;
  else if (blockTop < p.top) first += p.top - blockTop;
  const lines = texts.map((text, i) => ({ text, x: left(widths[i]) + shift, y: first + i * p.lineHeight, w: widths[i] }));
  const eps = 0.5;
  const outside = lines.some((l) => l.x - p.padX < p.lo - eps || l.x + l.w + p.padX > p.hi + eps);
  const adjusted = n > 1 || Math.abs(shift) > eps || Math.abs(first - (up ? p.y - (n - 1) * p.lineHeight : p.y)) > eps;
  return { lines, adjusted, outside };
}
