import { defineConfig } from 'vitest/config';

// Relative base so the same build runs on GitHub Pages later and as a claude.ai artifact.
export default defineConfig({
  base: './',
  // its own dependency cache: agent worktrees link node_modules to this checkout, and a shared node_modules/.vite
  // lets their dev servers invalidate this one's optimized deps ("504 Outdated Optimize Dep")
  cacheDir: '.vite',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
    // the standalone previews (docs/PANE.md) need their own build entries: lens-preview.html shows one lens,
    // scene-preview.html the two bodies; screenshot tooling runs `vite preview` against a real build
    rollupOptions: { input: { main: 'index.html', lensPreview: 'lens-preview.html', scenePreview: 'scene-preview.html', models: 'models.html' } },
  },
  // agent worktrees live under .claude/; their edits must not reload this server's page
  server: { watch: { ignored: ['**/.claude/**', '**/shots/**', '**/dist*/**', '**/recordings/**'] } },
  // tsconfig.json already opts into `"types": ["vitest/globals"]` (describe/it/expect typed as ambient globals);
  // this turns that on at runtime too, matching what that typing promises. Not in workstream E1a's owned paths,
  // but every workstream's *.test.ts needs it to run at all -- see needs_from_lead in E1a's report.
  // 30 s: several tests realize every lens (a few seconds each on a CI runner); the 5 s default failed on GitHub
  test: { include: ['src/**/*.test.ts'], globals: true, testTimeout: 30000 },
});
