/**
 * events.test.ts — the trace-event vocabulary → animation-cue mapping.
 */
import { describe, expect, it } from 'vitest';
import type { Handle } from '@math-ai/core';
import { interpretEvent } from './events.js';

const h = (kind: string, n: number): Handle => ({ id: `${kind}#${n}`, kind });
const fallback = h('walk', 1);

describe('interpretEvent', () => {
  it('hop → travel, with handle endpoints', () => {
    const from = h('state', 1);
    const to = h('state', 2);
    const cue = interpretEvent({ type: 'hop', index: 0, from, to }, fallback);
    expect(cue).toEqual({ kind: 'travel', from, to, size: undefined });
  });

  it('parcel → travel with size from the numeric field, string endpoints allowed', () => {
    const cue = interpretEvent({ type: 'parcel', from: 'Sunny', to: 'Rainy', parcel: 0.35 }, fallback);
    expect(cue).toEqual({ kind: 'travel', from: 'Sunny', to: 'Rainy', size: 0.35 });
    const mass = interpretEvent({ type: 'flow', from: 'A', to: 'B', mass: 0.1 }, fallback);
    expect(mass.kind).toBe('travel');
  });

  it('*derive* → derive with the tagged subject and handle/string inputs', () => {
    const edge = h('edge', 1);
    const cue = interpretEvent(
      { type: 'edge.derive', subject: edge, member: '1', symbol: '0', landed: 'ODD' },
      fallback,
    );
    expect(cue.kind).toBe('derive');
    if (cue.kind !== 'derive') return;
    expect(cue.subject).toBe(edge);
    expect(cue.inputs).toEqual(['1', '0', 'ODD']);
  });

  it('append → grow on the subject (falling back to the demonstrated handle)', () => {
    const word = h('word', 3);
    expect(interpretEvent({ type: 'append', subject: word, suffix: '1' }, fallback)).toEqual({
      kind: 'grow',
      subject: word,
    });
    expect(interpretEvent({ type: 'append', suffix: '1' }, fallback)).toEqual({
      kind: 'grow',
      subject: fallback,
    });
  });

  it('compare:apply / compare:judge → side-addressed cues', () => {
    const subject = h('word', 1);
    const result = h('word', 2);
    expect(interpretEvent({ type: 'compare:apply', side: 1, subject, result }, fallback)).toEqual({
      kind: 'apply',
      side: 1,
      subject,
      result,
    });
    const verdict = { label: 'ACCEPT', polarity: 'accept' as const };
    expect(interpretEvent({ type: 'compare:judge', side: 0, subject, verdict }, fallback)).toEqual({
      kind: 'verdict',
      side: 0,
      subject,
      verdict,
    });
  });

  it('unknown event types degrade to a pulse, never an error', () => {
    expect(interpretEvent({ type: 'mystery', payload: 42 }, fallback)).toEqual({
      kind: 'pulse',
      subject: fallback,
    });
  });
});
