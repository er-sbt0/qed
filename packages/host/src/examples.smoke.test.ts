/**
 * examples.smoke.test.ts — every program in examples/manifest.json still runs.
 *
 * This is the ONLY test that reads the examples, and it is deliberately blind
 * to what is in them. It asserts the contract from examples/README.md and
 * nothing more:
 *
 *   - the program survives the static gate (lint), and
 *   - it executes to completion inside QuickJS against a real scope, and
 *   - it opens as many beats as it declares (counted from its own source, not
 *     hardcoded here), and
 *   - it actually authors something — narration and views, not an empty run.
 *
 * No beat titles. No op counts. No example named in an assertion. That is what
 * makes the examples editable: rewrite one, add one, delete one, and this test
 * follows without being touched. What it still proves is real and is about the
 * HOST — that a hand-authored program bundles, gates, bridges every verb across
 * the sandbox boundary, and builds a timeline. Engine semantics are pinned by
 * the fixtures under packages/*&#47;src/__fixtures__/ instead.
 *
 * The loop is per-example so a broken one names itself in the failure.
 */
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createWorld } from '@math-ai/core';
import type { TimelineNode } from '@math-ai/core';
import { createStage } from '@math-ai/render';
import { createProgramScope } from '@math-ai/library';
import { QuickJSHost } from './host.js';
import { authoredBeatCount } from './lint.js';
import { newNodeContext } from './node.js';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');
const examplesDir = join(repo, 'examples');
const guestScope = join(here, '..', 'verify', 'guest-scope.ts');

interface ExampleEntry {
  readonly key: string;
  readonly dir: string;
  readonly title: string;
}

const { examples } = JSON.parse(
  readFileSync(join(examplesDir, 'manifest.json'), 'utf8'),
) as { examples: readonly ExampleEntry[] };

/** Bundle an example program into a self-contained guest IIFE string. */
async function bundleGuest(dir: string): Promise<string> {
  const result = await build({
    entryPoints: [join(examplesDir, dir, 'beats.ts')],
    bundle: true,
    format: 'iife',
    target: 'es2020',
    write: false,
    plugins: [
      {
        name: 'guest-scope-alias',
        setup(b) {
          b.onResolve({ filter: /^\.\/api$/ }, (args) =>
            args.importer.includes(`${sep}examples${sep}`) ? { path: guestScope } : undefined,
          );
        },
      },
    ],
  });
  return result.outputFiles[0]!.text;
}

function histogram(
  nodes: readonly TimelineNode[],
  acc: Record<string, number> = {},
): Record<string, number> {
  for (const n of nodes) {
    if (n.type === 'action') acc[n.op] = (acc[n.op] ?? 0) + 1;
    else acc[`@${n.type}`] = (acc[`@${n.type}`] ?? 0) + 1;
    if (n.type === 'cascade') for (const it of n.iterations) histogram(it, acc);
    else if (n.type === 'parallel' || n.type === 'loop') histogram(n.children, acc);
  }
  return acc;
}

describe.each(examples)('examples/$dir', ({ dir }) => {
  it('gates, executes in QuickJS, and lands every beat it authors', async () => {
    const authorSrc = readFileSync(join(examplesDir, dir, 'beats.ts'), 'utf8');
    // No `expectedBeats`: there is no plan behind a hand-written example, so
    // `beats-required` stays silent (see LintOptions). The program is its own
    // outline, and the assertion below is the one that means something.
    const authored = authoredBeatCount(authorSrc);
    expect(authored, 'an example must declare at least one beat').toBeGreaterThan(0);

    const guestSrc = await bundleGuest(dir);
    const world = createWorld();
    const scope = createProgramScope(world, createStage(world)); // headless stage
    const ctx = await newNodeContext();
    const host = new QuickJSHost(ctx, { budget: { authorMs: 20_000 } });
    host.defineScope(scope as unknown as Record<string, unknown>);

    try {
      const lintResult = host.run(guestSrc, { lintSource: authorSrc });
      expect(lintResult.ok, `gate rejected examples/${dir}`).toBe(true);

      const ops = histogram(world.timeline.root);
      // It ran all the way through, and every beat the source writes crossed
      // the sandbox boundary onto the host timeline — a host property, not a
      // fact about this example's content.
      expect(ops.beat ?? 0).toBe(authored);
      // It authored an explanation, not an empty timeline.
      expect(ops.say ?? 0).toBeGreaterThan(0);
      expect(ops.show ?? 0).toBeGreaterThan(0);
    } finally {
      host.dispose();
    }
  });
});
