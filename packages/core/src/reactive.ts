/**
 * reactive.ts — the reactive core: `Slot`, `Collection`, `Derived`,
 * `Incremental`.
 *
 * The value model the spikes settled (Markov Δ2 / M3): derived values are
 * immutable and provenance-carrying; a `Slot<T>` is the one timeline-mutable
 * cell; `Collection`s are reactive sources whose derived structures receive
 * deltas. Recomputation is dirty-propagation: sources push staleness, readers
 * pull values; only subscribed nodes recompute eagerly (after the mutation
 * finishes), everything else recomputes lazily on next read.
 *
 * Mutations happen immediately at authoring time (the program must be able to
 * read what it just wrote — `slot.set(chain.step(slot.value))` in a loop) AND
 * enqueue a timeline step describing the transition, so playback can animate
 * it later. That is the concrete meaning of "reactive graph under a
 * declarative timeline".
 */

import type { Handle, Id } from './identity.js';
import type { Pace, Step, Timeline } from './timeline.js';

export type Equals<T> = (a: T, b: T) => boolean;
export type Unsubscribe = () => void;

/** What reactive sources need from their world. */
export interface ReactiveHost {
  mint(kind: string, explicitId?: Id): Id;
  assertMutable(what: string): void;
  readonly timeline: Timeline;
}

// ─────────────────────────── internal plumbing ───────────────────────────

interface Dependent {
  /** @internal push-phase: a source this node read has changed */
  markStale(): void;
}

interface SourceLike {
  /** Every concrete source (Slot, Collection, Derived, Incremental) is a
   *  Handle; carrying identity here is what lets `dependsOn` hand edges back
   *  as things a caller can name. */
  readonly id: Id;
  readonly kind: string;
  /** @internal */
  readonly dependents: Set<Dependent>;
}

/** The computation currently auto-tracking its reads, if any. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let activeComputation: Derived<any> | null = null;

function trackRead(source: SourceLike): void {
  if (activeComputation) activeComputation._addDependency(source);
}

interface Flushable {
  _flush(): void;
}

/**
 * Subscribed derived nodes invalidated by the current mutation; drained
 * synchronously once the mutation has finished propagating staleness.
 */
const flushQueue: Flushable[] = [];

function runFlush(): void {
  while (flushQueue.length > 0) {
    const node = flushQueue.shift();
    if (node) node._flush();
  }
}

function removeFrom<T>(arr: T[], item: T): void {
  const i = arr.indexOf(item);
  if (i >= 0) arr.splice(i, 1);
}

// ────────────────────────────────── Slot ─────────────────────────────────

export interface SlotTransition<T> {
  readonly from: T;
  readonly to: T;
  readonly via?: 'derivation' | 'fade';
  /** The timeline step this transition enqueued. */
  readonly step: Step;
}

export interface SetOpts {
  /** `derivation` = animate through the new value's provenance; `fade` = crossfade. */
  readonly via?: 'derivation' | 'fade';
  readonly pace?: Pace;
}

/**
 * A reactive cell over immutable values — the only timeline-mutable state.
 * `set` applies immediately and enqueues a `slot:set` timeline step.
 */
export class Slot<T> implements Handle<'slot'> {
  readonly kind = 'slot' as const;
  /** @internal */
  readonly dependents = new Set<Dependent>();
  private current: T;
  private readonly equalsFn: Equals<T>;
  private readonly subscribers: Array<(t: SlotTransition<T>) => void> = [];

  /** @internal — create via `world.slot(...)` */
  constructor(
    private readonly host: ReactiveHost,
    readonly id: Id,
    initial: T,
    equalsFn?: Equals<T>,
  ) {
    this.current = initial;
    this.equalsFn = equalsFn ?? Object.is;
  }

  /** Tracked read: registers this slot with the enclosing computation. */
  get value(): T {
    trackRead(this);
    return this.current;
  }

  /** Untracked read. */
  peek(): T {
    return this.current;
  }

  /** A timeline step: applies immediately, subscribers see the transition. */
  set(value: T, opts?: SetOpts): Step {
    this.host.assertMutable('Slot.set');
    const from = this.current;
    this.current = value;
    const step = this.host.timeline.step(
      'slot:set',
      { slot: this, from, to: value, via: opts?.via },
      { pace: opts?.pace },
    );
    if (!this.equalsFn(from, value)) {
      const transition: SlotTransition<T> = { from, to: value, via: opts?.via, step };
      for (const fn of [...this.subscribers]) fn(transition);
      for (const d of [...this.dependents]) d.markStale();
      runFlush();
    }
    return step;
  }

