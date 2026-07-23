/**
 * player.ts — walks the timeline and executes steps as animation, one
 * navigable SEGMENT at a time.
 *
 * The program already RAN (authoring time): every slot/collection mutation is
 * applied, every payload is baked. The player replays the timeline against
 * the stage: verbs animate views, reactive-mutation steps trigger the delta
 * animations views queued when they observed the mutation (keyed by step id),
 * `demonstrate:event` steps replay the standard trace-event vocabulary
 * (events.ts), morph travels the routed correspondence paths, cascades pace
 * slow→fast, parallel groups run concurrently, and open-ended loops run
 * ambiently until superseded.
 *
 * ── the playback model ──────────────────────────────────────────────────
 *
 * `timeline.root` is cut at `beat` markers into segments (segments.ts): one
 * beat of the explanation each, plus an implicit untitled prologue for
 * anything authored before the first marker. An unmarked timeline is one
 * segment, which is exactly the old behaviour.
 *
 * PLAYBACK PAUSES AT EVERY BOUNDARY. `next()` plays one segment and resolves
 * when its animations have finished; nothing else happens until the caller
 * asks again. `play()` is the straight-through entry point (it just runs
 * `next()` to exhaustion) and keeps its old contract for every existing
 * caller (the demo page, the parity harnesses, the web canvas).
 *
 * SEEKING IS FORWARD-ONLY, because a timeline replay is not invertible: many
 * steps (a morph, a buildUp reveal, a derivation flow) have no inverse, and
 * `vary` writes through to live program state. Going BACKWARD is the caller's
 * job and means: build a fresh world, re-author the program, then
 * `seek(index)` on the new player — which fast-forwards segments 0..index-1
 * with animation SKIPPED and plays segment `index` normally.
 *
 * FAST-FORWARD ("instant mode") still EXECUTES every step: views mount, state
 * advances, reveals un-hide, classes land. Only time is removed —
 * `ms()` returns 0 and animate.ts treats `ms <= 0` as "final state, now"
 * (see its header). It is not a large `speed` divisor: `ms()` floors real
 * playback at 24ms on purpose, and travelers/tweens must be skipped
 * outright, not merely shortened.
 *
 * AMBIENT LOOPS KEEP RUNNING AT A BOUNDARY — the picture breathes while the
 * student reads. They are stopped only by supersession or by `stopAmbient()`
 * (teardown). During a fast-forward no loop driver is started at all (its
 * `wait` would be zero — a tight loop); surviving loops are started once the
 * fast-forward ends, so a loop whose superseder was among the skipped steps
 * never runs, and one whose superseder never fired is running on arrival.
 *
 * Supersession at playback: an ambient loop stops when (a) the step the
 * lesson recorded as its superseder starts (`lesson.supersederOf`), (b) a
 * `slot:set`/`collection:add` step provenance-connected to the loop's subject
 * starts (the renderer-level decision — see supersede.ts), or (c) the loop's
 * subject is hidden.
 *
 * `init()` runs the once-per-authoring-pass preparation — the buildUp reveal
 * prescan and `rewindVariedParameters` — before ANY segment plays, whichever
 * entry point started playback.
 */

import { isHandle } from '@math-ai/core';
import type {
  ActionStep,
  CascadeStep,
  Handle,
  Id,
  LoopStep,
  TimelineNode,
  TraceEvent,
} from '@math-ai/core';
import type {
  CompareExperimentPayload,
  DemonstrateEventPayload,
  EnableInteractionPayload,
  ExposePayload,
  FocusPayload,
  HidePayload,
  RetirePayload,
  ReplacePayload,
  Intensity,
  Lesson,
  LinkPayload,
  MorphPayload,
  RevealPayload,
  SayPayload,
  ShowPayload,
  TransformFormulaPayload,
  VaryPayload,
  VarySettable,
} from '@math-ai/lesson';
import { enter, exit, pulse, settled, travel, tweenNumber, wait } from './animate.js';
import { interpretEvent } from './events.js';
import type { AnimationCue, HandleRef } from './events.js';
import { cascadeDurations, paceMs, parseOver } from './pacing.js';
import { splitIntoSegments } from './segments.js';
import type { Segment } from './segments.js';
import type { Stage } from './stage.js';
import type { View } from './view.js';
import { stepSupersedesLoop } from './supersede.js';
import { ExperimentView } from './views/experiment.js';
import { FormulaView } from './views/formulaView.js';
import { appendNarration } from './views/narration.js';

interface AmbientEntry {
  readonly loop: LoopStep;
  readonly subject: Handle | null;
  stopped: boolean;
}

