/**
 * views/formulaView.ts — KaTeX rendering of a lesson `Formula`, one KaTeX
 * render PER FRAGMENT so every role-named span is an addressable DOM node.
 * All fragments of a role register under the role's single span handle —
 * lighting the handle lights every occurrence (π twice in πP=π).
 *
 * Fragments must therefore be self-contained TeX (the tag's interpolation
 * points are natural break points; a subscript can't straddle fragments).
 *
 * Element granularity: the role SPAN handles are the elements.
 *
 * MORPHING (`transformTo`, milestone 6): the view re-renders itself as the
 * `to` formula in place, so a role present in both formulas is the SAME DOM
 * lineage moving to its new position — that is what carries a span's
 * correspondence links (and therefore its highlight behavior) across the
 * transition. Roles only in `from` fade out; roles only in `to` fade in. The
 * preserved spans additionally register under BOTH span handles, so a link
 * authored against either formula's span still resolves after the morph.
 */

import katex from 'katex';
import type { Id } from '@math-ai/core';
import type { Formula, TransformFormulaPayload } from '@math-ai/lesson';
import { View } from '../view.js';
import type { Stage } from '../stage.js';
import { animate } from '../animate.js';

export class FormulaView extends View {
  private current: Formula;

  constructor(
    stage: Stage,
    readonly formula: Formula,
  ) {
    super(stage, 'view:formula');
    this.current = formula;
  }

  /** The formula this view is currently displaying (changes under a morph). */
  get displayed(): Formula {
    return this.current;
  }

  override get elements() {
    return this.current.roles.map((role) => this.current.span(role));
  }

  override projects(id: Id): boolean {
    return id === this.formula.id || id === this.current.id || super.projects(id);
  }

  /**
   * ONE KaTeX pass over the whole formula, with each role-named fragment
   * wrapped in `\htmlClass` so the rendered output still carries an
   * addressable node per role.
   *
   * Rendering fragment-by-fragment (the milestone-3 approach) required every
   * fragment to be self-contained TeX, and the FTC's ÷Δx formula is the case
   * that breaks it: `\frac{` · ΔA · `}{` · Δx · `}` has no standalone-valid
   * pieces at all. Wrapping instead of splitting keeps the addressable-span
   * contract — a role still resolves to every node it occupies — while the
   * math is laid out as one expression, which is the only way a fraction
   * typesets correctly.
   */
  private buildInto(root: HTMLElement, doc: Document, formula: Formula): void {
    const roleIndex = new Map<string, number>();
    let tex = '';
    for (const fragment of formula.fragments) {
      if (fragment.role === undefined) {
        tex += fragment.tex;
        continue;
      }
      let index = roleIndex.get(fragment.role);
      if (index === undefined) {
        index = roleIndex.size;
        roleIndex.set(fragment.role, index);
      }
      tex += `\\htmlClass{mr-role-${index}}{${fragment.tex}}`;
    }
    const holder = doc.createElement('span');
    holder.innerHTML = katex.renderToString(tex, {
      throwOnError: false,
      // \htmlClass is the addressing mechanism, so it must be permitted
      trust: true,
      strict: 'ignore',
    });
    root.appendChild(holder);

    for (const [role, index] of roleIndex) {
      const nodes = holder.querySelectorAll<HTMLElement>(`.mr-role-${index}`);
      for (const el of Array.from(nodes)) {
        el.classList.add('mr-fspan');
        el.setAttribute('data-mr-role', role);
        this.stage.registry.register(el, formula.span(role).id);
      }
    }
  }

  protected render(doc: Document): HTMLElement {
    const root = doc.createElement('div');
    root.classList.add('mr-panelbox', 'mr-formula');
    this.buildInto(root, doc, this.current);
    return root;
  }

  /**
   * Become the `to` formula. Preserved roles keep span identity: their nodes
   * are re-registered under the target span handle and travel to their new
   * position; leaving roles fade out, entering roles fade in.
   */
  async transformTo(payload: TransformFormulaPayload, ms: number): Promise<void> {
    this.current = payload.to;
    const doc = this.stage.doc;
    if (!this.el || !doc) return;

    const preservedRoles = new Set(payload.preserved.map((p) => p.role));
    const before = new Map<string, DOMRect>();
    for (const el of Array.from(this.el.querySelectorAll<HTMLElement>('[data-mr-role]'))) {
      const role = el.getAttribute('data-mr-role');
      if (role !== null && preservedRoles.has(role)) before.set(role, el.getBoundingClientRect());
    }
    // leaving spans fade before the rebuild
    const leaving = Array.from(this.el.querySelectorAll<HTMLElement>('[data-mr-role]')).filter(
      (el) => !preservedRoles.has(el.getAttribute('data-mr-role') ?? ''),
    );
    await Promise.all(leaving.map((el) => animate(el, [{ opacity: 1 }, { opacity: 0 }], ms / 2)));

    while (this.el.firstChild) this.el.removeChild(this.el.firstChild);
    this.buildInto(this.el, doc, payload.to);

    // preserved spans also answer to their `from` handle: a link authored on
    // the old formula's span must keep resolving to a live node
    for (const pair of payload.preserved) {
      for (const el of Array.from(this.el.querySelectorAll<HTMLElement>('[data-mr-role]'))) {
        if (el.getAttribute('data-mr-role') === pair.role) {
          this.stage.registry.register(el, pair.from.id);
        }
      }
    }

    const moves: Array<Promise<void>> = [];
    for (const el of Array.from(this.el.querySelectorAll<HTMLElement>('[data-mr-role]'))) {
      const role = el.getAttribute('data-mr-role') ?? '';
      const from = before.get(role);
      if (from) {
        // FLIP: start at the old position, settle into the new one
        const to = el.getBoundingClientRect();
        const dx = from.left - to.left;
        const dy = from.top - to.top;
        el.classList.add('mr-preserved');
        moves.push(
          animate(
            el,
            [{ transform: `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)` }, { transform: 'none' }],
            ms,
            'cubic-bezier(0.4, 0, 0.2, 1)',
          ).then(() => {
            setTimeout(() => el.classList.remove('mr-preserved'), ms);
          }),
        );
      } else {
        moves.push(animate(el, [{ opacity: 0 }, { opacity: 1 }], ms));
      }
    }
    await Promise.all(moves);
  }
}
