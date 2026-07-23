/**
 * verify/build.mjs — build the milestone-5 gate page.
 *
 * Two bundles:
 *  1. the GUEST bundles — each spike's beats.ts (byte-for-byte unmodified),
 *     `./api` aliased onto guest-scope.ts (reads the marshalled globals),
 *     emitted as strings the host evaluates inside QuickJS. The raw author
 *     sources ride along for the lint gate.
 *  2. the HOST harness — main.ts, with the QuickJS single-file WASM variant
 *     (wasm embedded as base64 — NO fetch, so it loads under CSP / offline in
 *     headless Chromium) and the guest sources inlined.
 *
 * Plus katex css/fonts + index.html, exactly as the M4 parity page.
 */
import { build } from 'esbuild';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');
const dist = join(here, 'dist');
const require = createRequire(join(here, '..', '..', 'render', 'package.json'));
const katexDist = dirname(require.resolve('katex/dist/katex.min.css'));

const guestScopeAlias = {
  name: 'guest-scope-alias',
  setup(b) {
    b.onResolve({ filter: /^\.\/api$/ }, (args) =>
      args.importer.includes(`${sep}spikes${sep}`) ? { path: join(here, 'guest-scope.ts') } : undefined,
    );
  },
};

async function bundleGuest(entry) {
  const res = await build({
    entryPoints: [entry],
    bundle: true,
    format: 'iife',
    target: 'es2020',
    write: false,
    plugins: [guestScopeAlias],
    logLevel: 'warning',
  });
  return res.outputFiles[0].text;
}

await mkdir(dist, { recursive: true });

// ── 1. guest bundles + raw author sources (for the lint gate) ──
// BROKEN, independently of the markov removal: there is no `spikes/` directory
// in this repo any more, so every path below resolves to nothing and this gate
// cannot build. Repointing it (at packages/library/src/__fixtures__/ or at
// examples/) is a separate job — left as-is rather than guessed at.
const spikes = {
  nerode: join(repo, 'spikes', 'myhill-nerode', 'beats.ts'),
  ftc: join(repo, 'spikes', 'ftc', 'beats.ts'),
  determinant: join(repo, 'spikes', 'determinant', 'beats.ts'),
};
const guest = {};
const author = {};
for (const [name, entry] of Object.entries(spikes)) {
  guest[name] = await bundleGuest(entry);
  author[name] = await readFile(entry, 'utf8');
}
await writeFile(
  join(dist, 'guest-sources.js'),
  `export const GUEST_SOURCES = ${JSON.stringify(guest)};\n` +
    `export const AUTHOR_SOURCES = ${JSON.stringify(author)};\n`,
);

// ── 2. the host harness (wasm embedded, guest sources inlined) ──
await build({
  entryPoints: [join(here, 'main.ts')],
  bundle: true,
  format: 'iife',
  target: 'es2020',
  platform: 'browser',
  outfile: join(dist, 'main.js'),
  logLevel: 'info',
});

await cp(join(here, 'parity.html'), join(dist, 'index.html'));
await cp(join(katexDist, 'katex.min.css'), join(dist, 'katex.min.css'));
await cp(join(katexDist, 'fonts'), join(dist, 'fonts'), { recursive: true });
console.log('gate page built at', dist);
