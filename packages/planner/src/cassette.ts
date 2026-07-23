/**
 * cassette.ts — recorded model output, replayed for free.
 *
 * The pipeline this package implements (plan → program → gate → repair) is
 * deterministic given a `ModelClient`. Everything interesting about it that we
 * change day to day — the extractor, the shape rules, the lint gate, the repair
 * brief — is POST-processing of text the model produced. Which means it can be
 * tested against real model output without calling the model, as long as the
 * output is on disk.
 *
 * That is a cassette: one question, and the raw responses a real billed run
 * produced for it, in order.
 *
 *   ./run.sh record "<question>"     BILLED — capture a new cassette
 *   ./run.sh test                    FREE — replay every cassette through the
 *                                    current gate (see replay.test.ts)
 *
 * WHY REPLAY IS KEYED ON CALL ORDER, NOT ON THE PROMPT
 *
 * The obvious design hashes the request (system + messages) and looks the hash
 * up. It is also useless here: the system prompt embeds the whole API reference,
 * so editing `api-reference.ts` — the single most common change in this repo —
 * would invalidate every cassette at once, and the free loop would be free only
 * until the moment you used it.
 *
 * So a cassette is a SCRIPT: the Nth call gets the Nth recorded response,
 * whatever the prompt now says. This is a deliberate trade. It means a replay
 * does NOT tell you what the model would say today given a changed prompt —
 * only a billed run tells you that. What it does tell you, exactly and for
 * free, is whether the code AROUND the model still handles real model output
 * correctly. Those are the regressions that otherwise cost a generation to find.
 *
 * The recorded system prompt's digest is kept per turn so drift is visible
 * (`staleness()`), not so it can gate anything.
 */

import { createHash } from 'node:crypto';
import type { ModelClient, ModelRequest } from './model.js';

/** Which pipeline call a turn corresponds to — provenance only, never matched on. */
export type CassettePass = 'plan' | 'program' | 'repair';

export interface CassetteTurn {
  readonly pass: CassettePass;
  /** sha256/12 of the system prompt as recorded — drift signal, not a key */
  readonly systemDigest: string;
  /** the model's raw text response, byte-for-byte */
  readonly response: string;
}

export interface Cassette {
  readonly slug: string;
  readonly question: string;
  readonly model: string;
  readonly recordedAt: string;
  /**
   * What the pipeline made of these responses AT RECORDING TIME. Replay asserts
   * against this, so a cassette is a regression test rather than a fixture: if
   * the gate now rejects what it accepted, or needs a repair where it did not,
   * the difference shows up as a failure with a real program behind it.
   */
  readonly outcome: {
    readonly gated: boolean;
    readonly attempts: number;
    /** lint rules that fired as warnings on the accepted program */
    readonly warnings: readonly string[];
    /** gate stage that rejected it, when it was never accepted */
    readonly failedStage?: string;
  };
  readonly turns: readonly CassetteTurn[];
}

export function digest(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 12);
}

/** Guess which pass a request is, from its shape. Provenance only. */
function passOf(req: ModelRequest, index: number): CassettePass {
  if (index === 0) return 'plan';
  const last = req.messages[req.messages.length - 1];
  return last?.content.includes('did not pass the static gate') ||
    last?.content.includes('failed while executing')
    ? 'repair'
    : 'program';
}

/**
 * Wrap a real client so every call is captured. Billed — this is the client the
 * record script uses.
 */
export function recordingClient(inner: ModelClient): ModelClient & {
  turns: () => readonly CassetteTurn[];
} {
  const turns: CassetteTurn[] = [];
  return {
    async complete(req: ModelRequest): Promise<string> {
      const response = await inner.complete(req);
      turns.push({
        pass: passOf(req, turns.length),
        systemDigest: digest(req.system),
        response,
      });
      return response;
    },
    turns: () => turns,
  };
}

/** Thrown when a replay asks for more calls than were recorded. */
export class CassetteExhaustedError extends Error {
  constructor(slug: string, wanted: number, have: number) {
    super(
      `cassette "${slug}" has ${have} recorded turn(s) but the pipeline asked for ${wanted}. ` +
        `The pipeline now makes MORE model calls for this input than it did when the ` +
        `cassette was recorded — almost always because the gate started rejecting a ` +
        `program it used to accept, triggering a repair round-trip. That is a real ` +
        `finding, not a broken fixture: look at what the gate now says about ` +
        `turn ${have} before re-recording.`,
    );
    this.name = 'CassetteExhaustedError';
  }
}

/**
 * A client that replays a cassette's responses in order. No API key, no
 * network, no cost.
 */
export function replayClient(cassette: Cassette): ModelClient {
  let i = 0;
  return {
    async complete(): Promise<string> {
      const turn = cassette.turns[i];
      if (!turn) throw new CassetteExhaustedError(cassette.slug, i + 1, cassette.turns.length);
      i++;
      return turn.response;
    },
  };
}

/**
 * How far the live prompts have drifted from what was recorded, per turn. Not
 * enforced anywhere — surfaced so a puzzling replay result can be read as "this
 * cassette predates the current prompt" rather than debugged as a code bug.
 */
export function staleness(cassette: Cassette, currentSystems: readonly string[]): string[] {
  const out: string[] = [];
  cassette.turns.forEach((turn, i) => {
    const now = currentSystems[i];
    if (now != null && digest(now) !== turn.systemDigest) {
      out.push(`turn ${i} (${turn.pass}): system prompt changed since recording`);
    }
  });
  return out;
}
