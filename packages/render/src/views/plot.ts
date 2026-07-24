/**
 * views/plot.ts — a continuous plot y = f(x) over a domain, and the moving
 * points that ride on it.
 *
 * Capture-vs-replay policy (spikes/ftc/FINDINGS.md, consequence 3): the curve
 * is sampled ONCE at authoring time and replayed as a polyline. A guest `f(x)`
 * re-sampled per frame would re-enter the sandbox thousands of times per drag;
 * the only things re-read per frame are the O(1) reactive scalars — where the
 * moving points sit, how far the shaded region reaches.
 *
 * `pointAt(q)` mints an addressable subpart: a marker whose position tracks a
 * live NumericHandle. It is the anchor for the FTC showpiece — one x-marker
 * moving three representations at once, linked by correspondence, not by
 * bespoke sync machinery.
 */

import type { Handle } from '@math-ai/core';
import type { NumericHandle, VarySettable } from '@math-ai/lesson';
import type { Stage } from '../stage.js';
import { FramedView, SVG_NS, createFrame, drawTicks, polyline, rangeOf, svgLayer } from './frame.js';
import type { CoordFrame } from './frame.js';
import { renderTex } from '../tex.js';

export interface PlotSpec {
  /** The semantic object being projected (an Fn, an Accumulation). */
  readonly subject: Handle;
  /** Height rule, sampled at authoring time only. */
  readonly sample: (x: number) => number;
  readonly domain: readonly [number, number];
  readonly showAxes?: boolean;
  readonly label?: string;
  /** Sample count across the domain (default 121). */
  readonly samples?: number;
}

interface MarkerSpec {
  readonly handle: Handle;
  readonly at: NumericHandle;
  readonly label: string | undefined;
}

const DEFAULT_SAMPLES = 121;

export class PlotView extends FramedView {
  /** Domain/value pairs, sampled once at construction. */
  private readonly samples: ReadonlyArray<readonly [number, number]>;
  private readonly frameRef: CoordFrame;
  private readonly markers: MarkerSpec[] = [];
  private readonly markerEls = new Map<string, SVGGElement>();
  /** The x-axis rail — `Interaction.drag(x, {along: plot.xAxis})` targets it. */
  readonly xAxis: Handle;

  constructor(
    stage: Stage,
    private readonly spec: PlotSpec,
  ) {
    super(stage, 'view:plot');
    const n = Math.max(2, spec.samples ?? DEFAULT_SAMPLES);
    const [d0, d1] = spec.domain;
    const pts: Array<readonly [number, number]> = [];
    for (let i = 0; i < n; i += 1) {
      const x = d0 + ((d1 - d0) * i) / (n - 1);
      pts.push([x, spec.sample(x)]);
    }
    this.samples = pts;
    this.frameRef = createFrame(spec.domain, rangeOf(pts.map(([, y]) => y)), {
      backdrop: () => this.curvePath(),
    });
    this.xAxis = stage.world.handle('plot:xaxis');
    // claim the frame for the object this plot projects, so a strip or a
    // riemann decomposition OF THE SAME object lands on these axes even when
    // shown on its own (see FramedView.frame)
    stage.registerFrame(spec.subject.id, this.frameRef);
  }

  override ownFrame(): CoordFrame {
    return this.frameRef;
  }

  override get elements(): readonly Handle[] {
    return [this.spec.subject];
  }

  /** An addressable moving point at a live x — the correspondence anchor. */
  pointAt(at: NumericHandle, opts?: { readonly label?: string }): Handle {
    const handle = this.stage.world.handle('plot:point');
    this.markers.push({ handle, at, label: opts?.label });
    return handle;
  }

  private curvePath(): string {
    const f = this.frameRef;
    return polyline(this.samples.map(([x, y]) => [f.x(x), f.y(y)] as const));
  }

