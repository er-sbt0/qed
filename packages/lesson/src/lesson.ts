/**
 * lesson.ts — milestone 2: the 13 kernel verbs as timeline-step operations
 * over `@math-ai/core`.
 *
 *   say · show · hide · retire · replace · focus · morph · link · vary · expose
 *   cascade · parallel · buildUp · demonstrate · compareExperiment
 *
 * Verbs enqueue steps in call order (implicit sequence); nothing here renders.
 * Each verb's job is a *correct step payload* (see types.ts) that milestone
 * 3's renderer consumes — plus the three pieces of real machinery this layer
 * owns: morph legality/routing (morph.ts), provenance-trace replay
 * (`demonstrate`), and lockstep comparison (`compareExperiment`).
 *
 * Conventions this layer fixes (resolving milestone 1's open questions):
 *
 * 1. **Per-subpart demonstrate.** Trace events may carry a reserved
 *    `subject: Handle` field naming the subpart they narrate. `demonstrate(h)`
 *    uses only the events tagged with `h`'s id when any exist, and the whole
 *    trace otherwise — so `demonstrate(oneEdge)` replays just that edge's
 *    derivation out of the whole construction, and `demonstrate(machine)`
 *    replays everything.
 *
 * 2. **Morph vs `autoEdges: false`.** Hot-path values are invisible to pure
 *    correspondence reachability; morph falls back to their provenance
 *    records, routing through derivation hops (see morph.ts).
 *
 * 3. **Loop supersession.** `LoopStep.times === undefined` means "until
 *    superseded". The superseder is the next *animating* step (not `say`, not
 *    `link` — annotation accompanies ambient motion, it doesn't end it)
 *    enqueued through the lesson that references the loop's subject by
 *    handle id. The lesson records the pairing queryably
 *    (`supersederOf(loop)`); a renderer may additionally stop still-open
 *    ambient loops when their subject leaves the stage.
 */

import { isHandle } from '@math-ai/core';
import type {
  CascadeStep,
  Handle,
  Id,
  LoopStep,
  Operation,
  ParallelStep,
  Relation,
  Step,
  StepOpts,
  TraceEvent,
  World,
} from '@math-ai/core';
import { checkMorph, illegalMorphError } from './morph.js';
import type { Formula } from './formula.js';
import type {
  Agreement,
  BeatPayload,
  BuildUpOpts,
  BuildUpSubject,
  CascadeOpts,
  CompareExperimentPayload,
  CompareOpts,
  DemonstrateEventPayload,
  DemonstrateOpts,
  Experiment,
  EnableInteractionPayload,
  ExposeOpts,
  ExposePayload,
  FocusOpts,
  FocusPayload,
  HidePayload,
  RetirePayload,
  ReplacePayload,
  Interaction,
  LinkPayload,
  Mention,
  MorphOpts,
  MorphPayload,
  MorphSubject,
  NumericHandle,
  Outcome,
  RevealPayload,
  SayPayload,
  ShowOpts,
  ShowPayload,
  TransformFormulaOpts,
  TransformFormulaPayload,
  FormulaMorphPair,
  VaryOpts,
  VaryPayload,
  Verdict,
} from './types.js';

type AnyApply = (subject: Handle) => Handle;
type AnyJudge = (result: Handle, subject: Handle) => Verdict;

interface VarySettableLike extends NumericHandle {
  setValue(next: number): void;
}

function canSetValue(target: NumericHandle): target is VarySettableLike {
  return typeof (target as { setValue?: unknown }).setValue === 'function';
}

function sameVerdict(a: Verdict, b: Verdict): boolean {
  return a.label === b.label && a.polarity === b.polarity;
}

/** One lesson per world — the compare op registers a world-unique name. */
const lessoned = new WeakSet<World>();

export class Lesson {
  private readonly compareOp: Operation<[AnyApply, AnyJudge, Handle, Handle], Experiment>;
  /** Open-ended loops awaiting supersession, newest last. */
  private readonly openLoops: Array<{ readonly loop: LoopStep; readonly subject: Handle }> = [];
  private readonly supersessions = new Map<Id, Id>();
  /** Beats declared so far — the 0-based `index` each `beat` marker carries. */
  private beatCount = 0;

