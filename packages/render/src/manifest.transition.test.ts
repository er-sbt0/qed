/**
 * manifest.transition.test.ts — the transition feed, over manifest literals.
 *
 * `sceneManifest` itself is proven against real scenes in the library package
 * (manifest.test.ts), where the objects exist to describe. The FEED is pure
 * comparison, so it is proven here on hand-built snapshots — what moved, what
 * flipped, and what deliberately does not count.
 */

import { describe, expect, it } from 'vitest';
import { transitionFeed } from './manifest.js';
import type { ManifestClaim, ManifestObject, SceneManifest } from './manifest.js';

const claim = (id: string, holds: boolean, label?: string): ManifestClaim => ({
  id,
  holds,
  evidence: 'exact-comparison',
  ...(label !== undefined ? { label } : {}),
});

const param = (id: string, value: number, label?: string): ManifestObject => ({
  id,
  kind: 'parameter',
  value,
  ...(label !== undefined ? { label } : {}),
});

const manifest = (
  objects: readonly ManifestObject[],
  claims: readonly ManifestClaim[],
): SceneManifest => ({ beats: [], narration: [], views: [], objects, claims });

describe('transitionFeed — the brief gets the transition, not just the state', () => {
  it('reports which claims flipped, with both verdicts', () => {
    const before = manifest([], [claim('claim#1', true, 'under three'), claim('claim#2', true)]);
    const after = manifest([], [claim('claim#1', false, 'under three'), claim('claim#2', true)]);
    const feed = transitionFeed(before, after, []);
    expect(feed.flipped).toEqual([{ id: 'claim#1', label: 'under three', from: true, to: false }]);
  });

  it('labels the moves from the AFTER manifest, so a model can narrate them', () => {
    const after = manifest([param('parameter#1', 2, 'spin')], []);
    const feed = transitionFeed(manifest([], []), after, [{ target: 'parameter#1', value: 2 }]);
    expect(feed.moved).toEqual([{ target: 'parameter#1', value: 2, label: 'spin' }]);
  });

  it('a move whose target the manifest no longer offers keeps its id, unlabeled', () => {
    const feed = transitionFeed(manifest([], []), manifest([], []), [
      { target: 'parameter#9', value: 1 },
    ]);
    expect(feed.moved).toEqual([{ target: 'parameter#9', value: 1 }]);
  });

  it('a claim that APPEARED in between is not a flip — no before-verdict exists', () => {
    const before = manifest([], []);
    const after = manifest([], [claim('claim#7', false)]);
    expect(transitionFeed(before, after, []).flipped).toEqual([]);
  });

  it('a claim that held both times is quiet, whatever moved underneath it', () => {
    const before = manifest([param('parameter#1', 1)], [claim('claim#1', true)]);
    const after = manifest([param('parameter#1', 1.4)], [claim('claim#1', true)]);
    const feed = transitionFeed(before, after, [{ target: 'parameter#1', value: 1.4 }]);
    expect(feed.flipped).toEqual([]);
    expect(feed.moved).toHaveLength(1);
  });

  it('an empty gap is an empty feed', () => {
    const m = manifest([param('parameter#1', 1)], [claim('claim#1', true)]);
    expect(transitionFeed(m, m, [])).toEqual({ moved: [], flipped: [] });
  });
});
