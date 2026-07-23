/**
 * stage.ts — the rendering container for one world: theme injection, the
 * canvas views mount into, the node registry, the narration panel, and the
 * resonance query (one-hop correspondence lighting).
 *
 * A stage can be created WITHOUT a container (headless) — views then build
 * their models, protocols, and subscriptions but never touch the DOM; unit
 * tests run this way.
 */

import { Slot, isHandle } from '@math-ai/core';
import type { Handle, Id, TraceEvent, World } from '@math-ai/core';
import { NodeRegistry } from './registry.js';
import type { NodeKey } from './registry.js';
import { ensureTheme } from './theme.js';
import type { View } from './view.js';
import type { CoordFrame } from './views/frame.js';

export interface StageOpts {
  /** Mount the narration side panel (default true when a container exists). */
  readonly narration?: boolean;
}

export class Stage {
  readonly registry = new NodeRegistry();
  readonly views: View[] = [];
  readonly doc: Document | null;
  readonly root: HTMLElement | null;
  readonly canvas: HTMLElement | null;
  readonly narrationEl: HTMLElement | null;

  /**
   * The most recently constructed coordinate-frame provider (a plot, a plane).
   * A framed view shown OUTSIDE an overlay borrows it, so the FTC strip beat —
   * `show(View.strip(strip))` on its own — still draws in f's coordinates with
   * f's curve behind it. See views/frame.ts.
   */
  ambientFrame: CoordFrame | null = null;

  /** subject id → the frame of the plot projecting it. */
  private readonly frames = new Map<Id, CoordFrame>();

  /** slot-set step id → derivation trace captured at authoring time. */
  private readonly derivations = new Map<Id, readonly TraceEvent[]>();
  private readonly watchedSlots = new Set<Id>();

  constructor(
    readonly world: World,
    container?: HTMLElement | null,
    opts?: StageOpts,
  ) {
    if (container) {
      this.doc = container.ownerDocument;
      ensureTheme(this.doc);
      this.root = this.doc.createElement('div');
      this.root.className = 'mr-stage';
      this.canvas = this.doc.createElement('div');
      this.canvas.className = 'mr-canvas';
      this.root.appendChild(this.canvas);
      if (opts?.narration ?? true) {
        this.narrationEl = this.doc.createElement('aside');
        this.narrationEl.className = 'mr-narration';
        this.root.appendChild(this.narrationEl);
      } else {
        this.narrationEl = null;
      }
      container.appendChild(this.root);
    } else {
      this.doc = null;
      this.root = null;
      this.canvas = null;
      this.narrationEl = null;
    }
  }

  /** A plot claims the frame for the object it projects. */
  registerFrame(subject: Id, frame: CoordFrame): void {
    if (!this.frames.has(subject)) this.frames.set(subject, frame);
    this.ambientFrame = frame;
  }

  /** The frame of the plot projecting a subject, if one exists. */
  frameFor(subject: Id): CoordFrame | undefined {
    return this.frames.get(subject);
  }

  addView(view: View): void {
    this.views.push(view);
  }

  viewById(id: Id): View | undefined {
    return this.views.find((v) => v.id === id);
  }

  /** The view projecting a handle (itself or one of its elements). */
  viewProjecting(id: Id): View | undefined {
    return this.views.find((v) => v.projects(id));
  }

  /** Mount a view into the canvas (idempotent). No-op when headless. */
  ensureMounted(view: View): HTMLElement | null {
    if (!this.doc || !this.canvas) return null;
    const el = view.mount(this.doc);
    if (!el.isConnected) this.canvas.appendChild(el);
    return el;
  }

  /** DOM nodes for a handle or alias key. */
  nodesFor(key: NodeKey): readonly Element[] {
    return this.registry.nodesFor(key);
  }

  /**
   * The resonance set of a handle: itself plus its one-hop correspondence
   * neighbors under the "refer to each other" relations. This is what makes
   * linked formula spans, narration mentions, and sibling views light up when
   * an object animates — emergent, never authored per pair.
   *
   * `contributes-to` participates (spike M5): a formula's merge span linked
   * to the states it sums over must light when mass flows into them, and a
   * word arriving lights the bucket it contributes to.
   */
  resonance(h: Handle): readonly Id[] {
    const ids = [h.id];
    for (const n of this.world.graph.neighbors(h, {
      rels: ['represents', 'counterpart-of', 'contributes-to'],
    })) {
      ids.push(n.id);
    }
    return ids;
  }

  /** Briefly light every node registered under a key's resonance set. */
  lightUp(key: NodeKey, ms = 700): void {
    const targets = new Set<Element>();
    if (isHandle(key)) {
      for (const id of this.resonance(key)) {
        for (const el of this.registry.nodesFor(id)) targets.add(el);
      }
    } else {
      for (const el of this.registry.nodesFor(key)) targets.add(el);
    }
    for (const el of targets) {
      el.classList.add('mr-lit');
      setTimeout(() => el.classList.remove('mr-lit'), ms);
    }
  }

  /** Bring every view to the correct state for current values (see View.applyState). */
  applyStateAll(): void {
    for (const v of this.views) v.applyState();
  }

  /**
   * Release every view's non-DOM resources. Must be called before a stage is
   * discarded — which happens on every backward seek, since backward is
   * rebuild-the-world. Removing the container's DOM is the CALLER's job (and
   * suffices for the SVG views); this call exists for what a container wipe
   * cannot reach: foreign boards, GL contexts, document-level listeners.
   */
  dispose(): void {
    for (const v of this.views) v.dispose();
  }

  /**
   * Capture derivation traces for a slot's `via: "derivation"` transitions at
   * AUTHORING time (when the program's closures still see the state the value
   * was derived under). Replaying lazily at playback would re-run the
   * operation against post-program state — later `vary`/drag mutations would
   * skew the parcels. Views over slots call this once per slot.
   */
  captureDerivations<T>(slot: Slot<T>): void {
    if (this.watchedSlots.has(slot.id)) return;
    this.watchedSlots.add(slot.id);
    slot.subscribe((t) => {
      if (t.via !== 'derivation') return;
      const to = t.to as unknown;
      if (to === null || typeof to !== 'object') return;
      if (!this.world.provenanceOf(to as object)) return;
      try {
        this.derivations.set(t.step.id, this.world.trace(to as object));
      } catch {
        // no trace — the crossfade fallback still runs
      }
    });
  }

  /** The captured trace for a slot:set step, if any. */
  derivationFor(stepId: Id): readonly TraceEvent[] | undefined {
    return this.derivations.get(stepId);
  }
}

export function createStage(world: World, container?: HTMLElement | null, opts?: StageOpts): Stage {
  return new Stage(world, container, opts);
}
