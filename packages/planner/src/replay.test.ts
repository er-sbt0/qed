/**
 * replay.test.ts — every recorded generation, re-run through the CURRENT gate.
 *
 * Free: no API key, no network. This is the regression check for everything
 * that post-processes model output — the extractor, the shape rules, the lint
 * gate, the repair brief. A cassette is real model text that a real billed run
 * produced; replaying it says whether today's pipeline still handles it the way
 * it did when it was recorded.
 *
 * What a failure here means, in order of likelihood:
 *
 *   1. A lint rule started rejecting something legal (false reject). The
 *      cassette's program gated cleanly once and does not now.
 *   2. The extractor or shape gate stopped handling a real response format.
 *   3. You deliberately changed the gate and the recorded outcome is simply out
 *      of date — re-record, on purpose, and commit the new cassette.
 *
 * It is NOT a check on prompt quality: replay is keyed on call order, not on
 * prompt text, so a changed `api-reference.ts` does not invalidate cassettes.
 * See cassettes/README.md for why that trade is the right one.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { replayClient, type Cassette } from './cassette.js';
import { generateAnswer } from './generate.js';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, 'cassettes');

function loadCassettes(): Cassette[] {
  let names: string[];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith('.json'));
  } catch {
    return []; // no cassettes recorded yet
  }
  return names.map((n) => JSON.parse(readFileSync(join(dir, n), 'utf8')) as Cassette);
}

const cassettes = loadCassettes();

describe.skipIf(cassettes.length === 0)('recorded generations still gate the same way', () => {
  it.each(cassettes.map((c) => [c.slug, c] as const))('%s', async (_slug, cassette) => {
    // repair stays enabled: a cassette that recorded a repair round-trip must
    // still be able to take it, and one that did not must still not need it
    // (an extra call raises CassetteExhaustedError, which is the point).
    const result = await generateAnswer(replayClient(cassette), cassette.question);

    expect(result.program != null, 'gated').toBe(cassette.outcome.gated);
    expect(result.attempts, 'model calls for the program pass').toBe(cassette.outcome.attempts);

    if (cassette.outcome.gated) {
      const warnings = (result.program?.findings ?? [])
        .filter((f) => f.severity === 'warning')
        .map((f) => f.rule)
        .sort();
      expect(warnings, 'lint warnings').toEqual([...cassette.outcome.warnings].sort());
    } else {
      expect(result.failure?.stage, 'rejecting stage').toBe(cassette.outcome.failedStage);
    }
  });
});
