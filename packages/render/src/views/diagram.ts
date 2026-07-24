/**
 * views/diagram.ts — the geometry ESCAPE HATCH.
 *
 * Every other continuous view is a hand-written renderer for one idea (a plot,
 * a field, a tiling). `View.diagram(frame, draw)` is the bottom tier the moat
 * has always promised: the author is handed a `pen` and draws low-level marks
 * — point · path · text · glyph — in MATH-SPACE coordinates of a declared
 * frame. No pixels ever appear in the authored `draw`; the frame owns the
 * pixel mapping, ticks, and fit.
 *
 * Live-repaint, exactly like `field.ts`: `draw` is re-run on every paint, so a
 * `LiveValue` (a Parameter) read INSIDE the closure redraws under a drag with
 * no extra wiring. Unlike a field's DOM-once policy, the mark set is authored
 * afresh each paint (its size is the author's, not a bounded lattice), so the
 * marks layer is wiped and rebuilt.
 *
 * THE MARSHALLING TRICK (see host/bridge.ts): when `draw` is a guest closure,
 * the host re-invokes it at paint and must hand it the `pen`. The pen is
 * Handle-shaped (`{ id, kind: 'diagram:pen' }`) so `bridge.encode` passes it BY
 * REFERENCE — a live proxy whose method calls (`pen.point(...)`) round-trip
 * back as host invokes — instead of value-copying it to dead stubs. ONE pen
 * instance is interned across paints for that reason.
 */

import type { Handle } from '@math-ai/core';
import type { Stage } from '../stage.js';
import {
  FRAME_H,
  FRAME_PAD,
  FRAME_W,
  FramedView,
  SVG_NS,
  createFrame,
  polyline,
  svgLayer,
} from './frame.js';
import type { CoordFrame } from './frame.js';
import { renderTex } from '../tex.js';

/** Semantic colour roles (docs/visual.md): free/amber, constraint/blue, escape/green, reject/red. */
export type MarkRole = 'free' | 'constraint' | 'escape' | 'reject' | 'neutral';

export interface MarkOpts {
  readonly role?: MarkRole;
  /** Register this mark's node under a semantic handle, so narration / resonance can light it. */
  readonly under?: Handle;
}
export interface PointOpts extends MarkOpts {
  /** Radius in pixels (a point is a fixed-size dot, not a math-space disc). Default 3. */
  readonly r?: number;
}
export interface PathOpts extends MarkOpts {
  readonly closed?: boolean;
  readonly fill?: boolean;
}
export interface TextOpts extends MarkOpts {
  readonly anchor?: 'start' | 'middle' | 'end';
  /** Font size in pixels. Omitted = the stage default (a small label). Raise it
   *  for a headline number — the ∞ a scene turns on wants to be big. */
  readonly size?: number;
}
export interface GlyphOpts extends MarkOpts {
  /** Half-extent in pixels. Default 4. */
  readonly size?: number;
  /** Arrow heading in radians (only `arrow`). Default 0 (points +x). */
  readonly angle?: number;
}

export type GlyphKind = 'dot' | 'cross' | 'ring' | 'arrow';

/**
 * The SEMANTIC state of a point, one level above a raw colour role — the
 * distinction the rack lesson was hand-mapping (`role: bad ? 'reject' : …`).
 * `marker` turns it into the role: free→amber, constrained/plain→neutral,
 * violated→red.
 */
export type MarkerState = 'free' | 'constrained' | 'violated' | 'plain';

/** A band in MATH-SPACE — the author feeds `center`/`lo`/`hi` back into `pen.*`. */
export interface MathBand {
  readonly center: number;
  readonly lo: number;
  readonly hi: number;
  readonly width: number;
}

export interface BandOpts {
  /** Fraction of each slot reserved as the gap between bands (0..1). Default 0.2. */
  readonly padding?: number;
  /**
   * A per-column shrink ratio in (0, 1): successive bands get geometrically
   * smaller widths (the receding "forever" tail), still spanning the domain.
   * Omitted = equal spacing.
   */
  readonly recede?: number;
}

/** Options for `pen.band` — a vertical strip/column-cell centred at a math-x. */
export interface BandMarkOpts extends MarkOpts {
  /** Strip width in DOMAIN units. Default: 6% of the domain span. */
  readonly width?: number;
  /** Bottom of the strip, in range units. Default: 12% up from the range floor. */
  readonly y0?: number;
  /** Top of the strip, in range units. Default: 12% down from the range ceiling. */
  readonly y1?: number;
  /** Faintly fill the strip so it reads as a cell, not a bare outline. Default true. */
  readonly fill?: boolean;
}

