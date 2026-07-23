/**
 * conversation.test.ts — the log logic, with no sandbox in the way.
 *
 * The sibling `.sandbox.test.ts` proves fragments really execute; this proves
 * the rules that decide WHAT executes and in what order, which is where the
 * design decisions live.
 */

import { describe, expect, it, vi } from 'vitest';
import { coalesce, commitEntry, foldSource, isolate, replayLog, studentEvents } from './conversation.js';
import type { ConversationLog, ReplayHooks, Settable } from './conversation.js';

const prog = (source: string) => ({ kind: 'program' as const, source, js: source });
const frag = (source: string) => ({ kind: 'fragment' as const, source, js: source });
const evt = (target: string, value: number) => ({
  kind: 'event' as const,
  event: { type: 'set-input' as const, target, value },
});

function recorder(targets: Record<string, Settable> = {}) {
  const order: string[] = [];
  const hooks: ReplayHooks = {
    execute: (entry) => {
      order.push(`${entry.kind}:${entry.source}`);
    },
    resolve: (id) => {
      order.push(`event:${id}`);
      return targets[id];
    },
  };
  return { order, hooks };
}

const settable = (sink: number[]): Settable => ({
  setValueLive: (n) => {
    sink.push(n);
  },
});

describe('replayLog — order is the design', () => {
  it('walks fragments and events in log order, not fragments-then-events', () => {
    const sink: number[] = [];
    const { order, hooks } = recorder({ 'p#1': settable(sink) });
    const log: ConversationLog = [prog('one'), evt('p#1', 5), frag('two'), evt('p#1', 9)];

    expect(replayLog(log, hooks)).toEqual({ ok: true });
    expect(order).toEqual(['program:one', 'event:p#1', 'fragment:two', 'event:p#1']);
    expect(sink).toEqual([5, 9]);
  });

  it('reports WHICH act broke, by position and kind', () => {
    const hooks: ReplayHooks = {
      execute: (entry) => {
        if (entry.source === 'bad') throw new Error('boom');
      },
      resolve: () => settable([]),
    };
    const result = replayLog([prog('ok'), evt('p#1', 1), frag('bad')], hooks);
    expect(result).toEqual({
      ok: false,
      failure: { index: 2, kind: 'fragment', message: 'boom' },
    });
  });

  /**
   * A missing target is a failure, not a skip. Skipping would let a replayed
   * scene differ from the recorded one, which is the one property a
   * conversation cassette exists to check.
   */
  it('fails on an event whose target is not in the scene', () => {
    const { hooks } = recorder({});
    const result = replayLog([prog('one'), evt('ghost#9', 1)], hooks);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.index).toBe(1);
      expect(result.failure.message).toContain('ghost#9');
    }
  });

  it('fails on an event whose target cannot be set', () => {
    const { hooks } = recorder({ 'view#1': {} });
    const result = replayLog([prog('one'), evt('view#1', 1)], hooks);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.message).toContain('not settable');
  });

  it('prefers setValueLive: a drag checkpoint is not a beat of the explanation', () => {
    const live = vi.fn();
    const authoring = vi.fn();
    const { hooks } = recorder({ 'p#1': { setValueLive: live, setValue: authoring } });
    replayLog([prog('one'), evt('p#1', 3)], hooks);
    expect(live).toHaveBeenCalledWith(3);
    expect(authoring).not.toHaveBeenCalled();
  });
});

describe('commitEntry — the whole transaction story', () => {
  it('accepts an entry whose candidate log folds', async () => {
    const log: ConversationLog = [prog('one')];
    const result = await commitEntry(log, frag('two'), () => ({ ok: true }));
    expect(result.ok).toBe(true);
    expect(result.log).toHaveLength(2);
  });

  it('rejects one that does not, and hands back the PREVIOUS log identically', async () => {
    const log: ConversationLog = [prog('one')];
    const result = await commitEntry(log, frag('bad'), () => ({
      ok: false,
      failure: { index: 1, kind: 'fragment', message: 'no such id' },
    }));
    expect(result.ok).toBe(false);
    // identity, not just equality: nothing was rebuilt, so nothing was
    // half-applied to the scene the student is looking at
    expect(result.log).toBe(log);
    if (!result.ok) expect(result.errors[0]).toContain('no such id');
  });

  it('folds the CANDIDATE, not the accepted log — the check happens before commitment', async () => {
    const seen: ConversationLog[] = [];
    await commitEntry([prog('one')], frag('two'), (candidate) => {
      seen.push(candidate);
      return { ok: false, failure: { index: 1, kind: 'fragment', message: 'x' } };
    });
    expect(seen[0]).toHaveLength(2);
  });
});

describe('coalesce — a sweep is one act, not thousands', () => {
  it('collapses consecutive events on the same target to the last', () => {
    const log: ConversationLog = [prog('one'), evt('p#1', 1), evt('p#1', 2), evt('p#1', 3)];
    expect(studentEvents(coalesce(log))).toEqual([{ type: 'set-input', target: 'p#1', value: 3 }]);
  });

  it('does NOT merge across a fragment — the fragment may have been written against the first value', () => {
    const log: ConversationLog = [prog('one'), evt('p#1', 1), frag('two'), evt('p#1', 3)];
    expect(coalesce(log)).toHaveLength(4);
  });

  it('does not merge different targets', () => {
    const log: ConversationLog = [prog('one'), evt('p#1', 1), evt('p#2', 2)];
    expect(coalesce(log)).toHaveLength(3);
  });
});

describe('isolate — the redeclaration trap', () => {
  it('wraps a bare fragment so two turns can both declare `const spin`', () => {
    expect(isolate('const spin = 1;')).toContain('(() => {');
  });

  it('leaves an already-wrapped iife alone, and is idempotent either way', () => {
    const iife = '(() => { const spin = 1; })();';
    expect(isolate(iife)).toBe(iife);
    expect(isolate(isolate('const a = 1;'))).toBe(isolate('const a = 1;'));
  });
});

describe('foldSource — for reading, never for replay', () => {
  it('renders events as comments, because they are not source', () => {
    const text = foldSource([prog('a'), evt('p#1', 2), frag('b')]);
    expect(text).toContain('// [1] student: set p#1 = 2');
    expect(text).toContain('a');
    expect(text).toContain('b');
  });
});
