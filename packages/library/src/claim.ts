/**
 * claim.ts — the Claim: a live proposition about the scene.
 *
 * A lesson's actual content is propositions ("these two quantities are equal",
 * "this total is never beaten"), and until now those existed only as
 * typesetting plus a readout the student had to compare by eye. A Claim makes
 * the proposition an object: two live quantities, an asserted relation, and a
 * `status` that is RE-DERIVED like any other reactive value.
 *
 * That is what buys the pedagogy. Because `holds` re-reads its inputs, a
 * theorem is a claim whose status never flips no matter what the student
 * drags, and a conjecture is one that does — the drag that flips it IS the
 * counterexample, addressable and narratable. Nothing here computes
 * mathematics: the relation is a comparison, and the predicate form hands the
 * whole judgement to an LLM-authored closure, which is the engine's standing
 * division of labour.
 *
 * The verdict is the library's first non-numeric live value, and it is no
 * longer special-cased: `verdict` is a real `Live<Verdict>` from live.ts, and
 * `holds`/`status` are thin reads of it. It was the first of the three
 * ledger entries that got `Live<T>` extracted (roadmap step 3) — the
 * generalization came out of this evidence rather than ahead of it.
 */

import type { Handle, World } from '@math-ai/core';
import type { Live, NumericHandle, Verdict } from '@math-ai/lesson';
import { constNumber, derivedNumber, numOf } from './numeric.js';
import type { LabeledNumber } from './numeric.js';
import { live } from './live.js';

/** The relations a claim can assert. `≈` is `=` with a loose default tolerance. */
export type ClaimRelation = '=' | '≈' | '<' | '<=' | '>' | '>=';

/**
 * WHAT KIND of thing the verdict is — because they are not the same kind of
 * thing, and presenting them as one is a lie the student cannot detect.
 *
 *  - `exact-comparison` — the engine compared two live numbers under a
 *    relation, with no slack. The verdict is as good as the numbers.
 *  - `sampled` — the same, but the claim asserts agreement WITHIN A TOLERANCE
 *    (`≈`, or an explicit one). It holding is numerical agreement at the
 *    current state, not a proof, and a tighter tolerance could break it.
 *  - `authored-predicate` — the judgement is an LLM-authored closure. The
 *    engine ran it; it did not check it. This is the engine's standing
 *    division of labour and also its standing caveat.
 *
 * Roadmap step 4a needs this: once a scene manifest is sent to a model to
 * answer questions about the scene, an unlabeled `holds: true` invites the
 * model to call a predicate's opinion a proof.
 */
export type ClaimEvidence = 'exact-comparison' | 'sampled' | 'authored-predicate';

export interface Claim extends Handle<'claim'> {
  readonly label?: string;
  /** The two-sided form's parts; absent when the claim is a predicate. */
  readonly lhs?: NumericHandle;
  readonly rhs?: NumericHandle;
  readonly relation?: ClaimRelation;
  readonly tolerance: number;
  /** Live: `lhs − rhs`. Two-sided form only. */
  readonly gap?: LabeledNumber;
  /** Live: does the claim hold at the CURRENT state of the scene? */
  readonly holds: boolean;
  /** Live: `holds` as a colorable badge — polarity drives the color. */
  readonly status: Verdict;
  /** How the verdict was reached — never presented as if all three were equal. */
  readonly evidence: ClaimEvidence;
  /**
   * The verdict as a HANDLE, not a snapshot — a `Live<Verdict>`.
   *
   * `holds` and `status` above are getters, which is fine for a program
   * reading them but leaves nothing for a view to subscribe to or a
   * correspondence to point at. This is that thing, and it is the library's
   * first live non-scalar to exist as a first-class value rather than a
   * special case (roadmap step 3).
   */
  readonly verdict: Live<Verdict>;
}

export interface ClaimSides {
  readonly lhs: number | NumericHandle;
  readonly rhs: number | NumericHandle;
  /** Default `=`. */
  readonly relation?: ClaimRelation;
  /** Slack allowed before the claim reads as broken. Default 1e-9, or 0.01 for `≈`. */
  readonly tolerance?: number;
  readonly label?: string;
}

