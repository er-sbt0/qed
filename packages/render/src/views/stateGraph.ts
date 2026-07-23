/**
 * views/stateGraph.ts — node-edge state graph with force autolayout, curved
 * reciprocal edges, self-loops, and edge labels.
 *
 * Element granularity: STATES AND EDGES are both elements — a bucket→graph
 * morph routes classes to state nodes, and `demonstrate(edge)` needs the edge
 * as an addressable element. Node groups register under the state's handle id
 * AND its label as an alias (trace events may say `from: "Sunny"`); edge
 * groups register under the edge's handle id.
 *
 * `edges: "deferred"` mounts edges pre-hidden so a derive cue can ink each
 * one in as its derivation replays ("the edges draw themselves").
 *
 * `directed: false` draws JOINS instead of arrows: no arrowheads, and bends
 * come from parallel-edge fanning rather than the reciprocal rule — an
 * undirected graph has one edge per pair, not two mirrored ones.
 *
 * LIVE re-reads: `applyState()` re-invokes `edgeLabel` (a weight backed by a
 * dragged Parameter repaints) and `edgeEmphasis` (live spanning-tree
 * membership toggles the `mr-intree` class) — state-derived rendering, the
 * seam contract. `enableRailDrag` makes an EDGE the drag rail for a settable
 * weight: vertical drag on the edge writes through `setValueLive`, the range
 * clamp staying on the Parameter (interaction policy lives on the object).
 */

import type { Handle } from '@math-ai/core';
import type { VarySettable } from '@math-ai/lesson';
import { View } from '../view.js';
import type { Stage } from '../stage.js';
import { edgeBends, edgeGeometry, layoutGraph, selfLoopGeometry } from '../layout/graph.js';
import { displayLabel, labelOf } from '../util.js';

export interface GraphEdgeLike extends Handle {
  readonly from: Handle;
  readonly to: Handle;
}

export interface StateGraphSpec<E extends GraphEdgeLike = GraphEdgeLike> {
  readonly states: readonly Handle[];
  readonly edges: readonly E[];
  /** Label text per edge (default: the edge's own label/symbol field).
   *  Re-invoked on applyState(), so a live weight repaints under a drag. */
  edgeLabel?(edge: E): string;
  /** Live per-edge emphasis (spanning-tree membership, say) — re-read on
   *  applyState(), rendered as the `mr-intree` class. */
  edgeEmphasis?(edge: E): boolean;
  accepting?(state: Handle): boolean;
  /** "deferred" pre-hides edges for demonstrate-driven reveal. */
  readonly edgesMode?: 'shown' | 'deferred';
  /** False → no arrowheads (an edge joins, it does not point). Default true. */
  readonly directed?: boolean;
  readonly title?: string;
  readonly width?: number;
  readonly height?: number;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const NODE_R = 22;

/** Unit vector from the canvas center toward a node (self-loops point out). */
function outwardDir(
  at: { readonly x: number; readonly y: number },
  width: number,
  height: number,
): { x: number; y: number } {
  const dx = at.x - width / 2;
  const dy = at.y - height / 2;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return { x: 0, y: -1 };
  return { x: dx / len, y: dy / len };
}

export class StateGraphView<E extends GraphEdgeLike = GraphEdgeLike> extends View {
  private readonly edgeEls = new Map<string, { group: SVGGElement; label: SVGTextElement | null }>();

  constructor(
    stage: Stage,
    private readonly spec: StateGraphSpec<E>,
  ) {
    super(stage, 'view:stategraph');
  }

  override get elements(): readonly Handle[] {
    return [...this.spec.states, ...this.spec.edges];
  }

  /** Model-level edge state — headless tests read these without a DOM. */
  edgeStates(): ReadonlyArray<{ readonly id: string; readonly label: string; readonly inTree: boolean }> {
    return this.spec.edges.map((e) => ({
      id: e.id,
      label: this.spec.edgeLabel ? this.spec.edgeLabel(e) : labelOf(e),
      inTree: this.spec.edgeEmphasis?.(e) ?? false,
    }));
  }