/**
 * Where playback stands.
 *
 *   idle     — nothing played yet.
 *   playing  — a segment's animations are in flight.
 *   seeking  — segments are being fast-forwarded (no time passing).
 *   paused   — parked at a beat boundary, waiting to be told to continue.
 *              Ambient loops may still be animating.
 *   done     — the last segment finished; ambient loops may still run.
 */
export type PlayerStatus = 'idle' | 'playing' | 'seeking' | 'paused' | 'done';

/** Emitted as playback enters and leaves each segment. */
export interface SegmentEvent {
  readonly phase: 'start' | 'end';
  readonly index: number;
  readonly title: string | undefined;
  readonly total: number;
  /** True while fast-forwarding (this segment is being skipped, not shown). */
  readonly instant: boolean;
}

export interface PlayerOpts {
  /** Time divisor: 2 halves every duration. */
  readonly speed?: number;
  /** Observation hook (verification, debugging). */
  onStep?(node: TimelineNode): void;
  /** Segment boundary hook — drives a beat navigator. */
  onSegment?(event: SegmentEvent): void;
}

export class Player {
  private readonly ambient: AmbientEntry[] = [];
  /** Loops started while fast-forwarding; driven once the fast-forward ends. */
  private readonly deferredAmbient: AmbientEntry[] = [];
  /** reveal-part id → buildUp subject id, for parts not yet revealed. */
  private readonly pendingReveals = new Map<Id, Id>();

  /** The beat-cut timeline. Authoring is finished before a player is made. */
  readonly segments: readonly Segment[];

  private initialized = false;
  /** Index of the segment last started; -1 before the first one. */
  private cursor = -1;
  private state: PlayerStatus = 'idle';
  /** The segment currently running, if any — `next()`/`seek()` await it. */
  private inFlight: Promise<void> | null = null;
  /** Time is suppressed: steps execute, no animation plays. */
  private instant = false;

  constructor(
    private readonly stage: Stage,
    private readonly lesson: Lesson,
    private readonly opts: PlayerOpts = {},
  ) {
    this.segments = splitIntoSegments(stage.world.timeline.root);
  }

  // ───────────────────────── navigation surface ─────────────────────────

  /** How many navigable beats this lesson has (always ≥ 1). */
  get segmentCount(): number {
    return this.segments.length;
  }

  /** The segment being played or parked at; -1 before playback starts. */
  get segmentIndex(): number {
    return this.cursor;
  }

  /** Beat titles in order; the implicit prologue reads as `undefined`. */
  get titles(): readonly (string | undefined)[] {
    return this.segments.map((s) => s.title);
  }

  get status(): PlayerStatus {
    return this.state;
  }

  /** Whether a segment's animation is in flight (vs parked at a boundary). */
  get isAnimating(): boolean {
    return this.inFlight !== null;
  }

  /** Whether the last segment has been played. */
  get atEnd(): boolean {
    return this.cursor >= this.segments.length - 1;
  }

  /** Resolves when the in-flight segment (if any) has finished animating. */
  async settledAt(): Promise<void> {
    while (this.inFlight) await this.inFlight;
  }

  /**
   * The once-per-authoring-pass preparation, idempotent and shared by every
   * entry point: pre-scan the whole timeline for buildUp reveals so their
   * parts can be pre-hidden the moment their view mounts (a shown-then-built-up
   * table must never flash fully populated — M3 Q5), then rewind the varied
   * parameters. Both must happen before ANY segment plays, including a
   * segment that is only being fast-forwarded.
   */
  init(): void {
    if (this.initialized) return;
    this.initialized = true;
    this.scanReveals(this.stage.world.timeline.root);
    this.rewindVariedParameters();
  }

  /**
   * Play the whole timeline straight through, ignoring beat boundaries.
   * The original entry point, unchanged in contract: resolves when the last
   * segment's animations finish; ambient loops keep running after that.
   */
  async play(): Promise<void> {
    this.init();
    while (await this.next());
  }

  /**
   * Play the next segment and stop at its boundary. Resolves when that
   * segment's animations have finished. Returns false when there was no next
   * segment (playback is done).
   *
   * Called while a segment is still animating, it QUEUES behind it rather than
   * interrupting — a beat is the unit of playback, and cutting one off would
   * leave the stage mid-morph. A UI that wants "skip ahead" should disable its
   * button while `isAnimating`, or simply let the calls queue.
   */
  async next(): Promise<boolean> {
    this.init();
    await this.settledAt();
    if (this.cursor + 1 >= this.segments.length) {
      this.state = 'done';
      return false;
    }
    this.cursor += 1;
    await this.enter(this.segments[this.cursor]!, false);
    return true;
  }

