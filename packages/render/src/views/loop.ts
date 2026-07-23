/**
 * views/loop.ts — an oriented closed loop, drawn one SEGMENT at a time.
 *
 * Why not a single polyline: the Green's-theorem beats address individual
 * edges. `lesson.focus(segment)` must light one edge, and `demonstrate(walk)`
 * inks the contributions in one at a time by replaying `contribution:derive`
 * against the segment each contribution links to. Both need a DOM node per
 * segment registered under that segment's OWN handle id — the `riemann.ts`
 * precedent, and here it is what the lesson is actually about. One path per
 * edge also costs nothing extra: an n-gon's polyline was already n line
 * commands, they just live in n nodes now.
 *
 * Frame policy is the interesting half. A loop USUALLY draws over a vector
 * field, and it must agree with the field's domain→pixel mapping or the walk
 * marches off the arrows. So: provider when `domain` is given, borrower
 * otherwise — and as a borrower it asks for its subject's frame first
 * (`frameSubjectId`), falling back to the overlay's frame and then the stage's
 * ambient one. Nothing here mints a frame silently.
 *
 * Vertices are LIVE closures, re-read on every paint, so a loop over a dragged
 * Parameter deforms without any per-vertex wiring. Per-frame cost: 2 closure
 * evaluations and one `d` write per segment — 8 reads for a rectangle, ~96 for
 * the 48-gon `circleLoop` mints, which is affordable on every pointermove. The
 * DOM is built ONCE in `render`; paint only mutates attributes.
 *
 * Arrowheads are inline path geometry appended to the shaft's own `d`, not a
 * `<defs>` marker: the barb then inherits the edge's stroke for free, focus
 * lights shaft and head together, and there is no document-unique marker id to
 * coordinate across however many loops a lesson mounts.
 */

import type { Handle, Id } from '@math-ai/core';
import type { Stage } from '../stage.js';
import { FramedView, SVG_NS, createFrame, svgLayer } from './frame.js';
import type { CoordFrame } from './frame.js';
import { renderTex } from '../tex.js';

export interface LoopSegmentRef {
  readonly handle: Handle;
  /** LIVE: re-read on every paint. */
  readonly from: () => readonly [number, number];
  /** LIVE: re-read on every paint. */
  readonly to: () => readonly [number, number];
}

export interface LoopSpec {
  /** The OrientedLoop handle — the caption's subject, and the frame subject. */
  readonly subject: Handle;
  readonly segments: readonly LoopSegmentRef[];
  readonly label?: string;
  /** When present the loop OWNS the frame; otherwise it borrows one. */
  readonly domain?: readonly [number, number];
  /** Defaults to `domain` (a square patch of the plane). */
  readonly range?: readonly [number, number];
  /** Draw direction arrowheads along each edge. Default true. */
  readonly showOrientation?: boolean;
}

/** Barb length as a fraction of the edge, capped so long edges stay tidy. */
const HEAD_FRACTION = 0.24;
const HEAD_MAX_PX = 7;
const HEAD_MIN_PX = 2.5;

export class LoopView extends FramedView {
  private readonly frameRef: CoordFrame | null;
  private readonly edges = new Map<number, SVGPathElement>();

  constructor(
    stage: Stage,
    private readonly spec: LoopSpec,
  ) {
    super(stage, 'view:loop');
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

  /**
   * A loop drawn over a field belongs in THAT field's frame, and the program
   * hands the loop's subject to whichever view provides it.
   */
  protected override frameSubjectId(): Id | null {
    return this.spec.subject.id;
  }

  /** Model-level, headless: the live vertex chain, one point per segment start. */
  path(): readonly (readonly [number, number])[] {
    return this.spec.segments.map((s) => s.from());
  }

  override get elements(): readonly Handle[] {
    // per-segment, because focusing ONE edge is the whole cancellation beat
    return this.spec.segments.map((s) => s.handle);
  }

  protected render(doc: Document): HTMLElement {
    const root = doc.createElement('div');
    root.classList.add('mr-loop');
    const svg = svgLayer(doc, this.frame, 'mr-loop-svg');
    root.appendChild(svg);
    this.appendBackdrop(doc, svg);

    this.spec.segments.forEach((seg, i) => {
      const path = doc.createElementNS(SVG_NS, 'path');
      path.classList.add('mr-loop-edge');
      svg.appendChild(path);
      this.edges.set(i, path);
      this.stage.registry.register(path, seg.handle.id);
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

  /** 2 closure reads + 1 attribute write per segment. No node churn. */
  private paint(): void {
    const f = this.frame;
    const oriented = this.spec.showOrientation !== false;
    this.spec.segments.forEach((seg, i) => {
      const path = this.edges.get(i);
      if (!path) return;
      path.setAttribute('d', edgePath(f, seg.from(), seg.to(), oriented));
    });
  }

  override applyState(): void {
    if (this.el) this.paint();
  }
}

/**
 * Shaft plus, optionally, one barb straddling the midpoint and pointing along
 * `to − from`. Shared with `tiling.ts`, which draws the same edges.
 */
export function edgePath(
  f: CoordFrame,
  from: readonly [number, number],
  to: readonly [number, number],
  oriented: boolean,
): string {
  const ax = f.x(from[0]);
  const ay = f.y(from[1]);
  const bx = f.x(to[0]);
  const by = f.y(to[1]);
  if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) {
    return '';
  }
  const shaft = `M ${ax.toFixed(2)} ${ay.toFixed(2)} L ${bx.toFixed(2)} ${by.toFixed(2)}`;
  if (!oriented) return shaft;
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (!Number.isFinite(len) || len === 0) return shaft;
  const ux = dx / len;
  const uy = dy / len;
  const head = Math.max(HEAD_MIN_PX, Math.min(HEAD_MAX_PX, len * HEAD_FRACTION));
  // the barb TIP sits just past the midpoint, so the mark reads as "this way"
  const tx = (ax + bx) / 2 + (ux * head) / 2;
  const ty = (ay + by) / 2 + (uy * head) / 2;
  const cos = Math.cos(Math.PI / 6);
  const sin = Math.sin(Math.PI / 6);
  const b1x = tx - head * (ux * cos - uy * sin);
  const b1y = ty - head * (uy * cos + ux * sin);
  const b2x = tx - head * (ux * cos + uy * sin);
  const b2y = ty - head * (uy * cos - ux * sin);
  return (
    `${shaft} M ${b1x.toFixed(2)} ${b1y.toFixed(2)} L ${tx.toFixed(2)} ${ty.toFixed(2)} ` +
    `L ${b2x.toFixed(2)} ${b2y.toFixed(2)}`
  );
}
