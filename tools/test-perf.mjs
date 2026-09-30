// Runs the timing budgets alone, where a budget means something (src/engine/render.test.ts explains why the
// parallel suite skips them). Exit code: vitest's. --json PATH writes vitest's JSON report there.
//
//   node tools/test-perf.mjs [--json out.json]
import { spawnSync } from 'child_process';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const i = process.argv.indexOf('--json');
const extra = i > 0 ? ['--reporter=json', `--outputFile=${process.argv[i + 1]}`] : [];
const r = spawnSync(process.execPath, [join(ROOT, 'node_modules/vitest/vitest.mjs'), 'run', 'src/engine/render.test.ts', '-t', 'well under', ...extra],
  { cwd: ROOT, stdio: 'inherit', env: { ...process.env, P2P_PERF: '1' } });
process.exit(r.status ?? 1);
