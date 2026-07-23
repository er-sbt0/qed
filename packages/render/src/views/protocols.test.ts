/**
 * protocols.test.ts — views implement the lesson's structural protocols
 * without a DOM: `elements` (morph granularity) and `buildUpGroups`. Also the
 * authoring-time delta queueing (views subscribe and key animations by step).
 * Run against a HEADLESS stage (no container).
 */
import { describe, expect, it } from 'vitest';
import { createWorld } from '@math-ai/core';
import type { Handle } from '@math-ai/core';
import { createLesson } from '@math-ai/lesson';
import type { Verdict } from '@math-ai/lesson';
import { createStage } from '../stage.js';
import { TokensView } from './tokens.js';
import { PartitionView } from './partition.js';
import { StateGraphView } from './stateGraph.js';
import { TableView } from './table.js';
import { MatrixView } from './matrix.js';
import { BarsView } from './bars.js';

interface Word extends Handle<'word'> {
  readonly text: string;
}

function setup() {
  const world = createWorld();
  const stage = createStage(world); // headless
  const word = (text: string): Word => ({ ...world.handle('word'), text });
  return { world, stage, word };
}

describe('TokensView', () => {
  it('elements are the projected items; collection arrivals extend them and queue per-step animations', () => {
    const { world, stage, word } = setup();
    const a = word('0');
    const b = word('1');
    const words = world.collection<Word>([a, b]);
    const view = new TokensView(stage, words, { layout: 'scatter' });
    expect(view.elements).toEqual([a, b]);

    const c = word('11');
    const step = words.add(c);
    expect(view.elements).toEqual([a, b, c]);
    expect(view.hasPending(step.id)).toBe(true);
    expect(view.takePending(step.id)).toHaveLength(1);
    expect(view.hasPending(step.id)).toBe(false);
  });
});

describe('PartitionView', () => {
  it('elements are the classes (buckets), not the members', () => {
    const { world, stage, word } = setup();
    const even = world.handle('class');
    const odd = world.handle('class');
    const words = world.collection<Word>([word('0'), word('1')]);
    const view = new PartitionView(stage, {
      classes: [even, odd],
      classOf: (w) => ((w.text.match(/1/g)?.length ?? 0) % 2 === 0 ? even : odd),
      source: words,
    });
    expect(view.elements).toEqual([even, odd]);
    const step = words.add(word('10'));
    expect(view.hasPending(step.id)).toBe(true);
  });
});

describe('StateGraphView', () => {
  it('elements are states AND edges — both are morph/demonstrate targets', () => {
    const { world, stage } = setup();
    const s1 = { ...world.handle('state'), label: 'EVEN' };
    const s2 = { ...world.handle('state'), label: 'ODD' };
    const e1 = { ...world.handle('edge'), from: s1, to: s2, symbol: '1' };
    const e2 = { ...world.handle('edge'), from: s1, to: s1, symbol: '0' }; // self-loop
    const view = new StateGraphView(stage, { states: [s1, s2], edges: [e1, e2] });
    expect(view.elements).toEqual([s1, s2, e1, e2]);
  });
});

describe('TableView', () => {
  const verdict = (ok: boolean): Verdict =>
    ok ? { label: 'ACCEPT', polarity: 'accept' } : { label: 'REJECT', polarity: 'reject' };

  it('elements are the header handles (the semantic objects the table projects)', () => {
    const { stage, word } = setup();
    const rows = [word('0'), word('00')];
    const cols = [word(''), word('1')];
    const view = new TableView(stage, {
      rowHeaders: rows,
      colHeaders: cols,
      cell: () => verdict(true),
    });
    expect(view.elements).toEqual([...rows, ...cols]);
  });

  it('buildUpGroups leads each group with the axis header, then subparts, and supports all three orders', () => {
    const { stage, word } = setup();
    const rows = [word('a'), word('b')];
    const cols = [word('x'), word('y'), word('z')];
    const view = new TableView(stage, {
      rowHeaders: rows,
      colHeaders: cols,
      cell: () => 'v',
    });

    const byRow = view.buildUpGroups('row-by-row');
    expect(byRow).toHaveLength(2);
    expect(byRow[0]![0]).toBe(rows[0]); // the header object itself
    expect(byRow[0]![1]!.kind).toBe('table:row');
    expect(byRow[0]!.slice(2).map((h) => h.kind)).toEqual(['table:cell', 'table:cell', 'table:cell']);

    const byCol = view.buildUpGroups('column-by-column');
    expect(byCol).toHaveLength(3);
    expect(byCol[2]![0]).toBe(cols[2]);
    expect(byCol[2]![1]!.kind).toBe('table:col');
    expect(byCol[2]!.slice(2)).toHaveLength(2); // one cell per row

    const byCell = view.buildUpGroups('cell-by-cell');
    expect(byCell).toHaveLength(6);
    expect(byCell.every((g) => g.length === 1 && g[0]!.kind === 'table:cell')).toBe(true);
  });

  it('subparts are addressed by header handle, never by index (F5), and unknowns diagnose', () => {
    const { stage, word } = setup();
    const r = word('r');
    const c = word('c');
    const view = new TableView(stage, { rowHeaders: [r], colHeaders: [c], cell: () => 'v' });
    expect(view.row(r).kind).toBe('table:row');
    expect(view.col(c).kind).toBe('table:col');
    expect(() => view.col(r)).toThrow(/no column headed by/);
  });

  it('satisfies lesson.buildUp as a BuildUpSubject', () => {
    const { world, stage, word } = setup();
    const lesson = createLesson(world);
    const view = new TableView(stage, {
      rowHeaders: [word('a')],
      colHeaders: [word('x'), word('y')],
      cell: () => 'v',
    });
    const cascade = lesson.buildUp(view, { order: 'column-by-column' });
    expect(cascade.iterations).toHaveLength(2);
  });
});

describe('MatrixView', () => {
  it('elements are the cell handles, row-major', () => {
    const { world, stage } = setup();
    const rows = [world.handle('state'), world.handle('state')];
    const cells = new Map<string, Handle & { value: number }>();
    const cellAt = (r: Handle, c: Handle) => {
      const key = `${r.id}|${c.id}`;
      let cell = cells.get(key);
      if (!cell) {
        cell = { ...world.handle('matrix:cell'), value: 0.5 };
        cells.set(key, cell);
      }
      return cell;
    };
    const view = new MatrixView(stage, { rows, cols: rows, cellAt });
    expect(view.elements).toHaveLength(4);
    expect(view.elements.every((h) => h.kind === 'matrix:cell')).toBe(true);
    // the SAME cell objects, so other views projecting them sync for free
    expect(view.elements[0]).toBe(cellAt(rows[0]!, rows[0]!));
  });
});

describe('BarsView', () => {
  it('elements are the categories; slot transitions queue one animation per step', () => {
    const { world, stage } = setup();
    const cats: Handle[] = [world.handle('state'), world.handle('state')];
    interface Dist extends Handle<'distribution'> {
      readonly mass: readonly number[];
    }
    const d = (m: readonly number[]): Dist => ({ ...world.handle('distribution'), mass: m });
    const slot = world.slot<Dist>(d([1, 0]));
    const view = new BarsView(stage, slot, {
      categories: cats,
      mass: (value, cat) => value.mass[cats.indexOf(cat)] ?? 0,
    });
    expect(view.elements).toEqual(cats);
    const step1 = slot.set(d([0.7, 0.3]));
    const step2 = slot.set(d([0.6, 0.4]));
    expect(view.hasPending(step1.id)).toBe(true);
    expect(view.hasPending(step2.id)).toBe(true);
  });
});
