// Runs the timing budgets alone, where a budget means something (src/engine/render.test.ts explains why the
// parallel suite skips them). Exit code: vitest's. --json PATH writes vitest's JSON report there.
//
//   node tools/test-perf.mjs [--json out.json]
import { spawnSync } from 'child_process';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const i = process.argv.indexOf('--json');
const extra = i > 0 ? ['--reporter=json', `--outputFile=${process.argv[i + 1]}`] : [];
// Say what this is, because vitest's own summary ("1 passed | 20 skipped") reads as if twenty tests were skipped: render.test.ts has 21,
// and the other twenty run in `npx vitest run`. This command runs the one that times the renderer (it is excluded from the parallel
// suite, where a timing means nothing), so its summary counts the twenty it filtered out as skipped.
console.log("test-perf: running the one timing budget in src/engine/render.test.ts ('well under 3 s'); the other tests in that file run in `npx vitest run`, and vitest will count them as skipped here");
const r = spawnSync(process.execPath, [join(dirname(createRequire(import.meta.url).resolve('vitest/package.json')), 'vitest.mjs'), 'run', 'src/engine/render.test.ts', '-t', 'well under', ...extra],
  { cwd: ROOT, stdio: 'inherit', env: { ...process.env, P2P_PERF: '1' } });
process.exit(r.status ?? 1);
