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

export function evidenceSearch(source: EvidenceSource): string {
  const text = [source.label, source.url, ...source.uses.flatMap(use => [use.path, use.evidence, use.locator])].join(' ');
  return `${text} ${text.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[._-]/g, ' ')}`;
}
