/**
 * loop-cassette.ts — a recorded agentic turn, replayed for free (roadmap 4c).
 *
 * The generation cassette (cassette.ts) records raw model responses keyed on
 * call order and replays them through the CURRENT pipeline. A tool-loop
 * cassette extends that shape with the other half of the transcript: the tool
 * calls the model made and the results the scene answered with.
 *
 * ## Only the model half replays. The tools re-execute, live.
 *
 * The split is deliberate and asymmetric:
 *
 *  - MODEL RESPONSES are replayed verbatim — they cost money and are not
 *    reproducible, which is the whole cassette argument.
 *  - TOOL RESULTS are RECOMPUTED against a freshly folded scene and then
 *    CHECKED against what was recorded. Determinism (state = fold(log))
 *    guarantees they match — so when one does not, the engine has drifted in a
 *    way a real conversation already exercised, and that is precisely the
 *    regression a cassette exists to catch. Replaying recorded results instead
 *    would test nothing but JSON round-tripping.
 *
 * Drift is returned as data rather than thrown: which act, what was recorded,
 * what the engine now says. A test asserts the list is empty; a human reading
 * a failure sees the actual divergence, not just "deep equality failed".
 */

import type { ConversationLog, ToolCall, ToolResult } from '@math-ai/host';
import { digest } from './cassette.js';
import type { ModelClient } from './model.js';
import { runToolLoop, type LoopAct, type LoopOutcome, type ToolExecutor, type ToolLoopOpts } from './loop.js';

export interface LoopCassetteTurn {
  /** sha256/12 of the system prompt as recorded — drift signal, not a key. */
  readonly systemDigest: string;
  /** the model's raw text response, byte-for-byte */
  readonly response: string;
}

export interface LoopCassette {
  readonly slug: string;
  readonly question: string;
  readonly model: string;
  readonly recordedAt: string;
  /** What the loop made of the turn AT RECORDING TIME. Replay asserts it. */
  readonly outcome: {
    readonly kind: LoopOutcome['kind'];
    readonly modelCalls: number;
    /** acts dispatched — a manipulate records 1 here and 0 turns. */
    readonly toolCalls: number;
    readonly prose?: string;
  };
  readonly turns: readonly LoopCassetteTurn[];
  /** The full act sequence: calls verbatim, results as the scene answered. */
  readonly acts: readonly LoopAct[];
}

/**
 * A loop cassette AS IT SITS ON DISK (src/loop-cassettes/*.json): the recorded
 * turn plus the scene it ran against, carried as the conversation log the turn
 * STARTED from. The log is the whole scene — state = fold(log) — so replay
 * needs nothing else to rebuild the exact world the model probed: refold the
 * log, recompute the manifest there, hand both back to `replayToolLoop`. The
 * feed rides along verbatim; it shaped the recorded brief, and replay passes
 * it through unchanged rather than re-deriving what the model already saw.
 */
export interface StoredLoopCassette extends LoopCassette {
  readonly scene: {
    /** The log AS HANDED IN — a committed write during the turn re-advances it on replay. */
    readonly log: ConversationLog;
    readonly feed?: unknown;
  };
}

// ─────────────────────────────── recording ───────────────────────────────

/**
 * Run one agentic turn with both halves captured. `client` is real on the
 * billed path and scripted in tests — the recorder does not care, which is
 * what lets the cassette format be proven for free before any money is spent.
 */
export async function recordToolLoop(
  client: ModelClient,
  execute: ToolExecutor,
  opts: ToolLoopOpts,
  meta: { readonly slug: string; readonly model: string },
): Promise<{ readonly outcome: LoopOutcome; readonly cassette: LoopCassette }> {
  const turns: LoopCassetteTurn[] = [];
  const taping: ModelClient = {
    async complete(req) {
      const response = await client.complete(req);
      turns.push({ systemDigest: digest(req.system), response });
      return response;
    },
  };
  // the loop's own act list is the record; only replay needs a capture wrapper
  const outcome = await runToolLoop(taping, execute, opts);
  return {
    outcome,
    cassette: {
      slug: meta.slug,
      question: opts.question,
      model: meta.model,
      recordedAt: new Date().toISOString(),
      outcome: {
        kind: outcome.kind,
        modelCalls: outcome.modelCalls,
        toolCalls: outcome.acts.length,
        ...(outcome.kind === 'answered' ? { prose: outcome.prose } : {}),
      },
      turns,
      acts: outcome.acts,
    },
  };
}

