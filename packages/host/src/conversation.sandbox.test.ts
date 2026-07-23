/**
 * conversation.sandbox.test.ts — a three-turn conversation, folded for real.
 *
 * `conversation.test.ts` proves the log logic with stub hooks. This proves the
 * thing stubs cannot: that a fragment appended on turn 2 actually executes in
 * QuickJS against the world turn 1 built, reaches back to a turn-1 object by
 * id, and that the whole log replays FROM SCRATCH into the same state.
 *
 * The shape is roadmap step 4b's exit criterion minus the billed part: turn 2
 * references a turn-1 handle, turn 3 responds to a student drag, and the log
 * replays to the same state. What stays unspent is whether a MODEL writes such
 * a fragment — no test can answer that.
 *
 * The determinism the linter enforces is what makes this work at all: no Date,
 * no Math.random, no I/O, so state = fold(log) and a replayed world is the
 * same world, not a similar one.
 */

import { describe, expect, it } from 'vitest';
import { createWorld } from '@math-ai/core';
import { createStage, sceneIndex, sceneManifest } from '@math-ai/render';
import { createProgramScope } from '@math-ai/library';
import { QuickJSHost } from './host.js';
import { newNodeContext } from './node.js';
import { coalesce, commitEntry, isolate, replayLog, studentEvents } from './conversation.js';
import type { ConversationLog, ReplayHooks, Settable } from './conversation.js';

/** Turn 1: the whole program, as /api/chat would return it. */
const TURN_1 = [
  'const spin = M.parameter("spin", 1, { range: [-2, 2] });',
  'const F = Field.vectorField((x, y) => [-spin.value * y, spin.value * x], { label: "F" });',
  'const omega = Field.rectangle({ x0: -1, y0: -1, x1: 1, y1: 1, label: "\\\\Omega" });',
  'lesson.beat("A field that swirls");',
  'const fieldView = View.field(F, { over: omega });',
  'lesson.show(fieldView);',
  'lesson.expose(spin, { as: "draggable" });',
  'lesson.enableInteraction(Interaction.drag(spin, { along: fieldView }));',
].join('\n');

/**
 * A fresh world, scope and VM. Every replay gets one — a program's authoring
 * pass runs once, so replay means rebuilding, exactly as LessonCanvas does for
 * a backward jump.
 */
async function freshScene() {
  const world = createWorld();
  const stage = createStage(world);
  const scope = createProgramScope(world, stage);
  const ctx = await newNodeContext();
  const host = new QuickJSHost(ctx, { budget: { authorMs: 10_000 }, lintGate: false });
  host.defineScope(scope as unknown as Record<string, unknown>);

  const hooks: ReplayHooks = {
    execute: (entry) => {
      // `isolate` is what the real pipeline gets for free from esbuild's
      // `format: 'iife'`. Without it, turn 2 redeclaring `const spin` dies
      // with a bare SyntaxError that says nothing about conversations — which
      // is exactly how this test first failed.
      host.run(isolate(entry.js));
    },
    // resolution happens PER EVENT, against the scene as it stands at that
    // point in the log — a fragment earlier in the log may have created the
    // thing a later event names.
    resolve: (id) => sceneIndex(stage).get(id) as Settable | undefined,
  };
  return { world, stage, scope, host, hooks };
}

/** The id the manifest reports for the draggable parameter. */
function spinId(stage: ReturnType<typeof createStage>): string {
  const p = sceneManifest(stage).objects.find((o) => o.label === 'spin');
  if (!p) throw new Error('the scene has no draggable `spin`');
  return p.id;
}

