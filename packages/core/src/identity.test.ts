import { describe, expect, it } from 'vitest';
import { IdRegistry, isHandle } from './identity.js';
import { createWorld } from './world.js';

describe('id generation', () => {
  it('generates deterministic per-kind ids', () => {
    const reg = new IdRegistry();
    expect(reg.mint('word')).toBe('word#1');
    expect(reg.mint('word')).toBe('word#2');
    expect(reg.mint('state')).toBe('state#1');
    expect(reg.mint('word')).toBe('word#3');
  });

  it('is deterministic across two registries running the same sequence', () => {
    const a = new IdRegistry();
    const b = new IdRegistry();
    const seq = ['word', 'word', 'state', 'edge', 'word', 'state'];
    expect(seq.map((k) => a.mint(k))).toEqual(seq.map((k) => b.mint(k)));
  });

  it('uses explicit ids verbatim', () => {
    const reg = new IdRegistry();
    expect(reg.mint('word', 'epsilon')).toBe('epsilon');
    expect(reg.handle('state', 'rainy')).toEqual({ id: 'rainy', kind: 'state' });
  });

  it('rejects duplicate explicit ids', () => {
    const reg = new IdRegistry();
    reg.mint('word', 'epsilon');
    expect(() => reg.mint('word', 'epsilon')).toThrow(/duplicate explicit id/);
    expect(() => reg.mint('state', 'epsilon')).toThrow(/duplicate explicit id/);
  });

  it('rejects explicit ids that collide with the generated namespace', () => {
    const reg = new IdRegistry();
    expect(() => reg.mint('word', 'word#7')).toThrow(/reserved generated form/);
    expect(() => reg.mint('word', 'anything#123')).toThrow(/reserved generated form/);
  });

  it('explicit ids do not disturb the generated sequence', () => {
    const reg = new IdRegistry();
    reg.mint('word');
    reg.mint('word', 'special');
    expect(reg.mint('word')).toBe('word#2');
  });

  it('a snapshot-seeded registry continues the exact generated sequence', () => {
    const reg = new IdRegistry();
    reg.mint('word');
    reg.mint('word');
    reg.mint('state');
    const shadow = new IdRegistry(reg.snapshot());
    expect(reg.mint('word')).toBe('word#3');
    expect(shadow.mint('word')).toBe('word#3');
    expect(shadow.mint('state')).toBe('state#2');
  });
});

describe('handles', () => {
  it('handles are frozen {id, kind} pairs', () => {
    const reg = new IdRegistry();
    const h = reg.handle('word');
    expect(h).toEqual({ id: 'word#1', kind: 'word' });
    expect(Object.isFrozen(h)).toBe(true);
  });

  it('isHandle recognizes handles and rejects non-handles', () => {
    expect(isHandle({ id: 'x', kind: 'word' })).toBe(true);
    expect(isHandle({ id: 'x' })).toBe(false);
    expect(isHandle('x')).toBe(false);
    expect(isHandle(null)).toBe(false);
    expect(isHandle(42)).toBe(false);
  });

  it('world.handle mints from the world registry', () => {
    const world = createWorld();
    expect(world.handle('word')).toEqual({ id: 'word#1', kind: 'word' });
    expect(world.handle('word', 'eps')).toEqual({ id: 'eps', kind: 'word' });
    expect(world.handle('word')).toEqual({ id: 'word#2', kind: 'word' });
  });

  it('two worlds executing the same program mint identical ids', () => {
    const program = (world: ReturnType<typeof createWorld>) => {
      const s = world.slot(0);
      const c = world.collection<number>();
      const h = world.handle('state');
      s.set(1);
      c.add(2);
      return [s.id, c.id, h.id];
    };
    expect(program(createWorld())).toEqual(program(createWorld()));
  });
});
