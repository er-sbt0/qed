/**
 * loop.sandbox.test.ts — the whole agentic turn against real guest code.
 *
 * loop.test.ts proves the driver with everything thunked; this proves the
 * assembly: a scripted model drives runToolLoop through an executor that is
 * the ONLY legal kind — host's runTool over `sceneIndex(stage)`, with every
 * experiment folding the conversation log through a fresh QuickJS VM and
 * appendFragment gated by the real planner pipeline (esbuild + lint). It is
 * 4c's exit criterion minus the billed half: the turn "why did that turn
 * red?" → whyChanged → bisectFlip → prose naming the actual threshold runs
 * end to end, and records/replays as a cassette with zero drift. Whether a
 * MODEL chooses that sequence is what the recording will buy.
 */

import { describe, expect, it } from 'vitest';
import { sceneIndex, sceneManifest } from '@math-ai/render';
import type { ConversationLog } from '@math-ai/host';
import { runToolLoop } from './loop.js';
import { recordToolLoop, replayToolLoop } from './loop-cassette.js';
import { SPIN_PROGRAM as PROGRAM, executorFor, fold, freshScene, idByLabel } from './loop-scene.js';
import type { ModelClient } from './model.js';

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

const call = (json: string, extra = ''): string => `\`\`\`json\n${json}\n\`\`\`\n${extra}`;

describe('the agentic turn against a QuickJS-folded scene', () => {
  it('probes (whyChanged → bisectFlip), narrates the real threshold, and replays with zero drift', async () => {
    const live = await freshScene();
    const log: ConversationLog = [{ kind: 'program', source: PROGRAM, js: PROGRAM }];
    live.execute(log[0] as { js: string });

    const scene = sceneIndex(live.stage);
    const spin = idByLabel(scene, 'spin', 'parameter');
    const under = idByLabel(scene, 'under three', 'claim');

    const script = [
      call(`{"tool": "whyChanged", "id": "${under}"}`),
      call(
        `{"tool": "bisectFlip", "param": "${spin}", "claim": "${under}", "lo": -2, "hi": 2, "maxProbes": 12}`,
      ),
      'The verdict hangs on spin: the chain runs claim → doubled → spin, and the engine bisected the flip to spin ≈ 1.5.',
    ];

    const { outcome, cassette } = await recordToolLoop(
      scripted(...script),
      executorFor(live.stage),
      { question: 'why did that turn red?', manifest: sceneManifest(live.stage), conversation: { log } },
      { slug: 'why-red-quickjs', model: 'scripted' },
    );

    expect(outcome.kind).toBe('answered');
    if (outcome.kind !== 'answered') return;
    expect(outcome.prose).toContain('1.5');
    expect(outcome.acts.map((a) => a.call.tool)).toEqual(['whyChanged', 'bisectFlip']);

    // whyChanged walked the real reactive graph, across the bridge
    const why = outcome.acts[0]!.result;
    expect(why.ok).toBe(true);
    if (why.ok) {
      const chain = (why.value as { chain: Array<{ kind: string }> }).chain;
      expect(chain[0]!.kind).toBe('claim');
      expect(chain[chain.length - 1]!.kind).toBe('parameter');
    }

    // bisectFlip named the actual threshold of 2·spin ≤ 3, one VM per probe
    const flip = outcome.acts[1]!.result;
    expect(flip.ok).toBe(true);
    if (flip.ok) {
      const v = flip.value as { flipped: boolean; lo: number; hi: number };
      expect(v.flipped).toBe(true);
      expect((v.lo + v.hi) / 2).toBeCloseTo(1.5, 2);
    }

    // every probe was a throwaway fold: the LIVE scene never moved
    expect(sceneManifest(live.stage).objects.find((o) => o.id === spin)!.value).toBe(1);

    // the cassette replays against a FRESHLY folded scene: model half off the
    // tape, tools re-executed — determinism makes the recomputed results match
    const replayed = await freshScene();
    replayed.execute(log[0] as { js: string });
    const replay = await replayToolLoop(cassette, executorFor(replayed.stage), {
      question: 'why did that turn red?',
      manifest: sceneManifest(replayed.stage),
      conversation: { log },
    });
    expect(replay.drift).toEqual([]);
    expect(replay.outcome.kind).toBe('answered');
  }, 120_000);

  it('a gate-rejected fragment comes back verbatim, the scripted retry lands, the log advances', async () => {
    const live = await freshScene();
    const log: ConversationLog = [{ kind: 'program', source: PROGRAM, js: PROGRAM }];
    live.execute(log[0] as { js: string });

    const scene = sceneIndex(live.stage);
    const spin = idByLabel(scene, 'spin', 'parameter');

    // eval is a banned-global ERROR; Math.random would only warn
    const BAD = 'lesson.beat("push");\nconst r = eval("2");\nlesson.say`push to ${r}`;';
    const GOOD = [
      `const spin = M.byId("${spin}");`,
      'lesson.beat("Push it further");',
      'lesson.show(View.readout(M.derived(() => 3 * spin.value, "tripled"), { label: "tripled" }));',
    ].join('\n');

    const out = await runToolLoop(
      scripted(
        call('{"tool": "appendFragment"}', `\`\`\`ts\n${BAD}\n\`\`\``),
        call('{"tool": "appendFragment"}', `\`\`\`ts\n${GOOD}\n\`\`\``),
        'Added a tripled readout to push on.',
      ),
      executorFor(live.stage),
      { question: 'can you push the idea further?', manifest: sceneManifest(live.stage), conversation: { log } },
    );

    expect(out.kind).toBe('answered');
    if (out.kind !== 'answered') return;
    // the first act failed with the REAL gate's complaint, verbatim
    const rejected = out.acts[0]!.result;
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.error.code).toBe('rejected');
      expect(rejected.error.message).toContain('eval');
    }
    // the retry committed: the log advanced and still folds from scratch
    expect(out.acts[1]!.result.ok).toBe(true);
    expect(out.log).toHaveLength(2);
    const check = await fold(out.log);
    expect(check.ok).toBe(true);
  }, 120_000);
});