  protected render(doc: Document): HTMLElement {
    const root = doc.createElement('div');
    root.classList.add('mr-plot');
    const f = this.frameRef;
    const svg = svgLayer(doc, f, 'mr-plot-svg');
    root.appendChild(svg);

    if (this.spec.showAxes ?? true) {
      const axes = doc.createElementNS(SVG_NS, 'path');
      const y0 = f.y(Math.min(Math.max(0, f.range[0]), f.range[1]));
      axes.setAttribute(
        'd',
        `M ${f.x(f.domain[0])} ${y0} L ${f.x(f.domain[1])} ${y0} ` +
          `M ${f.x(f.domain[0])} ${f.pad} L ${f.x(f.domain[0])} ${f.height - f.pad}`,
      );
      axes.classList.add('mr-axis');
      svg.appendChild(axes);
      drawTicks(doc, svg, f, { atX: f.x(f.domain[0]), atY: y0 });
      // the drag rail is the x-axis: registered so Interaction.drag can find it
      const rail = doc.createElementNS(SVG_NS, 'rect');
      rail.setAttribute('x', String(f.pad));
      rail.setAttribute('y', String(y0 - 7));
      rail.setAttribute('width', String(f.width - 2 * f.pad));
      rail.setAttribute('height', '14');
      rail.classList.add('mr-rail');
      svg.appendChild(rail);
      this.stage.registry.register(rail, this.xAxis.id);
    }

    const curve = doc.createElementNS(SVG_NS, 'path');
    curve.setAttribute('d', this.curvePath());
    curve.classList.add('mr-curve');
    svg.appendChild(curve);
    // `${f}` in narration lights the curve itself
    this.stage.registry.register(curve, this.spec.subject.id);

    if (this.spec.label) {
      // an HTML caption, so the label is typeset rather than approximated
      const caption = doc.createElement('div');
      caption.className = 'mr-plot-caption';
      renderTex(caption, this.spec.label);
      root.insertBefore(caption, svg);
      this.stage.registry.register(caption, this.spec.subject.id);
    }

    for (const marker of this.markers) {
      const g = doc.createElementNS(SVG_NS, 'g');
      g.classList.add('mr-marker');
      const dot = doc.createElementNS(SVG_NS, 'circle');
      dot.setAttribute('r', '4.5');
      g.appendChild(dot);
      const drop = doc.createElementNS(SVG_NS, 'line');
      drop.classList.add('mr-marker-drop');
      g.appendChild(drop);
      svg.appendChild(g);
      this.stage.registry.register(g, marker.handle.id);
      // also under the parameter it tracks: `${x}` in narration lights the
      // marker, and `expose(x, {as: "draggable"})` marks it as an affordance
      this.stage.registry.register(g, marker.at.id);
      this.markerEls.set(marker.handle.id, g);
    }
    this.positionMarkers();
    return root;
  }

  private positionMarkers(): void {
    const f = this.frameRef;
    for (const marker of this.markers) {
      const g = this.markerEls.get(marker.handle.id);
      if (!g) continue;
      const xv = marker.at.value;
      const px = f.x(xv);
      const py = f.y(this.spec.sample(xv));
      const dot = g.firstElementChild as SVGCircleElement | null;
      dot?.setAttribute('cx', px.toFixed(2));
      dot?.setAttribute('cy', py.toFixed(2));
      const drop = g.lastElementChild as SVGLineElement | null;
      drop?.setAttribute('x1', px.toFixed(2));
      drop?.setAttribute('y1', py.toFixed(2));
      drop?.setAttribute('x2', px.toFixed(2));
      drop?.setAttribute('y2', f.y(0).toFixed(2));
    }
  }

  /** Live: markers follow a dragged or varied parameter. */
  override applyState(): void {
    if (this.el) this.positionMarkers();
  }

  /**
   * Wire the drag rail: pointer x along the axis writes the domain value into
   * a settable quantity. The interaction path uses `setValueLive` (no timeline
   * step per frame) and the object's own policy clamps — an out-of-range drag
   * is unreachable at the boundary, so downstream numerics never see garbage.
   */
  enableRailDrag(railId: string, target: VarySettable): void {
    const rail = this.stage.nodesFor(railId).find((el) => this.el?.contains(el));
    if (!rail) return;
    const apply = (clientX: number): void => {
      const box = rail.getBoundingClientRect();
      if (box.width === 0) return;
      const t = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
      const [d0, d1] = this.frameRef.domain;
      const value = d0 + t * (d1 - d0);
      if (target.setValueLive) target.setValueLive(value);
      else target.setValue(value);
      this.stage.applyStateAll();
    };
    const el = rail as SVGElement;
    el.classList.add('mr-exposed');
    el.addEventListener('pointerdown', (e) => {
      const ev = e as PointerEvent;
      el.setPointerCapture?.(ev.pointerId);
      apply(ev.clientX);
    });
    el.addEventListener('pointermove', (e) => {
      const ev = e as PointerEvent;
      if (ev.buttons === 0) return;
      apply(ev.clientX);
    });
  }

  /** Model-level marker positions — headless tests assert against these. */
  markerPositions(): ReadonlyArray<{ readonly id: string; readonly x: number; readonly y: number }> {
    return this.markers.map((m) => {
      const xv = m.at.value;
      return { id: m.handle.id, x: xv, y: this.spec.sample(xv) };
    });
  }
}
