import { describe, expect, it } from 'vitest';
import { createWorld } from './world.js';
import type { Handle } from './identity.js';
import type { ActionStep } from './timeline.js';

interface Word extends Handle<'word'> {
  readonly text: string;
}

function words(world = createWorld()) {
  const word = (text: string): Word => Object.freeze({ ...world.handle('word'), text });
  return { world, word };
}

describe('Collection', () => {
  it('is a handle holding initial items', () => {
    const { world, word } = words();
    const c = world.collection([word('0'), word('1')]);
    expect(c.kind).toBe('collection');
    expect(c.items.map((w) => w.text)).toEqual(['0', '1']);
    expect(c.size).toBe(2);
  });

  it('add appends, returns a timeline step, and notifies subscribers with the delta', () => {
    const { world, word } = words();
    const c = world.collection<Word>();
    const deltas: Array<{ text: string; index: number }> = [];
    c.subscribe((d) => deltas.push({ text: d.item.text, index: d.index }));
    const w = word('01');
    const step = c.add(w);
    expect(c.items).toContain(w);
    expect(deltas).toEqual([{ text: '01', index: 0 }]);
    expect((step as ActionStep).op).toBe('collection:add');
    expect(world.timeline.root).toContain(step);
  });

  it('a derived over items recomputes when the collection grows', () => {
    const { world, word } = words();
    const c = world.collection([word('a')]);
    const count = world.derived(() => c.items.length);
    expect(count.value).toBe(1);
    c.add(word('b'));
    expect(count.value).toBe(2);
  });
});

describe('Incremental: collection deltas driving a derived partition', () => {
  /** The beat-3 shape: a partition derived from a collection via a key closure. */
  function partitionFixture() {
    const { world, word } = words();
    const source = world.collection([word('0'), word('1'), word('11')]);
    let keyCalls = 0;
    const key = (w: Word): number => {
      keyCalls += 1;
      return (w.text.match(/1/g)?.length ?? 0) % 2;
    };
    const partition = world.incremental(source, {
      init: (items) => {
        const buckets = new Map<number, Word[]>();
        for (const w of items) {
          const k = key(w);
          buckets.set(k, [...(buckets.get(k) ?? []), w]);
        }
        return buckets;
      },
      apply: (buckets, delta) => {
        const k = key(delta.item);
        const next = new Map(buckets);
        next.set(k, [...(next.get(k) ?? []), delta.item]);
        return next;
      },
    });
    return { world, word, source, partition, keyCalls: () => keyCalls };
  }

  it('initializes lazily from the items present at first read', () => {
    const { partition, keyCalls } = partitionFixture();
    expect(keyCalls()).toBe(0); // nothing computed yet
    const buckets = partition.value;
    expect(keyCalls()).toBe(3);
    expect(buckets.get(0)!.map((w) => w.text)).toEqual(['0', '11']);
    expect(buckets.get(1)!.map((w) => w.text)).toEqual(['1']);
  });

  it('recomputes incrementally: an arrival keys only the new item', () => {
    const { word, source, partition, keyCalls } = partitionFixture();
    partition.value; // initialize (3 key calls)
    source.add(word('111'));
    expect(keyCalls()).toBe(4); // exactly one more call — not a full re-bucket
    expect(partition.value.get(1)!.map((w) => w.text)).toEqual(['1', '111']);
  });

  it('observers receive {from, to, delta} per arrival', () => {
    const { word, source, partition } = partitionFixture();
    const seen: Array<{ addedText: string; oddSizeAfter: number }> = [];
    partition.subscribe((c) =>
      seen.push({
        addedText: (c.delta!.item as Word).text,
        oddSizeAfter: c.to.get(1)?.length ?? 0,
      }),
    );
    source.add(word('101'));
    source.add(word('1'));
    expect(seen).toEqual([
      { addedText: '101', oddSizeAfter: 1 },
      { addedText: '1', oddSizeAfter: 2 },
    ]);
    // no third bucket ever appears — the beat-3 punchline
    expect(partition.value.size).toBe(2);
  });

  it('additions before first read are folded in by init, not dropped', () => {
    const { word, source, partition, keyCalls } = partitionFixture();
    source.add(word('1111'));
    expect(keyCalls()).toBe(0);
    expect(partition.value.get(0)!.map((w) => w.text)).toEqual(['0', '11', '1111']);
    expect(keyCalls()).toBe(4); // one init pass over all four items
  });

  it('deriveds reading the partition are invalidated by deltas', () => {
    const { word, source, partition, world } = partitionFixture();
    const classCount = world.derived(() => partition.value.size);
    const seen: number[] = [];
    classCount.subscribe((c) => seen.push(c.to));
    expect(classCount.value).toBe(2);
    source.add(word('10')); // odd bucket — no new class
    expect(classCount.value).toBe(2);
    expect(seen).toEqual([]); // size unchanged: no notification
  });

  it('dispose detaches from the source collection', () => {
    const { word, source, partition } = partitionFixture();
    partition.value;
    partition.dispose();
    source.add(word('1'));
    expect(partition.value.get(1)!.map((w) => w.text)).toEqual(['1']); // stale by choice
  });
});
