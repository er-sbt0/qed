/**
 * tools.test.ts — the tool layer, with no sandbox in the way.
 *
 * The scene is built IN-PROCESS: a real world, stage and program scope, driven
 * by direct library calls instead of QuickJS. That is the same split
 * conversation.test.ts made — the sibling `.sandbox.test.ts` proves the tools
 * against a scene a real guest program folded; this proves the rules
 * (dispatch, boundary, typed errors) where they are cheap to exercise.
 */

import { describe, expect, it } from 'vitest';
import { createWorld } from '@math-ai/core';
import { createStage, sceneIndex } from '@math-ai/render';
import { createProgramScope } from '@math-ai/library';
import type { ProgramScope } from '@math-ai/library';
import { appendFragment, bisectFlip, counterfactual, evalAt, inspect, runTool, setInput, whyChanged } from './tools.js';
import type { CompileFragment, FoldScene } from './tools.js';
import { replayLog } from './conversation.js';
import type { ConversationLog, Settable } from './conversation.js';

/**
 * One scene with something for every dispatch arm: a draggable parameter, a
 * derived scalar, a two-sided claim, a vector field, a fn, a 2×2 matrix, a
 * region whose boundary is a loop — all MENTIONED, because the boundary rule
 * says a tool reaches what the manifest offers and nothing else.
 */
function build(scope: ProgramScope) {
  const { M, Field, Calc, LinAlg, lesson } = scope;

  const spin = M.parameter('spin', 1, { range: [-2, 2] });
  const doubled = M.derived(() => 2 * spin.value, 'doubled');
  const under = M.claim({ lhs: doubled, rhs: 3, relation: '<=', label: 'doubled stays under 3' });
  const F = Field.vectorField((x, y) => [-spin.value * y, spin.value * x], { label: 'F' });
  const f = Calc.fn((x) => 1 / x, { label: 'f' });
  const A = LinAlg.matrix([
    [spin, 0],
    [0, 1],
  ]);
  const omega = Field.rectangle({ x0: -1, y0: -1, x1: 1, y1: 1, label: '\\Omega' });

  lesson.beat('an instrumented scene');
  lesson.expose(spin, { as: 'draggable' });
  lesson.say`watch ${doubled} obey ${under} over ${F}, ${f}, ${A}, ${omega.boundary}`;

  return { spin, doubled, under, F, f, A, omega };
}

function scene() {
  const world = createWorld();
  const stage = createStage(world);
  const scope: ProgramScope = createProgramScope(world, stage);
  const refs = build(scope);

  // the hook contract: the scene map IS sceneIndex, built per probe so it
  // describes the scene as it stands, not as it stood when the test began
  const index = () => sceneIndex(stage);

  // the live scene is fold(log) too: one program entry, standing for build()
  const log: ConversationLog = [{ kind: 'program', source: 'build', js: 'build' }];

  // An in-process fold: fresh world, replay the CANDIDATE, hand back its
  // index. Determinism means the folded ids line up with the live scene's.
  // Program/fragment sources are interpreted through THUNKS — the same
  // stand-in for QuickJS execution the conversation unit tests use; the
  // sibling .sandbox.test.ts runs real guest code through the same seam.
  const thunks: Record<string, (sc: ProgramScope) => void> = {
    build,
    noteBeat: (sc) => {
      sc.lesson.beat('a note');
    },
  };
  const fold: FoldScene = (candidate) => {
    const w = createWorld();
    const st = createStage(w);
    const sc = createProgramScope(w, st);
    const result = replayLog(candidate, {
      execute: (entry) => {
        const run = thunks[entry.source];
        if (!run) throw new Error(`no thunk for source "${entry.source}"`);
        run(sc);
      },
      resolve: (id) => sceneIndex(st).get(id) as Settable | undefined,
    });
    return result.ok ? { ok: true, scene: sceneIndex(st) } : result;
  };

  return { stage, scope, index, log, fold, ...refs };
}

