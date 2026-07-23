/**
 * types.ts — the lesson layer's vocabulary: verb options, step payloads,
 * verdicts/experiments, morph routes, and the two structural protocols
 * (`MorphSubject.elements`, `VarySettable.setValue`, `BuildUpSubject.
 * buildUpGroups`) that let milestone-3 views and milestone-4 discipline
 * objects plug into the verbs without the verbs knowing their concrete types.
 *
 * Verdict/Experiment live HERE, not in core — they are authoring/choreography
 * vocabulary, not substrate (the spikes' api.ts files agree).
 */

import type { CorrespondenceEdge, Handle, Pace, Relation, TraceEvent } from '@math-ai/core';
import type { Formula, FormulaSpan } from './formula.js';

// ────────────────────────────── verdicts ──────────────────────────────

export type Polarity = 'accept' | 'reject' | 'neutral';

/** Polarity, not the label string, drives color/emphasis semantics. */
export interface Verdict {
  readonly label: string;
  readonly polarity: Polarity;
}

export interface Outcome<S extends Handle = Handle, R extends Handle = Handle> {
  readonly subject: S;
  readonly result: R;
  readonly verdict: Verdict;
}

export type Agreement = 'distinguished' | 'agree';

/** The immutable, provenance-carrying value `compareExperiment` derives. */
export interface Experiment<S extends Handle = Handle, R extends Handle = Handle>
  extends Handle<'experiment'> {
  readonly outcomes: readonly [Outcome<S, R>, Outcome<S, R>];
  readonly agreement: Agreement;
}

// ─────────────────────────── verb option types ───────────────────────────

/** Interpolations in `lesson.say` — handles become recorded live mentions. */
export type Mention = Handle | string | number;

export type EnterFrom = 'top' | 'left' | 'fade';

/** `stillness` emphasizes that a thing is NOT changing while its surroundings animate. */
export type Emphasis = 'disagreement' | 'agreement' | 'stillness';

export type Intensity = 'full' | 'ambient';

export type BuildUpOrder = 'row-by-row' | 'column-by-column' | 'cell-by-cell';

export type CompareLayout = 'side-by-side' | 'stacked';

export interface ShowOpts {
  readonly enterFrom?: EnterFrom;
  readonly fadeAfter?: string;
  readonly pace?: Pace;
}

export interface FocusOpts {
  readonly emphasize?: Emphasis;
  readonly pace?: Pace;
}

export interface MorphOpts {
  /** Morph is always identity-preserving; the literal keeps the author honest. */
  readonly preserveIdentity: true;
  readonly pace?: Pace;
}

export interface VaryOpts {
  readonly to: number;
  /** Duration hint for playback, e.g. "2s". */
  readonly over?: string;
  readonly pace?: Pace;
}

export interface ExposeOpts {
  readonly as: 'draggable' | 'sliders';
}

export interface DemonstrateOpts {
  readonly pace?: Pace;
  /** Loop until superseded (see `Lesson.supersederOf` for who cancels it). */
  readonly loop?: boolean;
  readonly intensity?: Intensity;
}

export interface CascadeOpts {
  readonly pace?: Pace;
}

export interface BuildUpOpts {
  readonly order: BuildUpOrder;
  readonly pace?: Pace;
  /** Explicit reveal groups, overriding the subject's own `buildUpGroups`. */
  readonly groups?: ReadonlyArray<readonly Handle[]>;
}

export interface CompareOpts<S extends Handle, R extends Handle> {
  readonly subjects: readonly [S, S];
  /**
   * ONE closure applied to both subjects through a core operation — the
   * sameness of the operation across subjects is the semantic content, and
   * running it inside an op is what makes both derivations replayable in
   * lockstep (`demonstrate(experiment)`). Must be pure: it may call other
   * operations and read reactive state, never mutate it.
   */
  readonly apply: (subject: S) => R;
  readonly judge: (result: R, subject: S) => Verdict;
  readonly layout?: CompareLayout;
}

// ─────────────────────────── structural protocols ───────────────────────────

