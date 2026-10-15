export type EvidenceUse = {
  path: string;
  evidence: string;
  evidencePath: string;
  locator: string;
};
export type EvidenceSource = { label: string; url: string; uses: EvidenceUse[] };

/** Index explicit source fields only. Shared URLs retain their separate recorded contexts. */
export function evidenceIndex(records: Record<string, unknown>): EvidenceSource[] {
  const sources = new Map<string, EvidenceSource>();
  function collect(value: unknown, label: string, path: string, evidence = '', evidencePath = '') {
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    if (typeof record.ev === 'string') { evidence = record.ev; evidencePath = path; }
    // a lens file's source block (kind: 'patent') is a published patent example: a published specification (score loop r5; seven
    // records read "No label on the record")
    else if (record.kind === 'patent') { evidence = 'spec'; evidencePath = path; }
    const locator = [...new Set(['ref', 'title', 'loc', 'location'].map(key => record[key])
      .filter((item): item is string => typeof item === 'string' && !!item))].join(' · ');
    for (const key of ['src', 'url']) {
      const url = record[key];
      if (typeof url !== 'string' || !/^https?:\/\//.test(url)) continue;
      try { new URL(url); } catch { continue; }
      const id = `${label}\n${url}`;
      const source = sources.get(id) ?? { label, url, uses: [] };
      const use = { path: path || 'Root record', evidence, evidencePath, locator };
      if (!source.uses.some(old => JSON.stringify(old) === JSON.stringify(use))) source.uses.push(use);
      sources.set(id, source);
    }
    Object.entries(record).forEach(([key, child]) => collect(child, label,
      Array.isArray(value) ? `${path}[${key}]` : path ? `${path}.${key}` : key, evidence, evidencePath));
  }
  Object.entries(records).forEach(([path, value]) => collect(value, path.split('/').pop()!.replace(/\.json$/, '').toUpperCase(), ''));
  return [...sources.values()];
}

/** Score loop r4: the index labels each record with its file name (M50, N500FL, READ-NOISE), which says nothing to a reader.
 *  Each file's plain name and the group it sits in; an unknown file keeps its own label. */
export const EVIDENCE_NAMES: Record<string, { name: string; group: 'Cameras' | 'Lenses' }> = {
  D850: { name: 'Nikon D850 camera', group: 'Cameras' },
  Z8: { name: 'Nikon Z8 camera', group: 'Cameras' },
  'READ-NOISE': { name: 'Read-noise measurements for the cameras', group: 'Cameras' },
  S35: { name: '35 mm f/1.4 wide-angle lens · patent example', group: 'Lenses' },
  Z35: { name: '35 mm f/1.8 mirrorless wide-angle lens · patent example', group: 'Lenses' },
  N50: { name: '50 mm f/1.8 standard lens · patent example', group: 'Lenses' },
  M50: { name: '50 mm f/1.8 mirrorless normal lens · patent example', group: 'Lenses' },
  N500: { name: '500 mm f/5.6 telephoto lens · patent example', group: 'Lenses' },
  N500FL: { name: '500 mm f/4 fluorite telephoto lens · patent example', group: 'Lenses' },
  Z800: { name: '800 mm Phase Fresnel super-telephoto lens · patent example', group: 'Lenses' },
};
export function evidenceDisplay(label: string): { name: string; group: string } {
  return EVIDENCE_NAMES[label] ?? { name: label, group: 'Other records' };
}

export function evidenceSearch(source: EvidenceSource): string {
  const text = [source.label, evidenceDisplay(source.label).name, source.url, ...source.uses.flatMap(use => [use.path, use.evidence, use.locator])].join(' ');
  return `${text} ${text.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[._-]/g, ' ')}`;
}

// ---- reader-facing locators (score loop r2, 10/11/2026) -------------------------------------------------------
// A record's locator mixes what the source says with how it was retrieved ("extracted via curl + bracket-balanced
// JS-literal parse", "read via r.jina.ai ... Google Patents itself returned HTTP 503"). The Evidence page shows the
// reader-facing part by default and keeps the full original text, unchanged, in a collapsed "Retrieval notes".

/** Clauses about how a value was fetched or parsed, not about what the source says. */
const RETRIEVAL = /\bcurl\b|\bparse\b|r\.jina\.ai|\bHTTP \d{3}\b|Playwright|headless|fetch tool|JS[- ]literal|JS data literal|inline <script>|\bextracted\b|\bread via\b|this session|same method as data\//i;
/** Chart-data field names the source page uses internally, in plain words. */
const FIELD_NAMES: Record<string, string> = {
  fwc: 'full-well capacity', unityEv: 'unity-gain ISO', 'loEv/hiEv': 'analog-gain ISO range', loEv: 'lowest analog-gain ISO',
  hiEv: 'highest analog-gain ISO', lowLightEv: 'low-light marker', qe: 'quantum efficiency', isoinvariantat: 'ISO-invariance point',
  unitygain: 'unity-gain ISO', readnoise: 'read noise', adcnoise: 'ADC noise',
};

/** Micrometers as µm, ISO dates as M/D/YYYY, in text a reader sees. */
export function readerUnits(text: string): string {
  return text
    .replace(/(\d)\s?um\b/g, '$1 µm')
    .replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_, y: string, m: string, d: string) => `${Number(m)}/${Number(d)}/${y}`);
}

