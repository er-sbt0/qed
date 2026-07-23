/**
 * views/readout.ts — a live numeric readout, optionally watched against a
 * second quantity.
 *
 * This is the FTC limit beat's instrument: `readout(strip.averageRate,
 * {compareTo: strip.approxHeight})` shows ΔA/Δx and f(x) side by side with
 * their gap, and the gap visibly closes as Δx shrinks. No `onApproach` verb —
 * the convergence IS the picture (spikes/ftc/FINDINGS.md, FR3).
 *
 * The value node carries `data-mr-num`, which is the marker `vary` writes
 * tweened numbers into: an element that is a numeric display, as opposed to a
 * shape that merely projects the same handle.
 */

import type { Handle } from '@math-ai/core';
import type { NumericHandle } from '@math-ai/lesson';
import { View } from '../view.js';
import type { Stage } from '../stage.js';
import { fmt } from '../util.js';
import { renderTex } from '../tex.js';

export interface ReadoutSpec {
  readonly quantity: NumericHandle;
  readonly label?: string;
  readonly compareTo?: NumericHandle;
  readonly compareLabel?: string;
}

export class ReadoutView extends View {
  private valueEl: HTMLElement | null = null;
  private compareEl: HTMLElement | null = null;
  private gapEl: HTMLElement | null = null;

  constructor(
    stage: Stage,
    private readonly spec: ReadoutSpec,
  ) {
    super(stage, 'view:readout');
  }

  override get elements(): readonly Handle[] {
    return this.spec.compareTo ? [this.spec.quantity, this.spec.compareTo] : [this.spec.quantity];
  }

  /** The live numbers — headless tests read these without a DOM. */
  values(): { readonly value: number; readonly compare?: number; readonly gap?: number } {
    const value = this.spec.quantity.value;
    if (!this.spec.compareTo) return { value };
    const compare = this.spec.compareTo.value;
    return { value, compare, gap: value - compare };
  }

  protected render(doc: Document): HTMLElement {
    const root = doc.createElement('div');
    root.classList.add('mr-panelbox', 'mr-readout');

    const row = (label: string | undefined, handle: NumericHandle): HTMLElement => {
      const line = doc.createElement('div');
      line.className = 'mr-readout-row';
      const name = doc.createElement('span');
      name.className = 'mr-readout-label';
      renderTex(name, label ?? '');
      const value = doc.createElement('span');
      value.className = 'mr-readout-value';
      value.setAttribute('data-mr-num', '');
      line.append(name, value);
      root.appendChild(line);
      this.stage.registry.register(value, handle.id);
      return value;
    };

    this.valueEl = row(this.spec.label, this.spec.quantity);
    if (this.spec.compareTo) {
      this.compareEl = row(this.spec.compareLabel ?? 'vs', this.spec.compareTo);
      const gapRow = doc.createElement('div');
      gapRow.className = 'mr-readout-row mr-readout-gap';
      const name = doc.createElement('span');
      name.className = 'mr-readout-label';
      name.textContent = 'gap';
      this.gapEl = doc.createElement('span');
      this.gapEl.className = 'mr-readout-value';
      gapRow.append(name, this.gapEl);
      root.appendChild(gapRow);
    }
    this.paint();
    return root;
  }

  private paint(): void {
    const v = this.values();
    if (this.valueEl) this.valueEl.textContent = fmt(v.value);
    if (this.compareEl && v.compare !== undefined) this.compareEl.textContent = fmt(v.compare);
    if (this.gapEl && v.gap !== undefined) {
      this.gapEl.textContent = fmt(v.gap);
      this.gapEl.classList.toggle('mr-converged', Math.abs(v.gap) < 0.01);
    }
  }

  override applyState(): void {
    if (this.el) this.paint();
  }
}
