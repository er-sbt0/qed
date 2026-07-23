/**
 * views/region.ts — a filled region in a coordinate frame, in the two shapes
 * the continuous examples need:
 *
 *  - `under` — the signed area under a curve from `from` to a LIVE upper limit
 *    (FTC). Reactive: the fill follows a dragged x, and `boundary` is an
 *    addressable subpart (the moving right edge) that correspondence links to
 *    the plot's moving point.
 *  - `polygon` — a filled polygon whose vertices are live (determinant). Each
 *    vertex registers under its own handle, which is what makes
 *    `morph(square, image)` route corner-to-corner: the routes the lesson
 *    computed are over the `maps-to` edges `LinearMap.apply` recorded, and the
 *    player resolves each endpoint to one of these vertex nodes.
 *
 * The fill is keyed to the SIGN of the area, so `det → 0` collapsing to a line
 * and `det < 0` flipping orientation are EMERGENT visuals — no `onCondition`
 * verb (spikes/determinant/FINDINGS.md).
 */

import type { Handle, Id } from '@math-ai/core';
import type { NumericHandle } from '@math-ai/lesson';
import type { Stage } from '../stage.js';
import { FramedView, SVG_NS, polyline, svgLayer } from './frame.js';
import { fmt } from '../util.js';
import { plainTex } from '../tex.js';

export interface UnderCurveSpec {
  readonly mode: 'under';
  readonly subject: Handle;
  /** Height rule, sampled at authoring time (capture policy). */
  readonly sample: (x: number) => number;
  readonly from: number;
  /** The live upper limit — a Parameter in every authored program. */
  readonly to: NumericHandle;
  readonly signed?: boolean;
  readonly label?: string;
}

export interface PolygonVertex {
  readonly handle: Handle;
  x(): number;
  y(): number;
}

export interface PolygonSpec {
  readonly mode: 'polygon';
  readonly subject: Handle;
  readonly vertices: readonly PolygonVertex[];
  /** Signed area — its sign keys the fill (orientation), reactive. */
  readonly area: NumericHandle;
  readonly label?: string;
}

export type RegionSpec = UnderCurveSpec | PolygonSpec;

const FILL_SAMPLES = 96;

export class RegionView extends FramedView {
  /** The moving edge of an under-curve region — an addressable subpart. */
  readonly boundary: Handle;
  private area: SVGPathElement | null = null;
  private edge: SVGLineElement | null = null;
  private labelEl: SVGTextElement | null = null;
  private readonly vertexEls = new Map<string, SVGCircleElement>();

  constructor(
    stage: Stage,
    private readonly spec: RegionSpec,
  ) {
    super(stage, 'view:region');
    this.boundary = stage.world.handle('region:boundary');
  }

  protected override frameSubjectId(): Id | null {
    // an under-curve region belongs on the plot of the very function it fills
    return this.spec.mode === 'under' ? this.spec.subject.id : null;
  }

  override get elements(): readonly Handle[] {
    return this.spec.mode === 'polygon'
      ? this.spec.vertices.map((v) => v.handle)
      : [this.spec.subject];
  }

  /** Signed area of the region right now (polygon: reactive; under: quadrature). */
  signedArea(): number {
    if (this.spec.mode === 'polygon') return this.spec.area.value;
    return this.trapezoid();
  }

  private trapezoid(): number {
    if (this.spec.mode !== 'under') return 0;
    const a = this.spec.from;
    const b = this.spec.to.value;
    if (!Number.isFinite(b) || a === b) return 0;
    const n = FILL_SAMPLES;
    const h = (b - a) / n;
    let sum = 0;
    for (let i = 0; i < n; i += 1) {
      sum += (this.spec.sample(a + i * h) + this.spec.sample(a + (i + 1) * h)) / 2;
    }
    return sum * h;
  }

