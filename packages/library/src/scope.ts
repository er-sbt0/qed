/**
 * scope.ts — the program-scope binding (M3 open question 4).
 *
 * `createProgramScope(world, stage)` yields the exact authoring surface the
 * two spike programs import — `M`, `Prob`, `View`, `Layout`, `F`, `lesson` —
 * all bound to ONE world and ONE stage. A beats program written against the
 * spike `api.ts` sketches runs against this scope unmodified.
 *
 * The active-scope registry is how an UNMODIFIED program (which does
 * `import { M, ... } from "./api"`) receives its bindings: the bundler (or
 * vitest resolver) aliases that import to a shim (spike-api/*.ts) which
 * re-exports `getActiveScope()` at its module-evaluation moment. The harness
 * therefore: creates world + stage, `setActiveScope(createProgramScope(...))`,
 * then dynamically imports the beats module — whose top-level code IS the
 * program. One scope per world (the lesson layer already enforces one lesson
 * per world).
 *
 * This is milestone 4's stand-in for the milestone-5 QuickJS host: there the
 * same scope members are marshalled into the guest instead of imported.
 */

import type { Collection, Handle, Slot, World } from '@math-ai/core';
import { createF, createLesson } from '@math-ai/lesson';
import type { FormulaBuilder, Lesson } from '@math-ai/lesson';
import type { Stage } from '@math-ai/render';
import { createAutomata } from './automata.js';
import type { AutomataLib, Word } from './automata.js';
import { createGraphLib } from './graph.js';
import type { GraphLib } from './graph.js';
import { createProbability } from './probability.js';
import type { ProbLib } from './probability.js';
import { createCalculus } from './calculus.js';
import type { CalcLib } from './calculus.js';
import { createLinearAlgebra } from './linalg.js';
import type { LinAlgLib } from './linalg.js';
import { createParameter } from './parameter.js';
import type { Parameter } from './parameter.js';
import { createFieldLib } from './field.js';
import type { FieldLib } from './field.js';
import { createInteraction } from './interaction.js';
import type { InteractionLib } from './interaction.js';
import { derivedNumber } from './numeric.js';
import type { LabeledNumber } from './numeric.js';
import { createClaim } from './claim.js';
import type { Claim, ClaimOpts } from './claim.js';
import { sceneIndex } from '@math-ai/render';
import { createViews } from './views.js';
import type { LayoutLib, ViewLib } from './views.js';

/**
 * `M` is the union the three spikes settled: automata constructors + slot/range
 * + `parameter` (the Δ3 interaction-mutable scalar the FTC/determinant spikes
 * forced — kernel because both continuous disciplines need it).
 */
export interface MLib extends AutomataLib {
  slot<T>(initial: T): Slot<T>;
  range(n: number): readonly number[];
  /** Re-exported for symmetry with `M.words` — the reactive source type. */
  collection<T>(initial?: readonly T[]): Collection<T>;
  /** Δ3 — a reactive, draggable scalar with a range (see parameter.ts). */
  parameter(name: string, value: number, opts: { range: readonly [number, number] }): Parameter;
  /** A live scalar computed from other reactive cells. `fn` is re-run on read
   *  and tracks whatever it touches, so a dragged Parameter updates it — the
   *  same mechanism behind `LinAlg.determinant` and `Calc` numerics. Reach for
   *  this instead of hand-building an object with a `value` getter. */
  derived(fn: () => number, label?: string): LabeledNumber;
  /** A live proposition — two quantities and an asserted relation, or a
   *  predicate closure. Its `status` re-derives like any other reactive value,
   *  so `View.claim` shows the student whether their drag broke it. See
   *  claim.ts. */
  claim(opts: ClaimOpts): Claim;
  /**
   * Reach an object authored by an EARLIER turn, by its handle id.
   *
   * Only a conversation needs this (roadmap 4b). A single program holds its
   * own objects in `const`s; a fragment appended on turn 2 runs in its own
   * scope and cannot see them, so it names them by the ids the scene manifest
   * gave it. Throws with the id listed rather than returning undefined —
   * a fragment that silently authored against `undefined` would gate clean and
   * then fail somewhere unrelated, which is the failure mode the whole gate
   * exists to avoid.
   *
   * The index is exactly what the manifest offered, so a fragment cannot name
   * an object the student was never shown, and cannot resurrect a retired one.
   */
  byId<T = Handle>(id: string): T;
}

export interface ProgramScope {
  readonly world: World;
  readonly stage: Stage;
  readonly lesson: Lesson;
  readonly F: FormulaBuilder;
  readonly M: MLib;
  readonly Prob: ProbLib;
  readonly Calc: CalcLib;
  readonly LinAlg: LinAlgLib;
  readonly Graph: GraphLib;
  /** Vector/scalar fields over the plane — see field.ts. */
  readonly Field: FieldLib;
  readonly View: ViewLib;
  readonly Layout: LayoutLib;
  /** Concrete affordances (the drag rail) — see interaction.ts. */
  readonly Interaction: InteractionLib;
}

let active: ProgramScope | null = null;

export function setActiveScope(scope: ProgramScope): void {
  active = scope;
}

export function getActiveScope(): ProgramScope {
  if (!active) {
    throw new Error(
      'no active program scope — call setActiveScope(createProgramScope(world, stage)) ' +
        'before importing a beats program',
    );
  }
  return active;
}

export function createProgramScope(world: World, stage: Stage): ProgramScope {
  if (stage.world !== world) {
    throw new Error('createProgramScope: the stage must belong to the same world');
  }
  const lesson = createLesson(world);
  const F = createF(world);
  const automata = createAutomata(world);
  const Prob = createProbability(world);
  const Calc = createCalculus(world);
  const LinAlg = createLinearAlgebra(world);
  const Graph = createGraphLib(world);
  const Field = createFieldLib(world);
  const { View, Layout } = createViews(stage);
  const Interaction = createInteraction(world);

  const M: MLib = Object.freeze({
    ...automata,
    slot: <T>(initial: T): Slot<T> => world.slot(initial),
    range: (n: number): readonly number[] =>
      Object.freeze(Array.from({ length: Math.max(0, Math.floor(n)) }, (_, i) => i)),
    collection: <T>(initial: readonly T[] = []): Collection<T> => world.collection(initial),
    parameter: (name: string, value: number, opts: { range: readonly [number, number] }): Parameter =>
      createParameter(world, name, value, opts.range),
    derived: (fn: () => number, label?: string): LabeledNumber => derivedNumber(world, fn, label),
    claim: (opts: ClaimOpts): Claim => createClaim(world, opts),
    byId: <T = Handle>(id: string): T => {
      // Built per call, not cached: a fragment may reference an object an
      // EARLIER STATEMENT of the same fragment showed, and a cached index
      // taken at scope construction would predate the whole conversation.
      const found = sceneIndex(stage).get(id);
      if (!found) {
        const available = [...sceneIndex(stage).keys()].slice(0, 20).join(', ');
        throw new Error(
          `M.byId("${id}") — no object with that id is in the scene. A fragment may only ` +
            `reference ids the scene manifest listed, and never a retired one. ` +
            `Available: ${available}${sceneIndex(stage).size > 20 ? ', …' : ''}`,
        );
      }
      return found as T;
    },
  });

  return Object.freeze({
    world, stage, lesson, F, M, Prob, Calc, LinAlg, Graph, Field, View, Layout, Interaction,
  });
}

export type { AutomataLib, ProbLib, CalcLib, LinAlgLib, GraphLib, FieldLib, ViewLib, LayoutLib, InteractionLib, Word };