/** Options for `pen.marker` — a point dot coloured by its semantic state. */
export interface MarkerOpts {
  /** The semantic state that picks the colour. Default 'plain'. */
  readonly state?: MarkerState;
  /** Dot radius in pixels. Default 5. */
  readonly size?: number;
  /** Register the dot under a semantic handle, so narration can light it. */
  readonly under?: Handle;
}

/**
 * The drawing surface handed to `draw`. Handle-shaped so it crosses the QuickJS
 * boundary by reference. Coordinate helpers speak MATH-SPACE (the frame owns
 * pixels); emit methods take MATH coordinates and map them internally.
 */
export interface DiagramPen {
  readonly id: string;
  readonly kind: 'diagram:pen';

  // ── math-space coordinate helpers (no pixels) ──
  /** Math-x of column `k` of `n` evenly-spaced columns across the domain (the probe's colX). */
  col(k: number, n?: number): number;
  /** `count` evenly-spaced bands across the domain, in MATH units. */
  bands(count: number, opts?: BandOpts): readonly MathBand[];
  /** Nice-number tick values across the domain (x). */
  xTicks(target?: number): number[];
  /** Nice-number tick values across the range (y). */
  yTicks(target?: number): number[];

  // ── emit (MATH coordinates) ──
  point(x: number, y: number, opts?: PointOpts): void;
  path(points: ReadonlyArray<readonly [number, number]>, opts?: PathOpts): void;
  text(x: number, y: number, str: string, opts?: TextOpts): void;
  glyph(x: number, y: number, kind: GlyphKind, opts?: GlyphOpts): void;

  // ── idioms (compose from the kernel above) ──
  /**
   * A vertical strip/column-cell centred at math-x `x`, from `y0` to `y1` — a
   * soft, faintly-filled band so a rack column reads as a CELL, not a bare line.
   */
  band(x: number, opts?: BandMarkOpts): void;
  /**
   * A point dot whose colour comes from a semantic STATE rather than a raw
   * role: free→amber, constrained/plain→neutral, violated→red.
   */
  marker(x: number, y: number, opts?: MarkerOpts): void;
}

/** A recorded mark, in MATH-SPACE — the headless test surface (`view.collect()`). */
export interface DiagramMark {
  readonly type: 'point' | 'path' | 'text' | 'glyph';
  readonly role: MarkRole;
  readonly at?: readonly [number, number];
  readonly points?: ReadonlyArray<readonly [number, number]>;
  readonly text?: string;
  readonly glyph?: GlyphKind;
}

export interface DiagramFrameSpec {
  readonly domain: readonly [number, number];
  readonly range: readonly [number, number];
  readonly width?: number;
  readonly height?: number;
  readonly pad?: number;
  /** Default column count for `pen.col(k)`. */
  readonly cols?: number;
}

export interface DiagramSpec {
  readonly frame: DiagramFrameSpec;
  /** LIVE: re-run on every paint, so a Parameter read inside it redraws the marks. */
  readonly draw: (pen: DiagramPen) => void;
  readonly label?: string;
  /** If the diagram owns the frame for a semantic object, register it under that id too. */
  readonly subject?: Handle;
}

export class DiagramView extends FramedView {
  private readonly frameRef: CoordFrame;
  private readonly pen: DiagramPenImpl;

  constructor(
    stage: Stage,
    private readonly spec: DiagramSpec,
  ) {
    super(stage, 'view:diagram');
    const { domain, range } = spec.frame;
    this.frameRef = createFrame(domain, range, {
      width: spec.frame.width ?? FRAME_W,
      height: spec.frame.height ?? FRAME_H,
      pad: spec.frame.pad ?? FRAME_PAD,
    });
    if (spec.subject) stage.registerFrame(spec.subject.id, this.frameRef);
    stage.registerFrame(this.id, this.frameRef);
    const penHandle = stage.world.handle('diagram:pen');
    this.pen = new DiagramPenImpl(stage, this.frameRef, spec.frame.cols, penHandle.id);
  }

  override ownFrame(): CoordFrame {
    return this.frameRef;
  }

  /**
   * Model-level, headless — run `draw` against the pen without a DOM and return
   * the marks it authored, in MATH-SPACE. The node tier asserts against this.
   */
  collect(): readonly DiagramMark[] {
    this.pen.reset();
    this.spec.draw(this.pen);
    return this.pen.marks();
  }