/**
 * A LIVE value of any type: a handle whose `.value` is re-read, not stored.
 *
 * This is the reactive cell as a protocol. It was scalar-only for a long time
 * and three independent ledgers said the same thing about that (roadmap step
 * 3): a claim's boolean had to be special-cased, a field's geometry had to be
 * faked as plain closures with no memoization or dependency tracking, and an
 * eigen-decomposition had to be faked the same way. All three are `Live<T>`
 * for a non-numeric `T`.
 *
 * `world.derived<T>` in core was ALREADY generic — the scalar-only constraint
 * lived entirely in this protocol type and the library's single wrapper. So
 * this is a widening, not a new mechanism.
 */
export interface Live<T> extends Handle {
  readonly value: T;
}

/** Anything with a numeric value the timeline or the user can vary. */
export type NumericHandle = Live<number>;

/**
 * A numeric handle `vary` can advance at authoring time. `setValue` is the
 * raw, non-timeline mutation hook — the `vary` step itself is the timeline
 * record of the transition (one verb, one step). Library objects (matrix
 * cells, sliders) implement it, applying their interaction policy
 * (renormalize-row etc.) inside. Targets without it still get a declarative
 * `vary` step, flagged `applied: false` in the payload.
 */
export interface VarySettable extends NumericHandle {
  setValue(next: number): void;
  /**
   * Apply a value on the INTERACTION path: same policy (clamp, renormalize),
   * but no timeline step. A drag frame and a `vary` replay frame are not beats
   * of the explanation — recording them would grow the timeline the player is
   * walking. Implementors back this with `Slot.poke`. Optional: a target
   * without it is only advanced at authoring time.
   */
  setValueLive?(next: number): void;
}

/**
 * A morph endpoint. `elements` are the object handles the subject projects or
 * aggregates — the granularity at which morph legality is checked and routes
 * are produced. A subject without `elements` is its own single element.
 * Milestone-3 views expose the objects they project here.
 */
export interface MorphSubject extends Handle {
  readonly elements?: readonly Handle[];
}

/**
 * A composite `buildUp` can reveal in stages. Groups are subpart handles in
 * reveal order for the given traversal; milestone-3's table view implements
 * this (rows / columns / cells).
 */
export interface BuildUpSubject extends Handle {
  buildUpGroups?(order: BuildUpOrder): ReadonlyArray<readonly Handle[]>;
}

// ────────────────────────────── morph routes ──────────────────────────────

/**
 * One hop of a morph route: either a correspondence edge, or — for values
 * derived by `autoEdges: false` (hot-path) operations, which record no edges —
 * a provenance hop from a derived value to one of its operation inputs.
 */
export type MorphHop =
  | { readonly via: 'edge'; readonly edge: CorrespondenceEdge }
  | {
      readonly via: 'derivation';
      readonly operation: string;
      readonly value: Handle;
      readonly input: Handle;
    };

/** How one source element travels to its target element during a morph. */
export interface MorphRoute {
  readonly from: Handle;
  readonly to: Handle;
  /** Empty when `from` IS an element of the target (same identity). */
  readonly hops: readonly MorphHop[];
}

// ────────────────────────────── step payloads ──────────────────────────────
// The contract milestone 3's renderer consumes. Every verb's ActionStep
// carries exactly one of these under `payload`.

export interface SayPayload {
  /** The cooked template segments, `mentions.length + 1` of them. */
  readonly strings: readonly string[];
  readonly mentions: readonly Mention[];
}

/**
 * The step-boundary marker `lesson.beat` emits. Carries no subject and drives
 * no animation: it is a zero-duration signpost in the flat step stream that a
 * player segments on, so a student can navigate an explanation beat by beat.
 */
export interface BeatPayload {
  /** The outline title of the beat that starts here. */
  readonly title: string;
  /** 0-based position among the beats declared on this lesson. */
  readonly index: number;
}

export interface ShowPayload {
  readonly subject: Handle;
  readonly enterFrom?: EnterFrom;
  readonly fadeAfter?: string;
}

export interface HidePayload {
  readonly subject: Handle;
}