describe('inspect — the full structured value of one object', () => {
  it('a parameter: value and range', () => {
    const s = scene();
    const r = inspect(s.index(), s.spin.id);
    expect(r).toEqual({
      ok: true,
      value: { id: s.spin.id, kind: 'parameter', label: 'spin', value: 1, range: [-2, 2] },
    });
  });

  it('a claim: verdict, evidence, and both sides with the gap', () => {
    const s = scene();
    const r = inspect(s.index(), s.under.id);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toMatchObject({
        kind: 'claim',
        label: 'doubled stays under 3',
        holds: true, // 2·1 ≤ 3
        evidence: 'exact-comparison',
        relation: '<=',
        lhs: 2,
        rhs: 3,
        gap: -1,
      });
    }
  });

  it('the claim inspects LIVE: a drag that breaks it is visible', () => {
    const s = scene();
    s.spin.setValueLive(2); // 2·2 = 4 > 3
    const r = inspect(s.index(), s.under.id);
    expect(r.ok && (r.value as { holds: boolean }).holds).toBe(false);
  });

  it('a matrix: entries as rows, reading live cells', () => {
    const s = scene();
    const r = inspect(s.index(), s.A.id);
    expect(r.ok && (r.value as { entries: number[][] }).entries).toEqual([
      [1, 0],
      [0, 1],
    ]);
  });

  it('a loop: vertices and signed area', () => {
    const s = scene();
    const r = inspect(s.index(), s.omega.boundary.id);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const v = r.value as { vertices: number[][]; area: number };
      expect(v.vertices).toHaveLength(4);
      // signed area — the SIGN is the orientation, so only the magnitude is
      // the rectangle's geometry
      expect(Math.abs(v.area)).toBeCloseTo(4, 9);
    }
  });

  it('a derived scalar falls through to {id, kind, label, value}', () => {
    const s = scene();
    const r = inspect(s.index(), s.doubled.id);
    expect(r).toEqual({
      ok: true,
      value: { id: s.doubled.id, kind: 'scalar', label: 'doubled', value: 2 },
    });
  });

  it('an unknown id is a typed error naming the boundary rule', () => {
    const s = scene();
    const r = inspect(s.index(), 'parameter#999');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('unknown-id');
      expect(r.error.message).toContain('parameter#999');
      expect(r.error.message).toContain('manifest');
    }
  });

  it('a retired object is unreachable — retire does its job here too', () => {
    const s = scene();
    s.scope.lesson.retire(s.doubled);
    const r = inspect(s.index(), s.doubled.id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('unknown-id');
  });
});

