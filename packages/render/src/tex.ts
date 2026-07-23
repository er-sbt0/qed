/**
 * tex.ts — labels arrive as TeX, because that is what the author wrote
 * (`"\\Delta A/\\Delta x"`, `"\\det A"`, `"\\sum_i f(x_i)\\,\\Delta x"`). Two
 * ways to show them:
 *
 *  - `renderTex` — real KaTeX, for anywhere in the HTML flow (narration
 *    mentions, readout labels, view captions).
 *  - `plainTex` — a best-effort unicode rendering, for SVG `<text>`, where
 *    KaTeX's HTML output cannot go. It is deliberately small: the symbols the
 *    disciplines actually use, plus sub/superscript digits.
 *
 * Neither ever throws: a label that isn't TeX comes back unchanged.
 */

import katex from 'katex';

const SYMBOLS: Record<string, string> = {
  Delta: 'Δ',
  delta: 'δ',
  pi: 'π',
  mu: 'μ',
  sigma: 'σ',
  lambda: 'λ',
  theta: 'θ',
  varepsilon: 'ε',
  epsilon: 'ε',
  alpha: 'α',
  beta: 'β',
  sum: 'Σ',
  int: '∫',
  infty: '∞',
  approx: '≈',
  le: '≤',
  ge: '≥',
  ne: '≠',
  cdot: '·',
  times: '×',
  to: '→',
  sim: '∼',
  perp: '⊥',
  det: 'det',
  text: '',
  frac: '',
  left: '',
  right: '',
};

const SUBSCRIPTS: Record<string, string> = {
  '0': '₀',
  '1': '₁',
  '2': '₂',
  '3': '₃',
  '4': '₄',
  '5': '₅',
  '6': '₆',
  '7': '₇',
  '8': '₈',
  '9': '₉',
  i: 'ᵢ',
  j: 'ⱼ',
  n: 'ₙ',
  x: 'ₓ',
};

const SUPERSCRIPTS: Record<string, string> = {
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  n: 'ⁿ',
};

/** Whether a string carries TeX markup worth typesetting. */
export function isTexish(s: string): boolean {
  return /[\\^_{}]/.test(s);
}

/** Unicode approximation of a short TeX label — for SVG text nodes. */
export function plainTex(label: string): string {
  return label
    .replace(/\\,|\\;|\\!/g, ' ')
    .replace(/\\([a-zA-Z]+)/g, (_, name: string) => SYMBOLS[name] ?? name)
    .replace(/_\{([^}]*)\}|_(.)/g, (_, braced: string | undefined, single: string | undefined) => {
      const body = braced ?? single ?? '';
      const mapped = [...body].map((ch) => SUBSCRIPTS[ch] ?? ch).join('');
      return mapped;
    })
    .replace(/\^\{([^}]*)\}|\^(.)/g, (_, braced: string | undefined, single: string | undefined) => {
      const body = braced ?? single ?? '';
      return [...body].map((ch) => SUPERSCRIPTS[ch] ?? ch).join('');
    })
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Typeset a label into an element: KaTeX when it is TeX, text otherwise. */
export function renderTex(el: HTMLElement, label: string): void {
  if (!isTexish(label)) {
    el.textContent = label;
    return;
  }
  try {
    el.innerHTML = katex.renderToString(label, { throwOnError: true, strict: 'ignore' });
  } catch {
    el.textContent = plainTex(label);
  }
}