  protected render(doc: Document): HTMLElement {
    const width = this.spec.width ?? 300;
    const height = this.spec.height ?? 230;
    const root = doc.createElement('div');
    root.classList.add('mr-panelbox');
    if (this.spec.title) {
      const h = doc.createElement('p');
      h.className = 'mr-view-title';
      h.textContent = this.spec.title;
      root.appendChild(h);
    }
    const svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.classList.add('mr-svg');
    root.appendChild(svg);

    const directed = this.spec.directed ?? true;

    // arrowhead marker (id must be document-unique) — directed graphs only
    const markerId = `mr-arrow-${this.id.replace(/[^a-zA-Z0-9]/g, '-')}`;
    if (directed) {
      const defs = doc.createElementNS(SVG_NS, 'defs');
      const marker = doc.createElementNS(SVG_NS, 'marker');
      marker.setAttribute('id', markerId);
      marker.setAttribute('viewBox', '0 0 10 10');
      marker.setAttribute('refX', '9');
      marker.setAttribute('refY', '5');
      marker.setAttribute('markerWidth', '7');
      marker.setAttribute('markerHeight', '7');
      marker.setAttribute('orient', 'auto-start-reverse');
      const tip = doc.createElementNS(SVG_NS, 'path');
      tip.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
      tip.setAttribute('fill', 'var(--mr-muted)');
      marker.appendChild(tip);
      defs.appendChild(marker);
      svg.appendChild(defs);
    }

    const positions = layoutGraph(
      this.spec.states.map((s) => s.id),
      this.spec.edges.map((e) => ({ from: e.from.id, to: e.to.id })),
      { width, height },
    );

    const bends = edgeBends(
      this.spec.edges.map((e) => ({ from: e.from.id, to: e.to.id })),
      directed,
    );

    // edges under nodes
    for (const [i, edge] of this.spec.edges.entries()) {
      const from = positions.get(edge.from.id);
      const to = positions.get(edge.to.id);
      if (!from || !to) continue;
      const g = doc.createElementNS(SVG_NS, 'g');
      g.classList.add('mr-edge');
      const geo =
        edge.from.id === edge.to.id
          ? selfLoopGeometry(from, NODE_R, outwardDir(from, width, height))
          : edgeGeometry(from, to, NODE_R, bends[i] ?? 0);
      const path = doc.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', geo.path);
      if (directed) path.setAttribute('marker-end', `url(#${markerId})`);
      g.appendChild(path);
      const labelText = this.spec.edgeLabel ? this.spec.edgeLabel(edge) : labelOf(edge);
      let text: SVGTextElement | null = null;
      if (labelText && labelText !== edge.id) {
        text = doc.createElementNS(SVG_NS, 'text');
        text.setAttribute('x', geo.label.x.toFixed(1));
        text.setAttribute('y', geo.label.y.toFixed(1));
        text.textContent = labelText;
        g.appendChild(text);
      }
      if (this.spec.edgeEmphasis?.(edge)) g.classList.add('mr-intree');
      if ((this.spec.edgesMode ?? 'shown') === 'deferred') g.classList.add('mr-prehidden');
      svg.appendChild(g);
      this.stage.registry.register(g, edge.id);
      this.edgeEls.set(edge.id, { group: g, label: text });
    }

    // nodes
    for (const state of this.spec.states) {
      const at = positions.get(state.id);
      if (!at) continue;
      const g = doc.createElementNS(SVG_NS, 'g');
      g.classList.add('mr-node');
      if (this.spec.accepting?.(state)) g.classList.add('mr-accepting');
      const circle = doc.createElementNS(SVG_NS, 'circle');
      circle.setAttribute('cx', at.x.toFixed(1));
      circle.setAttribute('cy', at.y.toFixed(1));
      circle.setAttribute('r', String(NODE_R));
      const text = doc.createElementNS(SVG_NS, 'text');
      text.setAttribute('x', at.x.toFixed(1));
      text.setAttribute('y', at.y.toFixed(1));
      text.textContent = displayLabel(state);
      g.append(circle, text);
      svg.appendChild(g);
      this.stage.registry.register(g, state.id, labelOf(state));
    }

    return root;
  }

  /** Re-read the live spec functions and repaint — no animation, no layout. */
  override applyState(): void {
    if (!this.el) return;
    for (const edge of this.spec.edges) {
      const els = this.edgeEls.get(edge.id);
      if (!els) continue;
      if (this.spec.edgeLabel && els.label) els.label.textContent = this.spec.edgeLabel(edge);
      if (this.spec.edgeEmphasis) els.group.classList.toggle('mr-intree', this.spec.edgeEmphasis(edge));
    }
  }

  /**
   * Wire a weight drag with an EDGE as the rail: grab the edge (or its
   * label) and drag vertically; up raises the value. Only the pixel→value
   * sensitivity lives here — the clamp is the Parameter's own policy, applied
   * inside `setValueLive`, so the drag cannot leave the range.
   */
  enableRailDrag(railId: string, target: VarySettable): void {
    const els = this.edgeEls.get(railId);
    if (!els) return;
    const { group } = els;
    // a transparent wide twin of the edge path — a 1.5px line is no grab target
    const doc = group.ownerDocument;
    const visible = group.querySelector('path');
    if (visible) {
      const hit = doc.createElementNS(SVG_NS, 'path');
      hit.setAttribute('d', visible.getAttribute('d') ?? '');
      hit.setAttribute('fill', 'none');
      hit.setAttribute('stroke', 'transparent');
      hit.setAttribute('stroke-width', '16');
      group.appendChild(hit);
    }
    group.classList.add('mr-exposed', 'mr-edge-rail');
    const range = (target as { range?: readonly [number, number] }).range;
    const span = range ? range[1] - range[0] : 10;
    const write = target.setValueLive?.bind(target) ?? target.setValue.bind(target);
    group.addEventListener('pointerdown', (down: PointerEvent) => {
      down.preventDefault();
      (group as SVGElement).setPointerCapture?.(down.pointerId);
      const start = target.value;
      const onMove = (move: PointerEvent): void => {
        // full range over ~150px of travel; upward drag increases the weight
        write(start - (move.clientY - down.clientY) * (span / 150));
        this.stage.applyStateAll();
        this.stage.lightUp(target, 200);
      };
      const onUp = (): void => {
        group.removeEventListener('pointermove', onMove);
        group.removeEventListener('pointerup', onUp);
      };
      group.addEventListener('pointermove', onMove);
      group.addEventListener('pointerup', onUp);
    });
  }
}