  constructor(readonly world: World) {
    if (lessoned.has(world)) {
      throw new Error('createLesson: this world already has a lesson — one lesson per world');
    }
    lessoned.add(world);
    this.compareOp = world.defineOp(
      'lesson:compare',
      (ctx, apply: AnyApply, judge: AnyJudge, a: Handle, b: Handle): Experiment => {
        // Both derivations run through this ONE op body, so a single
        // world.trace(experiment) replays them in lockstep: apply side 0,
        // apply side 1 (each with its nested ops' events), then the verdicts.
        const resultA = apply(a);
        ctx.trace({ type: 'compare:apply', side: 0, subject: a, result: resultA });
        const resultB = apply(b);
        ctx.trace({ type: 'compare:apply', side: 1, subject: b, result: resultB });
        const verdictA = judge(resultA, a);
        ctx.trace({ type: 'compare:judge', side: 0, subject: a, verdict: verdictA });
        const verdictB = judge(resultB, b);
        ctx.trace({ type: 'compare:judge', side: 1, subject: b, verdict: verdictB });
        const agreement: Agreement = sameVerdict(verdictA, verdictB) ? 'agree' : 'distinguished';
        const outcomes = Object.freeze([
          Object.freeze({ subject: a, result: resultA, verdict: verdictA }),
          Object.freeze({ subject: b, result: resultB, verdict: verdictB }),
        ]) as readonly [Outcome, Outcome];
        return ctx.value('experiment', { outcomes, agreement });
      },
    );
  }

  // ───────────────────────────── narration ─────────────────────────────

  /**
   * Narration is a view: interpolated handles become recorded mentions —
   * `represents` correspondence edges from the narration step to each object.
   */
  say(strings: TemplateStringsArray, ...mentions: readonly Mention[]): Step {
    const payload: SayPayload = {
      strings: Object.freeze([...strings]),
      mentions: Object.freeze([...mentions]),
    };
    const step = this.world.timeline.step('say', payload);
    for (const mention of mentions) {
      if (isHandle(mention)) this.world.graph.link(step, mention, 'represents', 'construction');
    }
    return step; // annotation: never supersedes an ambient loop
  }

  // ─────────────────────────── step boundaries ───────────────────────────

  /**
   * Mark the start of a step boundary — one beat of the planner's outline.
   *
   * A beat is a MARKER, not a container: it is an ordinary `ActionStep` sitting
   * flat among its siblings, so `timeline.root` stays flat and every existing
   * walker over it keeps working untouched. (The core timeline's container
   * stack only nests builders taking a callback, and `beat` is called flat
   * between statements.) Segmentation is a playback concern: a player slices
   * the step stream at these markers; nothing here changes what is authored
   * between them.
   *
   * Like `say` and `link` this is annotation-class w.r.t. loop supersession —
   * it deliberately does NOT call `noteAnimatingStep`. Parking the student at a
   * boundary must not kill an open-ended `demonstrate({ loop: true })`: the
   * ambient motion keeps running while they read the beat and decide to go on.
   */
  beat(title: string): Step {
    const payload: BeatPayload = { title, index: this.beatCount };
    this.beatCount += 1;
    return this.world.timeline.step('beat', payload); // marker: never supersedes
  }

  // ──────────────────────── presence and attention ────────────────────────

  show(subject: Handle, opts?: ShowOpts): Step {
    const payload: ShowPayload = { subject, enterFrom: opts?.enterFrom, fadeAfter: opts?.fadeAfter };
    const step = this.world.timeline.step('show', payload, { pace: opts?.pace });
    this.noteAnimatingStep(step, [subject]);
    return step;
  }

  hide(subject: Handle): Step {
    const payload: HidePayload = { subject };
    const step = this.world.timeline.step('hide', payload);
    this.noteAnimatingStep(step, [subject]);
    return step;
  }

