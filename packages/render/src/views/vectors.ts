/**
 * views/vectors.ts — arrows from the origin, one per vector handle. Components
 * are read live, so basis vectors drawn under a linear map follow a matrix
 * drag.
 *
 * Element granularity: the VECTORS are the elements — each arrow registers
 * under its own handle, so a vector can be linked, focused, or morphed
 * individually.
 */

import type { Handle } from '@math-ai/core';
import type { Stage } from '../stage.js';
import { FramedView, SVG_NS, svgLayer } from './frame.js';
import { plainTex } from '../tex.js';

export interface VectorRef {
  readonly handle: Handle;
  x(): number;
  y(): number;
  readonly label?: string;
}

export interface VectorsSpec {
  readonly vectors: readonly VectorRef[];
}

export class VectorsView extends FramedView {
  private readonly arrows = new Map<string, { line: SVGLineElement; text: SVGTextElement | null }>();

  constructor(
    stage: Stage,
    private readonly spec: VectorsSpec,
  ) {
    super(stage, 'view:vectors');
  }

  override get elements(): readonly Handle[] {
    return this.spec.vectors.map((v) => v.handle);
  }

  protected render(doc: Document): HTMLElement {
    const root = doc.createElement('div');
    root.classList.add('mr-vectors');
    const svg = svgLayer(doc, this.frame, 'mr-vectors-svg');
    root.appendChild(svg);
    this.appendBackdrop(doc, svg);

    for (const v of this.spec.vectors) {
      const g = doc.createElementNS(SVG_NS, 'g');
      g.classList.add('mr-arrow');
      const line = doc.createElementNS(SVG_NS, 'line');
      g.appendChild(line);
      let text: SVGTextElement | null = null;
      if (v.label) {
        text = doc.createElementNS(SVG_NS, 'text');
        text.classList.add('mr-arrow-label');
        text.textContent = plainTex(v.label);
        g.appendChild(text);
      }
      svg.appendChild(g);
      this.stage.registry.register(g, v.handle.id);
      this.arrows.set(v.handle.id, { line, text });
    }
    this.paint();
    return root;
  }

  private paint(): void {
    const f = this.frame;
    const ox = f.x(0);
    const oy = f.y(0);
    for (const v of this.spec.vectors) {
      const arrow = this.arrows.get(v.handle.id);
      if (!arrow) continue;
      const px = f.x(v.x());
      const py = f.y(v.y());
      arrow.line.setAttribute('x1', ox.toFixed(2));
      arrow.line.setAttribute('y1', oy.toFixed(2));
      arrow.line.setAttribute('x2', px.toFixed(2));
      arrow.line.setAttribute('y2', py.toFixed(2));
      arrow.text?.setAttribute('x', (px + 6).toFixed(2));
      arrow.text?.setAttribute('y', (py - 6).toFixed(2));
    }
  }

  override applyState(): void {
    if (this.el) this.paint();
  }
}
