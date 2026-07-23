/**
 * world.ts — the container that wires identity, reactivity, correspondence,
 * provenance, and the timeline together. One `World` per lesson program run.
 *
 * Operations (`defineOp`) are the derivation primitive: pure functions from
 * immutable inputs to immutable values. Running one records `(operation,
 * inputs)` provenance on every value it creates — a WeakMap entry and a small
 * record, cheap enough for the per-frame drag path. `trace(value)` replays
 * the body in traced mode against a *shadow* id registry seeded with the
 * original counters, so replayed handles reproduce the original ids exactly,
 * correspondence edges are not re-recorded, and the timeline stays untouched.
 * Purity is enforced: slots, collections, and the timeline reject mutation
 * while an operation body runs (normal or replay).
 */

import { IdRegistry, isHandle } from './identity.js';
import type { Handle, Id } from './identity.js';
import { CorrespondenceGraph } from './correspondence.js';
import type { CorrespondenceEdge, Relation } from './correspondence.js';
import { Timeline } from './timeline.js';
import { Collection, Derived, Incremental, Slot } from './reactive.js';
import type { Equals, IncrementalOpts, ReactiveHost } from './reactive.js';
import type {
  OpBody,
  OpContext,
  OpDefOpts,
  Operation,
  Provenance,
  ProvenanceRecord,
  TraceEvent,
} from './provenance.js';

interface ReplayFrame {
  readonly shadow: IdRegistry;
  readonly events: TraceEvent[];
}

/**
 * A frozen derived value carrying `data`'s own property DESCRIPTORS plus its
 * identity. Descriptors, not a spread: a spread would evaluate accessors once
 * and freeze the snapshot, but a live getter authored on the data (a graph
 * edge whose `weight` reads a Parameter, the `LinAlg.matrix` pattern) must
 * stay a getter, so downstream reactive numerics re-read it after a drag.
 * Freezing preserves accessors — it only pins the property definitions.
 */
function freezeValue<K extends string, D extends object>(
  data: D,
  id: Id,
  kind: K,
): Readonly<D> & Handle<K> {
  const v = Object.defineProperties(
    Object.defineProperties({}, Object.getOwnPropertyDescriptors(data)),
    {
      id: { value: id, enumerable: true },
      kind: { value: kind, enumerable: true },
    },
  );
  return Object.freeze(v) as Readonly<D> & Handle<K>;
}

export class World {
  readonly ids = new IdRegistry();
  readonly graph = new CorrespondenceGraph();
  readonly timeline: Timeline;

  private replayFrame: ReplayFrame | null = null;
  private opDepth = 0;
  private readonly provenance = new WeakMap<object, ProvenanceRecord>();
  private readonly opNames = new Set<string>();
  private readonly host: ReactiveHost & { timeline: Timeline };

  constructor() {
    const partialHost = {
      mint: (kind: string, explicitId?: Id): Id =>
        (this.replayFrame?.shadow ?? this.ids).mint(kind, explicitId),
      assertMutable: (what: string): void => {
        if (this.replayFrame) {
          throw new Error(`${what} is not allowed during provenance replay — operations must be pure`);
        }
        if (this.opDepth > 0) {
          throw new Error(`${what} is not allowed inside an operation body — operations must be pure`);
        }
      },
      timeline: undefined as unknown as Timeline,
    };
    this.timeline = new Timeline(partialHost);
    partialHost.timeline = this.timeline;
    this.host = partialHost;
  }

  // ────────────────────────────── identity ──────────────────────────────

  /** Mint a bare handle. Deterministic generated id unless one is supplied. */
  handle<K extends string>(kind: K, id?: Id): Handle<K> {
    return Object.freeze({ id: this.host.mint(kind, id), kind });
  }

  // ────────────────────────────── reactivity ────────────────────────────

  slot<T>(initial: T, opts?: { readonly id?: Id; readonly equals?: Equals<T> }): Slot<T> {
    this.host.assertMutable('slot creation');
    return new Slot(this.host, this.host.mint('slot', opts?.id), initial, opts?.equals);
  }

  collection<T>(initial: readonly T[] = [], opts?: { readonly id?: Id }): Collection<T> {
    this.host.assertMutable('collection creation');
    return new Collection(this.host, this.host.mint('collection', opts?.id), initial);
  }

  derived<T>(fn: () => T, opts?: { readonly id?: Id; readonly equals?: Equals<T> }): Derived<T> {
    return new Derived(this.host.mint('derived', opts?.id), fn, opts?.equals);
  }

