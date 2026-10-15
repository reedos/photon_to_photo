// Score loop r3 (visual): runs tools/run-gates.mjs against a fresh dev server on 47830 (vite does not watch files
// under .claude/, so a long-lived server in a worktree serves stale modules), with the accuracy gates' preview on
// 47831 so parallel worktrees do not collide.   node tools/score-loop/r3-gates.mjs [filter words...]
import { spawn } from 'node:child_process';
const { createServer } = await import('vite');
const dev = await createServer({ root: process.cwd(), logLevel: 'error', server: { host: '127.0.0.1', port: 47830, strictPort: true, open: false } });
await dev.listen();
const code = await new Promise((done) => {
  const child = spawn(process.execPath, ['tools/run-gates.mjs', ...process.argv.slice(2)], {
    stdio: 'inherit', env: { ...process.env, P2P_URL: 'http://127.0.0.1:47830/', P2P_PREVIEW_PORT: '47831' },
  });
  child.on('close', done);
});
await dev.close();
process.exit(code ?? 1);
