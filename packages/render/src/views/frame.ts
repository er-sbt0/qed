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
}

export interface FrameOpts {
  readonly width?: number;
  readonly height?: number;
  readonly pad?: number;
  readonly backdrop?: () => string;
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
  });
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

/** An SVG root sized to a frame; every continuous view mounts one of these. */
export function svgLayer(doc: Document, frame: CoordFrame, cls: string): SVGSVGElement {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${frame.width} ${frame.height}`);
  svg.setAttribute('width', String(frame.width));
  svg.setAttribute('height', String(frame.height));
  svg.classList.add('mr-svg', 'mr-plotsvg', cls);
  return svg;
}

/** `M x y L x y …` through the given pixel points. */
export function polyline(points: ReadonlyArray<readonly [number, number]>): string {
  if (points.length === 0) return '';
  return points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`).join(' ');
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
