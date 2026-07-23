/**
 * identity.ts — the handle/ID scheme.
 *
 * Every semantic object, view, subpart, and timeline step has stable identity
 * `{id, kind}` (architecture: "Locked early #1"). IDs are deterministic when
 * explicitly supplied and deterministically *generated* otherwise: a per-kind
 * counter yields `<kind>#<n>`, so the same program run in the same order mints
 * the same ids — which is what makes "the program is the artifact" reproducible
 * and makes provenance replay sound (see world.ts).
 */

export type Id = string;

/** Every object in the system carries stable identity. */
export interface Handle<K extends string = string> {
  readonly id: Id;
  readonly kind: K;
}

export function isHandle(x: unknown): x is Handle {
  return (
    typeof x === 'object' &&
    x !== null &&
    typeof (x as { id?: unknown }).id === 'string' &&
    typeof (x as { kind?: unknown }).kind === 'string'
  );
}

/**
 * Snapshot of the per-kind counters. Captured at the start of every operation
 * run; seeding a fresh registry with it makes a traced re-run mint identical
 * generated ids — the invariant lazy provenance replay relies on.
 */
export type IdCounters = Readonly<Record<string, number>>;

/**
 * Generated ids always take the form `<kind>#<n>`. Explicit ids may not use
 * that form, so the two namespaces can never collide — which keeps generated
 * ids a pure function of the counters (no skip-on-collision nondeterminism).
 */
const GENERATED_FORM = /#\d+$/;

export class IdRegistry {
  private readonly counters = new Map<string, number>();
  private readonly explicit = new Set<Id>();

  constructor(snapshot?: IdCounters) {
    if (snapshot) {
      for (const [kind, n] of Object.entries(snapshot)) this.counters.set(kind, n);
    }
  }

  mint(kind: string, explicitId?: Id): Id {
    if (explicitId !== undefined) {
      if (GENERATED_FORM.test(explicitId)) {
        throw new Error(
          `explicit id "${explicitId}" matches the reserved generated form "<kind>#<n>"`,
        );
      }
      if (this.explicit.has(explicitId)) {
        throw new Error(`duplicate explicit id "${explicitId}"`);
      }
      this.explicit.add(explicitId);
      return explicitId;
    }
    const n = (this.counters.get(kind) ?? 0) + 1;
    this.counters.set(kind, n);
    return `${kind}#${n}`;
  }

  handle<K extends string>(kind: K, explicitId?: Id): Handle<K> {
    return Object.freeze({ id: this.mint(kind, explicitId), kind });
  }

  snapshot(): IdCounters {
    return Object.fromEntries(this.counters);
  }
}