function plainField(code: string): string {
  const field = code.replace(/:\s*[\d.]+$/, '').trim();
  const value = /:\s*([\d.]+)$/.exec(code)?.[1];
  const name = FIELD_NAMES[field];
  if (!name) return /^[\w/]+$/.test(code) ? code : '';
  return value ? `${name} ${value}` : name;
}

/** Split a recorded locator into the part a reader needs and, when anything was dropped or reworded, the original
 *  text as retrieval notes. Nothing is invented: the summary only keeps, drops or plain-words clauses of the record. */
export function readerLocator(raw: string): { summary: string; notes: string } {
  if (!raw) return { summary: '', notes: '' };
  // A quotation inside a quotation was stored with backslash-escaped quotes (\"measured ISO\"), which showed to
  // readers as written; it reads as single curly quotes instead (score loop r3).
  const locator = raw.replace(/\\"([^"\\]*)\\"/g, '‘$1’');
  const clauses = locator.replace(/^Search-tool-summarized figure:\s*/i, '')
    .split(/\s+(?:--|—)\s+|;\s+|(?<=[a-z\d)\]])\.\s+(?=[A-Z])/);
  const kept: string[] = [];
  for (const clause of clauses) {
    if (RETRIEVAL.test(clause)) {
      // a chart title or series name inside a retrieval clause is still what the reader needs
      const chart = /chart "([^"]+)"/.exec(clause)?.[1], series = /name '([^']+)'/.exec(clause)?.[1];
      if (chart || series) kept.push([chart && `Chart “${chart}”`, series && `series ${series}`].filter(Boolean).join(', '));
      continue;
    }
    const text = clause
      .replace(/`loEv`\/`hiEv`/g, '`loEv/hiEv`')
      .replace(/Highcharts\s+`series`\s+array/g, 'chart data')
      .replace(/Highcharts\s+series options?\s*/g, 'chart field: ')
      .replace(/(`[^`]+`)\s+series options?/g, 'chart field: $1')
      .replace(/flat data array entry:?/g, 'data table entry')
      .replace(/field `([^`]+)`/g, (_, c: string) => plainField(c))
      .replace(/`([^`]*)`/g, (_, c: string) => plainField(c))
      .replace(/\s{2,}/g, ' ').replace(/\s+([,.;:])/g, '$1').replace(/[:,]\s*$/, '').trim();
    if (text) kept.push(text);
  }
  const summary = readerUnits(kept.join('; ').replace(/\s+/g, ' ').trim());
  return { summary, notes: summary === locator ? '' : locator };
}