  /**
   * Jump to a segment: fast-forward everything before it with animation
   * skipped, then play it normally and stop at its boundary.
   *
   * FORWARD ONLY. To go back, build a fresh world, re-run the program, and
   * `seek()` on the new player — see the header. Seeking backward throws
   * rather than silently showing a wrong stage.
   */
  async seek(index: number): Promise<void> {
    this.init();
    await this.settledAt();
    const target = Math.max(0, Math.min(Math.trunc(index), this.segments.length - 1));
    if (target <= this.cursor) {
      throw new Error(
        `Player.seek(${index}): cannot seek backward (at segment ${this.cursor}). ` +
          'Rebuild the world, re-author the program, and seek on the new player.',
      );
    }
    await this.fastForward(target);
    this.cursor = target;
    await this.enter(this.segments[target]!, false);
  }

  /**
   * Silently execute segments up to (not including) `upTo` — every step runs,
   * no time passes. Leaves playback parked just before `upTo`, so `next()`
   * plays it normally. Ambient loops that survive the skipped steps are
   * started when this resolves.
   */
  async fastForward(upTo: number): Promise<void> {
    this.init();
    await this.settledAt();
    const end = Math.min(Math.trunc(upTo), this.segments.length);
    for (let i = this.cursor + 1; i < end; i += 1) {
      this.cursor = i;
      await this.enter(this.segments[i]!, true);
    }
    this.startDeferredAmbient();
  }

  /** Run one segment; `instant` skips animation but not execution. */
  private async enter(segment: Segment, instant: boolean): Promise<void> {
    const total = this.segments.length;
    const base = { index: segment.index, title: segment.title, total, instant };
    this.state = instant ? 'seeking' : 'playing';
    this.instant = instant;
    this.opts.onSegment?.({ ...base, phase: 'start' });
    const run = (async () => {
      try {
        for (const node of segment.nodes) await this.run(node, undefined);
      } finally {
        this.instant = false;
        this.state = this.atEnd ? 'done' : 'paused';
      }
    })();
    this.inFlight = run;
    try {
      await run;
    } finally {
      this.inFlight = null;
      this.opts.onSegment?.({ ...base, phase: 'end' });
    }
  }

  /**
   * Rewind every varied parameter to the value it held before its FIRST
   * `vary`, then let playback re-walk the transitions.
   *
   * The program already ran: `vary` advanced its target at authoring time, so
   * a live-reading view mounted at beat 1 would otherwise display the state
   * beat 5 left behind — a strip already collapsed to Δx = 0.005, a
   * parallelogram already flipped negative. Discrete views dodged this by
   * snapshotting per step; continuous ones must read live (that is what makes
   * a drag work), so the timeline's own record is replayed instead. Each vary
   * lands on its recorded `to`, so the end state is exactly where authoring
   * left it.
   */
  private rewindVariedParameters(): void {
    const first = new Map<Id, { target: VarySettable; from: number }>();
    const walk = (nodes: readonly TimelineNode[]): void => {
      for (const node of nodes) {
        switch (node.type) {
          case 'action': {
            if (node.op !== 'vary') break;
            const payload = node.payload as VaryPayload;
            const target = payload.target as VarySettable;
            if (!payload.applied || typeof target.setValueLive !== 'function') break;
            if (!first.has(target.id)) first.set(target.id, { target, from: payload.from });
            break;
          }
          case 'cascade':
            for (const it of node.iterations) walk(it);
            break;
          default:
            walk(node.children);
        }
      }
    };
    walk(this.stage.world.timeline.root);
    for (const { target, from } of first.values()) target.setValueLive?.(from);
    if (first.size > 0) this.stage.applyStateAll();
  }

  /** Stop all still-running ambient loops. Teardown only — NOT at boundaries. */
  stopAmbient(): void {
    for (const entry of this.ambient) entry.stopped = true;
    this.deferredAmbient.length = 0;
  }

  /**
   * Milliseconds for a step. Zero while fast-forwarding — animate.ts reads
   * `ms <= 0` as "final state, now". The 24ms floor is deliberate for real
   * playback (a step at speed 20 must still be a step), which is exactly why
   * instant mode is a FLAG and not a very large `speed`.
   */
  private ms(base: number): number {
    if (this.instant) return 0;
    return Math.max(24, Math.round(base / (this.opts.speed ?? 1)));
  }

  /** Layout settle after a mount — nothing to wait for when time is off. */
  private settle(): Promise<void> {
    return this.instant ? Promise.resolve() : settled();
  }

