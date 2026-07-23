/**
 * formula.ts — the `F.tex` tagged-template formula builder.
 *
 * Formulas are never opaque strings (architecture: "Locked early #3"): a
 * formula is an addressable tree of role-named spans. CONSTRUCTION lives here
 * in the lesson layer — not in render — because the formula is authoring
 * vocabulary: the lesson program links spans to objects
 * (`lesson.link(f.span("suffix"), suffixes, "represents")`) before any
 * renderer exists, exactly as narration (`say`) is constructed here and
 * rendered elsewhere. Milestone 3's renderer consumes `fragments` and renders
 * KaTeX per fragment; formula MORPHING stays deferred — only the
 * addressable-span contract is fixed.
 *
 * Contract points the spikes forced (F7 / M5):
 *  - the tag reads `strings.raw` — in a cooked template `\sim` silently
 *    becomes `sim`, so the tag is load-bearing;
 *  - spans are named by semantic ROLE, and ONE role covers every fragment it
 *    recurs in (`π` twice in `πP=π`) — `span(role)` returns one handle that
 *    addresses all of them;
 *  - span handles are ordinary handles, so linking them into the
 *    correspondence graph makes them light up when their linked objects
 *    animate (emergent, not authored).
 */

import type { Handle, World } from '@math-ai/core';

/** A role-named TeX fragment, produced by `F.span(role, tex)`. */
export interface SpanSpec {
  readonly role: string;
  readonly tex: string;
}

/** The addressable handle one role resolves to (all its fragments at once). */
export type FormulaSpan = Handle<'span'>;

/** One renderable piece of the formula; `role` marks addressable fragments. */
export interface FormulaFragment {
  readonly tex: string;
  readonly role?: string;
}

export interface Formula extends Handle<'formula'> {
  readonly fragments: readonly FormulaFragment[];
  /** Distinct roles, in first-appearance order. */
  readonly roles: readonly string[];
  /** The full TeX, for describe/debug — renderers use `fragments`. */
  readonly tex: string;
  /** Address a role. Throws (listing available roles) when unknown. */
  span(role: string): FormulaSpan;
}

export interface FormulaBuilder {
  span(role: string, tex: string): SpanSpec;
  tex(
    strings: TemplateStringsArray,
    ...parts: ReadonlyArray<string | SpanSpec>
  ): Formula;
}

/** The `F` of the spike programs, bound to a world (handles need identity). */
export function createF(world: World): FormulaBuilder {
  return {
    span(role: string, tex: string): SpanSpec {
      return Object.freeze({ role, tex });
    },

    tex(strings: TemplateStringsArray, ...parts: ReadonlyArray<string | SpanSpec>): Formula {
      const raw = strings.raw; // load-bearing: cooked strings eat TeX backslashes
      const fragments: FormulaFragment[] = [];
      raw.forEach((segment, i) => {
        if (segment.length > 0) fragments.push(Object.freeze({ tex: segment }));
        const part = parts[i];
        if (part === undefined) return;
        if (typeof part === 'string') {
          if (part.length > 0) fragments.push(Object.freeze({ tex: part }));
        } else {
          fragments.push(Object.freeze({ tex: part.tex, role: part.role }));
        }
      });

      const spans = new Map<string, FormulaSpan>();
      for (const f of fragments) {
        if (f.role !== undefined && !spans.has(f.role)) {
          // the span's TeX is its label: an interpolated span in a `say`
          // renders as the math it addresses, not as a handle id
          spans.set(f.role, Object.freeze({ ...world.handle('span'), label: f.tex }));
        }
      }
      const roles = Object.freeze([...spans.keys()]);
      const base = world.handle('formula');

      return Object.freeze({
        id: base.id,
        kind: 'formula' as const,
        fragments: Object.freeze(fragments),
        roles,
        tex: fragments.map((f) => f.tex).join(''),
        span(role: string): FormulaSpan {
          const handle = spans.get(role);
          if (!handle) {
            throw new Error(
              `formula ${base.id} has no span role "${role}" — available roles: ` +
                (roles.length > 0 ? roles.join(', ') : '(none)'),
            );
          }
          return handle;
        },
      });
    },
  };
}
