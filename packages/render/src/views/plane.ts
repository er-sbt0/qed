/**
 * views/plane.ts — the coordinate plane, optionally the lattice UNDER a linear
 * map. With a map, every grid line is the image of a grid line: dragging a
 * matrix entry shears the whole lattice live, because the mapped points are
 * read on each refresh.
 *
 * The plane PROVIDES the coordinate frame for the regions and vectors overlaid
 * on it (the determinant story's shared frame).
 */

import type { Handle } from '@math-ai/core';
import type { Stage } from '../stage.js';
import { FramedView, SVG_NS, createFrame, drawTicks, polyline, svgLayer } from './frame.js';
import type { CoordFrame } from './frame.js';

export interface PlaneSpec {
  readonly grid?: boolean;
  readonly domain?: readonly [number, number];
  /** Apply to every lattice point — the transformed grid. */
  readonly map?: (x: number, y: number) => { readonly x: number; readonly y: number };
  readonly step?: number;
}

const SEGMENTS = 12;

export class PlaneView extends FramedView {
  private readonly frameRef: CoordFrame;
  private readonly domain: readonly [number, number];
  private gridEl: SVGGElement | null = null;

  constructor(
    stage: Stage,
    private readonly spec: PlaneSpec,
  ) {
    super(stage, 'view:plane');
    this.domain = spec.domain ?? [-3, 3];
    this.frameRef = createFrame(this.domain, this.domain, { width: 300, height: 300, pad: 18 });
    stage.registerFrame(this.id, this.frameRef);
  }

  override ownFrame(): CoordFrame {
    return this.frameRef;
  }

  protected render(doc: Document): HTMLElement {
    const root = doc.createElement('div');
    root.classList.add('mr-plane');
    const svg = svgLayer(doc, this.frameRef, 'mr-plane-svg');
    root.appendChild(svg);

    const grid = doc.createElementNS(SVG_NS, 'g');
    grid.classList.add('mr-grid');
    svg.appendChild(grid);
    this.gridEl = grid;

    const axes = doc.createElementNS(SVG_NS, 'path');
    const f = this.frameRef;
    axes.setAttribute(
      'd',
      `M ${f.x(this.domain[0])} ${f.y(0)} L ${f.x(this.domain[1])} ${f.y(0)} ` +
        `M ${f.x(0)} ${f.y(this.domain[0])} L ${f.x(0)} ${f.y(this.domain[1])}`,
    );
    axes.classList.add('mr-axis');
    svg.appendChild(axes);
    drawTicks(doc, svg, f, { atX: f.x(0), atY: f.y(0) });

    this.paintGrid(doc);
    return root;
  }

  private paintGrid(doc: Document): void {
    const grid = this.gridEl;
    if (!grid || (this.spec.grid ?? true) === false) return;
    while (grid.firstChild) grid.removeChild(grid.firstChild);
    const f = this.frameRef;
    const [lo, hi] = this.domain;
    const step = this.spec.step ?? 1;
    const map = this.spec.map ?? ((x: number, y: number) => ({ x, y }));
    const line = (pts: ReadonlyArray<readonly [number, number]>): void => {
      const path = doc.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', polyline(pts));
      path.classList.add('mr-gridline');
      grid.appendChild(path);
    };
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) {
      const horizontal: Array<readonly [number, number]> = [];
      const vertical: Array<readonly [number, number]> = [];
      for (let i = 0; i <= SEGMENTS; i += 1) {
        const t = lo + ((hi - lo) * i) / SEGMENTS;
        const h = map(t, v);
        const w = map(v, t);
        horizontal.push([f.x(h.x), f.y(h.y)] as const);
        vertical.push([f.x(w.x), f.y(w.y)] as const);
      }
      line(horizontal);
      line(vertical);
    }
  }

  override applyState(): void {
    if (this.el && this.stage.doc) this.paintGrid(this.stage.doc);
  }

  override get elements(): readonly Handle[] {
    return [this];
  }
}
