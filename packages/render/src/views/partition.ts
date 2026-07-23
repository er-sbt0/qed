/**
 * views/partition.ts — partition buckets.
 *
 * Element granularity: the CLASSES are the elements — morphing buckets into a
 * state graph sends each bucket to its counterpart state (the class↔state
 * correspondence recorded by construction). Member chips are rendered inside
 * their buckets and registered under the members' handle ids (so the same
 * word in a token cloud, a table header, and a bucket lights up as one), but
 * members are not morph elements of this view.
 *
 * Reactive: with a `source` collection, arrivals re-bucket — the delta
 * animation drops the new member into its class when playback reaches the
 * `collection:add` step. Buckets never multiply: classes are fixed by the
 * spec (a partition derived from a stream shows finiteness by absorbing every
 * arrival into an existing bucket).
 */

import type { Collection, Handle } from '@math-ai/core';
import { View } from '../view.js';
import type { Stage } from '../stage.js';
import { enter } from '../animate.js';
import { displayLabel } from '../util.js';

export interface PartitionSpec<T extends Handle = Handle> {
  readonly classes: readonly Handle[];
  classOf(item: T): Handle;
  /** Reactive source; arrivals animate into their buckets. */
  readonly source?: Collection<T>;
  /** Initial members (defaults to the source's items at construction). */
  readonly members?: readonly T[];
  readonly title?: string;
}

export class PartitionView<T extends Handle = Handle> extends View {
  private readonly members: T[];
  /** Mount renders only the construction-time members; arrivals replay as
   * queued per-step animations when playback reaches them. */
  private readonly initialCount: number;
  private readonly memberAreas = new Map<string, HTMLElement>();

  constructor(
    stage: Stage,
    private readonly spec: PartitionSpec<T>,
  ) {
    super(stage, 'view:partition');
    this.members = [...(spec.members ?? spec.source?.peek() ?? [])];
    this.initialCount = this.members.length;
    spec.source?.subscribe((delta) => {
      this.members.push(delta.item);
      this.queue(delta.step.id, (ms) => this.animateArrival(delta.item, ms));
    });
  }

  override get elements(): readonly Handle[] {
    return this.spec.classes;
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
    row.className = 'mr-buckets';
    root.appendChild(row);
    for (const cls of this.spec.classes) {
      const bucket = doc.createElement('div');
      bucket.className = 'mr-bucket';
      const label = doc.createElement('div');
      label.className = 'mr-bucket-label';
      label.textContent = displayLabel(cls);
      const area = doc.createElement('div');
      area.className = 'mr-bucket-members';
      bucket.append(label, area);
      row.appendChild(bucket);
      this.stage.registry.register(bucket, cls.id);
      this.memberAreas.set(cls.id, area);
    }
    for (const member of this.members.slice(0, this.initialCount)) this.addChip(doc, member);
    return root;
  }

  private addChip(doc: Document, member: T): HTMLElement | null {
    const cls = this.spec.classOf(member);
    const area = this.memberAreas.get(cls.id);
    if (!area) return null;
    const chip = doc.createElement('span');
    chip.className = 'mr-token';
    chip.textContent = displayLabel(member);
    this.stage.registry.register(chip, member.id);
    area.appendChild(chip);
    return chip;
  }

  private async animateArrival(member: T, ms: number): Promise<void> {
    if (!this.stage.doc) return;
    const chip = this.addChip(this.stage.doc, member);
    if (!chip) return;
    this.stage.lightUp(this.spec.classOf(member), ms);
    await enter(chip, 'top', ms);
  }
}
