/**
 * views/tokens.ts — word/collection tokens in row, column, or scatter layout.
 *
 * Element granularity: each projected ITEM is an element (`elements` = the
 * items) — a token cloud morphs by sending every token to its counterpart.
 * Chips register under their item's handle id, so any view or mention of the
 * same item lights up together.
 */

import { Collection } from '@math-ai/core';
import type { Handle } from '@math-ai/core';
import { View } from '../view.js';
import type { Stage } from '../stage.js';
import { enter } from '../animate.js';
import { displayLabel } from '../util.js';

export type TokensLayout = 'row' | 'column' | 'scatter';

export interface TokensOpts {
  readonly layout?: TokensLayout;
  readonly title?: string;
}

export class TokensView<T extends Handle = Handle> extends View {
  private readonly items: T[];
  /** Mount renders only the items present at CONSTRUCTION (this program
   * position); later arrivals were queued as per-step animations — playback
   * adds their chips when it reaches each `collection:add` step. */
  private readonly initialCount: number;
  private readonly layout: TokensLayout;
  private readonly title?: string;
  private listEl: HTMLElement | null = null;

  constructor(stage: Stage, source: Collection<T> | readonly T[], opts?: TokensOpts) {
    super(stage, 'view:tokens');
    this.layout = opts?.layout ?? 'row';
    this.title = opts?.title;
    if (source instanceof Collection) {
      this.items = [...source.peek()];
      source.subscribe((delta) => {
        this.items.push(delta.item);
        this.queue(delta.step.id, (ms) => this.animateArrival(delta.item, ms));
      });
    } else {
      this.items = [...source];
    }
    this.initialCount = this.items.length;
  }

  override get elements(): readonly Handle[] {
    return this.items;
  }

  protected render(doc: Document): HTMLElement {
    const root = doc.createElement('div');
    root.classList.add('mr-panelbox');
    if (this.title) {
      const h = doc.createElement('p');
      h.className = 'mr-view-title';
      h.textContent = this.title;
      root.appendChild(h);
    }
    this.listEl = doc.createElement('div');
    this.listEl.className = `mr-tokens-${this.layout}`;
    root.appendChild(this.listEl);
    this.items.slice(0, this.initialCount).forEach((item, i) => this.addChip(doc, item, i));
    return root;
  }

  private addChip(doc: Document, item: T, index: number): HTMLElement {
    const chip = doc.createElement('span');
    chip.className = 'mr-token';
    chip.textContent = displayLabel(item);
    if (this.layout === 'scatter') {
      // deterministic quasi-random placement (golden-ratio hashing)
      const x = ((index * 0.6180339887 + 0.05) % 1) * 200;
      const y = ((index * 0.3819660113 + 0.13) % 1) * 118;
      chip.style.left = `${x.toFixed(1)}px`;
      chip.style.top = `${y.toFixed(1)}px`;
    }
    this.stage.registry.register(chip, item.id);
    this.listEl?.appendChild(chip);
    return chip;
  }

  private async animateArrival(item: T, ms: number): Promise<void> {
    if (!this.listEl || !this.stage.doc) return;
    const chip = this.addChip(this.stage.doc, item, this.items.indexOf(item));
    await enter(chip, 'top', ms);
  }
}
