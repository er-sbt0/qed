/**
 * views/strip.ts — the thin increment strip: one rectangle of width Δx and
 * height f(x), sitting on the curve at x.
 *
 * Every field is read LIVE (they are reactive scalars), so `vary(dx, {to:
 * 0.005})` visibly narrows the strip while the readout converges — the FTC
 * limit beat with no bespoke machinery, just a refresh per tween frame.
 */

import type { Handle, Id } from '@math-ai/core';
import type { NumericHandle } from '@math-ai/lesson';
import type { Stage } from '../stage.js';
import { FramedView, SVG_NS, svgLayer } from './frame.js';

export interface StripSpec {
  readonly subject: Handle;
  /** Left edge — the x the strip starts at. */
  readonly at: NumericHandle;
  /** Δx. */
  readonly width: NumericHandle;
  /** f(x) — the approximate height. */
  readonly height: NumericHandle;
  /** ΔA — the strip's area subpart (what `focus(strip.area)` targets). */
  readonly area: NumericHandle;
  /** Curve rule, for the backdrop when the strip stands alone. */
  readonly sample: (x: number) => number;
  /** The function this is a strip OF — whose plot's frame it belongs in. */
  readonly on?: Handle;
}

export class StripView extends FramedView {
  private rect: SVGRectElement | null = null;
  private caption: SVGTextElement | null = null;

  constructor(
    stage: Stage,
    private readonly spec: StripSpec,
  ) {
    super(stage, 'view:strip');
  }

  override get elements(): readonly Handle[] {
    return [this.spec.subject];
  }

  protected override frameSubjectId(): Id | null {
    return this.spec.on?.id ?? null;
  }

  protected render(doc: Document): HTMLElement {
    const root = doc.createElement('div');
    root.classList.add('mr-strip');
    const svg = svgLayer(doc, this.frame, 'mr-strip-svg');
    root.appendChild(svg);
    this.appendBackdrop(doc, svg);

    const rect = doc.createElementNS(SVG_NS, 'rect');
    rect.classList.add('mr-strip-rect');
    svg.appendChild(rect);
    this.rect = rect;
    // the rectangle IS the strip and IS its area subpart: focus(strip.area)
    // and `${strip.width}` in narration both land here
    this.stage.registry.register(rect, this.spec.subject.id);
    this.stage.registry.register(rect, this.spec.area.id);
    this.stage.registry.register(rect, this.spec.width.id);
    this.stage.registry.register(rect, this.spec.height.id);

    const caption = doc.createElementNS(SVG_NS, 'text');
    caption.classList.add('mr-strip-label');
    svg.appendChild(caption);
    this.caption = caption;

    this.paint();
    return root;
  }

  /** Model-level geometry — headless tests assert against this. */
  geometry(): { readonly x: number; readonly width: number; readonly height: number } {
    return {
      x: this.spec.at.value,
      width: this.spec.width.value,
      height: this.spec.height.value,
    };
  }

  private paint(): void {
    const f = this.frame;
    const { x, width, height } = this.geometry();
    if (!this.rect) return;
    const px = f.x(x);
    // a vanishing Δx must stay visible as a hairline, not disappear
    const pw = Math.max(1, Math.abs(f.x(x + width) - px));
    const top = f.y(Math.max(height, 0));
    const bottom = f.y(Math.min(height, 0));
    this.rect.setAttribute('x', px.toFixed(2));
    this.rect.setAttribute('y', top.toFixed(2));
    this.rect.setAttribute('width', pw.toFixed(2));
    this.rect.setAttribute('height', Math.max(1, bottom - top).toFixed(2));
    this.rect.classList.toggle('mr-negative', height < 0);
    if (this.caption) {
      this.caption.setAttribute('x', (px + pw + 4).toFixed(2));
      this.caption.setAttribute('y', (top - 5).toFixed(2));
      this.caption.textContent = `Δx = ${width.toPrecision(2)}`;
    }
  }

  override applyState(): void {
    if (this.el) this.paint();
  }
}