  incremental<T, S>(
    source: Collection<T>,
    opts: IncrementalOpts<T, S> & { readonly id?: Id },
  ): Incremental<T, S> {
    return new Incremental(this.host.mint('incremental', opts.id), source, opts);
  }

  // ─────────────────────────── correspondence ───────────────────────────

  /** Author a correspondence edge (or one per target). */
  link(a: Handle, b: Handle | readonly Handle[], rel: Relation): readonly CorrespondenceEdge[] {
    if (this.replayFrame) return []; // replay must not re-record edges
    return this.graph.link(a, b, rel, 'authored');
  }

  // ──────────────────────── operations / provenance ──────────────────────

  /**
   * Define a named, deterministic operation over immutable inputs. Calling it
   * runs the body immediately (untraced — `ctx.trace` is a no-op); every
   * value it creates via `ctx.value` carries `(operation, inputs)` provenance
   * and, unless `autoEdges: false`, an automatic `came-from` edge to each
   * Handle-typed input.
   */
  defineOp<A extends readonly unknown[], R>(
    name: string,
    body: OpBody<A, R>,
    opts?: OpDefOpts,
  ): Operation<A, R> {
    if (this.opNames.has(name)) throw new Error(`operation "${name}" is already defined`);
    this.opNames.add(name);
    const autoEdges = opts?.autoEdges ?? true;

    const run = (...args: A): R => {
      const frame = this.replayFrame;
      if (frame) {
        // Nested call during a replay: keep tracing into the same frame,
        // minting from the shadow registry. No provenance, no edges.
        return body(this.replayCtx(frame), ...args);
      }
      const record: ProvenanceRecord = {
        operation: name,
        inputs: Object.freeze([...args]) as readonly unknown[],
        body: body as OpBody<readonly unknown[], unknown>,
        counters: this.ids.snapshot(),
      };
      const ctx: OpContext = {
        traced: false,
        trace: () => {},
        value: <K extends string, D extends object>(
          kind: K,
          data: D,
          o?: { readonly id?: Id },
        ): Readonly<D> & Handle<K> => {
          const v = freezeValue(data, this.ids.mint(kind, o?.id), kind);
          this.provenance.set(v, record);
          if (autoEdges) {
            for (const input of args) {
              if (isHandle(input)) this.graph.record(v, input, 'came-from', 'construction');
            }
          }
          return v;
        },
        handle: <K extends string>(kind: K, id?: Id): Handle<K> =>
          Object.freeze({ id: this.ids.mint(kind, id), kind }),
        link: (a, b, rel) => {
          this.graph.link(a, b, rel, 'construction');
        },
      };
      this.opDepth += 1;
      try {
        return body(ctx, ...args);
      } finally {
        this.opDepth -= 1;
      }
    };

    return Object.assign(run, { opName: name });
  }

  /** The lazy provenance record of a derived value, if it has one. */
  provenanceOf(value: object): Provenance | undefined {
    const record = this.provenance.get(value);
    return record && { operation: record.operation, inputs: record.inputs };
  }

  /**
   * Re-derive a value's full trace by re-running its operation in traced
   * mode. Replay is side-effect-free: ids mint from a shadow registry seeded
   * with the original counters (so replayed handles carry the original ids),
   * correspondence edges are suppressed, and timeline/slot/collection
   * mutation throws.
   */
  trace(value: object): readonly TraceEvent[] {
    const record = this.provenance.get(value);
    if (!record) {
      throw new Error('value carries no provenance — it was not created by an operation');
    }
    if (this.replayFrame) throw new Error('nested trace() during replay is not supported');
    const frame: ReplayFrame = { shadow: new IdRegistry(record.counters), events: [] };
    this.replayFrame = frame;
    try {
      record.body(this.replayCtx(frame), ...record.inputs);
    } finally {
      this.replayFrame = null;
    }
    return frame.events;
  }

  private replayCtx(frame: ReplayFrame): OpContext {
    return {
      traced: true,
      trace: (event) => {
        frame.events.push(event);
      },
      value: <K extends string, D extends object>(
        kind: K,
        data: D,
        o?: { readonly id?: Id },
      ): Readonly<D> & Handle<K> => freezeValue(data, frame.shadow.mint(kind, o?.id), kind),
      handle: <K extends string>(kind: K, id?: Id): Handle<K> =>
        Object.freeze({ id: frame.shadow.mint(kind, id), kind }),
      link: () => {},
    };
  }
}

export function createWorld(): World {
  return new World();
}
