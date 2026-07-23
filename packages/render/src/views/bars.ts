/**
 * views/bars.ts — distribution bars over a slot (or a fixed/live value).
 *
 * Element granularity: the CATEGORIES (state handles) are the elements; each
 * bar registers under its category's id, so a parcel traveling toward a state
 * lands visually on that state's bar AND its graph node at once.
 *
 * Reactive: subscribing to the slot at authoring time queues one tween per
 * `slot:set` step. Per the library's capture-at-derive policy, the per-
 * category MASSES are snapshotted at subscription time (authoring), not read
 * back at playback — a value that closes over mutable state (a reactive
 * stationary π, say) must display what it held when the timeline step was
 * authored, not what it holds after later mutations drifted it. The stage
 * also captures the derivation trace then (see Stage.captureDerivations) so
 * `via: "derivation"` flows replay parcels that match what actually happened.
 *
 * The getter form (`() => value`) is the deliberately LIVE path: `applyState()`
 * re-reads and repaints, which is how a reactive derived π follows a matrix
 * drag instantly.
 */

import { Slot } from '@math-ai/core';
import type { Handle, Id } from '@math-ai/core';
import { View } from '../view.js';
import type { Stage } from '../stage.js';
import { wait } from '../animate.js';
import { displayLabel, fmt } from '../util.js';

export interface BarsSpec<D> {
  readonly categories: readonly Handle[];
  mass(value: D, category: Handle): number;
  readonly title?: string;
  /** Full-height mass (default 1 — probability). */
  readonly max?: number;
}

const AREA_PX = 120;

export class BarsView<D> extends View {
  /** Displayed masses by category id — always a snapshot, never a live read. */
  private current: ReadonlyMap<Id, number>;
  private readonly getter: (() => D) | null;
  private readonly barEls = new Map<string, { bar: HTMLElement; value: HTMLElement }>();

  constructor(
    stage: Stage,
    source: Slot<D> | D | (() => D),
    private readonly spec: BarsSpec<D>,
  ) {
    super(stage, 'view:bars');
    if (source instanceof Slot) {
      this.current = this.massesOf(source.peek());
      // deliberately NO live getter: a slot-driven bars view is advanced by
      // its queued per-step transitions — applyState() reading the slot's final
      // (post-program) value would jump ahead of the timeline position
      this.getter = null;
      stage.captureDerivations(source);
      source.subscribe((t) => {
        // capture-at-derive: snapshot the masses NOW, paint them at playback
        const masses = this.massesOf(t.to);
        this.queue(t.step.id, (ms) => this.applyMasses(masses, ms));
      });
    } else if (typeof source === 'function') {
      this.getter = source as () => D;
      this.current = this.massesOf(this.getter());
    } else {
      this.current = this.massesOf(source);
      this.getter = null;
    }
  }

  override get elements(): readonly Handle[] {
    return this.spec.categories;
  }

  private massesOf(value: D): ReadonlyMap<Id, number> {
    return new Map(this.spec.categories.map((cat) => [cat.id, this.spec.mass(value, cat)]));
  }

  protected render(doc: Document): HTMLElement {
    const root = doc.createElement('div');
    root.classList.add('mr-panelbox');
    if (this.spec.title) {
      const h = doc.createElement('p');
      h.className = 'mr-view-title';
      h.textContent = this.spec.title;
      root.appendChild(h);
    }
    const row = doc.createElement('div');
    row.className = 'mr-bars';
    root.appendChild(row);
    for (const cat of this.spec.categories) {
      const cell = doc.createElement('div');
      cell.className = 'mr-bar-cell';
      const value = doc.createElement('span');
      value.className = 'mr-bar-value';
      const bar = doc.createElement('div');
      bar.className = 'mr-bar';
      const label = doc.createElement('span');
      label.className = 'mr-bar-label';
      label.textContent = displayLabel(cat);
      cell.append(value, bar, label);
      row.appendChild(cell);
      this.stage.registry.register(bar, cat.id);
      this.barEls.set(cat.id, { bar, value });
    }
    this.paint(this.current, 0);
    return root;
  }

  private paint(masses: ReadonlyMap<Id, number>, ms: number): void {
    const max = this.spec.max ?? 1;
    for (const cat of this.spec.categories) {
      const els = this.barEls.get(cat.id);
      if (!els) continue;
      const mass = masses.get(cat.id) ?? 0;
      const px = Math.max(2, (Math.min(mass, max) / max) * AREA_PX);
      els.bar.style.transition = ms > 0 ? `height ${ms}ms ease` : '';
      els.bar.style.height = `${px.toFixed(1)}px`;
      els.value.textContent = fmt(mass);
    }
  }

  private async applyMasses(masses: ReadonlyMap<Id, number>, ms: number): Promise<void> {
    this.current = masses;
    if (!this.el) return;
    this.paint(masses, ms);
    await wait(ms);
  }

  override applyState(): void {
    if (this.getter) {
      this.current = this.massesOf(this.getter());
      if (this.el) this.paint(this.current, 200);
    }
  }
}
