/**
 * view.ts — the view base class.
 *
 * A view is (a) a Handle, so it can be shown/hidden/focused/morphed like any
 * object; (b) a MorphSubject — `elements` exposes the semantic objects it
 * projects, at the granularity morph legality is checked and routes animate;
 * (c) a delta sink — views subscribe to slots/collections at AUTHORING time
 * and queue their animations keyed by the mutation's timeline step, so the
 * player can run them when playback reaches that step.
 *
 * Model and DOM are split: constructors build the model (handles, protocol
 * members, subscriptions — node-testable), `render(doc)` builds DOM. Views
 * never position themselves; layout is CSS flow + the layout container views.
 */

import type { Handle, Id } from '@math-ai/core';
import type { MorphSubject } from '@math-ai/lesson';
import type { Stage } from './stage.js';

export type PendingAnimation = (ms: number) => void | Promise<void>;

/**
 * What a view's rendering backend can and cannot honour — declared, not
 * discovered, so an invariant a backend breaks is explicit and checkable
 * rather than silent and per-lesson. See docs/renderer-backends.md.
 */
export interface BackendCapabilities {
  /**
   * False → this view family cannot construct its model in node; its tests
   * leave the ~2s tier for the browser tier. Today's SVG views are all true.
   */
  readonly headlessConstruct: boolean;
  /**
   * False → no per-element DOM nodes in the registry; resonance lighting,
   * narration mentions and fine-grained `lesson.link` degrade to view-level
   * highlighting. Today's SVG views are all true.
   */
  readonly elementNodes: boolean;
}

export abstract class View implements MorphSubject {
  readonly id: Id;
  readonly kind: string;
  /** The mounted root element, once mounted. */
  el: HTMLElement | null = null;
  /** Set by the player when the view has been shown. */
  shown = false;

  private readonly pending = new Map<Id, PendingAnimation[]>();

  constructor(
    readonly stage: Stage,
    kind: string,
    id?: Id,
  ) {
    this.kind = kind;
    this.id = stage.world.handle(kind, id).id;
    stage.addView(this);
  }

  /**
   * The semantic objects this view projects — morph granularity. Default: the
   * view is its own single element; concrete views override.
   */
  get elements(): readonly Handle[] {
    return [this];
  }

  /**
   * Whether this view is a projection of the given handle id — itself, or one
   * of the objects it projects. `transformFormula` uses it to find the view
   * currently showing a formula (the `to` formula of a morph has no view of
   * its own; the `from` view becomes it).
   */
  projects(id: Id): boolean {
    return this.id === id || this.elements.some((e) => e.id === id);
  }

  /** Build the DOM. Only called in a browser. */
  protected abstract render(doc: Document): HTMLElement;

  /** Idempotent: build + cache the root element (hidden until shown). */
  mount(doc: Document): HTMLElement {
    if (!this.el) {
      this.el = this.render(doc);
      this.el.classList.add('mr-view', 'mr-hidden');
      this.stage.registry.register(this.el, this.id);
    }
    return this.el;
  }

  /**
   * What this view's backend can honour. Hand-cut SVG satisfies everything;
   * a foreign backend (canvas, WebGL) overrides and pays its costs knowingly.
   */
  get capabilities(): BackendCapabilities {
    return { headlessConstruct: true, elementNodes: true };
  }

  /**
   * Bring the view to the visually correct state for the CURRENT live values,
   * synchronously, with no animation in flight. Animation is an embellishment
   * layered over this, never the mechanism by which correct state is reached —
   * that rule is what keeps fast-forward (backward seek's constant companion)
   * free. Called after vary/drag; views whose rendering is a pure function of
   * current state override, static views keep the no-op.
   */
  applyState(): void {}

  /**
   * Release whatever mount/render acquired beyond child DOM nodes of `el`:
   * document-level listeners, foreign boards, GL contexts. Called on every
   * stage teardown — and backward seek is a rebuild, so this runs constantly.
   * Today's SVG views hold nothing (listeners live on their own elements,
   * which the container wipe releases), hence the no-op default; a foreign
   * backend that leaks here dies slowly, one seek at a time.
   */
  dispose(): void {}

  /** Called by the player after the view enters (layouts reveal children). */
  onShown(): void {}

  /** Called by the player on `expose` — views with affordances override. */
  enableInteraction(): void {}

  /** Queue an animation for the given timeline step (authoring time). */
  protected queue(stepId: Id, fn: PendingAnimation): void {
    const list = this.pending.get(stepId);
    if (list) list.push(fn);
    else this.pending.set(stepId, [fn]);
  }

  /** Drain the animations queued for a step (playback time). */
  takePending(stepId: Id): readonly PendingAnimation[] {
    const list = this.pending.get(stepId);
    if (!list) return [];
    this.pending.delete(stepId);
    return list;
  }

  /** Whether any animation is queued for a step (peek, non-draining). */
  hasPending(stepId: Id): boolean {
    return this.pending.has(stepId);
  }
}
