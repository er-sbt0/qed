/**
 * record-cassette.test.ts — NOT A TEST. This is the BILLED recorder.
 *
 * It lives under a `.test.ts` name for one reason: vitest is already the only
 * thing in this repo that can resolve the workspace's TypeScript graph (the
 * sources import each other with `.js` specifiers, which node's native type
 * stripping cannot follow, and there is no build step). So the recorder borrows
 * vitest as a TypeScript runtime.
 *
 * It is INERT unless RECORD_QUESTION is set, so `./run.sh test` never bills
 * anything. The only way to trigger it is the named, billed path:
 *
 *   ./run.sh record "Explain the pigeonhole principle"
 *   ./run.sh record "..." --slug=pigeonhole
 *
 * One invocation makes one real generation (plan + program, plus a repair
 * round-trip if the gate rejects the first program) and writes TWO things:
 *
 *   1. the raw responses    → src/cassettes/<slug>.json   (always)
 *   2. the program itself   → examples/<slug>/            (only if it gated)
 *
 * (2) is the point of recording at all now. The few-shot examples are the
 * strongest lever on generation quality and the fastest thing to rot, so a
 * billed run refreshes them instead of leaving a hand-written program from
 * whenever someone last cared. See promote.ts for the three rules that govern
 * it, and that directory's README for what a cassette is for.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { recordingClient, type Cassette } from './cassette.js';
import { generateAnswer } from './generate.js';
import { anthropicClient, MODEL } from './model.js';
import { promoteToExample } from './promote.js';

const question = process.env.RECORD_QUESTION;
const here = dirname(fileURLToPath(import.meta.url));

/** "Explain the pigeonhole principle" -> "explain-the-pigeonhole-principle" */
function slugify(q: string): string {
  return (
    q
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .split('-')
      .slice(0, 6)
      .join('-') || 'cassette'
  );
}

describe.skipIf(!question)('RECORDING a cassette (billed)', () => {
  it(
    'generates once against the real model and writes the cassette',
    async () => {
      const q = question!;
      const slug = process.env.RECORD_SLUG || slugify(q);
      const client = recordingClient(anthropicClient());

      console.log(`\n• recording "${q}" → ${slug}.json`);
      const result = await generateAnswer(client, q);

      const warnings = (result.program?.findings ?? [])
        .filter((f) => f.severity === 'warning')
        .map((f) => f.rule);
      const recordedAt = new Date().toISOString();

      const cassette: Cassette = {
        slug,
        question: q,
        model: MODEL,
        recordedAt,
        outcome: {
          gated: result.program != null,
          attempts: result.attempts,
          warnings,
          ...(result.failure ? { failedStage: result.failure.stage } : {}),
        },
        turns: client.turns(),
      };

      const dir = join(here, 'cassettes');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${slug}.json`), JSON.stringify(cassette, null, 2) + '\n');

      console.log(
        `• ${cassette.turns.length} turn(s), ` +
          `${cassette.outcome.gated ? 'GATED' : `REJECTED at ${cassette.outcome.failedStage}`}, ` +
          `${cassette.outcome.attempts} attempt(s)` +
          (warnings.length ? `, warnings: ${warnings.join(', ')}` : ''),
      );
      console.log(`• wrote src/cassettes/${slug}.json — commit it.`);

      // ── promote, or say plainly why not ──
      //
      // A rejected generation is the cassette worth having and the example
      // worth refusing: it is precisely the failure we want re-checked for
      // free, and precisely the program we must not teach the model to copy.
      // So the reason is printed at full volume rather than swallowed — the
      // caller just paid for this run and the gate's complaint IS the finding.
      if (!result.program) {
        console.log(
          `\n• NOT promoted to an example: the gate rejected it` +
            (result.failure ? ` at ${result.failure.stage}` : '') +
            `.\n` +
            (result.failure?.errors ?? []).map((e) => `    ${e}`).join('\n') +
            `\n  That is a defect in the engine or the vocabulary, not in the ` +
            `recording. examples/ is untouched; fix it and re-record.\n`,
        );
      } else {
        const repo = join(here, '..', '..', '..');
        const promotion = promoteToExample(repo, {
          slug,
          question: q,
          discipline: result.plan.disciplines[0],
          title: result.plan.topic,
          source: result.program.source,
          model: MODEL,
          recordedAt,
          warnings,
        });
        if (promotion.promoted) {
          console.log(
            `• promoted → examples/${promotion.dir}/ ` +
              `(discipline "${result.plan.disciplines[0]}")` +
              (promotion.replaced ? `, replacing examples/${promotion.replaced}/` : ''),
          );
          console.log('• run `./run.sh examples` to re-inline, then commit.\n');
        } else {
          console.log(`\n• NOT promoted to an example: ${promotion.reason}\n`);
        }
      }

      // A cassette with no turns would replay as nothing at all.
      expect(cassette.turns.length).toBeGreaterThan(0);
    },
    { timeout: 300_000 },
  );
});
