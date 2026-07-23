/**
 * automata.test.ts — the automata library: traced append, reactive
 * partition (Incremental underneath), machine derivation with edge
 * witnesses, and sampled well-definedness diagnostics.
 */

import { describe, expect, it, vi } from 'vitest';
import { createWorld } from '@math-ai/core';
import type { Handle, World } from '@math-ai/core';
import { createAutomata } from './automata.js';
import type { AutomataLib, Word } from './automata.js';

function setup(): { world: World; M: AutomataLib } {
  const world = createWorld();
  return { world, M: createAutomata(world) };
}

const ones = (w: Word): number => w.count('1');

describe('words', () => {
  it('creates words with count and text', () => {
    const { M } = setup();
    const w = M.word('1011');
    expect(w.kind).toBe('word');
    expect(w.text).toBe('1011');
    expect(w.count('1')).toBe(3);
    expect(w.count('0')).toBe(1);
  });

  it('append derives a new word with came-from provenance and a trace', () => {
    const { world, M } = setup();
    const base = M.word('10');
    const grown = base.append('1');
    expect(grown.text).toBe('101');
    expect(grown.id).not.toBe(base.id);
    // came-from edge recorded by construction
    const edges = world.graph.edgesOf(grown);
    expect(edges.some((e) => e.rel === 'came-from' && e.b.id === base.id)).toBe(true);
    // replayable derivation with the token-growth event
    const events = world.trace(grown);
    const append = events.find((e) => e.type === 'append');
    expect(append).toBeDefined();
    expect((append!['subject'] as Handle).id).toBe(grown.id);
    expect(append!['suffix']).toBe('1');
  });

  it('append accepts a Word suffix', () => {
    const { M } = setup();
    expect(M.word('0').append(M.word('11')).text).toBe('011');
  });
});

describe('enumerateWords', () => {
  it('enumerates all words up to maxLength, ε included', () => {
    const { M } = setup();
    const words = M.enumerateWords(M.alphabet(['0', '1']), { maxLength: 2 });
    const texts = words.items.map((w) => w.text);
    expect(texts).toEqual(['', '0', '1', '00', '01', '10', '11']);
  });

  it('limit keeps the tail of the enumeration (fresh, longer words)', () => {
    const { M } = setup();
    const words = M.enumerateWords(M.alphabet(['0', '1']), { maxLength: 2, limit: 3 });
    expect(words.items.map((w) => w.text)).toEqual(['01', '10', '11']);
  });
});

describe('language', () => {
  it('runs the authored predicate', () => {
    const { M } = setup();
    const L = M.language({
      alphabet: M.alphabet(['0', '1']),
      label: 'even 1s',
      contains: (w) => w.count('1') % 2 === 0,
    });
    expect(L.contains(M.word('101'))).toBe(true);
    expect(L.contains(M.word('1'))).toBe(false);
  });
});

describe('partition', () => {
  it('buckets the source items by key with labels', () => {
    const { M } = setup();
    const words = M.words(['', '0', '1', '11']);
    const p = M.partition(words, { by: (w) => ones(w) % 2, labels: { 0: 'EVEN', 1: 'ODD' } });
    expect(p.classes.map((c) => c.label)).toEqual(['EVEN', 'ODD']);
    expect(p.class('EVEN').members.map((w) => w.text)).toEqual(['', '0', '11']);
    expect(p.class('ODD').members.map((w) => w.text)).toEqual(['1']);
    expect(p.class('EVEN').representative.text).toBe('');
  });

  it('rebuckets arrivals reactively and records contributes-to edges', () => {
    const { world, M } = setup();
    const words = M.words(['', '1']);
    const p = M.partition(words, { by: (w) => ones(w) % 2, labels: { 0: 'EVEN', 1: 'ODD' } });
    const w = M.word('10');
    words.add(w);
    expect(p.classes).toHaveLength(2); // no third bucket, ever
    expect(p.class('ODD').members.map((x) => x.text)).toEqual(['1', '10']);
    const edges = world.graph.edgesOf(w);
    expect(
      edges.some((e) => e.rel === 'contributes-to' && e.b.id === p.class('ODD').id),
    ).toBe(true);
  });

  it('classOf is total: unseen keys mint a class lazily', () => {
    const { M } = setup();
    const words = M.words(['a']);
    const p = M.partition(words, { by: (w) => w.text.length });
    expect(p.classes).toHaveLength(1);
    const cls = p.classOf(M.word('xyz'));
    expect(cls.label).toBe('3');
    expect(p.classes).toHaveLength(2);
    expect(p.classOf(M.word('abc')).id).toBe(cls.id); // stable identity per key
  });

  it('class(label) errors helpfully on unknown labels, showing the key too', () => {
    const { M } = setup();
    const p = M.partition(M.words(['0']), { by: () => 0, labels: { 0: 'ALL' } });
    expect(() => p.class('NOPE')).toThrow(/no class labeled "NOPE".*ALL \(key: 0\)/);
  });

  it('class() also accepts the partition key when labels renamed it', () => {
    const { M } = setup();
    // the shape that broke a generated program: a key -> display-name map, then
    // the class addressed by the KEY rather than the display name
    const p = M.partition(M.words(['', '1']), {
      by: (w) => `hole ${ones(w) % 2}`,
      labels: { 'hole 0': 'Hole 0', 'hole 1': 'Hole 1' },
    });

    expect(p.class('Hole 0').label).toBe('Hole 0');
    expect(p.class('hole 0').id).toBe(p.class('Hole 0').id);
    expect(p.class('hole 1').members.map((w) => w.text)).toEqual(['1']);
  });

  it('prefers the display label when a label and a foreign key collide', () => {
    const { M } = setup();
    // key "a" is displayed as "b"; key "b" is displayed as "z". "b" must find
    // the class DISPLAYED as b, not the class keyed b — labels win.
    const p = M.partition(M.words(['0', '1']), {
      by: (w) => (w.text === '0' ? 'a' : 'b'),
      labels: { a: 'b', b: 'z' },
    });

    expect(p.class('b').representative.text).toBe('0');
  });
});