  private async run(node: TimelineNode, budget: number | undefined): Promise<void> {
    this.checkSupersession(node);
    this.opts.onStep?.(node);
    switch (node.type) {
      case 'action':
        await this.execAction(node, budget);
        return;
      case 'cascade': {
        const durations = cascadeDurations(node.iterations.length, node.pace);
        this.prehideReveals(node);
        for (let i = 0; i < node.iterations.length; i += 1) {
          for (const child of node.iterations[i]!) {
            await this.run(child, durations[i]);
          }
        }
        return;
      }
      case 'parallel':
        await Promise.all(node.children.map((child) => this.run(child, budget)));
        return;
      case 'loop':
        if (node.times !== undefined) {
          for (let i = 0; i < node.times; i += 1) {
            for (const child of node.children) await this.run(child, budget);
          }
        } else {
          this.startAmbient(node);
        }
        return;
    }
  }

  // ───────────────────────── ambient loops ─────────────────────────

  /**
   * Register an open-ended loop. While fast-forwarding the driver is NOT
   * started — every wait would be zero, so it would spin without ever
   * yielding, and a loop the skipped steps go on to supersede must not run at
   * all. The entry is still registered, so `checkSupersession` can stop it as
   * the skipped steps replay in order; whatever survives is driven by
   * `startDeferredAmbient` when the fast-forward ends.
   */
  private startAmbient(loop: LoopStep): void {
    const entry: AmbientEntry = { loop, subject: findLoopSubject(loop), stopped: false };
    this.ambient.push(entry);
    if (this.instant) {
      this.deferredAmbient.push(entry);
      return;
    }
    this.driveAmbient(entry);
  }

  /** Start the loops that survived a fast-forward (see startAmbient). */
  private startDeferredAmbient(): void {
    const pending = this.deferredAmbient.splice(0, this.deferredAmbient.length);
    for (const entry of pending) {
      if (!entry.stopped) this.driveAmbient(entry);
    }
  }

  private driveAmbient(entry: AmbientEntry): void {
    const { loop } = entry;
    void (async () => {
      while (!entry.stopped) {
        for (const child of loop.children) {
          if (entry.stopped) break;
          await this.runAmbientNode(child);
        }
        await wait(this.ms(500));
      }
    })();
  }

  /** Like run(), without supersession checks or observation. */
  private async runAmbientNode(node: TimelineNode): Promise<void> {
    switch (node.type) {
      case 'action':
        await this.execAction(node, undefined);
        return;
      case 'cascade': {
        const durations = cascadeDurations(node.iterations.length, node.pace);
        for (let i = 0; i < node.iterations.length; i += 1) {
          for (const child of node.iterations[i]!) await this.runAmbientNode(child);
          void durations;
        }
        return;
      }
      case 'parallel':
        await Promise.all(node.children.map((child) => this.runAmbientNode(child)));
        return;
      case 'loop':
        return; // no nested open loops
    }
  }

  private checkSupersession(node: TimelineNode): void {
    for (const entry of this.ambient) {
      if (entry.stopped) continue;
      if (this.lesson.supersederOf(entry.loop) === node.id) {
        entry.stopped = true;
        continue;
      }
      if (
        node.type === 'action' &&
        entry.subject &&
        stepSupersedesLoop(this.stage.world, entry.subject, node)
      ) {
        entry.stopped = true;
      }
      if (
        node.type === 'action' &&
        node.op === 'hide' &&
        entry.subject &&
        (node.payload as HidePayload).subject.id === entry.subject.id
      ) {
        entry.stopped = true;
      }
    }
  }

  // ───────────────────────── action steps ─────────────────────────

  private async execAction(step: ActionStep, budget: number | undefined): Promise<void> {
    const ms = this.ms(budget ?? paceMs(step.pace?.start));
    // delta animations views queued for this step (reactive updates)
    const pendings = this.stage.views
      .flatMap((view) => view.takePending(step.id))
      .map((fn) => Promise.resolve(fn(ms)));
    const verb = this.execVerb(step, ms);
    await Promise.all([verb, ...pendings]);
  }

