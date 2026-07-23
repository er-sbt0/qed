/**
 * structure.ts — the shared structural core under automata and graphs.
 *
 * Extracted by RETRODICTION (docs/object-layer.md step 3), not designed: when
 * `graph.ts` was written against `automata.ts`, exactly two things repeated
 * verbatim —
 *
 *   1. the throwing label-addressed accessor that lists what actually exists
 *      (`machine.state("EVEN")`, `graph.node("A")` — an unknown label is an
 *      authoring error, and the error message is the repair signal), and
 *   2. the reported-not-thrown diagnostics discipline: coherence problems in a
 *      derived structure become a diagnostics array on the value plus one
 *      console.warn summary, never an exception.
 *
 * Everything else the two share is *shape* (nodes/edges as handles, edge-tagged
 * trace events), which lives in how each library uses `defineOp`/`ctx.trace`,
 * not in code that could be moved here without inventing an abstraction neither
 * caller needs. Prob.states has the same lookup idiom with a different message;
 * it keeps its own until a third caller makes the message worth unifying.
 */

/** Find by predicate or throw `message` — the accessor contract, one line. */
export function findOr<T>(items: readonly T[], pred: (item: T) => boolean, message: () => string): T {
  const found = items.find(pred);
  if (!found) throw new Error(message());
  return found;
}

/**
 * Label-addressed lookup: `noun` is the sentence prefix, e.g.
 * `byLabel(states, label, "machine has no state")` throws
 * `machine has no state labeled "X" — available: EVEN, ODD`.
 */
export function byLabel<T extends { readonly label: string }>(
  items: readonly T[],
  label: string,
  noun: string,
): T {
  return findOr(
    items,
    (item) => item.label === label,
    () =>
      `${noun} labeled "${label}" — available: ` +
      (items.map((item) => item.label).join(', ') || '(none)'),
  );
}

/**
 * Diagnostics are the product, not a failure — surface them, keep going.
 * (The exact warn `stateMachine` always printed; `structureMap` now shares it.)
 */
export function reportDiagnostics(
  what: string,
  id: string,
  diagnostics: ReadonlyArray<{ readonly message: string }>,
): void {
  if (diagnostics.length === 0) return;
  // eslint-disable-next-line no-console
  console.warn(
    `${what} ${id}: ${diagnostics.length} diagnostic(s):\n` +
      diagnostics.map((d) => `  - ${d.message}`).join('\n'),
  );
}
