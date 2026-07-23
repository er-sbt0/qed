/**
 * tools.sandbox.test.ts — the whole instrument, played against real guest code.
 *
 * `tools.test.ts` proves the tool rules with an in-process scene and thunked
 * folds. This proves what thunks cannot: a scene a QuickJS program actually
 * built answers every probe — inspect, evalAt, whyChanged, counterfactual,
 * bisectFlip — and takes both write acts, with every experiment folding the
 * log through a fresh VM and the LIVE scene never moving.
 *
 * This is roadmap 4c's exit criterion minus the billed half: the engine can
 * answer "why did that turn red?" causally and name the exact flip threshold.
 * Whether a MODEL asks before narrating is what the recording will buy.
 */

import { describe, expect, it } from 'vitest';
import { createWorld } from '@math-ai/core';
import { createStage, sceneIndex, sceneManifest } from '@math-ai/render';
import { createProgramScope } from '@math-ai/library';
import { QuickJSHost } from './host.js';
import { newNodeContext } from './node.js';
import { isolate, replayLog } from './conversation.js';
import type { ConversationLog, Settable } from './conversation.js';
import { lint } from './lint.js';
import {
  appendFragment,
  bisectFlip,
  counterfactual,
  evalAt,
  inspect,
  setInput,
  whyChanged,
} from './tools.js';
import type { CompileFragment, FoldScene, SceneMap } from './tools.js';

/** Turn 1: a parameter, a derived, a claim over it, a field to sample. */
const PROGRAM = [
  'const spin = M.parameter("spin", 1, { range: [-2, 2] });',
  'const doubled = M.derived(() => 2 * spin.value, "doubled");',
  'const under = M.claim({ lhs: doubled, rhs: 3, relation: "<=", label: "under three" });',
  'const F = Field.vectorField((x, y) => [-spin.value * y, spin.value * x], { label: "F" });',
  'const omega = Field.rectangle({ x0: -1, y0: -1, x1: 1, y1: 1, label: "\\\\Omega" });',
  'lesson.beat("An instrument");',
  'lesson.show(View.field(F, { over: omega }));',
  'lesson.expose(spin, { as: "draggable" });',
  'lesson.show(View.readout(doubled, { label: "doubled" }));',
  'lesson.show(View.claim(under));',
].join('\n');

async function freshScene() {
  const world = createWorld();
  const stage = createStage(world);
  const scope = createProgramScope(world, stage);
  const ctx = await newNodeContext();
  const host = new QuickJSHost(ctx, { budget: { authorMs: 10_000 }, lintGate: false });
  host.defineScope(scope as unknown as Record<string, unknown>);
  const execute = (entry: { js: string }): void => {
    host.run(isolate(entry.js));
  };
  return { world, stage, scope, host, execute };
}

/** Every fold is a brand-new VM replaying the candidate — state = fold(log). */
const fold: FoldScene = async (candidate: ConversationLog) => {
  const s = await freshScene();
  const result = replayLog(candidate, {
    execute: s.execute,
    resolve: (id) => sceneIndex(s.stage).get(id) as Settable | undefined,
  });
  return result.ok ? { ok: true, scene: sceneIndex(s.stage) } : result;
};

/** The real gate, no esbuild: these fragments are already plain JS. */
const compile: CompileFragment = (source) => {
  const gated = lint(source);
  return gated.ok
    ? { ok: true, js: source }
    : { ok: false, errors: gated.findings.map((f) => `${f.rule}: ${f.message}`) };
};

function idByLabel(scene: SceneMap, label: string, kind?: string): string {
  for (const h of scene.values()) {
    const l = (h as { label?: unknown }).label;
    if (l === label && (kind === undefined || h.kind === kind)) return h.id;
  }
  const seen = [...scene.values()].map((h) => `${h.id}:${String((h as { label?: unknown }).label)}`);
  throw new Error(`the scene offers nothing labeled "${label}" — it has: ${seen.join(', ')}`);
}