  private async execVerb(step: ActionStep, ms: number): Promise<void> {
    switch (step.op) {
      case 'say':
        return this.execSay(step.payload as SayPayload, ms);
      case 'show':
        return this.execShow(step.payload as ShowPayload, ms);
      case 'hide':
        return this.execHide(step.payload as HidePayload, ms);
      case 'retire':
        return this.execRetire(step.payload as RetirePayload, ms);
      case 'replace':
        return this.execReplace(step.payload as ReplacePayload, ms);
      case 'focus':
        return this.execFocus(step.payload as FocusPayload, ms);
      case 'morph':
        return this.execMorph(step.payload as MorphPayload, ms);
      case 'transformFormula':
        return this.execTransformFormula(step.payload as TransformFormulaPayload, ms);
      case 'link':
        return this.execLink(step.payload as LinkPayload, ms);
      case 'vary':
        return this.execVary(step.payload as VaryPayload, ms);
      case 'expose':
        return this.execExpose(step.payload as ExposePayload);
      case 'enableInteraction':
        return this.execEnableInteraction(step.payload as EnableInteractionPayload);
      case 'reveal':
        return this.execReveal(step.payload as RevealPayload, ms);
      case 'demonstrate:event':
        return this.execDemonstrateEvent(step.payload as DemonstrateEventPayload, ms);
      case 'compareExperiment':
        return this.execCompareExperiment(step.payload as CompareExperimentPayload, ms);
      case 'slot:set':
        return this.execSlotSet(step, ms);
      case 'collection:add':
        return this.execCollectionAdd(step, ms);
      default:
        return; // unknown ops: the queued pendings still ran
    }
  }

  private async execSay(payload: SayPayload, ms: number): Promise<void> {
    appendNarration(this.stage, payload);
    for (const mention of payload.mentions) {
      if (isHandle(mention)) this.stage.lightUp(mention, this.ms(700));
    }
    await wait(Math.min(ms, this.ms(350)));
  }

  private async execShow(payload: ShowPayload, ms: number): Promise<void> {
    const view = this.stage.viewById(payload.subject.id);
    if (view) {
      const el = this.stage.ensureMounted(view);
      this.applyPendingPrehides();
      if (el) {
        await this.settle();
        await enter(el, payload.enterFrom, ms);
        view.shown = true;
        view.onShown();
      }
      const fadeAfter = parseOver(payload.fadeAfter);
      if (fadeAfter !== undefined) {
        // a fade scheduled during a fast-forward has already "happened" by the
        // time the student arrives: land it, do not play it
        const instant = this.instant;
        setTimeout(() => {
          if (view.el) void exit(view.el, instant ? 0 : this.ms(400));
        }, this.ms(fadeAfter));
      }
      return;
    }
    // a plain object: reveal/pulse whatever nodes already project it
    for (const el of this.stage.nodesFor(payload.subject.id)) {
      el.classList.remove('mr-prehidden');
      void pulse(el, ms);
    }
  }

  private async execHide(payload: HidePayload, ms: number): Promise<void> {
    const view = this.stage.viewById(payload.subject.id);
    if (view?.el) {
      await exit(view.el, ms);
      view.shown = false;
      return;
    }
    for (const el of this.stage.nodesFor(payload.subject.id)) {
      await exit(el as HTMLElement, ms);
    }
  }

  /**
   * Retiring looks like hiding. The difference is entirely semantic and lives
   * downstream — the object is out of the explanation for good, so a later
   * turn's scene manifest must not offer it. Nothing here needs to differ, and
   * inventing a distinct animation would only make retirement look like a
   * different KIND of disappearing to the student, which it is not.
   */
  private async execRetire(payload: RetirePayload, ms: number): Promise<void> {
    await this.execHide({ subject: payload.subject }, ms);
  }

  /** Retire the old, then show the new — the revision, as one step. */
  private async execReplace(payload: ReplacePayload, ms: number): Promise<void> {
    await this.execHide({ subject: payload.old }, ms);
    await this.execShow({ subject: payload.next }, ms);
  }

  private async execFocus(payload: FocusPayload, ms: number): Promise<void> {
    const cls = payload.emphasize ? `mr-emph-${payload.emphasize}` : 'mr-lit';
    const hold = this.ms(payload.emphasize === 'stillness' ? 2600 : 1400);
    const targets = new Set<Element>();
    for (const subject of payload.subjects) {
      for (const id of this.stage.resonance(subject)) {
        for (const el of this.stage.nodesFor(id)) targets.add(el);
      }
    }
    for (const el of targets) {
      el.classList.add(cls);
      setTimeout(() => el.classList.remove(cls), hold);
    }
    await wait(Math.min(hold, this.ms(900)));
    void ms;
  }

