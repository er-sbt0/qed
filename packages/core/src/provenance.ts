/**
 * provenance.ts — types for immutable derived values with LAZY provenance.
 *
 * A provenance record is just `(operation, inputs)` plus the id-counter
 * snapshot needed to replay deterministically — cheap enough for the
 * per-frame drag path. The full derivation trace is re-derived on demand by
 * re-running the operation body in traced mode (`world.trace(value)`): sound
 * because values are immutable and operations deterministic. See world.ts for
 * the machinery.
 */

import type { Handle, Id, IdCounters } from './identity.js';
import type { Relation } from './correspondence.js';

/** The public face of a provenance record. */
export interface Provenance {
  readonly operation: string;
  readonly inputs: readonly unknown[];
}

/**
 * One semantic event emitted by an operation body under traced replay —
 * e.g. `{type: 'parcel', from, to, mass}` for one term of a matrix product.
 * The shape is operation-defined; milestone 2's `demonstrate` interprets it.
 */
export interface TraceEvent {
  readonly type: string;
  readonly [key: string]: unknown;
}

/** The context an operation body receives. */
export interface OpContext {
  /** `true` only during a `world.trace(...)` replay. */
  readonly traced: boolean;
  /** No-op unless traced — tracing costs nothing on the normal path. */
  trace(event: TraceEvent): void;
  /**
   * Create an immutable derived value: frozen, identity-bearing, carrying
   * this operation call's provenance. `id`/`kind` win over colliding keys in
   * `data`.
   */
  value<K extends string, D extends object>(
    kind: K,
    data: D,
    opts?: { readonly id?: Id },
  ): Readonly<D> & Handle<K>;
  /** Mint a bare handle (no provenance) — for lightweight subparts. */
  handle<K extends string>(kind: K, id?: Id): Handle<K>;
  /**
   * Record a by-construction correspondence edge (e.g. class ↔ state
   * `counterpart-of`). Suppressed during replay — the edges already exist.
   * Use `trace` instead for per-element flow detail that should stay lazy.
   */
  link(a: Handle, b: Handle | readonly Handle[], rel: Relation): void;
}

export type OpBody<A extends readonly unknown[], R> = (ctx: OpContext, ...args: A) => R;

/** A defined operation: callable, plus its registered name. */
export type Operation<A extends readonly unknown[], R> = ((...args: A) => R) & {
  readonly opName: string;
};

export interface OpDefOpts {
  /**
   * Record automatic `came-from` edges from each created value to each
   * Handle-typed input (default `true`). Turn off for hot per-frame
   * derivations (drag-path numerics) so the correspondence graph does not
   * grow per frame — the provenance record itself is kept either way.
   */
  readonly autoEdges?: boolean;
}

/** @internal — what the world stores per derived value (in a WeakMap). */
export interface ProvenanceRecord {
  readonly operation: string;
  readonly inputs: readonly unknown[];
  readonly body: OpBody<readonly unknown[], unknown>;
  /** Id counters at operation start — seeds the shadow registry on replay. */
  readonly counters: IdCounters;
}