describe('stateMachine', () => {
  function parityMachine(checkWellDefined: 'sampled' | 'off' = 'sampled') {
    const { world, M } = setup();
    const Sigma = M.alphabet(['0', '1']);
    const L = M.language({ alphabet: Sigma, label: 'even 1s', contains: (w) => ones(w) % 2 === 0 });
    const words = M.enumerateWords(Sigma, { maxLength: 3 });
    const p = M.partition(words, { by: (w) => ones(w) % 2, labels: { 0: 'EVEN', 1: 'ODD' } });
    const machine = M.stateMachine({
      statesFrom: p,
      alphabet: Sigma,
      transition: (cls, s) => p.classOf(cls.representative.append(s)),
      accepting: (cls) => L.contains(cls.representative),
      initial: p.classOf(M.word('')),
      checkWellDefined,
    });
    return { world, M, p, machine };
  }

  it('derives states from classes with counterpart-of edges', () => {
    const { world, p, machine } = parityMachine();
    expect(machine.states.map((s) => s.label)).toEqual(['EVEN', 'ODD']);
    expect(machine.states.map((s) => s.accepting)).toEqual([true, false]);
    expect(machine.initial.label).toBe('EVEN');
    for (const cls of p.classes) {
      const state = machine.state(cls.label);
      expect(
        world.graph
          .edgesOf(cls)
          .some((e) => e.rel === 'counterpart-of' && (e.b.id === state.id || e.a.id === state.id)),
      ).toBe(true);
    }
  });

  it('computes transitions by running the closure', () => {
    const { machine } = parityMachine();
    expect(machine.edge('EVEN', '0').to.label).toBe('EVEN');
    expect(machine.edge('EVEN', '1').to.label).toBe('ODD');
    expect(machine.edge('ODD', '0').to.label).toBe('ODD');
    expect(machine.edge('ODD', '1').to.label).toBe('EVEN');
    expect(machine.diagnostics).toEqual([]);
  });

  it('each edge carries its witness derivation, replayable per edge', () => {
    const { world, machine } = parityMachine();
    const edge = machine.edge('EVEN', '1');
    const all = world.trace(machine);
    const own = all.filter((e) => (e['subject'] as Handle | undefined)?.id === edge.id);
    expect(own.map((e) => e.type)).toEqual(['hop', 'edge.derive']);
    const hop = own[0]!;
    expect((hop['from'] as { label: string }).label).toBe('EVEN');
    expect((hop['to'] as { label: string }).label).toBe('ODD');
    expect(hop['member']).toBe('ε');
    expect(hop['symbol']).toBe('1');
  });

  it('checkWellDefined: "sampled" reports disagreeing members, never throws', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { world, M } = setup();
      const Sigma = M.alphabet(['0', '1']);
      const words = M.words(['', '0', '1', '10']);
      // NOT a right congruence: '' and '0' share a class but disagree under '1'
      const p = M.partition(words, {
        by: (w) => (w.text.startsWith('1') ? 1 : 0),
        labels: { 0: 'NO1', 1: 'HAS1' },
      });
      const machine = M.stateMachine({
        statesFrom: p,
        alphabet: Sigma,
        transition: (cls, s) => p.classOf(cls.representative.append(s)),
        accepting: () => false,
        initial: p.classOf(M.word('')),
        checkWellDefined: 'sampled',
      });
      const wd = machine.diagnostics.filter((d) => d.kind === 'well-definedness');
      expect(wd.length).toBeGreaterThan(0);
      expect(wd[0]!.message).toMatch(/disagree under append/);
      expect(wd[0]!.message).toMatch(/"ε" and "0"/);
      expect(warn).toHaveBeenCalled();
      void world;
    } finally {
      warn.mockRestore();
    }
  });

  it('with a well-defined partition, sampled check stays silent', () => {
    const { machine } = parityMachine('sampled');
    expect(machine.diagnostics.filter((d) => d.kind === 'well-definedness')).toEqual([]);
  });
});