  private async execMorph(payload: MorphPayload, ms: number): Promise<void> {
    const fromView = this.stage.viewById(payload.from.id);
    const toView = this.stage.viewById(payload.to.id);
    if (toView) {
      const el = this.stage.ensureMounted(toView);
      this.applyPendingPrehides();
      if (el) {
        el.classList.add('mr-measuring');
        el.classList.remove('mr-hidden');
        await this.settle();
      }
    }
    const doc = this.stage.doc;
    const travelMs = Math.round(ms * 1.6);
    const travels = payload.routes.map((route, i) => {
      if (!doc) return Promise.resolve();
      const fromEl = this.nodeFor(route.from, fromView?.el);
      const toEl = this.nodeFor(route.to, toView?.el);
      if (!fromEl || !toEl) return Promise.resolve();
      return wait(Math.round((i * ms) / Math.max(payload.routes.length, 1) / 4)).then(() =>
        travel(doc, fromEl, toEl, { ms: travelMs, clone: fromEl }),
      );
    });
    if (fromView?.el) void exit(fromView.el, travelMs);
    await Promise.all(travels);
    if (toView?.el) {
      toView.el.classList.remove('mr-measuring');
      toView.el.classList.remove('mr-hidden');
      await enter(toView.el, 'fade', this.ms(300));
      toView.shown = true;
      toView.onShown();
    }
    if (fromView) fromView.shown = false;
  }

  /**
   * The formula morph (milestone 6's one new verb). The view already showing
   * the `from` formula BECOMES the `to` formula: preserved roles keep their
   * span identity and travel to their new position, leaving roles fade, and
   * entering roles fade in. When nothing is showing `from` yet (a formula
   * transformed before it was shown), fall back to showing `to`.
   */
  private async execTransformFormula(payload: TransformFormulaPayload, ms: number): Promise<void> {
    const view = this.stage.viewProjecting(payload.from.id);
    if (view instanceof FormulaView) {
      this.stage.ensureMounted(view);
      await view.transformTo(payload, Math.round(ms * 1.2));
      for (const pair of payload.preserved) this.stage.lightUp(pair.to, ms);
      return;
    }
    const target = this.stage.viewProjecting(payload.to.id);
    if (target) await this.execShow({ subject: target, enterFrom: 'fade' }, ms);
  }

  private async execLink(payload: LinkPayload, ms: number): Promise<void> {
    this.stage.lightUp(payload.a, ms);
    for (const target of payload.targets) this.stage.lightUp(target, ms);
    await wait(Math.min(ms, this.ms(400)));
  }

  /**
   * `vary` replays the transition it recorded. The value was already advanced
   * at AUTHORING time (that is what made the payload's `to`), so playback
   * re-walks it: each tween frame writes the value back through `setValue` and
   * refreshes, which is what makes the continuous story move — the strip
   * narrows as Δx shrinks, the parallelogram collapses as c crosses det = 0.
   * It lands exactly where authoring left it, so nothing downstream drifts.
   *
   * Numeric TEXT is written only into nodes marked `data-mr-num` or plain leaf
   * cells; a shape projecting the same handle (an SVG marker, a strip rect)
   * must not have its geometry replaced by a number.
   */
  private async execVary(payload: VaryPayload, ms: number): Promise<void> {
    const duration = this.ms(parseOver(payload.over) ?? ms);
    const nodes = this.stage.nodesFor(payload.target.id).filter((el) => isNumericNode(el));
    const settable = payload.applied ? (payload.target as Partial<VarySettable>) : null;
    const live = settable?.setValueLive?.bind(settable);
    this.stage.lightUp(payload.target, duration);
    if (nodes.length > 0 || live) {
      await tweenNumber(payload.from, payload.to, duration, (value) => {
        if (live) {
          live(value);
          this.stage.applyStateAll();
        }
        for (const el of nodes) el.textContent = value.toFixed(2);
      });
    } else {
      await wait(duration);
    }
    this.stage.applyStateAll(); // dependents re-read live values (renormalized rows)
  }

  private async execExpose(payload: ExposePayload): Promise<void> {
    const view = this.stage.viewById(payload.subject.id);
    view?.enableInteraction();
    if (!view) {
      for (const el of this.stage.nodesFor(payload.subject.id)) el.classList.add('mr-exposed');
    }
  }

  /**
   * Wire a concrete interaction. The rail belongs to a view that knows its own
   * coordinate frame (a plot's x-axis), so the view owns the pointer handling
   * and the pixel→domain mapping; the player only routes the payload to it.
   */
  private async execEnableInteraction(payload: EnableInteractionPayload): Promise<void> {
    const { interaction } = payload;
    // Several views may project the rail (an earlier, since-hidden copy of the
    // same graph, say) — the affordance belongs on one the student can see.
    const projecting = this.stage.views.filter((v) => v.projects(interaction.along.id));
    const view =
      projecting.find((v) => v.shown) ?? projecting[0] ?? this.railHost(interaction.along.id);
    const host = view as { enableRailDrag?(railId: Id, target: VarySettable): void } | undefined;
    host?.enableRailDrag?.(interaction.along.id, interaction.target);
  }

