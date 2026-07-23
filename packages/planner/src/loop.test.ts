/**
 * loop.test.ts — the loop driver, with the judgement thunked out.
 *
 * The model is a script and the executor is a stub, which is exactly the
 * driver's contract: everything it owns — dispatch order, result feedback,
 * the classifier fast path, the caps, the typed endings — is provable with no
 * scene at all. The sibling loop.sandbox.test.ts runs the same driver against
 * a real QuickJS-folded scene.
 */

import { describe, expect, it } from 'vitest';
import type { ConversationLog, ToolCall, ToolOutcome } from '@math-ai/host';
import { runToolLoop, manipulableTargets, type ToolExecutor } from './loop.js';
import type { ModelClient, ModelRequest } from './model.js';

const MANIFEST = {
  objects: [
    { id: 'parameter#1', kind: 'parameter', label: 'spin', value: 1, range: [-2, 2], draggable: true },
    { id: 'scalar#2', kind: 'scalar', label: 'doubled', value: 2 },
  ],
  claims: [{ id: 'claim#3', label: 'under three', holds: false, evidence: 'exact-comparison' }],
};

const LOG: ConversationLog = [{ kind: 'program', source: 'p', js: 'p' }];

const call = (json: string, extra = ''): string => `\`\`\`json\n${json}\n\`\`\`\n${extra}`;

/** A model that plays its lines in order and records what it was asked. */
function scripted(...replies: string[]): { client: ModelClient; seen: ModelRequest[] } {
  const seen: ModelRequest[] = [];
  let i = 0;
  return {
    seen,
    client: {
      async complete(req) {
        seen.push(req);
        const r = replies[i++];
        if (r === undefined) throw new Error(`the script has no reply ${i}`);
        return r;
      },
    },
  };
}

/** An executor stub that logs dispatches and answers from a small table. */
function stubExecutor(
  impl: (call: ToolCall, log: ConversationLog) => ToolOutcome,
): { dispatched: { call: ToolCall; log: ConversationLog }[]; execute: ToolExecutor } {
  const dispatched: { call: ToolCall; log: ConversationLog }[] = [];
  return {
    dispatched,
    execute: (c, l) => {
      dispatched.push({ call: c, log: l });
      return impl(c, l);
    },
  };
}

const okResult = (value: unknown): ToolOutcome => ({
  result: { ok: true, value: value as never },
});

