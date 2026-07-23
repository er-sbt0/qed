/**
 * views/field.ts — a vector field over a square patch of the plane: one arrow
 * per lattice point, anchored AT that point rather than at the origin (which is
 * what separates a field from `VectorsView`'s few named vectors).
 *
 * Capture-vs-replay policy, and it is the opposite of `plot.ts`: the rule is
 * LIVE, re-sampled on every paint. A field is only worth drawing when it moves
 * — a Parameter inside the rule is the entire point — and unlike a curve's
 * thousand-sample polyline the cost here is bounded by the lattice. The budget
 * is grid² rule evaluations per paint: 144 at the default grid of 12, plus 144
 * `d` writes. That is affordable on every pointermove; a grid of 40 would not
 * be, which is why the default stays small.
 *
 * Consequently the DOM is built ONCE (`render`) and only mutated afterwards —
 * no wipe-and-rebuild, which at 144 nodes would thrash a drag.
 *
 * Arrowheads are inline path geometry, not a `<defs>` marker: the head then
 * inherits its shaft's stroke for free, and there is no document-unique marker
 * id to coordinate across however many fields a lesson mounts.
 */

import type { Handle } from '@math-ai/core';
import type { Stage } from '../stage.js';
import { FramedView, SVG_NS, createFrame, svgLayer } from './frame.js';
import type { CoordFrame } from './frame.js';
import { renderTex } from '../tex.js';

export interface FieldSample {
  readonly x: number;
  readonly y: number;
  readonly u: number;
  readonly v: number;
}

export interface FieldSpec {
  /** LIVE: re-sampled on every paint, so a Parameter inside the rule redraws the field. */
  readonly rule: (x: number, y: number) => readonly [number, number];
  readonly domain: readonly [number, number];
  /** Defaults to `domain` (a square patch of the plane). */
  readonly range?: readonly [number, number];
  /** Samples per axis. Default 12 (144 arrows). */
  readonly grid?: number;
  readonly label?: string;
  /** Frame-registration subject, if the field owns the frame. */
  readonly subject?: Handle;
}

const DEFAULT_GRID = 12;
/** Shortest arrow a nonzero sample may draw, in pixels — below this it reads as noise. */
const MIN_ARROW_PX = 3;
/** Arrowhead as a fraction of shaft length, capped so short arrows stay legible. */
const HEAD_FRACTION = 0.34;
const HEAD_MAX_PX = 5;

export class FieldView extends FramedView {
  private readonly frameRef: CoordFrame;
  private readonly domain: readonly [number, number];
  private readonly range: readonly [number, number];
  private readonly grid: number;
  private readonly arrows = new Map<number, SVGPathElement>();

  constructor(
    stage: Stage,
    private readonly spec: FieldSpec,
  ) {
    super(stage, 'view:field');
    this.domain = spec.domain;
    this.range = spec.range ?? spec.domain;
    this.grid = Math.max(2, Math.floor(spec.grid ?? DEFAULT_GRID));
    this.frameRef = createFrame(this.domain, this.range, { width: 300, height: 300, pad: 18 });
    if (spec.subject) stage.registerFrame(spec.subject.id, this.frameRef);
    stage.registerFrame(this.id, this.frameRef);
  }

  override ownFrame(): CoordFrame {
    return this.frameRef;
  }

  /** Model-level, headless — the tests assert against this. */
  samples(): readonly FieldSample[] {
    const n = this.grid;
    const [d0, d1] = this.domain;
    const [r0, r1] = this.range;
    const out: FieldSample[] = [];
    for (let j = 0; j < n; j += 1) {
      const y = r0 + ((r1 - r0) * j) / (n - 1);
      for (let i = 0; i < n; i += 1) {
        const x = d0 + ((d1 - d0) * i) / (n - 1);
        const [u, v] = this.spec.rule(x, y);
        out.push({ x, y, u, v });
      }
    }
    return out;
  }

  protected render(doc: Document): HTMLElement {
    const root = doc.createElement('div');
    root.classList.add('mr-field');
    const svg = svgLayer(doc, this.frameRef, 'mr-field-svg');
    root.appendChild(svg);

    const total = this.grid * this.grid;
    for (let k = 0; k < total; k += 1) {
      const path = doc.createElementNS(SVG_NS, 'path');
      path.classList.add('mr-field-arrow');
      svg.appendChild(path);
      this.arrows.set(k, path);
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
    const samples = this.samples();
    let maxMag = 0;
    for (const s of samples) {
      const m = Math.hypot(s.u, s.v);
      if (Number.isFinite(m) && m > maxMag) maxMag = m;
    }
    // the longest arrow in the grid spans about one lattice spacing
    const spacingPx = (f.x(this.domain[1]) - f.x(this.domain[0])) / (this.grid - 1);
    for (let k = 0; k < samples.length; k += 1) {
      const path = this.arrows.get(k);
      const s = samples[k];
      if (!path || !s) continue;
      path.setAttribute('d', this.arrowPath(s, maxMag, spacingPx));
    }
  }

  private arrowPath(s: FieldSample, maxMag: number, spacingPx: number): string {
    const f = this.frameRef;
    const mag = Math.hypot(s.u, s.v);
    if (!Number.isFinite(mag) || mag === 0) return '';
    const bx = f.x(s.x);
    const by = f.y(s.y);
    // direction in PIXEL space: x and y scales differ whenever range ≠ domain
    const dx = f.x(s.x + s.u) - bx;
    const dy = f.y(s.y + s.v) - by;
    const dLen = Math.hypot(dx, dy);
    if (!Number.isFinite(dLen) || dLen === 0) return '';
    const len = Math.max(MIN_ARROW_PX, (mag / (maxMag || 1)) * spacingPx);
    const ux = dx / dLen;
    const uy = dy / dLen;
    const tx = bx + ux * len;
    const ty = by + uy * len;
    const head = Math.min(HEAD_MAX_PX, len * HEAD_FRACTION);
    // two barbs at ±30° off the shaft, drawn inline so they take its colour
    const cos = Math.cos(Math.PI / 6);
    const sin = Math.sin(Math.PI / 6);
    const b1x = tx - head * (ux * cos - uy * sin);
    const b1y = ty - head * (uy * cos + ux * sin);
    const b2x = tx - head * (ux * cos + uy * sin);
    const b2y = ty - head * (uy * cos - ux * sin);
    return (
      `M ${bx.toFixed(2)} ${by.toFixed(2)} L ${tx.toFixed(2)} ${ty.toFixed(2)} ` +
      `M ${b1x.toFixed(2)} ${b1y.toFixed(2)} L ${tx.toFixed(2)} ${ty.toFixed(2)} ` +
      `L ${b2x.toFixed(2)} ${b2y.toFixed(2)}`
    );
  }

  override applyState(): void {
    if (this.el) this.paint();
  }

  override get elements(): readonly Handle[] {
    // The SUBJECT field, but never the lattice points: a point is not a
    // semantic object the lesson addresses, and 144 minted handles would make
    // every `viewProjecting` scan pay for them. The subject must be here,
    // though — it is how a shown field reaches the manifest at all, and
    // without it every conversational tool finds F unreachable (the gap the
    // first 4c probes hit).
    return this.spec.subject ? [this.spec.subject] : [this];
  }
}