  /**
   * Retire an object: gone for good, not merely off screen this beat.
   *
   * Authoring a lesson linearly, `hide` was enough — nothing came back to ask
   * what was still part of the explanation. A conversation does exactly that
   * on every turn (the scene manifest is built from what is still live), so
   * "temporarily not shown" and "no longer part of this" had to stop being the
   * same step. See RetirePayload.
   */
  retire(subject: Handle, opts?: { readonly reason?: string }): Step {
    const payload: RetirePayload = { subject, reason: opts?.reason };
    const step = this.world.timeline.step('retire', payload);
    this.noteAnimatingStep(step, [subject]);
    return step;
  }

  /**
   * Replace `old` with `next`: retire the old one and record that the new one
   * is its counterpart, in ONE step.
   *
   * The edge is minted here rather than left to the author because forgetting
   * it is silent and expensive — a later `morph(old, next)` would be rejected
   * as illegal, and the manifest would describe two unrelated objects where
   * the student sees a revision.
   */
  replace(old: Handle, next: Handle, opts?: { readonly reason?: string }): Step {
    this.world.link(next, old, 'counterpart-of');
    const payload: ReplacePayload = { old, next, reason: opts?.reason };
    const step = this.world.timeline.step('replace', payload);
    this.noteAnimatingStep(step, [old, next]);
    return step;
  }

  focus(subject: Handle | readonly Handle[], opts?: FocusOpts): Step {
    const subjects = Object.freeze(Array.isArray(subject) ? [...subject] : [subject as Handle]);
    const payload: FocusPayload = { subjects, emphasize: opts?.emphasize };
    const step = this.world.timeline.step('focus', payload, { pace: opts?.pace });
    this.noteAnimatingStep(step, subjects);
    return step;
  }

  // ────────────────────────────── morph ──────────────────────────────

  /**
   * Identity-preserving representation change. Legal iff every element of
   * `from` reaches an element of `to` through the correspondence graph
   * (provenance-derived routes included — see morph.ts); the payload carries
   * the per-element routes the animation travels.
   */
  morph(from: MorphSubject, to: MorphSubject, opts: MorphOpts): Step {
    const { routes, unreachable } = checkMorph(this.world, from, to);
    if (unreachable.length > 0) throw illegalMorphError(from, to, unreachable);
    const payload: MorphPayload = {
      from,
      to,
      routes: Object.freeze(routes),
      preserveIdentity: opts.preserveIdentity,
    };
    const step = this.world.timeline.step('morph', payload, { pace: opts.pace });
    this.noteAnimatingStep(step, [from, to]);
    return step;
  }

  // ─────────────────────────── formula morphing ───────────────────────────

  /**
   * The deferred `transformFormula` seam, span-scoped (spikes/ftc/FINDINGS.md
   * Δ3.2): a span-preserving formula-to-formula transition. Roles present in
   * BOTH formulas keep their identity — a `counterpart-of` edge bridges the two
   * span handles, so a `link` on either span resonates onto the other and the
   * highlight/correspondence survives the morph (the FTC `f(x)` that divides
   * across keeps pointing at the strip height). Roles only in `from` fade out;
   * roles only in `to` fade in. Legal iff the two formulas share ≥1 role —
   * otherwise there is nothing to preserve, so author `hide`/`show` instead.
   */
  transformFormula(from: Formula, to: Formula, opts?: TransformFormulaOpts): Step {
    const shared = from.roles.filter((role) => to.roles.includes(role));
    if (shared.length === 0) {
      throw new Error(
        `transformFormula(${from.id} → ${to.id}) is illegal: the two formulas share no span ` +
          `role, so there is nothing to preserve across the morph. from roles: ` +
          `[${from.roles.join(', ') || '(none)'}]; to roles: [${to.roles.join(', ') || '(none)'}]. ` +
          `Name at least one common role (F.span("dx", ...) in both), or use hide/show for an ` +
          `unrelated replacement.`,
      );
    }
    const preserved: FormulaMorphPair[] = shared.map((role) => {
      const fromSpan = from.span(role);
      const toSpan = to.span(role);
      // bridge the two span handles' identity so links survive the transition
      const edge = this.world.graph.record(fromSpan, toSpan, 'counterpart-of', 'construction');
      return { role, from: fromSpan, to: toSpan, edge };
    });
    const entering = to.roles.filter((role) => !from.roles.includes(role)).map((role) => to.span(role));
    const leaving = from.roles.filter((role) => !to.roles.includes(role)).map((role) => from.span(role));
    const payload: TransformFormulaPayload = { from, to, preserved, entering, leaving };
    const step = this.world.timeline.step('transformFormula', payload, { pace: opts?.pace });
    this.noteAnimatingStep(step, [from, to]);
    return step;
  }

