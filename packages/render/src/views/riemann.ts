/**
 * views/riemann.ts — the Riemann decomposition: one rectangle per slice, each
 * registered under its OWN `Rectangle` handle.
 *
 * That registration is the whole trick. `demonstrate(sum)` replays the traced
 * `rectangle:derive` events the riemann operation emitted, and the derive cue
 * un-hides and pulses whatever nodes carry the event's subject — so the
 * rectangles ink in one at a time, and any formula term span linked to a
 * rectangle lights with it. No per-rectangle authoring, no flow machinery:
 * the same verb that drew the DFA's edges draws these.
 */

import type { Handle, Id } from '@math-ai/core';
import type { Stage } from '../stage.js';
import { FramedView, SVG_NS, svgLayer } from './frame.js';
import { renderTex } from '../tex.js';

export interface RiemannRect {
  readonly handle: Handle;
  readonly x0: number;
  readonly x1: number;
  readonly height: number;
}

export interface RiemannSpec {
  readonly subject: Handle;
  readonly rectangles: readonly RiemannRect[];
  readonly label?: string;
  /** Curve rule, for the backdrop when the view stands alone. */
  readonly sample: (x: number) => number;
  /**
   * "deferred" (the default, and the discipline idiom): rectangles start
   * pre-hidden and ink in under `demonstrate`. "shown": all visible at once.
   */
  readonly mode?: 'deferred' | 'shown';
  /** The function this decomposes — whose plot's frame it belongs in. */
  readonly on?: Handle;
}

export class RiemannView extends FramedView {
  constructor(
    stage: Stage,
    private readonly spec: RiemannSpec,
  ) {
    super(stage, 'view:riemann');
  }

  override get elements(): readonly Handle[] {
    return this.spec.rectangles.map((r) => r.handle);
  }

  protected override frameSubjectId(): Id | null {
    return this.spec.on?.id ?? null;
  }

  /** Σ of the slice areas — the quantity the ∑-formula names. */
  total(): number {
    return this.spec.rectangles.reduce((s, r) => s + r.height * (r.x1 - r.x0), 0);
  }

  protected render(doc: Document): HTMLElement {
    const root = doc.createElement('div');
    root.classList.add('mr-riemann');
    const f = this.frame;
    const svg = svgLayer(doc, f, 'mr-riemann-svg');
    root.appendChild(svg);
    this.appendBackdrop(doc, svg);

    const deferred = (this.spec.mode ?? 'deferred') === 'deferred';
    for (const r of this.spec.rectangles) {
      const rect = doc.createElementNS(SVG_NS, 'rect');
      rect.classList.add('mr-riemann-rect');
      if (deferred) rect.classList.add('mr-prehidden');
      const x = Math.min(f.x(r.x0), f.x(r.x1));
      const w = Math.max(1, Math.abs(f.x(r.x1) - f.x(r.x0)));
      const top = f.y(Math.max(r.height, 0));
      const bottom = f.y(Math.min(r.height, 0));
      rect.setAttribute('x', x.toFixed(2));
      rect.setAttribute('y', top.toFixed(2));
      rect.setAttribute('width', w.toFixed(2));
      rect.setAttribute('height', Math.max(1, bottom - top).toFixed(2));
      rect.classList.toggle('mr-negative', r.height < 0);
      svg.appendChild(rect);
      this.stage.registry.register(rect, r.handle.id);
    }

    if (this.spec.label) {
      const caption = doc.createElement('div');
      caption.className = 'mr-plot-caption';
      renderTex(caption, this.spec.label);
      root.insertBefore(caption, svg);
      this.stage.registry.register(caption, this.spec.subject.id);
    }
    return root;
  }
}