  protected render(doc: Document): HTMLElement {
    const root = doc.createElement('div');
    root.classList.add('mr-diagram');
    const svg = svgLayer(doc, this.frameRef, 'mr-diagram-svg');
    const marks = doc.createElementNS(SVG_NS, 'g');
    marks.classList.add('mr-marks');
    svg.appendChild(marks);
    root.appendChild(svg);

    if (this.spec.label) {
      const caption = doc.createElement('div');
      caption.className = 'mr-plot-caption';
      renderTex(caption, this.spec.label);
      root.insertBefore(caption, svg);
    }

    this.pen.attach(doc, marks);
    this.paint();
    return root;
  }

  private paint(): void {
    this.pen.reset();
    this.spec.draw(this.pen);
  }

  override applyState(): void {
    if (this.el) this.paint();
  }
}

/** Semantic point-state → colour role. The mapping `pen.marker` applies. */
const MARKER_ROLE: Record<MarkerState, MarkRole> = {
  free: 'free',
  constrained: 'neutral',
  violated: 'reject',
  plain: 'neutral',
};

class DiagramPenImpl implements DiagramPen {
  readonly id: string;
  readonly kind = 'diagram:pen' as const;
  private doc: Document | null = null;
  private marksEl: Element | null = null;
  private readonly records: DiagramMark[] = [];

  constructor(
    private readonly stage: Stage,
    private readonly frame: CoordFrame,
    private readonly cols: number | undefined,
    id: string,
  ) {
    this.id = id;
  }

  /** Bind the live SVG marks layer (render time); before this the pen only records. */
  attach(doc: Document, marksEl: Element): void {
    this.doc = doc;
    this.marksEl = marksEl;
  }

  reset(): void {
    this.records.length = 0;
    this.marksEl?.replaceChildren();
  }

  marks(): readonly DiagramMark[] {
    return this.records;
  }

  // ── math-space helpers ──

  col(k: number, n?: number): number {
    const count = n ?? this.cols;
    if (count === undefined || count < 1) {
      throw new Error('pen.col(k, n) needs a column count — pass n, or set frame.cols.');
    }
    return this.frame.colX(k, count);
  }

  bands(count: number, opts: BandOpts = {}): readonly MathBand[] {
    return this.frame.mathBands(count, opts);
  }

  xTicks(target?: number): number[] {
    return this.frame.xTicks(target);
  }

  yTicks(target?: number): number[] {
    return this.frame.yTicks(target);
  }

  // ── emit ──

  point(x: number, y: number, opts?: PointOpts): void {
    this.records.push({ type: 'point', role: opts?.role ?? 'neutral', at: [x, y] });
    this.emit('circle', ['mr-mark-point'], opts, (el) => {
      el.setAttribute('cx', this.frame.x(x).toFixed(2));
      el.setAttribute('cy', this.frame.y(y).toFixed(2));
      el.setAttribute('r', String(opts?.r ?? 3));
    });
  }

  path(points: ReadonlyArray<readonly [number, number]>, opts?: PathOpts): void {
    this.records.push({
      type: 'path',
      role: opts?.role ?? 'neutral',
      points: points.map(([x, y]) => [x, y] as const),
    });
    const classes = opts?.fill ? ['mr-mark-path', 'mr-filled'] : ['mr-mark-path'];
    this.emit('path', classes, opts, (el) => {
      const px = points.map(([x, y]) => [this.frame.x(x), this.frame.y(y)] as const);
      let d = polyline(px);
      if (opts?.closed && px.length > 0) d += ' Z';
      el.setAttribute('d', d);
    });
  }

  text(x: number, y: number, str: string, opts?: TextOpts): void {
    this.records.push({ type: 'text', role: opts?.role ?? 'neutral', at: [x, y], text: str });
    this.emit('text', ['mr-mark-text'], opts, (el) => {
      el.setAttribute('x', this.frame.x(x).toFixed(2));
      el.setAttribute('y', this.frame.y(y).toFixed(2));
      el.setAttribute('text-anchor', opts?.anchor ?? 'middle');
      if (opts?.size !== undefined) el.setAttribute('font-size', String(opts.size));
      el.textContent = str;
    });
  }

