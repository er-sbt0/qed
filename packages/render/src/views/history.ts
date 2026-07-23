/**
 * views/history.ts — the step-series line: a fold over a slot's timeline of
 * values, one polyline per series. The one SVG "plot" this milestone allows
 * (Markov's convergence needs it); function plots proper come later.
 *
 * Element granularity: the view is its own single element — the history is an
 * aggregate of past values, not a projection of addressable objects.
 */

import type { Slot } from '@math-ai/core';
import type { Handle } from '@math-ai/core';
import { View } from '../view.js';
import type { Stage } from '../stage.js';
import { pulse } from '../animate.js';
import { displayLabel } from '../util.js';

export interface HistorySpec<D> {
  readonly series: readonly Handle[];
  valueOf(value: D, series: Handle): number;
  readonly title?: string;
  readonly max?: number;
}

const SERIES_COLORS = ['var(--mr-accent)', 'var(--mr-accept)', 'var(--mr-reject)', 'var(--mr-still)'];
const SVG_NS = 'http://www.w3.org/2000/svg';
const W = 240;
const H = 120;
const PAD = 8;

export class HistoryView<D> extends View {
  /** data[seriesIndex][stepIndex] */
  private readonly data: number[][];
  private paths: SVGPathElement[] = [];
  private svg: SVGSVGElement | null = null;

  constructor(
    stage: Stage,
    slot: Slot<D>,
    private readonly spec: HistorySpec<D>,
  ) {
    super(stage, 'view:history');
    const first = slot.peek();
    this.data = spec.series.map((s) => [spec.valueOf(first, s)]);
    slot.subscribe((t) => {
      // capture eagerly: values are immutable, the numbers are the fold
      const values = spec.series.map((s) => spec.valueOf(t.to, s));
      this.queue(t.step.id, (ms) => this.appendPoint(values, ms));
    });
  }

  protected render(doc: Document): HTMLElement {
    const root = doc.createElement('div');
    root.classList.add('mr-panelbox', 'mr-history');
    if (this.spec.title) {
      const h = doc.createElement('p');
      h.className = 'mr-view-title';
      h.textContent = this.spec.title;
      root.appendChild(h);
    }
    const svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('width', String(W));
    svg.setAttribute('height', String(H));
    svg.classList.add('mr-svg');
    this.svg = svg;
    root.appendChild(svg);

    const axis = doc.createElementNS(SVG_NS, 'path');
    axis.setAttribute(
      'd',
      `M ${PAD} ${PAD} L ${PAD} ${H - PAD} L ${W - PAD} ${H - PAD}`,
    );
    axis.setAttribute('fill', 'none');
    axis.classList.add('mr-axis');
    svg.appendChild(axis);

    this.paths = this.spec.series.map((_, i) => {
      const path = doc.createElementNS(SVG_NS, 'path');
      path.classList.add('mr-series');
      path.style.stroke = SERIES_COLORS[i % SERIES_COLORS.length]!;
      svg.appendChild(path);
      return path;
    });

    // legend
    const legend = doc.createElement('div');
    legend.style.display = 'flex';
    legend.style.gap = '10px';
    legend.style.fontSize = '11px';
    this.spec.series.forEach((s, i) => {
      const item = doc.createElement('span');
      item.style.color = SERIES_COLORS[i % SERIES_COLORS.length]!;
      item.textContent = `— ${displayLabel(s)}`;
      legend.appendChild(item);
    });
    root.appendChild(legend);

    this.redraw();
    return root;
  }

  private redraw(): void {
    const n = Math.max(...this.data.map((d) => d.length));
    const max = this.spec.max ?? 1;
    this.data.forEach((series, i) => {
      const path = this.paths[i];
      if (!path) return;
      const points = series.map((v, j) => {
        const x = PAD + (n <= 1 ? 0 : (j / (n - 1)) * (W - 2 * PAD));
        const y = H - PAD - (Math.min(v, max) / max) * (H - 2 * PAD);
        return `${x.toFixed(1)} ${y.toFixed(1)}`;
      });
      path.setAttribute('d', points.length > 1 ? `M ${points.join(' L ')}` : '');
    });
  }

  private async appendPoint(values: readonly number[], ms: number): Promise<void> {
    values.forEach((v, i) => this.data[i]?.push(v));
    if (!this.el) return;
    this.redraw();
    if (this.svg) await pulse(this.svg, Math.min(ms, 300));
  }
}