describe('a three-turn conversation, folded through QuickJS', () => {
  it('turn 2 reaches a turn-1 handle by id, and turn 3 responds to a drag', async () => {
    const first = await freshScene();
    first.hooks.execute({ kind: 'program', source: TURN_1, js: TURN_1 });
    const id = spinId(first.stage);

    // The student drags. This is the checkpoint the manifest was read at, and
    // the value turn 2 is authored against.
    const dragged = { kind: 'event', event: { type: 'set-input', target: id, value: -1.5 } } as const;

    // Turn 2: the model saw spin at -1.5 in the manifest and wrote a claim
    // ABOUT that — it can only name the parameter by id.
    const TURN_2 = [
      `const spin = M.byId("${id}");`,
      'lesson.beat("You reversed it");',
      'const negative = M.claim({ predicate: () => spin.value < 0, label: "the swirl runs clockwise" });',
      'lesson.show(View.claim(negative));',
    ].join('\n');

    // Turn 3: the student drags again, the other way.
    const undone = { kind: 'event', event: { type: 'set-input', target: id, value: 2 } } as const;

    const log: ConversationLog = [
      { kind: 'program', source: TURN_1, js: TURN_1 },
      dragged,
      { kind: 'fragment', source: TURN_2, js: TURN_2, turn: 2 },
      undone,
    ];

    // ── replay the WHOLE log from scratch into a brand new world ──
    const replayed = await freshScene();
    const result = replayLog(log, replayed.hooks);
    // assert on the failure MESSAGE, not just the flag — a replay that broke
    // at entry 2 should say so out loud.
    expect(result.ok ? 'ok' : result.failure.message).toBe('ok');

    const manifest = sceneManifest(replayed.stage);
    // the last event won: the parameter is where turn 3 left it
    expect(manifest.objects.find((o) => o.id === id)!.value).toBe(2);
    // and the turn-2 claim, authored against -1.5, now reads BROKEN — which is
    // the point: it is live, not a snapshot of the moment it was written.
    const claim = manifest.claims.find((c) => c.label === 'the swirl runs clockwise');
    expect(claim).toBeDefined();
    expect(claim!.holds).toBe(false);
    expect(claim!.evidence).toBe('authored-predicate');
    // the turn-2 beat is on the timeline after turn 1's
    expect(manifest.beats.map((b) => b.title)).toEqual(['A field that swirls', 'You reversed it']);
  });

  /**
   * The reason events are log entries rather than a final state applied at the
   * end. Same fragments, same values, different ORDER — different scene.
   */
  it('a drag BEFORE a fragment is a different world than the same drag after it', async () => {
    const probe = await freshScene();
    probe.hooks.execute({ kind: 'program', source: TURN_1, js: TURN_1 });
    const id = spinId(probe.stage);

    // the fragment SNAPSHOTS spin's value at authoring time — exactly the
    // mistake a real fragment can make, and the reason ordering must be real
    const FRAGMENT = [
      `const spin = M.byId("${id}");`,
      'const atWriting = M.derived(() => 0 * spin.value + 1, "one");',
      'lesson.beat("A note");',
      'lesson.show(View.readout(M.derived(() => spin.value, "spin then"), { label: "spin" }));',
      `lesson.say\`spin was \${atWriting}\`;`,
    ].join('\n');

    const before: ConversationLog = [
      { kind: 'program', source: TURN_1, js: TURN_1 },
      { kind: 'event', event: { type: 'set-input', target: id, value: -2 } },
      { kind: 'fragment', source: FRAGMENT, js: FRAGMENT },
    ];
    const after: ConversationLog = [
      { kind: 'program', source: TURN_1, js: TURN_1 },
      { kind: 'fragment', source: FRAGMENT, js: FRAGMENT },
      { kind: 'event', event: { type: 'set-input', target: id, value: -2 } },
    ];

    const a = await freshScene();
    expect(replayLog(before, a.hooks)).toEqual({ ok: true });
    const b = await freshScene();
    expect(replayLog(after, b.hooks)).toEqual({ ok: true });

    // Both end at the same parameter value — a "apply drags at the end" design
    // would call these identical...
    const va = sceneManifest(a.stage).objects.find((o) => o.id === id)!.value;
    const vb = sceneManifest(b.stage).objects.find((o) => o.id === id)!.value;
    expect(va).toBe(-2);
    expect(vb).toBe(-2);
    // ...but the fragment ran against different worlds, and the log records
    // which. That is the property the ordering rule protects.
    expect(before[1]!.kind).toBe('event');
    expect(after[1]!.kind).toBe('fragment');
  });

  it('a fragment naming an id that is not in the scene is REJECTED, and the log is untouched', async () => {
    const log: ConversationLog = [{ kind: 'program', source: TURN_1, js: TURN_1 }];
    const BAD = 'const ghost = M.byId("parameter#999");\nlesson.beat("nope");';

    const committed = await commitEntry(
      log,
      { kind: 'fragment', source: BAD, js: BAD },
      async (candidate) => {
        const scene = await freshScene();
        return replayLog(candidate, scene.hooks);
      },
    );

    expect(committed.ok).toBe(false);
    // the previous log comes back unchanged — nothing was half-applied, because
    // the candidate was folded somewhere disposable
    expect(committed.log).toBe(log);
    if (!committed.ok) {
      expect(committed.errors[0]).toContain('position 1');
      expect(committed.errors[0]).toContain('parameter#999');
    }
  });

  it('a good fragment commits, and the accepted log is the one that folded', async () => {
    const seed = await freshScene();
    seed.hooks.execute({ kind: 'program', source: TURN_1, js: TURN_1 });
    const id = spinId(seed.stage);
    const GOOD = [
      `const spin = M.byId("${id}");`,
      'lesson.beat("Still here");',
      'lesson.show(View.readout(M.derived(() => spin.value, "spin"), { label: "spin" }));',
    ].join('\n');

    const log: ConversationLog = [{ kind: 'program', source: TURN_1, js: TURN_1 }];
    const committed = await commitEntry(
      log,
      { kind: 'fragment', source: GOOD, js: GOOD, turn: 2 },
      async (candidate) => replayLog(candidate, (await freshScene()).hooks),
    );

    expect(committed.ok).toBe(true);
    expect(committed.log).toHaveLength(2);
    // and it really does fold — commit did not just say so
    const check = await freshScene();
    expect(replayLog(committed.log, check.hooks)).toEqual({ ok: true });
  });

  it('coalescing a drag sweep keeps the checkpoint, not the thousands of pokes', async () => {
    const sweep: ConversationLog = [
      { kind: 'program', source: TURN_1, js: TURN_1 },
      ...[0.1, 0.4, 0.9, 1.6].map(
        (value) => ({ kind: 'event', event: { type: 'set-input', target: 'p#1', value } }) as const,
      ),
    ];
    const tight = coalesce(sweep);
    expect(tight).toHaveLength(2);
    expect(studentEvents(tight)).toEqual([{ type: 'set-input', target: 'p#1', value: 1.6 }]);
  });
});
