/**
 * util.ts — small shared helpers.
 */

/**
 * Human label for a handle-ish object: first of label/text/symbol/name, then
 * the id. The empty string is a valid label (ε) — callers that want 'ε' for
 * it use `displayLabel`.
 */
export function labelOf(x: unknown): string {
  if (x !== null && typeof x === 'object') {
    const o = x as Record<string, unknown>;
    for (const key of ['label', 'text', 'symbol', 'name']) {
      const v = o[key];
      if (typeof v === 'string') return v;
    }
    if (typeof o['id'] === 'string') return o['id'];
  }
  return String(x);
}

/** `labelOf`, with the empty string shown as ε (the empty word). */
export function displayLabel(x: unknown): string {
  const s = labelOf(x);
  return s === '' ? 'ε' : s;
}

/** Format a number for display: up to 3 decimals, no trailing zeros. */
export function fmt(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n
    .toFixed(3)
    .replace(/0+$/, '')
    .replace(/\.$/, '');
}
