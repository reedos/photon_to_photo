import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

let building = false;

// Relative base so the same build runs on GitHub Pages later and as a claude.ai artifact.
export default defineConfig({
  base: './',
  // one copy of three in dev too (the dev server warned "Multiple instances of Three.js being imported")
  resolve: { dedupe: ['three'] },
  plugins: [{
    // Every DRACOLoader here takes its decoder from public/draco/ (src/scene/draco.ts). three's default decoder URLs
    // (new URL('../libs/draco/...', import.meta.url)) made the build emit about 1.3 MB of hashed decoder copies that
    // nothing loads; they become empty strings, which setDecoderPath always replaces.
    name: 'p2p-no-bundled-draco',
    enforce: 'pre',
    transform(code, id) {
      if (!/DRACOLoader\.js$/.test(id.split('?')[0])) return null;
      return { code: code.replace(/new URL\(\s*'\.\.\/libs\/draco\/[^']+',\s*import\.meta\.url\s*\)\.toString\(\)/g, "''"), map: null };
    },
  }, {
    // public/models/bodies.json and lenses.json and public/examples/examples.json are read by the page at run time and by the code at build time. Importing a file from
    // public/ made the dev server print "Assets in public directory cannot be imported from JavaScript" for each, which hid its real
    // warnings (score loop r6). The code imports them as virtual modules instead; the file stays where the Blender export writes it.
    name: 'p2p-model-facts',
    resolveId(id) { return /^virtual:p2p-facts\/(bodies|lenses|examples)$/.test(id) ? '\0' + id : null; },
    async load(id) {
      const m = /^\0virtual:p2p-facts\/(bodies|lenses|examples)$/.exec(id);
      if (!m) return null;
      const { readFileSync } = await import('node:fs');
      const file = fileURLToPath(new URL(m[1] === 'examples' ? './public/examples/examples.json' : `./public/models/${m[1]}.json`, import.meta.url));
      this.addWatchFile(file);
      return `export default ${readFileSync(file, 'utf8')};`;
    },
  }, {
    // realize()'s numbers for every lens, computed once at build time by the engine's own code (tools/realize-all.ts)
    // and handed to the engine at startup (primeRealizations), so the browser skips each lens's real-ray survey: on a
    // 4x-throttled phone it was 1 to 1.5 s of the 2.8 s task that froze the camera's start (score loop r3). The dev
    // server and vitest get an empty table, so they keep computing in place.
    name: 'p2p-realizations',
    resolveId(id) { return id === 'virtual:p2p-realizations' ? '\0p2p-realizations' : null; },
    async load(id) {
      if (id !== '\0p2p-realizations') return null;
      if (!building) return 'export default {};';
      // About 20 s of ray tracing, so the table is kept in .vite/ under a hash of everything it is computed from:
      // the engine's sources, the data files and the generator.
      const { createHash } = await import('node:crypto');
      const { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      const root = fileURLToPath(new URL('.', import.meta.url));
      const files = (dir: string): string[] => readdirSync(join(root, dir), { withFileTypes: true, recursive: true })
        .filter((e) => e.isFile() && /\.(ts|json)$/.test(e.name) && !e.name.endsWith('.test.ts'))
        .map((e) => join(e.parentPath, e.name)).sort();
      const hash = createHash('sha256');
      for (const f of [...files('src/engine'), ...files('data'), join(root, 'tools/realize-all.ts')]) hash.update(f.slice(root.length)).update(readFileSync(f));
      const cache = join(root, '.vite', `p2p-realizations-${hash.digest('hex').slice(0, 16)}.json`);
      if (existsSync(cache)) return `export default ${readFileSync(cache, 'utf8')};`;
      const { runnerImport } = await import('vite');
      const { module } = await runnerImport<{ allRealizations(): Record<string, unknown> }>(join(root, 'tools/realize-all.ts'), { configFile: false, logLevel: 'warn' });
      const json = JSON.stringify(module.allRealizations());
      mkdirSync(join(root, '.vite'), { recursive: true });
      writeFileSync(cache, json);
      return `export default ${json};`;
    },
    configResolved(c) { building = c.command === 'build' && !c.mode.includes('test'); },
  }, {
    // The service worker (src/sw/sw-template.js, score loop r5): emitted at the site root as sw.js with a build id that is a hash
    // of every file the build wrote and of the unhashed files in public/ (the GLBs, textures and decoder, whose names carry no
    // hash), so a build that changes any of them is a new worker with a cache of its own.
    name: 'p2p-service-worker',
    apply: 'build',
    async generateBundle(_options, bundle) {
      const { createHash } = await import('node:crypto');
      const { readFileSync, readdirSync } = await import('node:fs');
      const { join } = await import('node:path');
      const root = fileURLToPath(new URL('.', import.meta.url));
      const hash = createHash('sha256');
      for (const name of Object.keys(bundle).sort()) hash.update(name);
      const walk = (dir: string): string[] => readdirSync(join(root, dir), { withFileTypes: true })
        .flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`])).sort();
      // every unhashed file the site serves from public/ (score loop r6: the media files were left out, so a changed loop or poster with
      // unchanged code kept a stale copy under the cache-first rule)
      for (const file of walk('public')) hash.update(file).update(readFileSync(join(root, file)));
      const source = readFileSync(join(root, 'src/sw/sw-template.js'), 'utf8').replace("const BUILD = '__P2P_BUILD__'", `const BUILD = '${hash.digest('hex').slice(0, 12)}'`);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  }, {
    // The opening warms the camera while the reader looks at it (src/app/warm.ts, score loop r3): it needs the hashed
    // names of app-start's chunk and every chunk that one imports. They are written into index.html as
    // <meta name="p2p-warm-modules" content="./assets/a.js ./assets/b.js">. The dev server has no such list.
    name: 'p2p-warm-modules',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        if (!ctx.bundle || !/(^|\/)index\.html$/.test(ctx.filename.replace(/\\/g, '/'))) return html;
        const chunks = Object.values(ctx.bundle).filter((c) => c.type === 'chunk');
        const start = chunks.find((c) => c.type === 'chunk' && /[\\/]src[\\/]app-start\.ts$/.test(c.facadeModuleId ?? ''));
        if (!start || start.type !== 'chunk') return html;
        const files: string[] = [];
        const visit = (file: string) => {
          if (files.includes(file)) return;
          files.push(file);
          const c = ctx.bundle![file];
          if (c?.type === 'chunk') c.imports.forEach(visit);
        };
        visit(start.fileName);
        // Play the shot is the opening's own button: its player's code is fetched ahead too (score loop r4)
        const player = chunks.find((c) => c.type === 'chunk' && /[\\/]src[\\/]app[\\/]shot-player\.ts$/.test(c.facadeModuleId ?? ''));
        if (player) visit(player.fileName);
        // the opening's own entry chunk is already loaded
        const entry = ctx.chunk?.fileName;
        const warm = files.filter((f) => f !== entry);
        const list = warm.map((f) => `./${f}`).join(' ');
        // the bytes those files take over the wire (gzip, as a static host sends them): the veil shows how much of them has arrived
        // while a slow connection downloads the camera (main.ts, watchCodeDownload; score loop r5)
        const bytes = warm.reduce((sum, f) => { const c = ctx.bundle![f]; return sum + (c?.type === 'chunk' ? gzipSync(c.code).length : 0); }, 0);
        return html.replace('</head>', `<meta name="p2p-warm-modules" content="${list}">\n<meta name="p2p-code-bytes" content="${bytes}">\n</head>`);
      },
    },
  }],
  // its own dependency cache: agent worktrees link node_modules to this checkout, and a shared node_modules/.vite
  // lets their dev servers invalidate this one's optimized deps ("504 Outdated Optimize Dep")
  cacheDir: '.vite',
  build: {
    target: 'es2022',
    // The `look` chunk is three/webgpu (2,047 kB raw, 426 kB gzip on 10/14/2026; the reviewers' build of the merged branches
    // measured 2,109 kB, with the chunk named after the first module that landed in it, `compile-steps`, which made the
    // warning look like it came from a 12 kB file). WebGPURenderer imports its WebGL2 fallback backend statically, so both
    // backends ship in one chunk; splitting them needs a renderer factory that does not go through WebGPURenderer (not done:
    // score loop r2, r4, r5). The limit sits about 7% above the merged size, so the warning fires again when the chunk grows
    // by that much instead of being ignored by habit (score loop r5: re-baselined from 2,100 kB, which every merged build
    // exceeded). Chunks are named by module in the build output; `look` and `app-start` are the two that matter.
    chunkSizeWarningLimit: 2250,
    // the standalone previews (docs/PANE.md) need their own build entries: lens-preview.html shows one lens,
    // scene-preview.html the two bodies; screenshot tooling runs `vite preview` against a real build
    // Score loop r4: the two previews are developer tools (a 4x-throttled phone froze 3.3 to 4.8 s on them). The public build
    // (P2P_PUBLIC_BUILD=1, set by the Pages workflow) leaves them out; the build the gates test keeps them.
    rollupOptions: { input: {
      main: 'index.html', models: 'models.html', reference: 'reference.html',
      ...(process.env.P2P_PUBLIC_BUILD === '1' ? {} : { lensPreview: 'lens-preview.html', scenePreview: 'scene-preview.html' }),
    } },
  },
  // agent worktrees live under .claude/; their edits must not reload this server's page
  server: { watch: { ignored: ['**/.claude/**', '**/shots/**', '**/dist*/**', '**/recordings/**'] } },
  // tsconfig.json already opts into `"types": ["vitest/globals"]` (describe/it/expect typed as ambient globals);
  // this turns that on at runtime too, matching what that typing promises. Not in workstream E1a's owned paths,
  // but every workstream's *.test.ts needs it to run at all -- see needs_from_lead in E1a's report.
  // 30 s: several tests realize every lens (a few seconds each on a CI runner); the 5 s default failed on GitHub
  test: { include: ['src/**/*.test.ts'], globals: true, testTimeout: 30000 },
});
