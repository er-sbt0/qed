/**
 * segments.test.ts — the pure segmentation rules: where a timeline is cut,
 * what the implicit prologue is, and what an unmarked timeline yields.
 */
import { describe, expect, it } from 'vitest';
import { createWorld } from '@math-ai/core';
import type { TimelineNode } from '@math-ai/core';
import { createLesson } from '@math-ai/lesson';
import { isBeatMarker, segmentTitles, splitIntoSegments } from './segments.js';

function setup() {
  const world = createWorld();
  const lesson = createLesson(world);
  const root = (): readonly TimelineNode[] => world.timeline.root;
  const say = (text: string) => lesson.say`${text}`;
  return { world, lesson, root, say };
}

/** ops of a segment, so assertions read like the program does. */
const ops = (nodes: readonly TimelineNode[]): string[] =>
  nodes.map((n) => (n.type === 'action' ? n.op : n.type));

describe('splitIntoSegments', () => {
  it('yields exactly one segment for a timeline with no beats (today’s behaviour)', () => {
    const { world, lesson, root, say } = setup();
    say('a');
    lesson.show(world.handle('thing'));
    say('b');
    const segments = splitIntoSegments(root());
    expect(segments).toHaveLength(1);
    expect(segments[0]!.title).toBeUndefined();
    expect(segments[0]!.nodes).toHaveLength(root().length);
  });

  it('never returns an empty list, even for an empty timeline', () => {
    const { root } = setup();
    const segments = splitIntoSegments(root());
    expect(segments).toHaveLength(1);
    expect(segments[0]!.nodes).toEqual([]);
  });

  it('cuts at each marker and titles the segment the marker opens', () => {
    const { lesson, root, say } = setup();
    lesson.beat('first');
    say('a');
    say('b');
    lesson.beat('second');
    say('c');
    const segments = splitIntoSegments(root());
    expect(segmentTitles(segments)).toEqual(['first', 'second']);
    expect(ops(segments[0]!.nodes)).toEqual(['beat', 'say', 'say']);
    expect(ops(segments[1]!.nodes)).toEqual(['beat', 'say']);
    expect(segments.map((s) => s.index)).toEqual([0, 1]);
  });

  it('collects nodes before the first marker into an implicit untitled prologue', () => {
    const { lesson, root, say } = setup();
    say('setup');
    lesson.beat('the collapse');
    say('a');
    const segments = splitIntoSegments(root());
    expect(segments).toHaveLength(2);
    expect(segments[0]!.title).toBeUndefined();
    expect(ops(segments[0]!.nodes)).toEqual(['say']);
    expect(segments[1]!.title).toBe('the collapse');
  });

  it('partitions the timeline: every node appears exactly once, in order', () => {
    const { lesson, root, say } = setup();
    say('p');
    lesson.beat('one');
    say('a');
    lesson.beat('two');
    say('b');
    say('c');
    const segments = splitIntoSegments(root());
    const flat = segments.flatMap((s) => s.nodes);
    expect(flat.map((n) => n.id)).toEqual(root().map((n) => n.id));
  });

  it('does not cut on a beat nested inside a cascade — boundaries are top-level only', () => {
    const { lesson, root } = setup();
    lesson.beat('outer');
    lesson.cascade([1, 2], () => {
      lesson.beat('nested');
    });
    const segments = splitIntoSegments(root());
    expect(segments).toHaveLength(1);
    expect(segments[0]!.title).toBe('outer');
    expect(ops(segments[0]!.nodes)).toEqual(['beat', 'cascade']);
  });

  it('tolerates adjacent markers (an empty beat is still navigable)', () => {
    const { lesson, root, say } = setup();
    lesson.beat('empty');
    lesson.beat('full');
    say('a');
    const segments = splitIntoSegments(root());
    expect(segmentTitles(segments)).toEqual(['empty', 'full']);
    expect(ops(segments[0]!.nodes)).toEqual(['beat']);
  });
});

describe('isBeatMarker', () => {
  it('recognises only the marker op', () => {
    const { lesson, root, say } = setup();
    lesson.beat('t');
    say('a');
    expect(isBeatMarker(root()[0]!)).toBe(true);
    expect(isBeatMarker(root()[1]!)).toBe(false);
  });
});
