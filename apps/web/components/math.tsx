'use client';

import katex from 'katex';
import { useMemo } from 'react';
import { cn } from '@/lib/utils';

interface MathProps {
  tex: string;
  display?: boolean;
  className?: string;
}

export function Math({ tex, display = false, className }: MathProps) {
  const html = useMemo(() => {
    return katex.renderToString(tex, {
      displayMode: display,
      throwOnError: false,
    });
  }, [tex, display]);

  return (
    <span
      className={cn(className)}
      style={{ display: display ? 'block' : 'inline' }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/**
 * The delimiters the planner actually emits. `$$…$$` and `\[…\]` are display
 * math; `$…$` and `\(…\)` are inline. Ordered longest-first so `$$` wins over
 * `$`. The `$…$` case requires a non-space, non-digit opener so prices ("$5")
 * and stray dollars stay prose.
 */
const SEGMENT = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$(?![\s\d])([^$\n]+?)\$/g;

interface MathTextProps {
  text: string;
  className?: string;
}

/**
 * Prose with math mixed in. Everything outside a delimiter stays text; each
 * delimited span goes through KaTeX. Use this for any model-written string —
 * `Math` alone assumes the whole string is TeX.
 */
export function MathText({ text, className }: MathTextProps) {
  const parts = useMemo(() => {
    const out: Array<{ key: string; text: string } | { key: string; tex: string; display: boolean }> =
      [];
    let last = 0;
    for (const m of text.matchAll(SEGMENT)) {
      const at = m.index ?? 0;
      if (at > last) out.push({ key: `t${last}`, text: text.slice(last, at) });
      const [, block, bracket, paren, inline] = m;
      const tex = block ?? bracket ?? paren ?? inline ?? '';
      out.push({ key: `m${at}`, tex, display: block !== undefined || bracket !== undefined });
      last = at + m[0].length;
    }
    if (last < text.length) out.push({ key: `t${last}`, text: text.slice(last) });
    return out;
  }, [text]);

  return (
    <span className={cn(className)}>
      {parts.map((p) =>
        'tex' in p ? (
          <Math key={p.key} tex={p.tex} display={p.display} />
        ) : (
          <span key={p.key}>{p.text}</span>
        ),
      )}
    </span>
  );
}
