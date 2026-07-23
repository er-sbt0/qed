/**
 * loop-cassette.test.ts — the record/replay contract for an agentic turn.
 *
 * Everything here runs against a scripted model and a deterministic stub
 * executor: the format and the drift detection are what is under test, and
 * both must be proven BEFORE a billed recording exists — the eventual 4c exit
 * recording should only have to plug in a real client. The sandbox tier
 * replays a recorded turn against a real QuickJS-folded scene.
 */

import { describe, expect, it } from 'vitest';
import type { ConversationLog, ToolCall, ToolOutcome } from '@math-ai/host';
import { recordToolLoop, replayToolLoop, LoopCassetteExhaustedError } from './loop-cassette.js';
import type { ToolExecutor, ToolLoopOpts } from './loop.js';
import type { ModelClient } from './model.js';

const MANIFEST = {
  objects: [
    { id: 'parameter#1', kind: 'parameter', label: 'spin', value: 1, range: [-2, 2], draggable: true },
  ],
  claims: [{ id: 'claim#3', label: 'under three', holds: false, evidence: 'exact-comparison' }],
};
const LOG: ConversationLog = [{ kind: 'program', source: 'p', js: 'p' }];
const OPTS: ToolLoopOpts = { question: 'why did that turn red?', manifest: MANIFEST, conversation: { log: LOG } };

const call = (json: string): string => `\`\`\`json\n${json}\n\`\`\``;

function scripted(...replies: string[]): ModelClient {
  let i = 0;
  return {
    async complete() {
      const r = replies[i++];
      if (r === undefined) throw new Error(`the script has no reply ${i}`);
      return r;
    },
  };
}

/** Deterministic, like the engine: same call + same log → same result. */
const engine: ToolExecutor = (c: ToolCall): ToolOutcome => {
  if (c.tool === 'whyChanged') {
    return { result: { ok: true, value: { chain: [{ id: c.id }, { id: 'parameter#1', value: 1 }] } } };
  }
  if (c.tool === 'bisectFlip') {
    return { result: { ok: true, value: { flipped: true, lo: 1.499, hi: 1.501, probes: 12 } } };
  }
  return { result: { ok: false, error: { code: 'bad-args', message: 'unexpected in this test' } } };
};

const SCRIPT = [
  call('{"tool": "whyChanged", "id": "claim#3"}'),
  call('{"tool": "bisectFlip", "param": "parameter#1", "claim": "claim#3", "lo": -2, "hi": 2}'),
  'It flips at spin = 1.5 — the engine bisected the threshold.',
];

describe('record → replay', () => {
  it('records both halves and replays with zero drift', async () => {
    const { outcome, cassette } = await recordToolLoop(scripted(...SCRIPT), engine, OPTS, {
      slug: 'why-red',
      model: 'scripted',
    });
    expect(outcome.kind).toBe('answered');
    expect(cassette.turns).toHaveLength(3);
    expect(cassette.acts.map((a) => a.call.tool)).toEqual(['whyChanged', 'bisectFlip']);
    expect(cassette.outcome).toMatchObject({ kind: 'answered', modelCalls: 3, toolCalls: 2 });

    const replay = await replayToolLoop(cassette, engine, OPTS);
    expect(replay.drift).toEqual([]);
    expect(replay.outcome.kind).toBe('answered');
    if (replay.outcome.kind === 'answered') {
      expect(replay.outcome.prose).toBe(cassette.outcome.prose);
    }
  });

  it('a manipulate turn records one act and zero model turns, and replays', async () => {
    const never: ModelClient = { complete: () => Promise.reject(new Error('not consulted')) };
    const set: ToolExecutor = () => ({ result: { ok: true, value: { set: 'parameter#1', to: 0 } } });
    const { cassette } = await recordToolLoop(never, set, { ...OPTS, question: 'set spin to 0' }, {
      slug: 'set-spin',
      model: 'scripted',
    });
    expect(cassette.turns).toHaveLength(0);
    expect(cassette.outcome).toMatchObject({ kind: 'manipulated', modelCalls: 0, toolCalls: 1 });

    const replay = await replayToolLoop(cassette, set, { ...OPTS, question: 'set spin to 0' });
    expect(replay.drift).toEqual([]);
  });
});

describe('drift is the point', () => {
  it('an engine that answers differently is named, act by act', async () => {
    const { cassette } = await recordToolLoop(scripted(...SCRIPT), engine, OPTS, {
      slug: 'why-red',
      model: 'scripted',
    });
    // the "engine" drifts: bisect now brackets a different threshold
    const drifted: ToolExecutor = (c) =>
      c.tool === 'bisectFlip'
        ? { result: { ok: true, value: { flipped: true, lo: 0.999, hi: 1.001, probes: 12 } } }
        : engine(c, LOG) as ToolOutcome;
    const replay = await replayToolLoop(cassette, drifted, OPTS);
    expect(replay.drift).toHaveLength(1);
    expect(replay.drift[0]).toContain('act 1 (bisectFlip): the engine drifted');
    expect(replay.drift[0]).toContain('1.499');
    expect(replay.drift[0]).toContain('0.999');
  });

  it('a truncated cassette raises the exhaustion error, which explains itself', async () => {
    const { cassette } = await recordToolLoop(scripted(...SCRIPT), engine, OPTS, {
      slug: 'why-red',
      model: 'scripted',
    });
    const truncated = { ...cassette, turns: cassette.turns.slice(0, 1) };
    await expect(replayToolLoop(truncated, engine, OPTS)).rejects.toThrow(
      LoopCassetteExhaustedError,
    );
    await expect(replayToolLoop(truncated, engine, OPTS)).rejects.toThrow(/parser or the classifier/);
  });
});
