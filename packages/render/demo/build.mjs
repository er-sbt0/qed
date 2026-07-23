/**
 * demo/build.mjs — bundle the demo with esbuild and copy static assets
 * (index.html, KaTeX css + fonts) into demo/dist.
 */
import { build } from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, 'dist');
const require = createRequire(import.meta.url);
const katexDist = dirname(require.resolve('katex/dist/katex.min.css'));

await mkdir(dist, { recursive: true });
await build({
  entryPoints: [join(here, 'main.ts')],
  bundle: true,
  format: 'iife',
  outfile: join(dist, 'main.js'),
  logLevel: 'info',
});
await cp(join(here, 'index.html'), join(dist, 'index.html'));
await cp(join(katexDist, 'katex.min.css'), join(dist, 'katex.min.css'));
await cp(join(katexDist, 'fonts'), join(dist, 'fonts'), { recursive: true });
console.log('demo built at', dist);