export interface ClaimPredicate {
  /** Judged by a closure — the LLM writes the semantics, the engine re-runs it. */
  readonly predicate: () => boolean;
  readonly label?: string;
}

export type ClaimOpts = ClaimSides | ClaimPredicate;

const HOLDS: Verdict = Object.freeze({ label: 'holds', polarity: 'accept' as const });
const BROKEN: Verdict = Object.freeze({ label: 'broken', polarity: 'reject' as const });

function isPredicateForm(o: ClaimOpts): o is ClaimPredicate {
  return typeof (o as ClaimPredicate).predicate === 'function';
}

/**
 * A claim compares LIVE quantities, so a snapshot silently freezes it — the
 * badge would then say "holds" forever regardless of what the student does,
 * which is the exact opposite of the point. Same trap `View.readout` guards.
 */
function assertComparable(x: number | NumericHandle, where: string): void {
  if (typeof x === 'number') return;
  if (x == null || typeof (x as { value?: unknown }).value !== 'number') {
    throw new Error(
      `${where} needs a number or a LIVE numeric handle with a numeric .value — got ${String(x)}. ` +
        `Fn.at(x) and Accumulation.at(u) return snapshots, not handles; a claim built from one can ` +
        `never break, so it proves nothing. Pass a Parameter, a M.derived(...), or a live quantity ` +
        `like A.slopeAt(x) / tree.totalWeight.`,
    );
  }
}

function compare(relation: ClaimRelation, d: number, tol: number): boolean {
  switch (relation) {
    case '=':
    case '≈':
      return Math.abs(d) <= tol;
    case '<=':
      return d <= tol;
    case '<':
      return d < -tol;
    case '>=':
      return d >= -tol;
    case '>':
      return d > tol;
  }
}

function asHandle(world: World, x: number | NumericHandle): NumericHandle {
  return typeof x === 'number' ? constNumber(world, x) : x;
}

/**
 * The live verdict. `equals` compares the two frozen singletons by identity,
 * so a dependent only invalidates when the claim actually FLIPS — not on
 * every drag frame that leaves it holding.
 */
function verdictOf(world: World, holds: () => boolean): Live<Verdict> {
  return live<Verdict>(world, () => (holds() ? HOLDS : BROKEN), {
    kind: 'verdict',
    equals: (a, b) => a === b,
  });
}

export function createClaim(world: World, opts: ClaimOpts): Claim {
  const base = world.handle('claim');

  if (isPredicateForm(opts)) {
    const verdict = verdictOf(world, () => opts.predicate() === true);
    return Object.freeze({
      id: base.id,
      kind: 'claim' as const,
      label: opts.label,
      tolerance: 0,
      evidence: 'authored-predicate' as const,
      verdict,
      get holds(): boolean {
        return verdict.value.polarity === 'accept';
      },
      get status(): Verdict {
        return verdict.value;
      },
    });
  }

  assertComparable(opts.lhs, 'M.claim({ lhs })');
  assertComparable(opts.rhs, 'M.claim({ rhs })');

  const relation: ClaimRelation = opts.relation ?? '=';
  const tolerance = opts.tolerance ?? (relation === '≈' ? 0.01 : 1e-9);
  const lhs = asHandle(world, opts.lhs);
  const rhs = asHandle(world, opts.rhs);
  const gap = derivedNumber(world, () => numOf(lhs) - numOf(rhs), 'gap');
  const verdict = verdictOf(world, () => compare(relation, gap.value, tolerance));

  return Object.freeze({
    id: base.id,
    kind: 'claim' as const,
    label: opts.label,
    lhs,
    rhs,
    relation,
    tolerance,
    // `≈` and any hand-set slack are numerical agreement, not exactness. The
    // default 1e-9 on `=` is float hygiene rather than asserted slack, so it
    // does not demote the claim.
    evidence: (opts.tolerance !== undefined || relation === '≈'
      ? 'sampled'
      : 'exact-comparison') as ClaimEvidence,
    gap,
    verdict,
    get holds(): boolean {
      return verdict.value.polarity === 'accept';
    },
    get status(): Verdict {
      return verdict.value;
    },
  });
}
