/**
 * record-loop.test.ts — NOT A TEST. This is the BILLED agentic-turn recorder.
 *
 * Same shape as record-cassette.test.ts, same reason for the `.test.ts` name:
 * vitest is the only runtime here that resolves the workspace's TypeScript
 * graph. It is INERT unless RECORD_LOOP is set, so `./run.sh test` never bills
 * anything. The armed invocation is:
 *
 *   ANTHROPIC_API_KEY=... RECORD_LOOP=1 ./run.sh test packages/planner/src/record-loop.test.ts
 *
 * What one invocation buys — the 4c exit criterion, measured:
 *
 *   1. The spin scene (2·spin ≤ 3, flips at spin = 1.5) is folded headlessly.
 *   2. A student drag lands as a set-input event that pushes spin PAST the
 *      flip; the transition feed shows the verdict going true → false.
 *   3. A REAL model is asked "why did that turn red?" through runToolLoop over
 *      the legal executor (host runTool over sceneIndex).
 *
 * The criterion: the model PROBES BEFORE NARRATING — whyChanged and/or
 * bisectFlip/counterfactual, then prose naming the ACTUAL threshold rather
 * than a guessed one, without overstating the verdict. Whatever happens, the
 * whole turn lands in src/loop-cassettes/ as a StoredLoopCassette, and
 * loop-replay.test.ts re-runs its tools for free from then on. A turn that
 * never probed, or gave up, is the finding — commit it anyway; the cassette is
 * the valuable half either way.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { sceneIndex, sceneManifest, transitionFeed } from '@math-ai/render';
import { coalesce, studentEvents } from '@math-ai/host';
import type { ConversationLog, EventEntry, Settable } from '@math-ai/host';
import { recordToolLoop, replayToolLoop, type StoredLoopCassette } from './loop-cassette.js';
import { SPIN_PROGRAM, executorFor, idByLabel, sceneFromLog } from './loop-scene.js';
import { anthropicClient, MODEL } from './model.js';

const armed = process.env.RECORD_LOOP;
const here = dirname(fileURLToPath(import.meta.url));

const QUESTION = 'why did that turn red?';
/** Past the flip at 1.5, inside the parameter's [-2, 2] range. */
const DRAG_TO = 1.8;

describe.skipIf(!armed)('RECORDING an agentic turn (billed)', () => {
  it(
    'one real model drives the loop over the spin scene; the whole turn lands as a cassette',
    async () => {
      if (!process.env.ANTHROPIC_API_KEY) {
        throw new Error('RECORD_LOOP is set but ANTHROPIC_API_KEY is not — nothing was billed.');
      }

      // ── the scene, and the student's drag past the flip (free, preflight) ──
      const programLog: ConversationLog = [
        { kind: 'program', source: SPIN_PROGRAM, js: SPIN_PROGRAM },
      ];
      const live = await sceneFromLog(programLog);
      const before = sceneManifest(live.stage);
      const scene = sceneIndex(live.stage);
      const spin = idByLabel(scene, 'spin', 'parameter');
      const under = idByLabel(scene, 'under three', 'claim');

      const drag: EventEntry = {
        kind: 'event',
        event: { type: 'set-input', target: spin, value: DRAG_TO },
      };
      const handle = scene.get(spin) as Settable | undefined;
      const apply = handle && (handle.setValueLive ?? handle.setValue);
      if (!apply) throw new Error(`"${spin}" is not settable — nothing was billed.`);
      apply.call(handle, DRAG_TO);

      const log: ConversationLog = [...programLog, drag];
      const after = sceneManifest(live.stage);
      const feed = transitionFeed(before, after, studentEvents(coalesce([drag])));

      // The premise must hold BEFORE any money moves: the feed shows the flip.
      const flip = feed.flipped.find((f) => f.id === under);
      if (!flip || flip.from !== true || flip.to !== false) {
        throw new Error(
          `preflight: dragging spin to ${DRAG_TO} did not flip "${under}" true → false ` +
            `(feed: ${JSON.stringify(feed)}) — nothing was billed.`,
        );
      }

      const slug = process.env.RECORD_LOOP_SLUG || 'why-red-spin';
      console.log(`\n• recording one agentic turn: "${QUESTION}" → loop-cassettes/${slug}.json`);
      console.log(
        `• the scene: spin dragged 1 → ${DRAG_TO}; "${flip.label ?? under}" flipped true → false (flip is at 1.5)`,
      );

      // ── the billed half: a REAL model, the legal executor ──
      const t0 = Date.now();
      const { outcome, cassette } = await recordToolLoop(
        anthropicClient(),
        executorFor(live.stage),
        { question: QUESTION, manifest: after, conversation: { log }, feed },
        { slug, model: MODEL },
      );
      const seconds = ((Date.now() - t0) / 1000).toFixed(1);

      // ── the report: the acts in order, then the prose ──
      console.log(
        `\n• outcome: ${outcome.kind} — ${outcome.modelCalls} model call(s), ` +
          `${outcome.acts.length} act(s), ${seconds}s`,
      );
      outcome.acts.forEach((a, i) => {
        const { tool, ...args } = a.call;
        console.log(`  ${i + 1}. ${tool} ${JSON.stringify(args)}`);
        console.log(
          `     → ${
            a.result.ok
              ? JSON.stringify(a.result.value)
              : `ERROR ${a.result.error.code}: ${a.result.error.message}`
          }`,
        );
      });
      if (outcome.kind === 'answered') {
        console.log(`\n• the prose:\n\n${outcome.prose}\n`);
      } else if (outcome.kind === 'gave-up') {
        console.log(`\n• gave up (${outcome.reason}): ${outcome.detail}`);
      } else if (outcome.kind === 'failed') {
        console.log(`\n• the model seam failed: ${outcome.detail}`);
      }

      // ── the cassette, scene included, whatever the outcome ──
      const stored: StoredLoopCassette = { ...cassette, scene: { log, feed } };
      const dir = join(here, 'loop-cassettes');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${slug}.json`), JSON.stringify(stored, null, 2) + '\n');
      console.log(`• wrote src/loop-cassettes/${slug}.json — commit it.`);

      // ── the drift check: refold the scene, re-execute the tools, compare ──
      if (cassette.turns.length > 0) {
        const fresh = await sceneFromLog(log);
        const replay = await replayToolLoop(cassette, executorFor(fresh.stage), {
          question: QUESTION,
          manifest: sceneManifest(fresh.stage),
          conversation: { log },
          feed,
        });
        if (replay.drift.length === 0) {
          console.log('• replayed against a fresh fold: ZERO DRIFT — recomputed tool results match.');
        } else {
          console.log('• DRIFT on immediate replay:');
          for (const d of replay.drift) console.log(`  - ${d}`);
        }
      }

      // A cassette with no turns records a transport failure, not a turn.
      expect(cassette.turns.length).toBeGreaterThan(0);
    },
    { timeout: 300_000 },
  );
});
