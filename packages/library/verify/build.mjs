/**
 * verify/build.mjs — bundle the parity-gate page. The one interesting piece
 * is the resolver plugin: the spike beats programs import `"./api"` (their
 * types-only sketch, which has no runtime exports); this plugin aliases that
 * import — per spike, keyed on the importer's directory — onto the runtime
 * shim that re-exports the active program scope. beats.ts is bundled
 * byte-for-byte unmodified.
 */
import { build } from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = join(here, '..');
const dist = join(here, 'dist');
// katex is @math-ai/render's dependency — resolve it from there
const require = createRequire(join(pkg, '..', 'render', 'package.json'));
const katexDist = dirname(require.resolve('katex/dist/katex.min.css'));

const spikeApiAlias = {
  name: 'spike-api-alias',
  setup(b) {
    b.onResolve({ filter: /^\.\/api$/ }, (args) => {
      // DEAD, and harmless: neither `spikes/` nor `packages/library/spike-api/`
      // exists any more — the fixtures under src/__fixtures__/ ship their own
      // `./api` module, so this branch never fires and the gate builds anyway.
      // Kept only until someone confirms nothing else resolves through here.
      if (args.importer.includes(`${sep}spikes${sep}myhill-nerode${sep}`)) {
        return { path: join(pkg, 'spike-api', 'myhill-nerode.ts') };
      }
      return undefined;
    });
  },
};

await mkdir(dist, { recursive: true });
await build({
  entryPoints: [join(here, 'main.ts')],
  bundle: true,
  format: 'iife',
  outfile: join(dist, 'main.js'),
  plugins: [spikeApiAlias],
  logLevel: 'info',
});
await cp(join(here, 'parity.html'), join(dist, 'index.html'));
await cp(join(katexDist, 'katex.min.css'), join(dist, 'katex.min.css'));
await cp(join(katexDist, 'fonts'), join(dist, 'fonts'), { recursive: true });
console.log('parity page built at', dist);