describe('evalAt — sample a rule the object already carries', () => {
  it('a vector field at (x, y)', () => {
    const s = scene();
    // rule is [-spin·y, spin·x] with spin = 1
    expect(evalAt(s.index(), s.F.id, [1, 1])).toEqual({ ok: true, value: [-1, 1] });
  });

  it('reads the rule LIVE: a dragged parameter changes the sample', () => {
    const s = scene();
    s.spin.setValueLive(-2);
    expect(evalAt(s.index(), s.F.id, [1, 1])).toEqual({ ok: true, value: [2, -2] });
  });

  it('a fn at x', () => {
    const s = scene();
    expect(evalAt(s.index(), s.f.id, [4])).toEqual({ ok: true, value: 0.25 });
  });

  it('wrong arity is a typed error naming what was wanted', () => {
    const s = scene();
    const r = evalAt(s.index(), s.F.id, [1]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('bad-args');
      expect(r.error.message).toContain('2 finite coordinates');
    }
  });

  it('a non-finite input is bad-args, not a crash', () => {
    const s = scene();
    const r = evalAt(s.index(), s.f.id, [Number.NaN]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('bad-args');
  });

  it('a pole is a domain error, not Infinity smuggled through JSON', () => {
    const s = scene();
    const r = evalAt(s.index(), s.f.id, [0]); // 1/x at 0
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('domain');
  });

  it('an object with no rule is not-evaluable', () => {
    const s = scene();
    const r = evalAt(s.index(), s.under.id, [1]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('not-evaluable');
      expect(r.error.message).toContain('claim');
    }
  });
});

describe('runTool — errors are data, never a throw', () => {
  it('dispatches a typed call', async () => {
    const s = scene();
    const out = await runTool({ tool: 'inspect', id: s.spin.id }, { scene: s.index });
    expect(out.result.ok).toBe(true);
  });

  it('an experiment call without a fold hook is a failed result, not a crash', async () => {
    const s = scene();
    const out = await runTool(
      { tool: 'bisectFlip', param: s.spin.id, claim: s.under.id, lo: -2, hi: 2 },
      { scene: s.index },
    );
    expect(out.result.ok).toBe(false);
    if (!out.result.ok) expect(out.result.error.code).toBe('failed');
  });

  it('a scene that throws mid-read comes back as a failed result', async () => {
    const s = scene();
    const bomb = s.scope.M.claim({
      predicate: () => {
        throw new Error('the predicate exploded');
      },
      label: 'unstable',
    });
    s.scope.lesson.say`${bomb}`;
    const out = await runTool({ tool: 'inspect', id: bomb.id }, { scene: s.index });
    expect(out.result.ok).toBe(false);
    if (!out.result.ok) {
      expect(out.result.error.code).toBe('failed');
      expect(out.result.error.message).toContain('the predicate exploded');
    }
  });
});

describe('whyChanged — causality read off the reactive graph', () => {
  it('walks a claim back to the parameter that moves it: claim → gap → derived → input', () => {
    const s = scene();
    const r = whyChanged(s.index(), s.under.id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const chain = (r.value as { chain: Array<Record<string, unknown>> }).chain;
    // ordered from the asked-about thing back to the root input
    expect(chain.map((e) => e['kind'])).toEqual(['claim', 'scalar', 'scalar', 'parameter']);
    expect(chain[0]).toMatchObject({ id: s.under.id, value: true });
    expect(chain[1]).toMatchObject({ label: 'gap', value: -1 });
    expect(chain[2]).toMatchObject({ id: s.doubled.id, label: 'doubled', value: 2 });
    expect(chain[3]).toMatchObject({ id: s.spin.id, label: 'spin', value: 1 });
  });

  it('answers about the CURRENT state: after the drag that broke the claim', () => {
    const s = scene();
    s.spin.setValueLive(2);
    const r = whyChanged(s.index(), s.under.id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const chain = (r.value as { chain: Array<Record<string, unknown>> }).chain;
    expect(chain[0]).toMatchObject({ value: false }); // the claim is broken…
    expect(chain[chain.length - 1]).toMatchObject({ id: s.spin.id, value: 2 }); // …because spin is 2
  });

  it('a derived scalar walks straight to its input', () => {
    const s = scene();
    const r = whyChanged(s.index(), s.doubled.id);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const chain = (r.value as { chain: Array<Record<string, unknown>> }).chain;
    expect(chain.map((e) => e['id'])).toEqual([s.doubled.id, s.spin.id]);
  });

  it('a parameter is an INPUT — the typed error says where its history lives', () => {
    const s = scene();
    const r = whyChanged(s.index(), s.spin.id);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('not-derived');
      expect(r.error.message).toContain('INPUT');
      expect(r.error.message).toContain('set-input');
    }
  });

  it('unknown ids hit the same boundary as every other tool', () => {
    const s = scene();
    const r = whyChanged(s.index(), 'derived#404');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('unknown-id');
  });
});

describe('counterfactual — a disposable fold, not the live scene', () => {
  it('answers "what if spin were 2" and leaves the screen untouched', async () => {
    const s = scene();
    const r = await counterfactual(s.log, s.fold, {
      set: [{ id: s.spin.id, value: 2 }],
      read: [s.doubled.id, s.under.id],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const reads = (r.value as { reads: Array<Record<string, unknown>> }).reads;
      expect(reads[0]).toMatchObject({ id: s.doubled.id, value: 4 });
      expect(reads[1]).toMatchObject({ id: s.under.id, holds: false });
    }
    // the probe ran in a throwaway fold: the LIVE scene never moved
    expect(s.spin.value).toBe(1);
    expect(s.under.holds).toBe(true);
  });

  it('a set on an id the scene does not offer is the fold\'s rejection, verbatim', async () => {
    const s = scene();
    const r = await counterfactual(s.log, s.fold, {
      set: [{ id: 'parameter#999', value: 2 }],
      read: [s.doubled.id],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('rejected');
      expect(r.error.message).toContain('parameter#999');
    }
  });

  it('a read of an unknown id fails whole — no partial answers to guess around', async () => {
    const s = scene();
    const r = await counterfactual(s.log, s.fold, {
      set: [{ id: s.spin.id, value: 2 }],
      read: ['scalar#404'],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('unknown-id');
  });

  it('non-finite values are bad-args before any fold is spent', async () => {
    const s = scene();
    const r = await counterfactual(s.log, s.fold, {
      set: [{ id: s.spin.id, value: Number.POSITIVE_INFINITY }],
      read: [s.doubled.id],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('bad-args');
  });
});

describe('bisectFlip — the exact threshold, one disposable fold per probe', () => {
  it('finds where "2·spin ≤ 3" flips: the analytic threshold is 1.5', async () => {
    const s = scene();
    const r = await bisectFlip(s.log, s.fold, {
      param: s.spin.id,
      claim: s.under.id,
      lo: -2,
      hi: 2,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const v = r.value as {
      flipped: boolean;
      lo: number;
      hi: number;
      holdsAtLo: boolean;
      holdsAtHi: boolean;
      probes: number;
    };
    expect(v.flipped).toBe(true);
    expect(v.holdsAtLo).toBe(true);
    expect(v.holdsAtHi).toBe(false);
    // The bracket pins the analytically known flip point — which, precisely,
    // is 1.5 + tol/2: the claim's `<=` carries its default 1e-9 float-hygiene
    // tolerance, and the bisection is exact enough to resolve THAT.
    expect(v.lo).toBeLessThanOrEqual(1.5 + 1e-9);
    expect(v.hi).toBeGreaterThanOrEqual(1.5);
    expect((v.lo + v.hi) / 2).toBeCloseTo(1.5, 6);
    expect(v.probes).toBeLessThanOrEqual(40);
    // and the live scene never moved through ~40 folds
    expect(s.spin.value).toBe(1);
  });

  it('both ends agreeing is a typed no-flip result, not an error', async () => {
    const s = scene();
    const r = await bisectFlip(s.log, s.fold, {
      param: s.spin.id,
      claim: s.under.id,
      lo: -2,
      hi: 1,
    });
    expect(r).toEqual({
      ok: true,
      value: { flipped: false, lo: -2, hi: 1, holdsAtLo: true, holdsAtHi: true, probes: 2 },
    });
  });

  it('the probe cap holds: a small budget still returns a (wider) bracket', async () => {
    const s = scene();
    const r = await bisectFlip(s.log, s.fold, {
      param: s.spin.id,
      claim: s.under.id,
      lo: -2,
      hi: 2,
      maxProbes: 6,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const v = r.value as { probes: number; lo: number; hi: number };
      expect(v.probes).toBeLessThanOrEqual(6);
      expect(v.lo).toBeLessThanOrEqual(1.5);
      expect(v.hi).toBeGreaterThanOrEqual(1.5);
    }
  });

  it('watching a non-claim is bad-args naming what bisect needs', async () => {
    const s = scene();
    const r = await bisectFlip(s.log, s.fold, {
      param: s.spin.id,
      claim: s.doubled.id,
      lo: -2,
      hi: 2,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('bad-args');
      expect(r.error.message).toContain('not a claim');
    }
  });

  it('inverted bounds are bad-args before any fold is spent', async () => {
    const s = scene();
    const r = await bisectFlip(s.log, s.fold, { param: s.spin.id, claim: s.under.id, lo: 2, hi: -2 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('bad-args');
  });
});

describe('setInput — the event path as a tool', () => {
  it('commits via commitEntry and hands back the advanced log; the screen is the caller\'s', async () => {
    const s = scene();
    const w = await setInput(s.log, s.fold, { id: s.spin.id, value: -1 });
    expect(w.result.ok).toBe(true);
    expect(w.log).toHaveLength(2);
    expect(w.log[1]).toEqual({
      kind: 'event',
      event: { type: 'set-input', target: s.spin.id, value: -1 },
    });
    // the committed log FOLDS to the new value…
    const folded = await s.fold(w.log);
    expect(folded.ok).toBe(true);
    if (folded.ok) {
      const r = inspect(folded.scene, s.spin.id);
      expect(r.ok && (r.value as { value: number }).value).toBe(-1);
    }
    // …while the live stage stays whatever it was: reflecting an accepted log
    // (a re-fold, a poke) is the caller's act, as on the manipulate path
    expect(s.spin.value).toBe(1);
  });

  it('an id the scene does not offer is rejected, and the log is untouched', async () => {
    const s = scene();
    const w = await setInput(s.log, s.fold, { id: 'parameter#999', value: 0 });
    expect(w.result.ok).toBe(false);
    if (!w.result.ok) {
      expect(w.result.error.code).toBe('rejected');
      expect(w.result.error.message).toContain('parameter#999');
    }
    expect(w.log).toBe(s.log);
  });

  it('a target that is not settable is the fold\'s complaint, verbatim', async () => {
    const s = scene();
    const w = await setInput(s.log, s.fold, { id: s.under.id, value: 0 });
    expect(w.result.ok).toBe(false);
    if (!w.result.ok) expect(w.result.error.message).toContain('not settable');
  });
});

describe('appendFragment — the 4b pipeline as a tool', () => {
  /** A gate that rejects on a marker: the unit-tier stand-in for lint. */
  const compile: CompileFragment = (source) =>
    source.includes('FORBIDDEN')
      ? { ok: false, errors: ['banned-global: FORBIDDEN is a sandbox-escape'] }
      : { ok: true, js: source };

  it('gates, commits, and the accepted log carries the fragment', async () => {
    const s = scene();
    const w = await appendFragment(s.log, s.fold, compile, { source: 'noteBeat' });
    expect(w.result.ok).toBe(true);
    expect(w.log).toHaveLength(2);
    expect(w.log[1]).toMatchObject({ kind: 'fragment', source: 'noteBeat' });
    expect((await s.fold(w.log)).ok).toBe(true);
  });

  it('a gate rejection returns VERBATIM as the tool error — retry is repair', async () => {
    const s = scene();
    const w = await appendFragment(s.log, s.fold, compile, { source: 'FORBIDDEN' });
    expect(w.result.ok).toBe(false);
    if (!w.result.ok) {
      expect(w.result.error.code).toBe('rejected');
      expect(w.result.error.message).toBe('banned-global: FORBIDDEN is a sandbox-escape');
    }
    expect(w.log).toBe(s.log);
  });

  it('a fragment that gates but breaks the fold is rejected the same way', async () => {
    const s = scene();
    const w = await appendFragment(s.log, s.fold, compile, { source: 'no-such-thunk' });
    expect(w.result.ok).toBe(false);
    if (!w.result.ok) expect(w.result.error.code).toBe('rejected');
    expect(w.log).toBe(s.log);
  });

  it('runTool routes writes and reports the advanced log', async () => {
    const s = scene();
    const out = await runTool(
      { tool: 'setInput', id: s.spin.id, value: 2 },
      { scene: s.index, log: s.log, fold: s.fold },
    );
    expect(out.result.ok).toBe(true);
    expect(out.log).toHaveLength(2);
  });

  it('appendFragment without a compile hook is a failed result, not a crash', async () => {
    const s = scene();
    const out = await runTool(
      { tool: 'appendFragment', source: 'noteBeat' },
      { scene: s.index, log: s.log, fold: s.fold },
    );
    expect(out.result.ok).toBe(false);
    if (!out.result.ok) expect(out.result.error.code).toBe('failed');
  });
});
