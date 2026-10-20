// Runs tools/test-perf.mjs N times and prints the budget test's duration each time (review loop, 10/10/2026).
//   node tools/review-loop/perf-times.mjs [label] [n]
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const label = process.argv[2] || 'run', n = Number(process.argv[3] || 3);
const dir = mkdtempSync(join(tmpdir(), 'p2p-perf-'));
const times = [];
for (let i = 0; i < n; i++) {
  const out = join(dir, `perf-${i}.json`);
  const r = spawnSync(process.execPath, ['tools/test-perf.mjs', '--json', out], { stdio: 'ignore' });
  const j = JSON.parse(readFileSync(out, 'utf8'));
  for (const f of j.testResults) for (const a of f.assertionResults) if (a.status !== 'skipped' && a.status !== 'pending') times.push({ status: a.status, ms: a.duration, exit: r.status });
}
console.log(label, JSON.stringify(times));