  /** The view whose element contains a node registered under the rail id. */
  private railHost(railId: Id): View | undefined {
    const nodes = this.stage.nodesFor(railId);
    return this.stage.views.find((v) => v.el && nodes.some((n) => v.el?.contains(n)));
  }

  private async execReveal(payload: RevealPayload, ms: number): Promise<void> {
    for (const part of payload.parts) this.pendingReveals.delete(part.id);
    for (const part of payload.parts) {
      for (const el of this.stage.nodesFor(part.id)) {
        el.classList.remove('mr-prehidden'); // the reveal's lasting effect
        if (this.instant) continue; // no pop on a part revealed in a skipped beat
        el.classList.add('mr-pop');
        setTimeout(() => el.classList.remove('mr-pop'), 450);
      }
      this.stage.lightUp(part, ms);
    }
    await wait(ms);
  }

  private async execDemonstrateEvent(payload: DemonstrateEventPayload, ms: number): Promise<void> {
    const cue = interpretEvent(payload.event, payload.subject);
    await this.runCue(cue, ms, payload.intensity, payload.subject);
  }

  private async execCompareExperiment(payload: CompareExperimentPayload, ms: number): Promise<void> {
    const view = new ExperimentView(this.stage, payload);
    const el = this.stage.ensureMounted(view);
    if (el) {
      await this.settle();
      await enter(el, 'fade', ms);
      view.shown = true;
    }
  }

  private async execSlotSet(step: ActionStep, ms: number): Promise<void> {
    const payload = step.payload as { via?: string; to?: unknown };
    if (payload.via !== 'derivation') return;
    let events: readonly TraceEvent[] | undefined = this.stage.derivationFor(step.id);
    if (!events) {
      const to = payload.to;
      if (to !== null && typeof to === 'object' && this.stage.world.provenanceOf(to)) {
        try {
          events = this.stage.world.trace(to);
        } catch {
          events = undefined;
        }
      }
    }
    if (!events || events.length === 0) return;
    const fallback = isHandle(payload.to) ? payload.to : (step as Handle);
    const each = this.instant ? 0 : Math.max(80, Math.round((ms * 2) / events.length));
    const runs: Promise<void>[] = [];
    for (let i = 0; i < events.length; i += 1) {
      const cue = interpretEvent(events[i]!, fallback);
      runs.push(
        wait(Math.round(i * each * 0.5)).then(() => this.runCue(cue, each, 'full', fallback)),
      );
    }
    await Promise.all(runs);
  }

  private async execCollectionAdd(step: ActionStep, ms: number): Promise<void> {
    const payload = step.payload as { item?: unknown };
    if (isHandle(payload.item)) this.stage.lightUp(payload.item, ms);
  }

  // ───────────────────────── cue execution ─────────────────────────

  private async runCue(
    cue: AnimationCue,
    ms: number,
    intensity: Intensity,
    fallbackSubject: Handle,
  ): Promise<void> {
    const doc = this.stage.doc;
    switch (cue.kind) {
      case 'travel': {
        if (!doc) return;
        const fromEl = this.refNode(cue.from);
        const toEl = this.refNode(cue.to);
        if (isHandle(cue.from)) this.stage.lightUp(cue.from, ms);
        if (isHandle(cue.to)) this.stage.lightUp(cue.to, ms);
        if (!fromEl || !toEl) return;
        const size =
          cue.size !== undefined
            ? Math.max(6, Math.round(6 + Math.sqrt(cue.size) * 16))
            : intensity === 'ambient'
              ? 8
              : 12;
        await travel(doc, fromEl, toEl, {
          ms: Math.round(ms * 1.4),
          size,
          ambient: intensity === 'ambient',
        });
        return;
      }
      case 'derive': {
        for (const input of cue.inputs) {
          const el = this.refNode(input);
          if (el) void pulse(el, ms);
        }
        for (const el of this.stage.nodesFor(cue.subject.id)) {
          el.classList.remove('mr-prehidden');
          void pulse(el, ms);
        }
        this.stage.lightUp(cue.subject, ms);
        await wait(ms);
        return;
      }
      case 'grow': {
        for (const el of this.stage.nodesFor(cue.subject.id)) void pulse(el, ms);
        this.stage.lightUp(cue.subject, ms);
        await wait(ms);
        return;
      }
      case 'apply': {
        const panel = this.refNode(`${fallbackSubject.id}#side${cue.side}`);
        if (panel) void pulse(panel, ms);
        if (cue.result) this.stage.lightUp(cue.result, ms);
        if (cue.subject) this.stage.lightUp(cue.subject, ms);
        await wait(ms);
        return;
      }
      case 'verdict': {
        const badge = this.refNode(`${fallbackSubject.id}#verdict${cue.side}`);
        if (badge) void pulse(badge, ms);
        if (cue.subject) this.stage.lightUp(cue.subject, ms);
        await wait(ms);
        return;
      }
      case 'pulse': {
        const el = this.refNode(cue.subject);
        if (el) void pulse(el, ms);
        if (isHandle(cue.subject)) this.stage.lightUp(cue.subject, ms);
        await wait(ms);
        return;
      }
    }
  }

