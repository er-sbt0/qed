/**
 * views/frame.ts — the shared coordinate frame for continuous views.
 *
 * Discrete views place themselves by CSS flow. Continuous ones cannot: the
 * shaded region, the strip rectangle, the Riemann rectangles, the moving point
 * and the transformed lattice must agree with the plot on the domain→pixel
 * mapping, or the area drifts off the curve (spikes/ftc/FINDINGS.md, FR1).
 *
 * So `overlay` stops being z-order only and becomes a shared coordinate frame:
 * the first child that PROVIDES a frame (a plot, a coordinate plane)
 * establishes it, and every other framed child draws into it. The authoring
 * surface is untouched — `Layout.overlay([fPlot, area])` reads the same.
 *
 * A framed view shown OUTSIDE an overlay (the FTC strip beat does exactly
 * this) falls back to the stage's ambient frame — the most recent provider —
 * and paints that provider's `backdrop` curve faintly behind itself, so a lone
 * strip still reads as "a strip under f", not as a rectangle in a void.
 */

import type { Id } from '@math-ai/core';
import { View } from '../view.js';
import type { Stage } from '../stage.js';

export const SVG_NS = 'http://www.w3.org/2000/svg';

export const FRAME_W = 320;
export const FRAME_H = 220;
export const FRAME_PAD = 26;

export interface CoordFrame {
  readonly domain: readonly [number, number];
  readonly range: readonly [number, number];
  readonly width: number;
  readonly height: number;
  readonly pad: number;
  /** Domain value → pixel x. */
  x(v: number): number;
  /** Range value → pixel y (SVG y grows downward). */
  y(v: number): number;
  /** Pixel x → domain value (the drag path). */
  toDomain(px: number): number;
  /**
   * An SVG path for the frame provider's own curve, so a framed view drawn
   * outside the overlay can paint it faintly as a backdrop. Empty when the
   * provider has no curve (a coordinate plane).
   */
  backdrop(): string;
  /** Nice-number tick values across the domain (x-axis), honest to look at. */
  xTicks(target?: number): number[];
  /** Nice-number tick values across the range (y-axis). */
  yTicks(target?: number): number[];
  /** `count` evenly-spaced vertical bands across the inner pixel width. */
  bands(count: number, opts?: BandOpts): readonly Band[];
  /**
   * Math-x of column `k` of `n` evenly-spaced columns across the DOMAIN — the
   * math-space counterpart of a band centre, in domain units. The single source
   * of the column arithmetic the diagram pen used to re-derive.
   */
  colX(k: number, n: number): number;
  /**
   * `count` vertical bands across the DOMAIN, in math (not pixel) units — the
   * math-space counterpart of `bands`. Same `{center, lo, hi, width}` shape, so
   * an author feeds the numbers straight back into `pen.*`.
   */
  mathBands(count: number, opts?: BandOpts): readonly Band[];
}

export interface FrameOpts {
  readonly width?: number;
  readonly height?: number;
  readonly pad?: number;
  readonly backdrop?: () => string;
}

export interface Band {
  readonly center: number;
  readonly lo: number;
  readonly hi: number;
  readonly width: number;
}

export interface BandOpts {
  /** Fraction of each slot reserved as the gap between bands (0..1). Default 0.2. */
  readonly padding?: number;
  /**
   * A per-column shrink ratio in (0, 1). When set, successive bands get
   * geometrically smaller widths — the "runs off toward forever" recession —
   * still spanning the full extent. Omitted (or ≥ 1) means equal spacing.
   */
  readonly recede?: number;
}

export function createFrame(
  domain: readonly [number, number],
  range: readonly [number, number],
  opts: FrameOpts = {},
): CoordFrame {
  const width = opts.width ?? FRAME_W;
  const height = opts.height ?? FRAME_H;
  const pad = opts.pad ?? FRAME_PAD;
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const dSpan = d1 - d0 || 1;
  const rSpan = r1 - r0 || 1;
  const innerW = width - 2 * pad;
  const innerH = height - 2 * pad;
  return Object.freeze({
    domain,
    range,
    width,
    height,
    pad,
    x: (v: number): number => pad + ((v - d0) / dSpan) * innerW,
    y: (v: number): number => height - pad - ((v - r0) / rSpan) * innerH,
    toDomain: (px: number): number => d0 + ((px - pad) / innerW) * dSpan,
    backdrop: opts.backdrop ?? ((): string => ''),
    xTicks: (target = 5): number[] => niceTicks(domain[0], domain[1], target),
    yTicks: (target = 5): number[] => niceTicks(range[0], range[1], target),
    bands: (count: number, bandOpts: BandOpts = {}): readonly Band[] => layoutBands(pad, innerW, count, bandOpts),
    colX: (k: number, n: number): number => d0 + ((k + 0.5) * dSpan) / Math.max(1, n),
    mathBands: (count: number, bandOpts: BandOpts = {}): readonly Band[] => layoutBands(d0, dSpan, count, bandOpts),
  });
}