// ─────────────────────────────── replay ───────────────────────────────

/** Thrown when a replay asks for more model calls than were recorded. */
export class LoopCassetteExhaustedError extends Error {
  constructor(slug: string, wanted: number, have: number) {
    super(
      `loop cassette "${slug}" has ${have} recorded model turn(s) but the loop asked for ` +
        `${wanted}. The loop now takes MORE rounds for this transcript than it did when ` +
        `the cassette was recorded — usually the reply parser or the classifier changed ` +
        `what counts as a call. That is a real finding, not a broken fixture.`,
    );
    this.name = 'LoopCassetteExhaustedError';
  }
}

function capture(execute: ToolExecutor, into: LoopAct[]): ToolExecutor {
  return async (call, log) => {
    const outcome = await execute(call, log);
    into.push({ call, result: outcome.result });
    return outcome;
  };
}

export interface LoopReplayResult {
  readonly outcome: LoopOutcome;
  /**
   * Every way the replayed turn diverged from the recorded one. Empty is the
   * assertion; a non-empty list names the acts where the ENGINE now answers
   * differently than it did when a real conversation was recorded.
   */
  readonly drift: readonly string[];
}

const show = (x: unknown): string => JSON.stringify(x);

/**
 * Replay a recorded turn: model responses from the cassette, tools live
 * against the caller's executor (which must wrap the real engine over the
 * same folded scene the recording ran against — the log in `opts.conversation`
 * reconstructs it).
 */
export async function replayToolLoop(
  cassette: LoopCassette,
  execute: ToolExecutor,
  opts: ToolLoopOpts,
): Promise<LoopReplayResult> {
  let i = 0;
  // The loop turns a throwing client into a typed `failed` outcome — right for
  // a live seam, wrong here: exhaustion is the replay's own finding and must
  // surface as itself, so it is kept aside and rethrown after the loop ends.
  let exhausted: LoopCassetteExhaustedError | undefined;
  const replaying: ModelClient = {
    async complete() {
      const turn = cassette.turns[i];
      if (!turn) {
        exhausted = new LoopCassetteExhaustedError(cassette.slug, i + 1, cassette.turns.length);
        throw exhausted;
      }
      i += 1;
      return turn.response;
    },
  };

  const recomputed: LoopAct[] = [];
  const outcome = await runToolLoop(replaying, capture(execute, recomputed), opts);
  if (exhausted) throw exhausted;

  const drift: string[] = [];
  if (outcome.kind !== cassette.outcome.kind) {
    drift.push(`outcome: recorded "${cassette.outcome.kind}", replay ended "${outcome.kind}"`);
  }
  if (recomputed.length !== cassette.acts.length) {
    drift.push(`acts: recorded ${cassette.acts.length}, replay took ${recomputed.length}`);
  }
  const n = Math.min(recomputed.length, cassette.acts.length);
  for (let k = 0; k < n; k += 1) {
    const was = cassette.acts[k]!;
    const now = recomputed[k]!;
    if (show(was.call) !== show(now.call)) {
      // same responses, different calls: the PARSER drifted, not the engine
      drift.push(`act ${k}: recorded call ${show(was.call)}, replay dispatched ${show(now.call)}`);
      continue;
    }
    if (show(was.result) !== show(now.result)) {
      drift.push(
        `act ${k} (${was.call.tool}): the engine drifted —\n` +
          `  recorded: ${show(was.result)}\n` +
          `  now:      ${show(now.result)}`,
      );
    }
  }
  return { outcome, drift };
}
