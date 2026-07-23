/**
 * views/claim.ts — a live proposition with a status badge.
 *
 * The claim view is the "try to break it" instrument. It shows both sides of
 * an asserted relation as live numbers and a Verdict badge that re-derives on
 * every `applyState` — so a student dragging a Parameter watches the badge
 * either hold (a theorem) or flip (a conjecture, and the drag that broke it is
 * the counterexample).
 *
 * The subject is structural, not a concrete library type: anything with live
 * `holds` / `status` and optional numeric sides renders here, exactly as
 * `MorphSubject.elements` keeps the verbs ignorant of discipline objects.
 */

import type { Handle } from '@math-ai/core';
import type { NumericHandle, Verdict } from '@math-ai/lesson';
import { View } from '../view.js';
import type { Stage } from '../stage.js';
import { fmt } from '../util.js';
import { renderTex } from '../tex.js';

/** What a claim must expose to be shown. `M.claim` produces this shape. */
export interface ClaimSubject extends Handle {
  readonly label?: string;
  /** Two-sided form; absent for a predicate claim. */
  readonly lhs?: NumericHandle;
  readonly rhs?: NumericHandle;
  readonly relation?: string;
  readonly gap?: NumericHandle;
  /** Live. */
  readonly holds: boolean;
  /** Live. */
  readonly status: Verdict;
}

export interface ClaimSpec {
  readonly claim: ClaimSubject;
  readonly label?: string;
  /** Show the numeric sides. Default true when the claim has them. */
  readonly showValues?: boolean;
}

const GLYPH: Readonly<Record<string, string>> = {
  '<=': '≤',
  '>=': '≥',
  '!=': '≠',
};

/** `<=` reads as `≤` on the stage; anything else passes through. */
export function relationGlyph(relation: string): string {
  return GLYPH[relation] ?? relation;
}

export class ClaimView extends View {
  private badgeEl: HTMLElement | null = null;
  private lhsEl: HTMLElement | null = null;
  private rhsEl: HTMLElement | null = null;
  private gapEl: HTMLElement | null = null;

  constructor(
    stage: Stage,
    private readonly spec: ClaimSpec,
  ) {
    super(stage, 'view:claim');
  }

  override get elements(): readonly Handle[] {
    const { lhs, rhs } = this.spec.claim;
    return [this.spec.claim, ...(lhs ? [lhs] : []), ...(rhs ? [rhs] : [])];
  }

  /** The live state — headless tests read this without a DOM. */
  values(): {
    readonly holds: boolean;
    readonly status: Verdict;
    readonly lhs?: number;
    readonly rhs?: number;
    readonly gap?: number;
  } {
    const c = this.spec.claim;
    return {
      holds: c.holds,
      status: c.status,
      lhs: c.lhs?.value,
      rhs: c.rhs?.value,
      gap: c.gap?.value,
    };
  }

  private get showValues(): boolean {
    return (this.spec.showValues ?? true) && this.spec.claim.lhs !== undefined;
  }

  protected render(doc: Document): HTMLElement {
    const c = this.spec.claim;
    const root = doc.createElement('div');
    root.classList.add('mr-panelbox', 'mr-claim');

    const head = doc.createElement('div');
    head.className = 'mr-claim-head';
    const label = doc.createElement('span');
    label.className = 'mr-claim-label';
    renderTex(label, this.spec.label ?? c.label ?? '');
    this.badgeEl = doc.createElement('span');
    head.append(label, this.badgeEl);
    root.appendChild(head);

    if (this.showValues && c.lhs && c.rhs) {
      const body = doc.createElement('div');
      body.className = 'mr-claim-body';
      const side = (handle: NumericHandle): HTMLElement => {
        const el = doc.createElement('span');
        el.className = 'mr-claim-side';
        el.setAttribute('data-mr-num', '');
        this.stage.registry.register(el, handle.id);
        return el;
      };
      this.lhsEl = side(c.lhs);
      const rel = doc.createElement('span');
      rel.className = 'mr-claim-rel';
      rel.textContent = relationGlyph(c.relation ?? '=');
      this.rhsEl = side(c.rhs);
      body.append(this.lhsEl, rel, this.rhsEl);
      root.appendChild(body);

      if (c.gap) {
        this.gapEl = doc.createElement('span');
        this.gapEl.className = 'mr-claim-gap';
        body.appendChild(this.gapEl);
      }
    }

    this.paint();
    return root;
  }

  private paint(): void {
    const v = this.values();
    if (this.badgeEl) {
      this.badgeEl.className = `mr-verdict mr-verdict-${v.status.polarity}`;
      this.badgeEl.textContent = v.status.label;
    }
    if (this.lhsEl && v.lhs !== undefined) this.lhsEl.textContent = fmt(v.lhs);
    if (this.rhsEl && v.rhs !== undefined) this.rhsEl.textContent = fmt(v.rhs);
    if (this.gapEl && v.gap !== undefined) this.gapEl.textContent = `gap ${fmt(v.gap)}`;
    if (this.el) this.el.classList.toggle('mr-claim-broken', !v.holds);
  }

  override applyState(): void {
    if (this.el) this.paint();
  }
}
