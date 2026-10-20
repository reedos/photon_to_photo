// vite.config.ts (p2p-realizations): realize()'s numbers for every lens, computed at build time; {} in the dev server.
declare module 'virtual:p2p-realizations' {
  const table: Record<string, import('./engine/realize').Realization>;
  export default table;
}

// vite.config.ts (p2p-model-facts): public/models/bodies.json and lenses.json, as modules the dev server does not warn about.
declare module 'virtual:p2p-facts/bodies' { const facts: typeof import('../public/models/bodies.json'); export default facts; }
declare module 'virtual:p2p-facts/lenses' { const facts: typeof import('../public/models/lenses.json'); export default facts; }
declare module 'virtual:p2p-facts/examples' { const facts: typeof import('../public/examples/examples.json'); export default facts; }
