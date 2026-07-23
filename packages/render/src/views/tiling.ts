/**
 * views/tiling.ts — a region cut into cells, drawn so that the cancellation
 * beat of Green's theorem is a thing you can see rather than a thing the
 * narration claims.
 *
 * Two registrations carry the whole lesson:
 *
 *  - **One node per cell, under its `Tile` handle.** `demonstrate(walkTiles)`
 *    replays `tile:derive` per cell, and the derive cue un-hides and pulses
 *    whatever carries the event's subject — so with `cellsMode: 'deferred'`
 *    the cells ink in one at a time, exactly as the Riemann rectangles do.
 *  - **One node per edge, under its `Segment` handle — and two adjacent cells
 *    share that handle.** `NodeRegistry` is a multi-map, so the two traversals
 *    of an interior edge register two nodes under one id and `focus(edge)`
 *    lights BOTH. That is the beat: two contributions, one edge, equal and
 *    opposite. We deliberately do not dedupe by id here; collapsing the pair
 *    into one node would erase the thing being shown.
 *
 * Interior vs boundary is a CSS class (`mr-interior` / `mr-boundary`), not JS
 * colour math, because the lesson focuses the two SETS against each other and
 * they must stay visually separable under theme changes and under focus.
 *
 * Frame policy matches `loop.ts`: provider when `domain` is given, borrower
 * otherwise — a tiling laid over a vector field must share the field's mapping
 * or the cells drift off the arrows.
 *
 * Per-frame cost: one `corners()` call (4 live points) and one `d` write per
 * cell, plus 2 endpoint reads and one `d` write per edge. For the n×n tiling
 * that is n² cells and 2n(n+1) edges — 4 and 12 at n = 2, 100 and 220 at
 * n = 10, which is why the lessons tile small. The DOM is built ONCE in
 * `render`; paint only mutates attributes.
 */

import type { Handle, Id } from '@math-ai/core';
import type { Stage } from '../stage.js';
import { FramedView, SVG_NS, createFrame, svgLayer } from './frame.js';
import type { CoordFrame } from './frame.js';
import { edgePath } from './loop.js';
import { renderTex } from '../tex.js';

export interface TilingCellRef {
  readonly handle: Handle;
  /** LIVE: 4 points, re-read on every paint. */
  readonly corners: () => readonly (readonly [number, number])[];
}

export interface TilingEdgeRef {
  /** The shared `Segment` — two adjacent cells hand over the SAME id. */
  readonly handle: Handle;
  readonly from: () => readonly [number, number];
  readonly to: () => readonly [number, number];
  readonly interior: boolean;
}

export interface TilingSpec {
  readonly subject: Handle;
  readonly cells: readonly TilingCellRef[];
  readonly edges: readonly TilingEdgeRef[];
  readonly label?: string;
  /** When present the tiling OWNS the frame; otherwise it borrows one. */
  readonly domain?: readonly [number, number];
  readonly range?: readonly [number, number];
  /** Pre-hide the cells so `demonstrate(walk)` inks them in. Default 'deferred'. */
  readonly cellsMode?: 'shown' | 'deferred';
}

export class TilingView extends FramedView {
  private readonly frameRef: CoordFrame | null;
  private readonly cellNodes = new Map<number, SVGPathElement>();
  private readonly edgeNodes = new Map<number, SVGPathElement>();

  constructor(
    stage: Stage,
    private readonly spec: TilingSpec,
  ) {
    super(stage, 'view:tiling');
    if (spec.domain) {
      this.frameRef = createFrame(spec.domain, spec.range ?? spec.domain, {
        width: 300,
        height: 300,
        pad: 18,
      });
      stage.registerFrame(spec.subject.id, this.frameRef);
      stage.registerFrame(this.id, this.frameRef);
    } else {
      this.frameRef = null;
    }
  }

  override ownFrame(): CoordFrame | null {
    return this.frameRef;
  }

  protected override frameSubjectId(): Id | null {
    return this.spec.subject.id;
  }

  cellCount(): number {
    return this.spec.cells.length;
  }

  edgeCount(): { readonly interior: number; readonly boundary: number } {
    let interior = 0;
    for (const e of this.spec.edges) if (e.interior) interior += 1;
    return { interior, boundary: this.spec.edges.length - interior };
  }

  override get elements(): readonly Handle[] {
    // cells first, then edges: both are objects the lesson addresses by name
    return [...this.spec.cells.map((c) => c.handle), ...this.spec.edges.map((e) => e.handle)];
  }

  protected render(doc: Document): HTMLElement {
    const root = doc.createElement('div');
    root.classList.add('mr-tiling');
    const svg = svgLayer(doc, this.frame, 'mr-tiling-svg');
    root.appendChild(svg);
    this.appendBackdrop(doc, svg);

    const deferred = (this.spec.cellsMode ?? 'deferred') === 'deferred';
    this.spec.cells.forEach((c, i) => {
      const path = doc.createElementNS(SVG_NS, 'path');
      path.classList.add('mr-tiling-cell');
      if (deferred) path.classList.add('mr-prehidden');
      svg.appendChild(path);
      this.cellNodes.set(i, path);
      this.stage.registry.register(path, c.handle.id);
    });

    // edges last, so the lattice draws over the cell fills
    this.spec.edges.forEach((e, i) => {
      const path = doc.createElementNS(SVG_NS, 'path');
      path.classList.add('mr-tiling-edge', e.interior ? 'mr-interior' : 'mr-boundary');
      svg.appendChild(path);
      this.edgeNodes.set(i, path);
      this.stage.registry.register(path, e.handle.id);
    });

    if (this.spec.label) {
      const caption = doc.createElement('div');
      caption.className = 'mr-plot-caption';
      renderTex(caption, this.spec.label);
      root.insertBefore(caption, svg);
      this.stage.registry.register(caption, this.spec.subject.id);
    }

    this.paint();
    return root;
  }

  /** cells × (corners + `d`) + edges × (2 reads + `d`). No node churn. */
  private paint(): void {
    const f = this.frame;
    this.spec.cells.forEach((c, i) => {
      const node = this.cellNodes.get(i);
      if (!node) return;
      node.setAttribute('d', cellPath(f, c.corners()));
    });
    // the barb makes the two traversals of a shared edge indistinguishable, so
    // tiling edges are drawn plain — the loop view is where orientation reads
    this.spec.edges.forEach((e, i) => {
      const node = this.edgeNodes.get(i);
      if (!node) return;
      node.setAttribute('d', edgePath(f, e.from(), e.to(), false));
    });
  }

  override applyState(): void {
    if (this.el) this.paint();
  }
}

/** A closed polygon through the cell's live corners. */
function cellPath(f: CoordFrame, corners: readonly (readonly [number, number])[]): string {
  if (corners.length === 0) return '';
  const parts: string[] = [];
  corners.forEach((p, i) => {
    const px = f.x(p[0]);
    const py = f.y(p[1]);
    if (!Number.isFinite(px) || !Number.isFinite(py)) return;
    parts.push(`${i === 0 ? 'M' : 'L'} ${px.toFixed(2)} ${py.toFixed(2)}`);
  });
  if (parts.length === 0) return '';
  return `${parts.join(' ')} Z`;
}
