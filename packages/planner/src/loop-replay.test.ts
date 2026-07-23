/**
 * loop-replay.test.ts — every recorded agentic turn, re-run for free.
 *
 * The sibling of replay.test.ts, for loop cassettes (src/loop-cassettes/*.json):
 * no API key, no network. The model half comes off the tape verbatim; the
 * TOOLS re-execute against a freshly folded QuickJS scene rebuilt from the
 * cassette's own log, and every recomputed result is checked against the
 * recorded one act by act (see loop-cassette.ts for why the split is the
 * point). A failure here means the reply parser, the classifier, or the
 * engine's tool answers drifted from what a real billed conversation already
 * exercised — with the actual divergence named, not just "deep equality
 * failed".
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { sceneManifest } from '@math-ai/render';
import { replayToolLoop, type StoredLoopCassette } from './loop-cassette.js';
import { executorFor, sceneFromLog } from './loop-scene.js';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, 'loop-cassettes');

function loadCassettes(): StoredLoopCassette[] {
  let names: string[];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith('.json'));
  } catch {
    return []; // no loop cassettes recorded yet
  }
  return names.map((n) => JSON.parse(readFileSync(join(dir, n), 'utf8')) as StoredLoopCassette);
}

// A zero-turn cassette records a seam failure before any model text arrived;
// there is no transcript in it to replay.
const cassettes = loadCassettes().filter((c) => c.turns.length > 0);

describe.skipIf(cassettes.length === 0)('recorded agentic turns still run the same way', () => {
  it.each(cassettes.map((c) => [c.slug, c] as const))(
    '%s',
    async (_slug, cassette) => {
      const scene = await sceneFromLog(cassette.scene.log);
      const replay = await replayToolLoop(cassette, executorFor(scene.stage), {
        question: cassette.question,
        manifest: sceneManifest(scene.stage),
        conversation: { log: cassette.scene.log },
        ...(cassette.scene.feed !== undefined ? { feed: cassette.scene.feed } : {}),
      });
      expect(replay.drift).toEqual([]);
      expect(replay.outcome.kind).toBe(cassette.outcome.kind);
    },
    120_000,
  );
});
