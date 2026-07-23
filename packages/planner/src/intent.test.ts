/**
 * intent.test.ts — the turns that must NOT cost a billed call, and the far
 * larger set that must not be intercepted by a regex.
 *
 * The asymmetry is the design: a false positive silently moves the student's
 * scene, a false negative costs one ordinary turn. So most of these assert
 * that the classifier declined.
 */

import { describe, expect, it } from 'vitest';
import { classifyFollowup } from './intent.js';
import type { ManipulableTarget } from './intent.js';

const TARGETS: readonly ManipulableTarget[] = [
  { id: 'parameter#1', label: 'spin', range: [-2, 2] },
  { id: 'parameter#2', label: '\\theta', range: [0, 3.14] },
  { id: 'parameter#3', label: 'radius' },
];

describe('classifyFollowup — manipulate, answered without a model', () => {
  it('recognizes the plain forms', () => {
    for (const q of ['set spin to 1', 'set spin = 1', 'make spin equal to 1', 'spin = 1']) {
      const r = classifyFollowup(q, TARGETS);
      expect(r.intent, q).toBe('manipulate');
      if (r.intent === 'manipulate') {
        expect(r.target.id).toBe('parameter#1');
        expect(r.value).toBe(1);
      }
    }
  });

  it('takes negatives and decimals', () => {
    const r = classifyFollowup('set spin to -1.5', TARGETS);
    expect(r.intent === 'manipulate' && r.value).toBe(-1.5);
  });

  it('clamps to the range, and says that it did', () => {
    const r = classifyFollowup('set spin to 99', TARGETS);
    expect(r.intent).toBe('manipulate');
    if (r.intent === 'manipulate') {
      expect(r.value).toBe(2);
      expect(r.clamped).toBe(true);
    }
  });

  it('leaves a rangeless target alone', () => {
    const r = classifyFollowup('set radius to 40', TARGETS);
    expect(r.intent === 'manipulate' && r.value).toBe(40);
    expect(r.intent === 'manipulate' && r.clamped).toBe(false);
  });

  it('matches a LaTeX label against a plainly-typed name', () => {
    const r = classifyFollowup('set theta to 1', TARGETS);
    expect(r.intent === 'manipulate' && r.target.id).toBe('parameter#2');
  });

  it('accepts a raw id, which is what a UI control would send', () => {
    const r = classifyFollowup('set parameter#3 to 2', TARGETS);
    expect(r.intent === 'manipulate' && r.target.id).toBe('parameter#3');
  });
});

describe('classifyFollowup — everything it must refuse to decide', () => {
  it('declines a question, even one containing a number', () => {
    for (const q of [
      'why did that turn red?',
      'what happens when spin is 2?',
      'is spin = 1 the case here?',
      'does the claim hold for spin above 1?',
      'what would setting spin to 0 do?',
    ]) {
      expect(classifyFollowup(q, TARGETS).intent, q).toBeNull();
    }
  });

  it('declines a name that is not in the scene — the model may know what it meant', () => {
    expect(classifyFollowup('set wobble to 3', TARGETS).intent).toBeNull();
  });

  it('declines an AMBIGUOUS name rather than picking one', () => {
    const twins: readonly ManipulableTarget[] = [
      { id: 'a#1', label: 'the angle' },
      { id: 'a#2', label: 'the angle' },
    ];
    expect(classifyFollowup('set the angle to 1', twins).intent).toBeNull();
  });

  it('declines when there is nothing draggable at all', () => {
    expect(classifyFollowup('set spin to 1', []).intent).toBeNull();
  });

  it('declines a non-numeric target value', () => {
    expect(classifyFollowup('set spin to maximum', TARGETS).intent).toBeNull();
  });

  it('declines an instruction that is not a set', () => {
    for (const q of ['show me the tiling', 'add a second field', 'drop that last beat']) {
      expect(classifyFollowup(q, TARGETS).intent, q).toBeNull();
    }
  });
});
