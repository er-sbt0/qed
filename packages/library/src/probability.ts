/**
 * probability.ts — the probability discipline library, in USERLAND over
 * `@math-ai/core`. Implements the `Prob` surface the api reference teaches
 * (packages/planner/src/api-reference.ts):
 *
 *  - `stochasticMatrix({editable: "renormalize-row"})` — the interaction
 *    POLICY lives on the semantic object: each cell is a `VarySettable`
 *    (lesson protocol) whose `setValue` renormalizes its row, so a drag or a
 *    `vary` can never make the matrix non-stochastic — invalid states are
 *    unreachable at the object boundary. `editable: "locked"` (the default)
 *    omits `setValue` entirely: drags stay dead even after `expose`, and
 *    `vary` records a declarative-only step (`applied: false`).
 *    The matrix's value grid lives in a core `Slot` (one frozen grid per
 *    state), which is what makes downstream derived numerics reactive.
 *  - `markovChain` — `Transition` objects carry a by-construction
 *    `counterpart-of` edge to their matrix cell, so the matrix view's cells
 *    and the graph view's edges light up together (resonance) with no
 *    authored link. `chain.step(d)` is a traced operation emitting `parcel`
 *    events (the render vocabulary): the split/travel/merge choreography IS
 *    the provenance.
 *  - `stationary(chain)` — a REACTIVE derived value: a core `Derived` runs
 *    power iteration over the matrix slot, so dragging a cell recomputes π on
 *    the next read (M3 open question 1). The returned Distribution is a
 *    stable handle whose `mass()` reads the derived — live by design; every
 *    *value* use of it (chain.step input, judge closures, slot.set) reads at
 *    call time, which is the library's capture-at-derive policy.
 *  - `sampleWalk` — seeded LCG, deterministic and replayable: the seed is in
 *    the provenance, `demonstrate(walk)` replays the same hops every run.
 *
 * TRACE-DRIFT POLICY (M3 open question 2, library-wide): operations that
 * close over mutable state (matrix cells) read that state at DERIVE time, and
 * every consumer captures derived numeric content at the moment of
 * derivation — `Stage.captureDerivations` snapshots `via: "derivation"`
 * traces when the slot moves, `lesson.demonstrate` traces at verb-call time,
 * and the bars/history views snapshot masses at subscription time. Lazy
 * `world.trace` after later mutations would replay against post-drift state;
 * nothing in this library relies on it.
 */

import type { Handle, OpContext, Slot as CoreSlot, World } from '@math-ai/core';

// ─────────────────────────────── types ───────────────────────────────

export interface ChainState extends Handle<'state'> {
  readonly label: string;
}

export interface StateSet extends Handle<'collection'> {
  readonly items: readonly ChainState[];
  state(label: string): ChainState;
}

/** A reactive, draggable number — subpart of the stochastic matrix. */
export interface MatrixCell extends Handle<'matrix:cell'> {
  readonly value: number;
  /** Present only under `editable: "renormalize-row"` — the policy itself. */
  setValue?(next: number): void;
}

export type MatrixPolicy = 'renormalize-row' | 'locked';

export interface StochasticMatrix extends Handle<'matrix'> {
  readonly states: StateSet;
  readonly editable: MatrixPolicy;
  cell(row: ChainState | string, col: ChainState | string): MatrixCell;
  /** Live, untracked read (drag path). */
  valueAt(from: string, to: string): number;
  /** Live, TRACKED read of the whole grid — what reactive numerics depend on. */
  valuesTracked(): ReadonlyArray<readonly number[]>;
}

export interface Transition extends Handle<'transition'> {
  readonly from: ChainState;
  readonly to: ChainState;
  readonly probability: number;
}

export interface Distribution extends Handle<'distribution'> {
  readonly states: StateSet;
  readonly label: string;
  mass(state: ChainState): number;
}

export interface MarkovChain extends Handle<'chain'> {
  readonly states: StateSet;
  readonly matrix: StochasticMatrix;
  readonly transitions: readonly Transition[];
  state(label: string): ChainState;
  transition(from: ChainState | string, to: ChainState | string): Transition;
  step(d: Distribution): Distribution;
}

export interface Walk extends Handle<'walk'> {
  readonly path: readonly ChainState[];
  readonly seed: number;
}

export interface ProbLib {
  states(labels: readonly string[]): StateSet;
  stochasticMatrix(opts: {
    readonly states: StateSet;
    readonly values: ReadonlyArray<readonly number[]>;
    readonly editable?: MatrixPolicy;
  }): StochasticMatrix;
  markovChain(opts: {
    readonly states: StateSet;
    readonly transitions: StochasticMatrix;
  }): MarkovChain;
  distribution(states: StateSet, mass: Readonly<Record<string, number>>): Distribution;
  stationary(chain: MarkovChain): Distribution;
  sampleWalk(
    chain: MarkovChain,
    opts: { readonly from: string; readonly steps: number; readonly seed: number },
  ): Walk;
}

