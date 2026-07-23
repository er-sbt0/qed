/**
 * views/heatmap.ts — a scalar field over a square patch of the plane, drawn as
 * a tiling of constant-colour cells. The companion to `field.ts`: same lattice
 * idea, but the quantity is a number rather than an arrow, so the encoding is
 * area-filling instead of directional.
 *
 * Live, like the field and unlike `plot.ts`: the rule is re-evaluated on every
 * paint, because a potential that does not deform under a drag has no reason to
 * be a heatmap. The budget is grid² rule evaluations per paint — 256 at the
 * default grid of 16 — plus 256 attribute writes onto rects built ONCE in
 * `render`. Nothing is created or removed after mount; at this node count a
 * wipe-and-rebuild per pointermove would be visible.
 *
 * Colour is the established diverging idiom, not a new JS colour scale:
 * `--mr-accent` for positive, `--mr-reject` for negative via an `mr-negative`
 * class toggle (region.ts), magnitude via `fill-opacity` normalized against the
 * largest |value| in the CURRENT paint — so a field that weakens under a drag
 * visibly fades instead of silently rescaling to look identical.
 */

import type { Handle } from '@math-ai/core';
import type { Stage } from '../stage.js';
import { FramedView, SVG_NS, createFrame, svgLayer } from './frame.js';
import type { CoordFrame } from './frame.js';
import { renderTex } from '../tex.js';

export interface HeatmapCell {
  readonly x0: number;
  readonly x1: number;
  readonly y0: number;
  readonly y1: number;
  readonly value: number;
}

export interface HeatmapSpec {
  /** LIVE: re-sampled on every paint, so a Parameter inside the rule redraws the map. */
  readonly rule: (x: number, y: number) => number;
  readonly domain: readonly [number, number];
  /** Defaults to `domain` (a square patch of the plane). */
  readonly range?: readonly [number, number];
  /** Cells per axis. Default 16 (256 cells). */
  readonly grid?: number;
  readonly label?: string;
  /** Frame-registration subject, if the heatmap owns the frame. */
  readonly subject?: Handle;
}

const DEFAULT_GRID = 16;
/** Opacity of the strongest cell; weaker cells scale down from here. */
const MAX_OPACITY = 0.85;
const MIN_OPACITY = 0.02;

export class HeatmapView extends FramedView {
  private readonly frameRef: CoordFrame;
  private readonly domain: readonly [number, number];
  private readonly range: readonly [number, number];
  private readonly grid: number;
  private readonly rects = new Map<number, SVGRectElement>();

  constructor(
    stage: Stage,
    private readonly spec: HeatmapSpec,
  ) {
    super(stage, 'view:heatmap');
    this.domain = spec.domain;
    this.range = spec.range ?? spec.domain;
    this.grid = Math.max(1, Math.floor(spec.grid ?? DEFAULT_GRID));
    this.frameRef = createFrame(this.domain, this.range, { width: 300, height: 300, pad: 18 });
    if (spec.subject) stage.registerFrame(spec.subject.id, this.frameRef);
    stage.registerFrame(this.id, this.frameRef);
  }

  override ownFrame(): CoordFrame {
    return this.frameRef;
  }

  /**
   * Model-level, headless. Row-major with x varying fastest, and edges computed
   * from the same expression on both sides, so cell i's `x1` is EXACTLY cell
   * i+1's `x0` — the tiling has no seams to fall through.
   */
  cells(): readonly HeatmapCell[] {
    const n = this.grid;
    const [d0, d1] = this.domain;
    const [r0, r1] = this.range;
    const edgeX = (i: number): number => d0 + ((d1 - d0) * i) / n;
    const edgeY = (j: number): number => r0 + ((r1 - r0) * j) / n;
    const out: HeatmapCell[] = [];
    for (let j = 0; j < n; j += 1) {
      const y0 = edgeY(j);
      const y1 = edgeY(j + 1);
      for (let i = 0; i < n; i += 1) {
        const x0 = edgeX(i);
        const x1 = edgeX(i + 1);
        out.push({ x0, x1, y0, y1, value: this.spec.rule((x0 + x1) / 2, (y0 + y1) / 2) });
      }
    }
    return out;
  }

  protected render(doc: Document): HTMLElement {
    const root = doc.createElement('div');
    root.classList.add('mr-heatmap');
    const svg = svgLayer(doc, this.frameRef, 'mr-heatmap-svg');
    root.appendChild(svg);

    const total = this.grid * this.grid;
    for (let k = 0; k < total; k += 1) {
      const rect = doc.createElementNS(SVG_NS, 'rect');
      rect.classList.add('mr-heatmap-cell');
      svg.appendChild(rect);
      this.rects.set(k, rect);
    }

    if (this.spec.label) {
      const caption = doc.createElement('div');
      caption.className = 'mr-plot-caption';
      renderTex(caption, this.spec.label);
      root.insertBefore(caption, svg);
      if (this.spec.subject) this.stage.registry.register(caption, this.spec.subject.id);
    }

    this.paint();
    return root;
  }

  /** grid² rule evaluations, then grid² attribute writes. No node churn. */
  private paint(): void {
    const f = this.frameRef;
    const cells = this.cells();
    let peak = 0;
    for (const c of cells) {
      const m = Math.abs(c.value);
      if (Number.isFinite(m) && m > peak) peak = m;
    }
    for (let k = 0; k < cells.length; k += 1) {
      const rect = this.rects.get(k);
      const c = cells[k];
      if (!rect || !c) continue;
      const px0 = f.x(c.x0);
      const px1 = f.x(c.x1);
      const py0 = f.y(c.y0);
      const py1 = f.y(c.y1);
      rect.setAttribute('x', Math.min(px0, px1).toFixed(3));
      rect.setAttribute('y', Math.min(py0, py1).toFixed(3));
      rect.setAttribute('width', Math.abs(px1 - px0).toFixed(3));
      rect.setAttribute('height', Math.abs(py1 - py0).toFixed(3));
      const v = Number.isFinite(c.value) ? c.value : 0;
      const strength = peak > 0 ? Math.abs(v) / peak : 0;
      rect.setAttribute('fill-opacity', (MIN_OPACITY + strength * (MAX_OPACITY - MIN_OPACITY)).toFixed(3));
      rect.classList.toggle('mr-negative', v < 0);
    }
  }

  override applyState(): void {
    if (this.el) this.paint();
  }

  override get elements(): readonly Handle[] {
    // The subject field, but never the cells: a cell is not a semantic object
    // the lesson addresses, and 256 minted handles would make every
    // `viewProjecting` scan pay for them. The subject must be here, though —
    // it is how a shown heatmap's field reaches the manifest at all.
    return this.spec.subject ? [this.spec.subject] : [this];
  }
}