  private fillPath(): string {
    const f = this.frame;
    if (this.spec.mode === 'polygon') {
      const pts = this.spec.vertices.map((v) => [f.x(v.x()), f.y(v.y())] as const);
      return pts.length > 0 ? `${polyline(pts)} Z` : '';
    }
    const a = this.spec.from;
    const b = this.spec.to.value;
    if (!Number.isFinite(b)) return '';
    const n = FILL_SAMPLES;
    const pts: Array<readonly [number, number]> = [];
    for (let i = 0; i <= n; i += 1) {
      const x = a + ((b - a) * i) / n;
      pts.push([f.x(x), f.y(this.spec.sample(x))] as const);
    }
    return `${polyline(pts)} L ${f.x(b).toFixed(2)} ${f.y(0).toFixed(2)} L ${f
      .x(a)
      .toFixed(2)} ${f.y(0).toFixed(2)} Z`;
  }

  protected render(doc: Document): HTMLElement {
    const root = doc.createElement('div');
    root.classList.add('mr-region');
    const svg = svgLayer(doc, this.frame, 'mr-region-svg');
    root.appendChild(svg);
    this.appendBackdrop(doc, svg);

    const area = doc.createElementNS(SVG_NS, 'path');
    area.classList.add('mr-fill');
    svg.appendChild(area);
    this.area = area;
    this.stage.registry.register(area, this.spec.subject.id);
    this.stage.registry.register(area, this.id);

    if (this.spec.mode === 'under') {
      const edge = doc.createElementNS(SVG_NS, 'line');
      edge.classList.add('mr-region-edge');
      svg.appendChild(edge);
      this.edge = edge;
      this.stage.registry.register(edge, this.boundary.id);
    } else {
      for (const v of this.spec.vertices) {
        const dot = doc.createElementNS(SVG_NS, 'circle');
        dot.setAttribute('r', '3.5');
        dot.classList.add('mr-vertex');
        svg.appendChild(dot);
        this.stage.registry.register(dot, v.handle.id);
        this.vertexEls.set(v.handle.id, dot);
      }
    }

    if (this.spec.label) {
      const text = doc.createElementNS(SVG_NS, 'text');
      text.classList.add('mr-region-label');
      svg.appendChild(text);
      this.labelEl = text;
      this.stage.registry.register(text, this.spec.subject.id);
    }

    this.paint();
    return root;
  }

  private paint(): void {
    const f = this.frame;
    const signed = this.signedArea();
    this.area?.setAttribute('d', this.fillPath());
    // orientation and collapse, emergent from the sign and magnitude
    this.area?.classList.toggle('mr-negative', signed < 0);
    this.area?.classList.toggle('mr-collapsed', Math.abs(signed) < 1e-6);

    if (this.spec.mode === 'under' && this.edge) {
      const b = this.spec.to.value;
      this.edge.setAttribute('x1', f.x(b).toFixed(2));
      this.edge.setAttribute('y1', f.y(0).toFixed(2));
      this.edge.setAttribute('x2', f.x(b).toFixed(2));
      this.edge.setAttribute('y2', f.y(this.spec.sample(b)).toFixed(2));
    }
    if (this.spec.mode === 'polygon') {
      for (const v of this.spec.vertices) {
        const dot = this.vertexEls.get(v.handle.id);
        dot?.setAttribute('cx', f.x(v.x()).toFixed(2));
        dot?.setAttribute('cy', f.y(v.y()).toFixed(2));
      }
    }
    if (this.labelEl && this.spec.label) {
      const anchor = this.centroid();
      this.labelEl.setAttribute('x', anchor[0].toFixed(2));
      this.labelEl.setAttribute('y', anchor[1].toFixed(2));
      this.labelEl.textContent = `${plainTex(this.spec.label)} ${fmt(signed)}`;
    }
  }

  private centroid(): readonly [number, number] {
    const f = this.frame;
    if (this.spec.mode === 'polygon') {
      const vs = this.spec.vertices;
      if (vs.length === 0) return [f.x(0), f.y(0)];
      const cx = vs.reduce((s, v) => s + v.x(), 0) / vs.length;
      const cy = vs.reduce((s, v) => s + v.y(), 0) / vs.length;
      return [f.x(cx), f.y(cy)];
    }
    const mid = (this.spec.from + this.spec.to.value) / 2;
    return [f.x(mid), f.y(this.spec.sample(mid) / 2)];
  }

  override applyState(): void {
    if (this.el) this.paint();
  }
}