/**
 * `count` vertical bands laid out across a span `[origin, origin + total]` — the
 * discrete counterpart to `xTicks`/`yTicks`. One layout, called in two spaces:
 * pixels (`bands`, origin = pad) and domain units (`mathBands`, origin = d0).
 * Used for side-by-side coordinate columns (a rack of frames) rather than a
 * continuous axis. With `recede`, slot widths shrink geometrically instead of
 * evenly, still spanning `total`.
 */
function layoutBands(origin: number, total: number, count: number, opts: BandOpts): readonly Band[] {
  const n = Math.max(1, Math.floor(count));
  const inner = Math.min(0.9, Math.max(0, opts.padding ?? 0.2));
  const slots = slotWidths(total, n, opts.recede);
  const out: Band[] = [];
  let x = origin;
  for (let i = 0; i < n; i += 1) {
    const slot = slots[i]!;
    const width = slot * (1 - inner);
    const gap = slot * inner;
    const lo = x + gap / 2;
    const hi = lo + width;
    out.push({ center: (lo + hi) / 2, lo, hi, width });
    x += slot;
  }
  return out;
}

/**
 * The `n` slot widths that partition `total`. Equal by default; with a recede
 * ratio r ∈ (0, 1) they form a geometric sequence w, wr, wr², … whose sum is
 * `total` (so `w = total·(1−r)/(1−rⁿ)`) — the row narrowing toward "forever".
 */
function slotWidths(total: number, n: number, recede?: number): number[] {
  if (recede !== undefined && recede > 0 && recede < 1) {
    const first = (total * (1 - recede)) / (1 - recede ** n);
    const out: number[] = [];
    let w = first;
    for (let i = 0; i < n; i += 1) {
      out.push(w);
      w *= recede;
    }
    return out;
  }
  return Array.from({ length: n }, () => total / n);
}

/**
 * Paul Heckbert's "nice numbers for graph labels": round `range` to
 * 1/2/5 × 10ⁿ, either up (`round`, for a step size) or to the nearest
 * containing nice value (for a span).
 */
function niceNum(range: number, round: boolean): number {
  if (range === 0) return 0;
  const exponent = Math.floor(Math.log10(range));
  const fraction = range / 10 ** exponent;
  let niceFraction: number;
  if (round) {
    if (fraction < 1.5) niceFraction = 1;
    else if (fraction < 3) niceFraction = 2;
    else if (fraction < 7) niceFraction = 5;
    else niceFraction = 10;
  } else {
    if (fraction <= 1) niceFraction = 1;
    else if (fraction <= 2) niceFraction = 2;
    else if (fraction <= 5) niceFraction = 5;
    else niceFraction = 10;
  }
  return niceFraction * 10 ** exponent;
}

/**
 * Nice-number tick values spanning [lo, hi]: a step from the standard
 * 1/2/5 × 10ⁿ family, lo/hi snapped outward to that step, then filtered back
 * to the requested span so an honest axis never ticks past its own domain.
 */
export function niceTicks(lo: number, hi: number, target = 5): number[] {
  if (lo > hi) [lo, hi] = [hi, lo];
  if (lo === hi) return [lo];
  const span = hi - lo;
  const step = niceNum(span / Math.max(1, target - 1), true);
  const niceLo = Math.floor(lo / step) * step;
  const niceHi = Math.ceil(hi / step) * step;
  const eps = step * 1e-9;
  const ticks: number[] = [];
  const n = Math.round((niceHi - niceLo) / step);
  for (let i = 0; i <= n; i += 1) {
    const v = Math.round((niceLo + i * step) / step) * step;
    if (v >= lo - eps && v <= hi + eps) ticks.push(snapZero(v));
  }
  return ticks;
}

/** -0 reads as an ugly "-0" label; treat it as 0. */
function snapZero(v: number): number {
  return Object.is(v, -0) ? 0 : v;
}

/**
 * An honest number label: trims trailing zeros and float noise
 * (`0.30000000000000004` → `"0.3"`) without hiding real precision.
 */
export function formatNumber(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  const rounded = Number.parseFloat(v.toPrecision(10));
  return String(snapZero(rounded));
}

/** A padded range around sampled values, always including y = 0. */
export function rangeOf(values: readonly number[]): readonly [number, number] {
  const finite = values.filter((v) => Number.isFinite(v));
  let lo = Math.min(0, ...finite);
  let hi = Math.max(0, ...finite);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo === hi) {
    lo = Math.min(lo, -1);
    hi = Math.max(hi, 1);
  }
  const margin = (hi - lo) * 0.12;
  return [lo - margin, hi + margin];
}

/**
 * An SVG root sized to a frame; every continuous view mounts one of these.
 *
 * The `viewBox` carries the frame's logical (mapping) dimensions — untouched,
 * so `x`/`y`/`toDomain` stay exactly as authored. `width`/`height` attributes
 * are kept only as an intrinsic fallback (e.g. paste into a document with no
 * stylesheet); CSS (`.mr-plotsvg`, theme.ts) is what actually sizes it,
 * letting the figure grow to fill the space its panel is given.
 */
