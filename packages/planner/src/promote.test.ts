/**
 * promote.test.ts — the promotion rules, against a real temp repo.
 *
 * This is the only free coverage the recorder's second half can have: the path
 * that produces its input is BILLED, so if promotion is wrong it is wrong at
 * the worst possible moment — after a generation has already been paid for and
 * with `examples/` half-rewritten. Hence a temp directory rather than mocks.
 */

import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { promoteToExample, type PromotionInput } from './promote.js';

let root: string;

function manifest(): { examples: { key: string; dir: string; title: string }[] } {
  return JSON.parse(readFileSync(join(root, 'examples', 'manifest.json'), 'utf8'));
}

function seedExample(dir: string, key: string, title: string): void {
  mkdirSync(join(root, 'examples', dir), { recursive: true });
  writeFileSync(join(root, 'examples', dir, 'beats.ts'), `// ${dir}\n`);
  const m = manifest();
  m.examples.push({ key, dir, title });
  writeFileSync(join(root, 'examples', 'manifest.json'), JSON.stringify(m, null, 2));
}

const input = (over: Partial<PromotionInput> = {}): PromotionInput => ({
  slug: 'why-does-bfs-find-shortest',
  question: 'Why does BFS find shortest paths?',
  discipline: 'graphs',
  title: 'Breadth-first search finds shortest paths',
  source: 'lesson.beat("Frontier by frontier");\n',
  model: 'claude-test',
  recordedAt: '2026-07-22T12:00:00.000Z',
  warnings: [],
  ...over,
});

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'promote-'));
  mkdirSync(join(root, 'examples'), { recursive: true });
  writeFileSync(join(root, 'examples', 'manifest.json'), JSON.stringify({ examples: [] }, null, 2));
});

describe('promoting a recorded program into examples/', () => {
  it('writes the program and claims the discipline', () => {
    const result = promoteToExample(root, input());
    if (!result.promoted) throw new Error(`expected a promotion: ${result.reason}`);

    expect(result).toEqual({ promoted: true, dir: 'why-does-bfs-find-shortest', replaced: null });
    expect(readFileSync(join(root, 'examples', result.dir, 'beats.ts'), 'utf8')).toContain(
      'Frontier by frontier',
    );
    expect(manifest().examples).toEqual([
      { key: 'graphs', dir: 'why-does-bfs-find-shortest', title: 'Breadth-first search finds shortest paths' },
    ]);
  });

  it('records provenance beside the program, so nobody has to guess where it came from', () => {
    promoteToExample(root, input());
    const meta = JSON.parse(
      readFileSync(join(root, 'examples', 'why-does-bfs-find-shortest', 'meta.json'), 'utf8'),
    );
    expect(meta.question).toBe('Why does BFS find shortest paths?');
    expect(meta.discipline).toBe('graphs');
    expect(meta.cassette).toBe(
      'packages/planner/src/cassettes/why-does-bfs-find-shortest.json',
    );
  });

  it('NEWEST WINS: the superseded example is dropped, directory and all', () => {
    seedExample('mst', 'graphs', 'Minimum spanning trees');

    const result = promoteToExample(root, input());

    expect(result).toMatchObject({ promoted: true, replaced: 'mst' });
    expect(existsSync(join(root, 'examples', 'mst'))).toBe(false);
    // one entry per discipline, still — not two
    expect(manifest().examples.filter((e) => e.key === 'graphs')).toHaveLength(1);
  });

  it('leaves OTHER disciplines alone', () => {
    seedExample('ftc', 'calculus', 'The Fundamental Theorem of Calculus');

    promoteToExample(root, input());

    expect(existsSync(join(root, 'examples', 'ftc', 'beats.ts'))).toBe(true);
    expect(manifest().examples.map((e) => e.key).sort()).toEqual(['calculus', 'graphs']);
  });

  it('re-recording the same question in place reuses the directory', () => {
    promoteToExample(root, input());
    const again = promoteToExample(root, input({ title: 'BFS, again' }));

    expect(again).toEqual({ promoted: true, dir: 'why-does-bfs-find-shortest', replaced: null });
    expect(manifest().examples).toHaveLength(1);
    expect(manifest().examples[0]!.title).toBe('BFS, again');
  });

  it('does not overwrite a directory another discipline still points at', () => {
    seedExample('pigeonhole', 'calculus', 'A borrowed name');

    const result = promoteToExample(root, input({ slug: 'pigeonhole' }));

    expect(result).toMatchObject({ promoted: true, dir: 'pigeonhole-2' });
    // the calculus example is untouched and still resolvable
    expect(readFileSync(join(root, 'examples', 'pigeonhole', 'beats.ts'), 'utf8')).toContain(
      '// pigeonhole',
    );
  });

  it('refuses when the plan named no discipline — there is no slot to fill', () => {
    const result = promoteToExample(root, input({ discipline: undefined }));

    expect(result.promoted).toBe(false);
    expect(manifest().examples).toEqual([]);
  });
});