  // ───────────────────────── node resolution ─────────────────────────

  /**
   * Resolve a travel/pulse endpoint when a handle is projected by several
   * views. Rule (M3 Q3): prefer the first VISIBLE projection — no `mr-hidden`
   * ancestor, not itself pre-hidden — in registration order (views register
   * at mount, mounts follow program order, so the choice is deterministic:
   * the earliest-shown view that still displays the object wins). Fall back
   * to the first registered node when nothing is visible yet.
   */
  private refNode(ref: HandleRef): Element | undefined {
    const nodes = this.stage.nodesFor(isHandle(ref) ? ref.id : ref);
    const visible = nodes.find(
      (el) => !el.closest('.mr-hidden') && !el.classList.contains('mr-prehidden'),
    );
    return visible ?? nodes[0];
  }

  /** Prefer a node inside the given root (a specific view's projection). */
  private nodeFor(handle: Handle, root: Element | null | undefined): Element | undefined {
    const nodes = this.stage.nodesFor(handle.id);
    if (root) {
      const inside = nodes.find((el) => root.contains(el));
      if (inside) return inside;
    }
    return nodes[0];
  }

  /** Pre-hide the parts of every reveal step in a buildUp cascade. */
  private prehideReveals(cascade: CascadeStep): void {
    for (const iteration of cascade.iterations) {
      for (const node of iteration) {
        if (node.type !== 'action' || node.op !== 'reveal') continue;
        const payload = node.payload as RevealPayload;
        for (const part of payload.parts) {
          this.prehidePart(part.id, payload.subject.id);
        }
      }
    }
  }

  /** Collect every reveal in the (already-authored) timeline. */
  private scanReveals(nodes: readonly TimelineNode[]): void {
    for (const node of nodes) {
      switch (node.type) {
        case 'action':
          if (node.op === 'reveal') {
            const payload = node.payload as RevealPayload;
            for (const part of payload.parts) {
              if (!this.pendingReveals.has(part.id)) {
                this.pendingReveals.set(part.id, payload.subject.id);
              }
            }
          }
          break;
        case 'cascade':
          for (const iteration of node.iterations) this.scanReveals(iteration);
          break;
        case 'parallel':
        case 'loop':
          this.scanReveals(node.children);
          break;
      }
    }
  }

  /** Hide every not-yet-revealed part whose nodes now exist (post-mount). */
  private applyPendingPrehides(): void {
    for (const [partId, subjectId] of this.pendingReveals) {
      this.prehidePart(partId, subjectId);
    }
  }

  /**
   * Add `mr-prehidden` to the part's nodes INSIDE the buildUp subject's own
   * view — a header handle may also be projected elsewhere (a token cloud),
   * and those projections must not disappear.
   */
  private prehidePart(partId: Id, subjectId: Id): void {
    const root = this.stage.viewById(subjectId)?.el;
    for (const el of this.stage.nodesFor(partId)) {
      if (root && !root.contains(el)) continue;
      el.classList.add('mr-prehidden');
    }
  }
}

/**
 * Whether a node is a numeric DISPLAY of a handle (a readout value, a matrix
 * cell) as opposed to a shape that merely projects the same handle. `vary`
 * writes tweened text only into these — replacing an SVG marker's children
 * with a number would erase the geometry.
 */
function isNumericNode(el: Element): boolean {
  if (el.hasAttribute('data-mr-num')) return true;
  return el.namespaceURI === 'http://www.w3.org/1999/xhtml' && el.childElementCount === 0;
}

/** The demonstrated subject of an open loop: found in its event payloads. */
function findLoopSubject(loop: LoopStep): Handle | null {
  const stack: TimelineNode[] = [...loop.children];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.type === 'action') {
      if (node.op === 'demonstrate:event') {
        return (node.payload as DemonstrateEventPayload).subject;
      }
    } else if (node.type === 'cascade') {
      for (const it of node.iterations) stack.push(...it);
    } else {
      stack.push(...node.children);
    }
  }
  return null;
}

export function createPlayer(stage: Stage, lesson: Lesson, opts?: PlayerOpts): Player {
  return new Player(stage, lesson, opts);
}