  /**
   * Apply a value WITHOUT recording a timeline step: the interaction path.
   * A drag (or a `vary` replay re-walking a transition the timeline already
   * records) changes the value hundreds of times per second; each of those is
   * not a beat of the explanation, and appending them to the timeline would
   * grow the very structure the player is walking. Dependents are invalidated
   * exactly as `set` invalidates them, so reactive derived values recompute —
   * views repaint through `applyState()`, not through queued step animations.
   */
  poke(value: T): void {
    this.host.assertMutable('Slot.poke');
    const from = this.current;
    this.current = value;
    if (this.equalsFn(from, value)) return;
    for (const d of [...this.dependents]) d.markStale();
    runFlush();
  }

  subscribe(fn: (t: SlotTransition<T>) => void): Unsubscribe {
    this.subscribers.push(fn);
    return () => removeFrom(this.subscribers, fn);
  }
}

// ─────────────────────────────── Collection ──────────────────────────────

export interface CollectionDelta<T> {
  readonly type: 'add';
  readonly item: T;
  readonly index: number;
  /** The timeline step this arrival enqueued. */
  readonly step: Step;
}

interface DeltaConsumer<T> {
  /** @internal */
  _applyDelta(delta: CollectionDelta<T>): void;
}

/**
 * A reactive source collection. `add` is a timeline step; derived structures
 * recompute (incrementally, for `Incremental` consumers) and observers
 * receive the delta.
 */
export class Collection<T> implements Handle<'collection'> {
  readonly kind = 'collection' as const;
  /** @internal */
  readonly dependents = new Set<Dependent>();
  private readonly current: T[];
  private readonly subscribers: Array<(d: CollectionDelta<T>) => void> = [];
  private readonly deltaConsumers = new Set<DeltaConsumer<T>>();

  /** @internal — create via `world.collection(...)` */
  constructor(
    private readonly host: ReactiveHost,
    readonly id: Id,
    initial: readonly T[],
  ) {
    this.current = [...initial];
  }

  /** Tracked read. */
  get items(): readonly T[] {
    trackRead(this);
    return this.current;
  }

  /** Tracked read. */
  get size(): number {
    trackRead(this);
    return this.current.length;
  }

  /** Untracked read. */
  peek(): readonly T[] {
    return this.current;
  }

  /** A timeline step: derived structures animate the arrival. */
  add(item: T): Step {
    this.host.assertMutable('Collection.add');
    const index = this.current.length;
    this.current.push(item);
    const step = this.host.timeline.step('collection:add', { collection: this, item, index });
    const delta: CollectionDelta<T> = { type: 'add', item, index, step };
    for (const fn of [...this.subscribers]) fn(delta);
    for (const consumer of [...this.deltaConsumers]) consumer._applyDelta(delta);
    for (const d of [...this.dependents]) d.markStale();
    runFlush();
    return step;
  }

  subscribe(fn: (d: CollectionDelta<T>) => void): Unsubscribe {
    this.subscribers.push(fn);
    return () => removeFrom(this.subscribers, fn);
  }

  /** @internal */
  _registerDeltaConsumer(c: DeltaConsumer<T>): () => void {
    this.deltaConsumers.add(c);
    return () => this.deltaConsumers.delete(c);
  }
}

// ──────────────────────────────── Derived ────────────────────────────────

export interface DerivedChange<T> {
  readonly from: T;
  readonly to: T;
}

/**
 * A lazily recomputed value with auto-tracked dependencies. Reading `.value`
 * inside another derived computation links the two; staleness propagates
 * through the graph, values recompute on pull (or eagerly when subscribed).
 */
export class Derived<T> implements Handle<'derived'>, Dependent, SourceLike, Flushable {
  readonly kind = 'derived' as const;
  /** @internal */
  readonly dependents = new Set<Dependent>();
  private cached!: T;
  private state: 'uninitialized' | 'clean' | 'dirty' = 'uninitialized';
  private computing = false;
  private readonly deps = new Set<SourceLike>();
  private readonly equalsFn: Equals<T>;
  private readonly subscribers: Array<(c: DerivedChange<T>) => void> = [];
  private pendingFrom: { readonly value: T } | null = null;

  /** @internal — create via `world.derived(...)` */
  constructor(
    readonly id: Id,
    private readonly fn: () => T,
    equalsFn?: Equals<T>,
  ) {
    this.equalsFn = equalsFn ?? Object.is;
  }

  /** Tracked read; recomputes if stale. */
  get value(): T {
    trackRead(this);
    this.pull();
    return this.cached;
  }

  /** Untracked read; still recomputes if stale. */
  peek(): T {
    this.pull();
    return this.cached;
  }

  /**
   * Change notifications carry `{from, to}`; delivered synchronously after
   * the mutation that invalidated this node, in subscription order.
   */
  subscribe(fn: (c: DerivedChange<T>) => void): Unsubscribe {
    this.pull(); // establish a baseline so `from` is always meaningful
    this.subscribers.push(fn);
    return () => removeFrom(this.subscribers, fn);
  }