describe('the probe path', () => {
  it('dispatches each call, feeds the result back, and ends on prose', async () => {
    const { client, seen } = scripted(
      call('{"tool": "whyChanged", "id": "claim#3"}'),
      call('{"tool": "counterfactual", "set": [{"id": "parameter#1", "value": 1.4}], "read": ["claim#3"]}'),
      'It flips because doubled crosses 3: the chain runs claim → doubled → spin.',
    );
    const { execute, dispatched } = stubExecutor((c) =>
      c.tool === 'whyChanged'
        ? okResult({ chain: [{ id: 'claim#3' }, { id: 'scalar#2' }, { id: 'parameter#1' }] })
        : okResult({ reads: [{ id: 'claim#3', holds: true }] }),
    );

    const out = await runToolLoop(client, execute, { question: 'why did that turn red?', manifest: MANIFEST, conversation: { log: LOG } });

    expect(out.kind).toBe('answered');
    if (out.kind === 'answered') {
      expect(out.prose).toContain('claim → doubled → spin');
      expect(out.modelCalls).toBe(3);
      expect(out.acts.map((a) => a.call.tool)).toEqual(['whyChanged', 'counterfactual']);
      expect(out.log).toBe(LOG); // read probes never advance the log
    }
    // each dispatch saw the CURRENT log
    expect(dispatched.every((d) => d.log === LOG)).toBe(true);
    // the second model call saw the first tool's result, as data
    const fedBack = seen[1]!.messages.at(-1)!.content;
    expect(fedBack).toContain('TOOL RESULT (whyChanged)');
    expect(fedBack).toContain('"chain"');
    // and the transcript alternates user/assistant from the brief onward
    expect(seen[2]!.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user']);
  });

  it('sends the brief with the manifest, the feed, and the question', async () => {
    const { client, seen } = scripted('Just prose.');
    const { execute } = stubExecutor(() => okResult(null));
    await runToolLoop(client, execute, {
      question: 'why?',
      manifest: MANIFEST,
      conversation: { log: LOG },
      feed: { moved: [{ target: 'parameter#1', value: 1 }], flipped: [] },
    });
    const brief = seen[0]!.messages[0]!.content;
    expect(brief).toContain('SCENE MANIFEST');
    expect(brief).toContain('SINCE THE LAST QUESTION');
    expect(brief).toContain('The student asks: why?');
  });

  it('the artifact carries the plan and the original question into the brief', async () => {
    const { client, seen } = scripted('Prose.');
    const { execute } = stubExecutor(() => okResult(null));
    await runToolLoop(client, execute, {
      question: 'which beat proves it?',
      manifest: MANIFEST,
      conversation: {
        log: LOG,
        originalQuestion: 'Why does doubling stay bounded?',
        plan: {
          topic: 'Bounded doubling',
          summary: 'Doubling stays under 3 while spin stays under 1.5.',
          visualize: true,
          disciplines: [],
          beats: [
            { title: 'Watch it double', claim: 'doubled tracks 2·spin' },
            { title: 'Find the ceiling', claim: 'the claim flips at spin = 1.5' },
          ],
        },
      },
    });
    const brief = seen[0]!.messages[0]!.content;
    expect(brief).toContain('The lesson answers: Why does doubling stay bounded?');
    expect(brief).toContain("THE LESSON'S ARGUMENT");
    // the per-beat CLAIMS — the argument structure 4a/4b discarded
    expect(brief).toContain('the claim flips at spin = 1.5');
    expect(brief.indexOf("THE LESSON'S ARGUMENT")).toBeLessThan(brief.indexOf('SCENE MANIFEST'));
  });
});

describe('the classifier fast path', () => {
  it('a "set spin to 0" never reaches the model', async () => {
    const client: ModelClient = {
      complete: () => {
        throw new Error('the model must not be consulted for a classified manipulate');
      },
    };
    const advanced: ConversationLog = [...LOG, { kind: 'event', event: { type: 'set-input', target: 'parameter#1', value: 0 } }];
    const { execute, dispatched } = stubExecutor(() => ({ result: { ok: true, value: null }, log: advanced }));

    const out = await runToolLoop(client, execute, { question: 'set spin to 0', manifest: MANIFEST, conversation: { log: LOG } });

    expect(out.kind).toBe('manipulated');
    expect(out.modelCalls).toBe(0);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]!.call).toEqual({ tool: 'setInput', id: 'parameter#1', value: 0 });
    expect(out.log).toBe(advanced);
  });

  it('clamps into the target range, as a drag would', async () => {
    const { execute, dispatched } = stubExecutor(() => okResult(null));
    const client: ModelClient = { complete: () => Promise.reject(new Error('no')) };
    await runToolLoop(client, execute, { question: 'set spin to 99', manifest: MANIFEST, conversation: { log: LOG } });
    expect(dispatched[0]!.call).toEqual({ tool: 'setInput', id: 'parameter#1', value: 2 });
  });

  it('manipulableTargets reads only what the manifest marks draggable', () => {
    expect(manipulableTargets(MANIFEST)).toEqual([
      { id: 'parameter#1', label: 'spin', range: [-2, 2] },
    ]);
    expect(manipulableTargets(null)).toEqual([]);
    expect(manipulableTargets({ objects: 'nope' })).toEqual([]);
  });
});