  // ────────────────────────────── linking ──────────────────────────────

  /** Author correspondence edges (the minority case — most are recorded by construction). */
  link(a: Handle, b: Handle | readonly Handle[], rel: Relation): Step {
    const targets = Object.freeze(Array.isArray(b) ? [...b] : [b as Handle]);
    const edges = this.world.link(a, targets, rel);
    const payload: LinkPayload = { a, targets, rel, edges };
    return this.world.timeline.step('link', payload); // annotation: never supersedes
  }

  // ─────────────────────────── vary / expose ───────────────────────────

  /**
   * Animate a numeric handle to a target value. When the target implements
   * `setValue` (the `VarySettable` protocol) the value advances immediately,
   * so later authoring-time derivations read the post-vary state; the step is
   * the timeline record of the transition either way.
   */
  vary(target: NumericHandle, opts: VaryOpts): Step {
    const from = target.value;
    const applied = canSetValue(target);
    if (applied) target.setValue(opts.to);
    const payload: VaryPayload = { target, from, to: opts.to, over: opts.over, applied };
    const step = this.world.timeline.step('vary', payload, { pace: opts.pace });
    this.noteAnimatingStep(step, [target]);
    return step;
  }

  /**
   * Hand a view/object to the user: bind its interactive affordances in the
   * step payload. Interaction *policy* (what a drag keeps invariant) lives on
   * the semantic object, not here.
   */
  expose(subject: Handle, opts: ExposeOpts): Step {
    const payload: ExposePayload = { subject, as: opts.as };
    const step = this.world.timeline.step('expose', payload);
    this.noteAnimatingStep(step, [subject]);
    return step;
  }

  /**
   * Wire a CONCRETE interaction built by a discipline library — the rail a
   * parameter is dragged along, say. `expose` declares that an object is the
   * user's to touch; this says how. The pair is deliberate: `expose` alone is
   * enough wherever the view already owns an affordance (a matrix cell knows
   * it is draggable), and a continuous parameter needs a rail to move on.
   */
  enableInteraction(interaction: Interaction): Step {
    const payload: EnableInteractionPayload = { interaction };
    const step = this.world.timeline.step('enableInteraction', payload);
    this.noteAnimatingStep(step, [interaction.target, interaction.along]);
    return step;
  }

  // ────────────────────────────── grouping ──────────────────────────────

  /** Paced per-item iteration — thin over the core timeline's cascade. */
  cascade<T>(items: readonly T[], per: (item: T, index: number) => void, opts?: CascadeOpts): CascadeStep {
    return this.world.timeline.cascade(items, per, { pace: opts?.pace });
  }

  /** Steps enqueued inside `build` run concurrently — thin over the core timeline. */
  parallel(build: () => void): ParallelStep {
    return this.world.timeline.parallel(build);
  }

  /**
   * Reveal an already-shown composite one region at a time: a cascade with
   * one `reveal` step per group. Groups come from `opts.groups` or the
   * subject's `buildUpGroups(order)` (milestone-3 views implement it).
   */
  buildUp(subject: BuildUpSubject, opts: BuildUpOpts): CascadeStep {
    const groups = opts.groups ?? subject.buildUpGroups?.(opts.order);
    if (!groups) {
      throw new Error(
        `buildUp(${subject.id} (${subject.kind})) has no subparts to reveal: the subject does ` +
          `not implement buildUpGroups("${opts.order}") and no explicit groups were passed. ` +
          `Implement the BuildUpSubject protocol on the view, or pass { groups: [...] }.`,
      );
    }
    const step = this.world.timeline.cascade(
      groups,
      (parts, index) => {
        const payload: RevealPayload = { subject, parts, index, order: opts.order };
        this.world.timeline.step('reveal', payload);
      },
      { pace: opts.pace },
    );
    this.noteAnimatingStep(step, [subject]);
    return step;
  }