  glyph(x: number, y: number, kind: GlyphKind, opts?: GlyphOpts): void {
    this.records.push({ type: 'glyph', role: opts?.role ?? 'neutral', at: [x, y], glyph: kind });
    const cx = this.frame.x(x);
    const cy = this.frame.y(y);
    const s = opts?.size ?? 4;
    switch (kind) {
      case 'dot':
        this.emit('circle', ['mr-mark-glyph', 'mr-dot'], opts, (el) => {
          el.setAttribute('cx', cx.toFixed(2));
          el.setAttribute('cy', cy.toFixed(2));
          el.setAttribute('r', String(s));
        });
        break;
      case 'ring':
        this.emit('circle', ['mr-mark-glyph', 'mr-ring'], opts, (el) => {
          el.setAttribute('cx', cx.toFixed(2));
          el.setAttribute('cy', cy.toFixed(2));
          el.setAttribute('r', String(s));
        });
        break;
      case 'cross':
        this.emit('path', ['mr-mark-glyph', 'mr-cross'], opts, (el) => {
          el.setAttribute(
            'd',
            `M ${(cx - s).toFixed(2)} ${(cy - s).toFixed(2)} L ${(cx + s).toFixed(2)} ${(cy + s).toFixed(2)} ` +
              `M ${(cx - s).toFixed(2)} ${(cy + s).toFixed(2)} L ${(cx + s).toFixed(2)} ${(cy - s).toFixed(2)}`,
          );
        });
        break;
      case 'arrow': {
        const a = opts?.angle ?? 0;
        // shaft along the heading, centred on (x, y); barbs at ±150° off it
        const ux = Math.cos(a);
        const uy = -Math.sin(a); // SVG y grows downward
        const tipX = cx + ux * s;
        const tipY = cy + uy * s;
        const tailX = cx - ux * s;
        const tailY = cy - uy * s;
        const head = s * 0.7;
        const cos = Math.cos(Math.PI / 6);
        const sin = Math.sin(Math.PI / 6);
        const b1x = tipX - head * (ux * cos - uy * sin);
        const b1y = tipY - head * (uy * cos + ux * sin);
        const b2x = tipX - head * (ux * cos + uy * sin);
        const b2y = tipY - head * (uy * cos - ux * sin);
        this.emit('path', ['mr-mark-glyph', 'mr-arrow'], opts, (el) => {
          el.setAttribute(
            'd',
            `M ${tailX.toFixed(2)} ${tailY.toFixed(2)} L ${tipX.toFixed(2)} ${tipY.toFixed(2)} ` +
              `M ${b1x.toFixed(2)} ${b1y.toFixed(2)} L ${tipX.toFixed(2)} ${tipY.toFixed(2)} ` +
              `L ${b2x.toFixed(2)} ${b2y.toFixed(2)}`,
          );
        });
        break;
      }
    }
  }

  // ── idioms ──

  band(x: number, opts: BandMarkOpts = {}): void {
    const [d0, d1] = this.frame.domain;
    const [r0, r1] = this.frame.range;
    const w = opts.width ?? (d1 - d0) * 0.06;
    const y0 = opts.y0 ?? r0 + (r1 - r0) * 0.12;
    const y1 = opts.y1 ?? r1 - (r1 - r0) * 0.12;
    const hw = w / 2;
    const pts: ReadonlyArray<readonly [number, number]> = [
      [x - hw, y0],
      [x + hw, y0],
      [x + hw, y1],
      [x - hw, y1],
    ];
    const fill = opts.fill !== false;
    this.records.push({ type: 'path', role: opts.role ?? 'neutral', points: pts.map(([px, py]) => [px, py] as const) });
    const classes = fill ? ['mr-mark-path', 'mr-band', 'mr-filled'] : ['mr-mark-path', 'mr-band'];
    this.emit('path', classes, opts, (el) => {
      const px = pts.map(([mx, my]) => [this.frame.x(mx), this.frame.y(my)] as const);
      el.setAttribute('d', `${polyline(px)} Z`);
    });
  }

  marker(x: number, y: number, opts: MarkerOpts = {}): void {
    const role = MARKER_ROLE[opts.state ?? 'plain'];
    this.glyph(x, y, 'dot', { role, size: opts.size ?? 5, under: opts.under });
  }

  private emit(
    tag: string,
    classes: readonly string[],
    opts: MarkOpts | undefined,
    build: (el: Element) => void,
  ): void {
    if (!this.doc || !this.marksEl) return;
    const el = this.doc.createElementNS(SVG_NS, tag);
    el.classList.add('mr-mark', ...classes);
    if (opts?.role) el.classList.add(`mr-role-${opts.role}`);
    build(el);
    this.marksEl.appendChild(el);
    if (opts?.under) this.stage.registry.register(el, opts.under.id);
  }
}