export function svgLayer(doc: Document, frame: CoordFrame, cls: string): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${frame.width} ${frame.height}`);
  svg.setAttribute('width', String(frame.width));
  svg.setAttribute('height', String(frame.height));
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.classList.add('mr-svg', 'mr-plotsvg', cls);
  return svg;
}

/** `M x y L x y …` through the given pixel points. */
export function polyline(points: ReadonlyArray<readonly [number, number]>): string {
  if (points.length === 0) return '';
  return points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`).join(' ');
}

export interface TickAxes {
  /** Pixel x of the vertical axis line — where y-tick marks and labels sit. */
  readonly atX: number;
  /** Pixel y of the horizontal axis line — where x-tick marks and labels sit. */
  readonly atY: number;
}

const TICK_LEN = 4;

/**
 * Real tick marks + honest number labels for a frame, appended onto `svg`.
 * Callers pass the pixel position of each axis line because that convention
 * differs by provider — a plot draws its value axis at the domain's left
 * edge, a plane draws both axes through zero — while the tick *values*
 * always come from the frame (`xTicks`/`yTicks`), so the numbers stay
 * correct even when the axis line itself is drawn elsewhere.
 */
export function drawTicks(doc: Document, svg: SVGSVGElement, frame: CoordFrame, axes: TickAxes): void {
  const g = doc.createElementNS(SVG_NS, 'g');
  g.classList.add('mr-ticks');
  for (const v of frame.xTicks()) {
    const px = frame.x(v);
    const tick = doc.createElementNS(SVG_NS, 'line');
    tick.setAttribute('x1', px.toFixed(2));
    tick.setAttribute('x2', px.toFixed(2));
    tick.setAttribute('y1', (axes.atY - TICK_LEN).toFixed(2));
    tick.setAttribute('y2', (axes.atY + TICK_LEN).toFixed(2));
    tick.classList.add('mr-tick');
    g.appendChild(tick);
    const label = doc.createElementNS(SVG_NS, 'text');
    label.setAttribute('x', px.toFixed(2));
    label.setAttribute('y', (axes.atY + TICK_LEN + 11).toFixed(2));
    label.setAttribute('text-anchor', 'middle');
    label.classList.add('mr-tick-label');
    label.textContent = formatNumber(v);
    g.appendChild(label);
  }
  for (const v of frame.yTicks()) {
    const py = frame.y(v);
    const tick = doc.createElementNS(SVG_NS, 'line');
    tick.setAttribute('x1', (axes.atX - TICK_LEN).toFixed(2));
    tick.setAttribute('x2', (axes.atX + TICK_LEN).toFixed(2));
    tick.setAttribute('y1', py.toFixed(2));
    tick.setAttribute('y2', py.toFixed(2));
    tick.classList.add('mr-tick');
    g.appendChild(tick);
    const label = doc.createElementNS(SVG_NS, 'text');
    label.setAttribute('x', (axes.atX - TICK_LEN - 3).toFixed(2));
    label.setAttribute('y', (py + 3).toFixed(2));
    label.setAttribute('text-anchor', 'end');
    label.classList.add('mr-tick-label');
    label.textContent = formatNumber(v);
    g.appendChild(label);
  }
  svg.appendChild(g);
}

/**
 * A view that lives in a coordinate frame. It either PROVIDES the frame (a
 * plot, a plane) or draws into whichever one it is attached to.
 */
export abstract class FramedView extends View {
  private attached: CoordFrame | null = null;

  constructor(stage: Stage, kind: string) {
    super(stage, kind);
  }

  /** Frame providers override; drawers return null. */
  ownFrame(): CoordFrame | null {
    return null;
  }

  /** Called by an overlay container at construction time. */
  attachFrame(frame: CoordFrame): void {
    if (!this.ownFrame()) this.attached = frame;
  }

  /** True when this view has no frame of its own and none was attached. */
  get borrowsAmbientFrame(): boolean {
    return this.ownFrame() === null && this.attached === null;
  }

  /**
   * The object whose plot this view belongs on. A strip and a Riemann
   * decomposition of f must draw in f's frame — NOT in whichever plot happened
   * to be constructed last (the FTC program builds A's plot after f's).
   * Overridden by views that know their subject.
   */
  protected frameSubjectId(): Id | null {
    return null;
  }

  get frame(): CoordFrame {
    const subject = this.frameSubjectId();
    return (
      this.ownFrame() ??
      this.attached ??
      (subject !== null ? this.stage.frameFor(subject) : undefined) ??
      this.stage.ambientFrame ??
      DEFAULT_FRAME
    );
  }

  /**
   * Paint the ambient provider's curve faintly behind this view — only when
   * this view is standing alone (inside an overlay the provider draws it).
   */
  protected appendBackdrop(doc: Document, svg: SVGSVGElement): void {
    if (!this.borrowsAmbientFrame) return;
    const d = this.frame.backdrop();
    if (!d) return;
    const path = doc.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    path.classList.add('mr-backdrop');
    svg.appendChild(path);
  }
}

const DEFAULT_FRAME = createFrame([0, 1], [0, 1]);