  // ──────────────────────────── demonstrate ────────────────────────────

  /**
   * Replay a derived value's provenance trace as choreography: one cascade
   * iteration per trace event (re-derived lazily via `world.trace`). With
   * `loop: true` the cascade nests in an open-ended `LoopStep` that runs
   * until superseded.
   */
  demonstrate(subject: Handle, opts?: DemonstrateOpts): Step {
    if (!this.world.provenanceOf(subject)) {
      throw new Error(
        `demonstrate(${subject.id} (${subject.kind})) requires a derived value: it carries no ` +
          `provenance record, so there is no derivation to replay. Only values created by an ` +
          `operation (ctx.value) can be demonstrated.`,
      );
    }
    const all = this.world.trace(subject);
    const own = all.filter((e) => isHandle(e['subject']) && (e['subject'] as Handle).id === subject.id);
    const events: readonly TraceEvent[] = own.length > 0 ? own : all;
    const intensity = opts?.intensity ?? 'full';
    const stepOpts: StepOpts = { pace: opts?.pace };

    const emit = (): CascadeStep =>
      this.world.timeline.cascade(
        events,
        (event, index) => {
          const payload: DemonstrateEventPayload = {
            subject,
            event,
            index,
            total: events.length,
            intensity,
          };
          this.world.timeline.step('demonstrate:event', payload);
        },
        stepOpts,
      );

    if (opts?.loop) {
      const loop = this.world.timeline.loop(() => void emit(), stepOpts); // times: undefined — until superseded
      this.noteAnimatingStep(loop, [subject]);
      this.openLoops.push({ loop, subject });
      return loop;
    }
    const cascade = emit();
    this.noteAnimatingStep(cascade, [subject]);
    return cascade;
  }

  // ────────────────────────── compareExperiment ──────────────────────────

  /**
   * Apply one operation to two subjects in synchronized parallel, judge both
   * outcomes, badge the verdicts. Runs through a core op so the whole
   * comparison — both derivations, in lockstep — is one provenance-carrying
   * value: `demonstrate(experiment)` replays it.
   */
  compareExperiment<S extends Handle, R extends Handle>(opts: CompareOpts<S, R>): Experiment<S, R> {
    const [a, b] = opts.subjects;
    const experiment = this.compareOp(
      opts.apply as unknown as AnyApply,
      opts.judge as unknown as AnyJudge,
      a,
      b,
    ) as Experiment<S, R>;
    const payload: CompareExperimentPayload = {
      experiment,
      subjects: opts.subjects,
      layout: opts.layout ?? 'side-by-side',
    };
    const step = this.world.timeline.step('compareExperiment', payload);
    this.noteAnimatingStep(step, [a, b, experiment]);
    return experiment;
  }

  // ─────────────────────────── loop supersession ───────────────────────────

  /** The id of the step that superseded an open-ended loop, if any yet. */
  supersederOf(loop: Step): Id | undefined {
    return this.supersessions.get(loop.id);
  }

  /** Open-ended loops not yet superseded, oldest first. */
  get ambientLoops(): readonly LoopStep[] {
    return this.openLoops.map((entry) => entry.loop);
  }

  /**
   * Animating steps referencing an open loop's subject supersede that loop.
   * (`say` and `link` are annotation and never call this.)
   */
  private noteAnimatingStep(step: Handle<'step'>, referenced: readonly Handle[]): void {
    if (this.openLoops.length === 0) return;
    const ids = new Set(referenced.map((h) => h.id));
    for (let i = this.openLoops.length - 1; i >= 0; i -= 1) {
      const entry = this.openLoops[i]!;
      if (entry.loop.id === step.id || !ids.has(entry.subject.id)) continue;
      this.supersessions.set(entry.loop.id, step.id);
      this.openLoops.splice(i, 1);
    }
  }
}

/** The `lesson.*` authoring surface of the spikes, bound to a world. */
export function createLesson(world: World): Lesson {
  return new Lesson(world);
}