// ───────────────────────────── helpers ─────────────────────────────

function fmt(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n
    .toFixed(3)
    .replace(/0+$/, '')
    .replace(/\.$/, '');
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

const POWER_MAX_ITER = 500;
const POWER_EPS = 1e-12;

/** Power iteration for the stationary row vector: v ← vP until fixed. */
export function powerIterate(
  labels: readonly string[],
  p: (from: string, to: string) => number,
): Readonly<Record<string, number>> {
  const n = labels.length;
  let v = labels.map(() => 1 / n);
  for (let iter = 0; iter < POWER_MAX_ITER; iter += 1) {
    const next = labels.map(() => 0);
    for (let i = 0; i < n; i += 1) {
      const vi = v[i]!;
      if (vi === 0) continue;
      for (let j = 0; j < n; j += 1) {
        next[j] = next[j]! + vi * p(labels[i]!, labels[j]!);
      }
    }
    const total = next.reduce((acc, x) => acc + x, 0);
    if (total > 0) for (let j = 0; j < n; j += 1) next[j] = next[j]! / total;
    let delta = 0;
    for (let j = 0; j < n; j += 1) delta = Math.max(delta, Math.abs(next[j]! - v[j]!));
    v = next;
    if (delta < POWER_EPS) break;
  }
  return Object.freeze(Object.fromEntries(labels.map((label, i) => [label, v[i]!])));
}

// ───────────────────────────── factory ─────────────────────────────

export function createProbability(world: World): ProbLib {
  const mkDistribution = (
    ctx: OpContext,
    states: StateSet,
    mass: Readonly<Record<string, number>>,
    label?: string,
  ): Distribution => {
    const record = Object.freeze({ ...mass });
    const values = states.items.map((s) => record[s.label] ?? 0);
    return ctx.value('distribution', {
      states,
      label: label ?? `(${values.map(fmt).join(', ')})`,
      mass: (state: ChainState): number => record[state.label] ?? 0,
    });
  };

  const distributionOp = world.defineOp(
    'Prob.distribution',
    (ctx, states: StateSet, mass: Readonly<Record<string, number>>): Distribution =>
      mkDistribution(ctx, states, mass),
  );

  /**
   * One step of evolution. Reads the matrix LIVE (capture-at-derive policy:
   * the values that flow into the parcels are the values at call time), and
   * emits one `parcel` trace event per nonzero flow — the render vocabulary.
   */
  const stepOp = world.defineOp('Prob.step', (ctx, chain: MarkovChain, d: Distribution): Distribution => {
    const items = chain.states.items;
    const mass: Record<string, number> = {};
    for (const s of items) mass[s.label] = 0;
    for (const from of items) {
      const m = d.mass(from);
      if (m === 0) continue;
      for (const to of items) {
        const parcel = m * chain.matrix.valueAt(from.label, to.label);
        if (parcel <= 0) continue;
        ctx.trace({ type: 'parcel', from, to, parcel });
        mass[to.label] = (mass[to.label] ?? 0) + parcel;
      }
    }
    return mkDistribution(ctx, chain.states, mass);
  });

  const chainOp = world.defineOp(
    'Prob.markovChain',
    (ctx, states: StateSet, matrix: StochasticMatrix): MarkovChain => {
      const transitions: Transition[] = [];
      for (const from of states.items) {
        for (const to of states.items) {
          const probability = matrix.valueAt(from.label, to.label);
          if (probability <= 0) continue;
          const t: Transition = ctx.value('transition', { from, to, probability });
          // matrix cell ↔ graph edge sync, recorded by construction (M1):
          // both views resolve through this one counterpart-of edge.
          ctx.link(t, matrix.cell(from.label, to.label), 'counterpart-of');
          transitions.push(t);
        }
      }
      const chain = ctx.value('chain', {
        states,
        matrix,
        transitions: Object.freeze([...transitions]),
        state: (label: string): ChainState => states.state(label),
        transition(from: ChainState | string, to: ChainState | string): Transition {
          const fromLabel = typeof from === 'string' ? from : from.label;
          const toLabel = typeof to === 'string' ? to : to.label;
          const found = transitions.find(
            (t) => t.from.label === fromLabel && t.to.label === toLabel,
          );
          if (!found) throw new Error(`chain has no transition ${fromLabel} → ${toLabel}`);
          return found;
        },
        step(this: MarkovChain, d: Distribution): Distribution {
          return stepOp(this, d);
        },
      });
      return chain as MarkovChain;
    },
  );

  const walkOp = world.defineOp(
    'Prob.sampleWalk',
    (ctx, chain: MarkovChain, from: string, steps: number, seed: number): Walk => {
      let rng = seed >>> 0;
      const nextRand = (): number => {
        rng = (rng * 1103515245 + 12345) % 2147483648;
        return rng / 2147483648;
      };
      let current = chain.state(from);
      const path: ChainState[] = [current];
      for (let i = 0; i < steps; i += 1) {
        const r = nextRand();
        let acc = 0;
        let chosen = current;
        for (const to of chain.states.items) {
          acc += chain.matrix.valueAt(current.label, to.label);
          if (r < acc) {
            chosen = to;
            break;
          }
        }
        ctx.trace({ type: 'hop', index: i, from: current, to: chosen });
        current = chosen;
        path.push(current);
      }
      return ctx.value('walk', { path: Object.freeze(path), seed, from });
    },
  );

  const lib: ProbLib = {
    states(labels: readonly string[]): StateSet {
      const items: readonly ChainState[] = Object.freeze(
        labels.map((label) => Object.freeze({ ...world.handle('state'), label })),
      );
      const base = world.handle('collection');
      return Object.freeze({
        id: base.id,
        kind: 'collection' as const,
        items,
        state(label: string): ChainState {
          const found = items.find((s) => s.label === label);
          if (!found) {
            throw new Error(
              `no state labeled "${label}" — available: ${labels.join(', ')}`,
            );
          }
          return found;
        },
      });
    },

    stochasticMatrix(opts): StochasticMatrix {
      const { states } = opts;
      const editable: MatrixPolicy = opts.editable ?? 'locked';
      const n = states.items.length;
      if (opts.values.length !== n || opts.values.some((row) => row.length !== n)) {
        throw new Error(`stochasticMatrix: values must be ${n}×${n} to match the states`);
      }
      const grid0 = Object.freeze(opts.values.map((row) => Object.freeze([...row])));
      // The reactive underpinning: one frozen grid per state of the matrix.
      const slot: CoreSlot<ReadonlyArray<readonly number[]>> = world.slot(grid0);
      const index = new Map(states.items.map((s, i) => [s.label, i]));

      const indexOf = (which: ChainState | string): number => {
        const label = typeof which === 'string' ? which : which.label;
        const i = index.get(label);
        if (i === undefined) {
          throw new Error(`matrix has no state labeled "${label}"`);
        }
        return i;
      };

      const setCell = (r: number, c: number, next: number): void => {
        // renormalize-row: the edited cell takes the new value; the rest of
        // the row rescales proportionally to keep the row summing to 1.
        const grid = slot.peek();
        const x = clamp01(next);
        const row = [...grid[r]!];
        const rest = 1 - x;
        const others = row.reduce((acc, v, j) => (j === c ? acc : acc + v), 0);
        for (let j = 0; j < row.length; j += 1) {
          if (j === c) row[j] = x;
          else row[j] = others > 1e-12 ? row[j]! * (rest / others) : rest / (row.length - 1);
        }
        const nextGrid = grid.map((rr, i) => (i === r ? Object.freeze(row) : rr));
        slot.set(Object.freeze(nextGrid));
      };

      const cells: ReadonlyArray<readonly MatrixCell[]> = states.items.map((_, r) =>
        states.items.map((_c, c) => {
          const handle = world.handle('matrix:cell');
          const cell: MatrixCell & { setValue?(next: number): void } = {
            id: handle.id,
            kind: 'matrix:cell' as const,
            get value(): number {
              return slot.peek()[r]![c]!;
            },
          };
          if (editable === 'renormalize-row') {
            cell.setValue = (next: number): void => setCell(r, c, next);
          }
          return Object.freeze(cell);
        }),
      );

      const base = world.handle('matrix');
      return Object.freeze({
        id: base.id,
        kind: 'matrix' as const,
        states,
        editable,
        cell: (row: ChainState | string, col: ChainState | string): MatrixCell =>
          cells[indexOf(row)]![indexOf(col)]!,
        valueAt: (from: string, to: string): number => slot.peek()[indexOf(from)]![indexOf(to)]!,
        valuesTracked: (): ReadonlyArray<readonly number[]> => slot.value,
      });
    },

    markovChain(opts): MarkovChain {
      return chainOp(opts.states, opts.transitions);
    },

    distribution(states, mass): Distribution {
      return distributionOp(states, mass);
    },

    stationary(chain: MarkovChain): Distribution {
      // The REACTIVE derived value: reading the matrix through
      // `valuesTracked()` registers the dependency, so any cell edit marks
      // this stale and the next read re-runs power iteration (M3 Q1).
      const derived = world.derived(() => {
        chain.matrix.valuesTracked();
        return powerIterate(
          chain.states.items.map((s) => s.label),
          (from, to) => chain.matrix.valueAt(from, to),
        );
      });
      const base = world.handle('distribution');
      return Object.freeze({
        id: base.id,
        kind: 'distribution' as const,
        states: chain.states,
        label: 'π',
        mass: (state: ChainState): number => derived.value[state.label] ?? 0,
      });
    },

    sampleWalk(chain, opts): Walk {
      return walkOp(chain, opts.from, opts.steps, opts.seed);
    },
  };
  return Object.freeze(lib);
}