  /**
   * The sources this node's CURRENT value actually read — the graph's edges,
   * made queryable (roadmap 4c: `whyChanged` walks a verdict back to the
   * inputs that moved along these).
   *
   * Pulls first, because dependencies here are dynamic: `deps` is cleared and
   * re-tracked on every recomputation, so a stale node's edge list would
   * describe a value nobody can read any more. The flip side is worth stating:
   * the edges are those of the current value, not of the computation that a
   * subscriber was last notified about.
   */
  dependsOn(): readonly Handle[] {
    this.pull();
    return [...this.deps];
  }

  /** @internal */
  _addDependency(source: SourceLike): void {
    this.deps.add(source);
    source.dependents.add(this);
  }

  /** @internal */
  markStale(): void {
    if (this.state !== 'clean') return; // uninitialized has no observers; dirty already propagated
    this.state = 'dirty';
    if (this.subscribers.length > 0 && !this.pendingFrom) {
      this.pendingFrom = { value: this.cached };
      flushQueue.push(this);
    }
    for (const d of [...this.dependents]) d.markStale();
  }

  /** @internal */
  _flush(): void {
    const pending = this.pendingFrom;
    this.pendingFrom = null;
    if (!pending) return;
    this.pull();
    if (!this.equalsFn(pending.value, this.cached)) {
      const change: DerivedChange<T> = { from: pending.value, to: this.cached };
      for (const fn of [...this.subscribers]) fn(change);
    }
  }

  private pull(): void {
    if (this.state === 'clean') return;
    if (this.computing) throw new Error(`cycle detected in derived computation (${this.id})`);
    this.computing = true;
    for (const dep of this.deps) dep.dependents.delete(this);
    this.deps.clear();
    const previous = activeComputation;
    activeComputation = this;
    try {
      this.cached = this.fn();
    } finally {
      activeComputation = previous;
      this.computing = false;
    }
    this.state = 'clean';
  }
}

// ────────────────────────────── Incremental ──────────────────────────────

export interface IncrementalOpts<T, S> {
  /** Compute the initial state from the items present at first read. */
  readonly init: (items: readonly T[]) => S;
  /** Fold one collection delta into the state; return the next state. */
  readonly apply: (state: S, delta: CollectionDelta<T>) => S;
}

export interface IncrementalChange<T, S> {
  readonly from: S;
  readonly to: S;
  /** The collection delta that drove this update, when there was one. */
  readonly delta?: CollectionDelta<T>;
}

/**
 * A derived structure over exactly one `Collection`, updated per-delta instead
 * of recomputed from scratch — e.g. a partition keyed by a closure, where an
 * arrival re-buckets only the new item. Participates in the dependency graph
 * as a source (deriveds reading `.value` are tracked).
 */
export class Incremental<T, S> implements Handle<'incremental'>, SourceLike {
  readonly kind = 'incremental' as const;
  /** @internal */
  readonly dependents = new Set<Dependent>();
  private state: S | undefined;
  private initialized = false;
  private readonly subscribers: Array<(c: IncrementalChange<T, S>) => void> = [];
  private readonly detach: () => void;

  /** @internal — create via `world.incremental(...)` */
  constructor(
    readonly id: Id,
    private readonly source: Collection<T>,
    private readonly opts: IncrementalOpts<T, S>,
  ) {
    this.detach = source._registerDeltaConsumer(this);
  }

  /** Tracked read; initializes lazily from the current items. */
  get value(): S {
    trackRead(this);
    this.ensure();
    return this.state as S;
  }

  /** Untracked read. */
  peek(): S {
    this.ensure();
    return this.state as S;
  }

  subscribe(fn: (c: IncrementalChange<T, S>) => void): Unsubscribe {
    this.ensure();
    this.subscribers.push(fn);
    return () => removeFrom(this.subscribers, fn);
  }

  /** Stop receiving deltas from the source collection. */
  dispose(): void {
    this.detach();
  }

  /** The one edge an Incremental has: its source collection is fixed at
   *  construction, so no pull is needed to know it. Same query surface as
   *  `Derived.dependsOn`, so a graph walk does not care which it met. */
  dependsOn(): readonly Handle[] {
    return [this.source];
  }

  /** @internal */
  _applyDelta(delta: CollectionDelta<T>): void {
    if (!this.initialized) return; // first read will fold this item in via init
    const from = this.state as S;
    this.state = this.opts.apply(from, delta);
    const change: IncrementalChange<T, S> = { from, to: this.state, delta };
    for (const fn of [...this.subscribers]) fn(change);
    for (const d of [...this.dependents]) d.markStale();
    // flush runs from the collection mutation that delivered this delta
  }

  private ensure(): void {
    if (this.initialized) return;
    this.state = this.opts.init(this.source.peek());
    this.initialized = true;
  }
}