describe('errors as data', () => {
  it('a malformed reply is fed back as bad-args and is not an act', async () => {
    const { client, seen } = scripted(
      call('{"tool": "interrogate", "id": "claim#3"}'),
      'Fine, prose then.',
    );
    const { execute, dispatched } = stubExecutor(() => okResult(null));
    const out = await runToolLoop(client, execute, { question: 'q', manifest: MANIFEST, conversation: { log: LOG } });

    expect(out.kind).toBe('answered');
    expect(dispatched).toHaveLength(0);
    if (out.kind === 'answered') expect(out.acts).toHaveLength(0);
    const fedBack = seen[1]!.messages.at(-1)!.content;
    expect(fedBack).toContain('TOOL RESULT (unparseable call)');
    expect(fedBack).toContain('bad-args');
  });

  it('a rejected fragment goes back verbatim and the retry can land', async () => {
    const { client } = scripted(
      call('{"tool": "appendFragment"}', '```ts\nconst x = eval("1");\n```'),
      call('{"tool": "appendFragment"}', '```ts\nlesson.beat("fixed");\n```'),
      'Added it.',
    );
    const advanced: ConversationLog = [...LOG, { kind: 'fragment', source: 'lesson.beat("fixed");', js: 'x' }];
    const { execute } = stubExecutor((c) => {
      if (c.tool !== 'appendFragment') throw new Error('unexpected');
      return c.source.includes('eval')
        ? { result: { ok: false, error: { code: 'rejected', message: 'banned-global: eval()' } }, log: LOG }
        : { result: { ok: true, value: { appended: true } }, log: advanced };
    });

    const out = await runToolLoop(client, execute, { question: 'q', manifest: MANIFEST, conversation: { log: LOG } });
    expect(out.kind).toBe('answered');
    if (out.kind === 'answered') {
      expect(out.acts.map((a) => a.result.ok)).toEqual([false, true]);
      expect(out.log).toBe(advanced);
    }
  });

  it('a model seam failure returns the acts taken, typed', async () => {
    const { client } = scripted(call('{"tool": "inspect", "id": "parameter#1"}'));
    const { execute } = stubExecutor(() => okResult({ value: 1 }));
    const out = await runToolLoop(client, execute, { question: 'q', manifest: MANIFEST, conversation: { log: LOG } });
    expect(out.kind).toBe('failed');
    if (out.kind === 'failed') {
      expect(out.detail).toContain('no reply');
      expect(out.acts).toHaveLength(1);
    }
  });
});

describe('the caps', () => {
  it('a model that never stops probing gets the typed give-up', async () => {
    const forever: ModelClient = {
      complete: async () => call('{"tool": "inspect", "id": "parameter#1"}'),
    };
    const { execute } = stubExecutor(() => okResult({ value: 1 }));
    const out = await runToolLoop(forever, execute, {
      question: 'q',
      manifest: MANIFEST,
      conversation: { log: LOG },
      maxToolCalls: 5,
    });
    expect(out.kind).toBe('gave-up');
    if (out.kind === 'gave-up') {
      expect(out.reason).toBe('tool-cap');
      expect(out.acts).toHaveLength(5);
      expect(out.modelCalls).toBe(5);
    }
  });

  it('a model that re-submits rejected fragments gets the typed give-up', async () => {
    const stubborn: ModelClient = {
      complete: async () => call('{"tool": "appendFragment"}', '```ts\nconst x = eval("1");\n```'),
    };
    const { execute } = stubExecutor(() => ({
      result: { ok: false, error: { code: 'rejected', message: 'banned-global: eval()' } },
      conversation: { log: LOG },
    }));
    const out = await runToolLoop(stubborn, execute, { question: 'q', manifest: MANIFEST, conversation: { log: LOG } });
    expect(out.kind).toBe('gave-up');
    if (out.kind === 'gave-up') {
      expect(out.reason).toBe('fragment-retries');
      expect(out.detail).toContain('banned-global');
      expect(out.acts).toHaveLength(3); // the default cap
      expect(out.log).toBe(LOG); // nothing committed
    }
  });
});