describe('a hand-scripted tool sequence against a QuickJS-folded scene', () => {
  it('inspect → evalAt → whyChanged → counterfactual → bisectFlip → setInput → appendFragment', async () => {
    const live = await freshScene();
    const log: ConversationLog = [{ kind: 'program', source: PROGRAM, js: PROGRAM }];
    live.execute(log[0] as { js: string });

    const scene = () => sceneIndex(live.stage);
    const spin = idByLabel(scene(), 'spin', 'parameter');
    const doubled = idByLabel(scene(), 'doubled', 'scalar');
    const under = idByLabel(scene(), 'under three', 'claim');
    const F = idByLabel(scene(), 'F', 'vectorField');

    // ── inspect: the full value of one object, live ──
    const p = inspect(scene(), spin);
    expect(p).toEqual({
      ok: true,
      value: { id: spin, kind: 'parameter', label: 'spin', value: 1, range: [-2, 2] },
    });
    const c = inspect(scene(), under);
    expect(c.ok && (c.value as { holds: boolean; evidence: string }).holds).toBe(true);

    // ── evalAt: sample the guest-authored rule at a point ──
    // [-spin·y, spin·x] at (1, 1) with spin = 1
    expect(evalAt(scene(), F, [1, 1])).toEqual({ ok: true, value: [-1, 1] });

    // ── whyChanged: causality off the reactive graph, across the bridge ──
    const why = whyChanged(scene(), under);
    expect(why.ok).toBe(true);
    if (why.ok) {
      const chain = (why.value as { chain: Array<Record<string, unknown>> }).chain;
      expect(chain.map((e) => e['kind'])).toEqual(['claim', 'scalar', 'scalar', 'parameter']);
      expect(chain[chain.length - 1]).toMatchObject({ id: spin, label: 'spin', value: 1 });
    }

    // ── counterfactual: a disposable fold answers "what if spin were 2" ──
    const what = await counterfactual(log, fold, {
      set: [{ id: spin, value: 2 }],
      read: [doubled, under],
    });
    expect(what.ok).toBe(true);
    if (what.ok) {
      const reads = (what.value as { reads: Array<Record<string, unknown>> }).reads;
      expect(reads[0]).toMatchObject({ id: doubled, value: 4 });
      expect(reads[1]).toMatchObject({ id: under, holds: false });
    }

    // ── bisectFlip: the exact threshold of "2·spin ≤ 3", one VM per probe ──
    // 12 probes = 2 endpoints + 10 halvings of [-2, 2]: bracket width ~4e-3
    const flip = await bisectFlip(log, fold, {
      param: spin,
      claim: under,
      lo: -2,
      hi: 2,
      maxProbes: 12,
    });
    expect(flip.ok).toBe(true);
    if (flip.ok) {
      const v = flip.value as { flipped: boolean; lo: number; hi: number; holdsAtLo: boolean; holdsAtHi: boolean };
      expect(v.flipped).toBe(true);
      expect(v.holdsAtLo).toBe(true);
      expect(v.holdsAtHi).toBe(false);
      // the analytic flip point, to the resolution 12 probes buy
      expect((v.lo + v.hi) / 2).toBeCloseTo(1.5, 2);
    }

    // ── every probe so far was a throwaway fold: the LIVE scene never moved ──
    const untouched = sceneManifest(live.stage);
    expect(untouched.objects.find((o) => o.id === spin)!.value).toBe(1);
    expect(untouched.claims.find((cl) => cl.id === under)!.holds).toBe(true);

    // ── setInput: the event path, committed via the disposable fold ──
    const set = await setInput(log, fold, { id: spin, value: -1 });
    expect(set.result.ok).toBe(true);
    expect(set.log).toHaveLength(2);

    // ── appendFragment: gate → commit; the fragment reaches back BY ID ──
    const FRAGMENT = [
      `const spin = M.byId("${spin}");`,
      'lesson.beat("Watch it settle");',
      'lesson.show(View.readout(M.derived(() => spin.value, "spin now"), { label: "spin now" }));',
    ].join('\n');
    const appended = await appendFragment(set.log, fold, compile, { source: FRAGMENT });
    expect(appended.result.ok ? 'ok' : JSON.stringify(appended.result.error)).toBe('ok');
    expect(appended.log).toHaveLength(3);

    // the whole conversation still folds from scratch, and the folded scene
    // carries the write acts: spin at -1, the turn-2 beat on the timeline
    const replayed = await freshScene();
    const result = replayLog(appended.log, {
      execute: replayed.execute,
      resolve: (id) => sceneIndex(replayed.stage).get(id) as Settable | undefined,
    });
    expect(result.ok ? 'ok' : (result as { failure: { message: string } }).failure.message).toBe('ok');
    const manifest = sceneManifest(replayed.stage);
    expect(manifest.objects.find((o) => o.id === spin)!.value).toBe(-1);
    expect(manifest.beats.map((b) => b.title)).toEqual(['An instrument', 'Watch it settle']);

    // and the live scene STILL has not moved — writes advance the log; the
    // screen is the caller's to refresh, exactly as on the manipulate path
    expect(sceneManifest(live.stage).objects.find((o) => o.id === spin)!.value).toBe(1);
  }, 30_000);

  it('the gate rejection comes back verbatim as the tool error', async () => {
    const log: ConversationLog = [{ kind: 'program', source: PROGRAM, js: PROGRAM }];
    const BAD = 'lesson.beat("nope");\nconst x = eval("1");';
    const w = await appendFragment(log, fold, compile, { source: BAD });
    expect(w.result.ok).toBe(false);
    if (!w.result.ok) {
      expect(w.result.error.code).toBe('rejected');
      // the lint complaint itself, word for word — retry IS repair
      expect(w.result.error.message).toContain('banned-global');
      expect(w.result.error.message).toContain('eval()');
    }
    expect(w.log).toBe(log);
  });
});
