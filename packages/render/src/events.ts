/**
 * events.ts — the standard trace-event vocabulary `demonstrate` replay (and
 * `slot.set({via: "derivation"})`) interprets, and the pure mapping from a
 * trace event to an animation cue.
 *
 * THE VOCABULARY (adopted for milestone 3; operations are free to emit richer
 * shapes — unknown types degrade to a pulse, never an error):
 *
 *   { type: "hop",    from, to, ... }            one token travels from→to
 *   { type: "parcel", from, to, parcel|mass|weight, ... }
 *                                                a mass parcel travels from→to,
 *                                                dot size ∝ the numeric field
 *   { type: "*derive*", subject, ... }           a derivation reveals its
 *                                                subject: inputs pulse, the
 *                                                subject inks in (any type
 *                                                containing "derive")
 *   { type: "append", subject, base, suffix }    a token grows in place
 *   { type: "compare:apply", side, subject, result }
 *                                                one experiment side runs its
 *                                                operation; result lands
 *   { type: "compare:judge", side, subject, verdict }
 *                                                one side's verdict stamps
 *   anything else                                pulse the event's `subject`
 *                                                (or the demonstrated handle)
 *
 * `from`/`to` may be Handles or plain strings — strings resolve through the
 * node registry's alias keys (views register label aliases for exactly this).
 */

import { isHandle } from '@math-ai/core';
import type { Handle, TraceEvent } from '@math-ai/core';
import type { Verdict } from '@math-ai/lesson';

/** A node reference an event may carry: a handle, or an alias string. */
export type HandleRef = Handle | string;

export type AnimationCue =
  | { readonly kind: 'travel'; readonly from: HandleRef; readonly to: HandleRef; readonly size?: number }
  | { readonly kind: 'derive'; readonly subject: Handle; readonly inputs: readonly HandleRef[] }
  | { readonly kind: 'grow'; readonly subject: Handle }
  | { readonly kind: 'apply'; readonly side: number; readonly subject?: Handle; readonly result?: Handle }
  | { readonly kind: 'verdict'; readonly side: number; readonly subject?: Handle; readonly verdict: Verdict }
  | { readonly kind: 'pulse'; readonly subject: HandleRef };

function refOf(x: unknown): HandleRef | undefined {
  if (isHandle(x)) return x;
  if (typeof x === 'string') return x;
  return undefined;
}

function subjectOf(event: TraceEvent, fallback: Handle): Handle {
  const s = event['subject'];
  return isHandle(s) ? s : fallback;
}

function sizeOf(event: TraceEvent): number | undefined {
  for (const key of ['parcel', 'mass', 'weight']) {
    const v = event[key];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return undefined;
}

/**
 * Map one trace event to an animation cue. `fallback` is the demonstrated
 * handle — the subject of last resort.
 */
export function interpretEvent(event: TraceEvent, fallback: Handle): AnimationCue {
  const from = refOf(event['from']);
  const to = refOf(event['to']);

  if (event.type === 'compare:apply') {
    const side = typeof event['side'] === 'number' ? event['side'] : 0;
    const result = event['result'];
    return {
      kind: 'apply',
      side,
      subject: isHandle(event['subject']) ? event['subject'] : undefined,
      result: isHandle(result) ? result : undefined,
    };
  }
  if (event.type === 'compare:judge') {
    const side = typeof event['side'] === 'number' ? event['side'] : 0;
    const verdict = event['verdict'] as Verdict | undefined;
    if (verdict && typeof verdict.label === 'string') {
      return {
        kind: 'verdict',
        side,
        subject: isHandle(event['subject']) ? event['subject'] : undefined,
        verdict,
      };
    }
  }
  if ((event.type === 'hop' || event.type === 'parcel') && from !== undefined && to !== undefined) {
    return { kind: 'travel', from, to, size: sizeOf(event) };
  }
  // generic travel: any event with both endpoints moves something
  if (event.type !== 'append' && !event.type.includes('derive') && from !== undefined && to !== undefined) {
    return { kind: 'travel', from, to, size: sizeOf(event) };
  }
  if (event.type.includes('derive')) {
    const inputs: HandleRef[] = [];
    for (const [key, value] of Object.entries(event)) {
      if (key === 'type' || key === 'subject') continue;
      const ref = refOf(value);
      if (ref !== undefined) inputs.push(ref);
    }
    return { kind: 'derive', subject: subjectOf(event, fallback), inputs };
  }
  if (event.type === 'append') {
    return { kind: 'grow', subject: subjectOf(event, fallback) };
  }
  return { kind: 'pulse', subject: subjectOf(event, fallback) };
}