/**
 * `retire` — the object is done, permanently. Distinct from `hide`, and the
 * distinction only starts mattering in a conversation (roadmap step 4b):
 * `hide` is a beat saying "look away for a moment", and a later beat may show
 * the same thing again. `retire` says the object is out of the explanation for
 * good, so a later turn's scene manifest must not offer it as something to
 * reason about or drag. A renderer treats it as a hide it never undoes.
 */
export interface RetirePayload {
  readonly subject: Handle;
  /** Why, in the author's words — narratable, and it lands in the manifest. */
  readonly reason?: string;
}

/**
 * `replace` — this object stands in for that one, from here on.
 *
 * `hide` alone was too weak for a conversation: a turn that revises an earlier
 * turn needs the OLD object gone AND the correspondence recorded, or the
 * student sees two versions of the same idea with nothing saying which won.
 * The `counterpart-of` edge is minted by the verb, which is what keeps a
 * later `morph` between them legal.
 */
export interface ReplacePayload {
  readonly old: Handle;
  readonly next: Handle;
  readonly reason?: string;
}

export interface FocusPayload {
  readonly subjects: readonly Handle[];
  readonly emphasize?: Emphasis;
}

export interface MorphPayload {
  readonly from: MorphSubject;
  readonly to: MorphSubject;
  readonly routes: readonly MorphRoute[];
  readonly preserveIdentity: true;
}

export interface LinkPayload {
  readonly a: Handle;
  readonly targets: readonly Handle[];
  readonly rel: Relation;
  readonly edges: readonly CorrespondenceEdge[];
}

export interface VaryPayload {
  readonly target: NumericHandle;
  readonly from: number;
  readonly to: number;
  readonly over?: string;
  /** Whether the value was advanced at authoring time (target had `setValue`). */
  readonly applied: boolean;
}

export interface ExposePayload {
  readonly subject: Handle;
  readonly as: 'draggable' | 'sliders';
}

/**
 * A concrete interaction: drag `target` along the rail `along` (a plot's
 * x-axis subpart). Discipline libraries mint these; `lesson.enableInteraction`
 * puts one on the timeline and the renderer wires the pointer handlers.
 */
export interface Interaction extends Handle<'interaction'> {
  readonly mode: 'drag';
  readonly target: VarySettable;
  readonly along: Handle;
}

export interface EnableInteractionPayload {
  readonly interaction: Interaction;
}

/** One stage of a buildUp — the cascade iteration's single action step. */
export interface RevealPayload {
  readonly subject: Handle;
  readonly parts: readonly Handle[];
  readonly index: number;
  readonly order: BuildUpOrder;
}

/** One replayed trace event — demonstrate's cascade iterations carry these. */
export interface DemonstrateEventPayload {
  readonly subject: Handle;
  readonly event: TraceEvent;
  readonly index: number;
  readonly total: number;
  readonly intensity: Intensity;
}

export interface CompareExperimentPayload {
  readonly experiment: Experiment;
  readonly subjects: readonly [Handle, Handle];
  readonly layout: CompareLayout;
}

// ─────────────────────────── formula morphing ───────────────────────────
// The deferred `transformFormula` seam (spikes/ftc/FINDINGS.md, Δ3.2). A
// span-preserving formula-to-formula transition: roles present in BOTH
// formulas keep span identity (a `counterpart-of` edge bridges the two span
// handles, so a correspondence link on the `from` span survives onto the `to`
// span), roles only in `from` fade out, roles only in `to` fade in. This is
// the minimum the FTC ÷Δx turn needs — not a term-rewriting engine.

export interface FormulaMorphPair {
  readonly role: string;
  readonly from: FormulaSpan;
  readonly to: FormulaSpan;
  /** The `counterpart-of` edge bridging the two span handles' identity. */
  readonly edge: CorrespondenceEdge;
}

export interface TransformFormulaOpts {
  readonly pace?: Pace;
}

export interface TransformFormulaPayload {
  readonly from: Formula;
  readonly to: Formula;
  /** Roles in both formulas — identity preserved, routed corner-to-corner. */
  readonly preserved: readonly FormulaMorphPair[];
  /** Span handles only in `to` — fade in. */
  readonly entering: readonly FormulaSpan[];
  /** Span handles only in `from` — fade out. */
  readonly leaving: readonly FormulaSpan[];
}
