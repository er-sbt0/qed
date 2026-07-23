/**
 * views/layout.ts — the `Layout.{columns, stack, overlay}` containers:
 * placement without coordinates. Showing the container reveals its children.
 *
 * Element granularity: the union of the children's elements — morphing
 * to/from a composition means morphing what it contains.
 *
 * `overlay` is more than z-order (spikes/ftc/FINDINGS.md, FR1): its first
 * frame-PROVIDING child (a plot, a coordinate plane) establishes a shared
 * coordinate frame, and every other framed child draws into it. Without that,
 * a shaded region and its curve agree on nothing and the area drifts off the
 * plot. The authoring surface is unchanged — `overlay([fPlot, area])` reads
 * exactly as before.
 */

import type { Handle } from '@math-ai/core';
import { View } from '../view.js';
import type { Stage } from '../stage.js';
import { FramedView } from './frame.js';

export type LayoutKindName = 'columns' | 'stack' | 'overlay';

export class LayoutContainerView extends View {
  constructor(
    stage: Stage,
    private readonly layoutKind: LayoutKindName,
    readonly children: readonly View[],
  ) {
    super(stage, `view:${layoutKind}`);
    if (layoutKind === 'overlay') this.shareCoordinateFrame();
  }

  /** The first framed child that provides a frame lends it to the others. */
  private shareCoordinateFrame(): void {
    const framed = this.children.filter((c): c is FramedView => c instanceof FramedView);
    const provider = framed.find((c) => c.ownFrame() !== null);
    const frame = provider?.ownFrame();
    if (!frame) return;
    for (const child of framed) {
      if (child !== provider) child.attachFrame(frame);
    }
  }

  override get elements(): readonly Handle[] {
    return this.children.flatMap((c) => c.elements);
  }

  protected render(doc: Document): HTMLElement {
    const root = doc.createElement('div');
    root.className = `mr-${this.layoutKind}`;
    for (const child of this.children) root.appendChild(child.mount(doc));
    return root;
  }

  override onShown(): void {
    for (const child of this.children) {
      child.el?.classList.remove('mr-hidden');
      child.shown = true;
      child.onShown();
    }
  }
}
