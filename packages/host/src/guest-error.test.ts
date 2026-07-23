/**
 * guest-error.test.ts — the enrichment that makes a runtime failure repairable.
 *
 * The pure parsing is tested against the exact shape QuickJS produces (captured
 * from a real dump, not invented), and one end-to-end case runs a program that
 * throws in the real sandbox — because the claim being made is about what a
 * repair pass receives, and only the round trip proves that.
 */
import { describe, expect, it } from 'vitest';
import { describeGuestError } from './guest-error.js';
import { QuickJSHost } from './host.js';
import { newNodeContext } from './node.js';
import { GuestError } from './protocol.js';

/** Verbatim from `ctx.dump(result.error)` for `p.poke(3)` where p has no poke. */
const REAL_DUMP = {
  name: 'TypeError',
  message: 'not a function',
  stack: '    at buildTheThing (<program>:2:3)\n    at <eval> (<program>:5:14)\n',
};

const SOURCE = [
  'function buildTheThing(p) {',
  '  return p.poke(3);',
  '}',
  'const w = lesson.widget();',
  'buildTheThing(w);',
].join('\n');

describe('describeGuestError', () => {
  it('names the type, the function, the line, and quotes the code', () => {
    const d = describeGuestError(REAL_DUMP, { source: SOURCE, filename: '<program>' });
    expect(d.message).toBe('TypeError: not a function — at buildTheThing (line 2): `return p.poke(3);`');
    expect(d.site).toEqual({
      fn: 'buildTheThing',
      file: '<program>',
      line: 2,
      column: 3,
      text: 'return p.poke(3);',
    });
    expect(d.guestStack).toBe(REAL_DUMP.stack);
  });

  it('keeps the engine message unadorned for classification', () => {
    // The whole reason `rawMessage` exists: callers match on it to tell a
    // frame-budget interrupt from a program bug, and the enriched message
    // quotes program text that could otherwise spoof that match.
    const d = describeGuestError(REAL_DUMP, { source: SOURCE, filename: '<program>' });
    expect(d.rawMessage).toBe('not a function');
  });

  it('a program that merely mentions "interrupt" is not an interrupt', () => {
    const source = ['const label = "interrupt the flow";', 'thing.nope();'].join('\n');
    const d = describeGuestError(
      { name: 'TypeError', message: 'not a function', stack: '    at <eval> (<program>:1:1)\n' },
      { source, filename: '<program>' },
    );
    expect(d.message).toMatch(/interrupt/); // the quoted line carries the word
    expect(/interrupt/i.test(d.rawMessage)).toBe(false); // classification does not
  });

  it('prefers the program frame over an inner prelude frame', () => {
    const d = describeGuestError(
      {
        name: 'TypeError',
        message: 'boom',
        stack: '    at helper (<prelude>:9:1)\n    at authoring (<program>:4:7)\n',
      },
      { source: SOURCE, filename: '<program>' },
    );
    expect(d.site?.file).toBe('<program>');
    expect(d.site?.line).toBe(4);
  });

  it('does not prefix a redundant name', () => {
    const d = describeGuestError({ name: 'Error', message: 'plain failure' });
    expect(d.message).toBe('plain failure');
    const already = describeGuestError({ name: 'TypeError', message: 'TypeError: dup' });
    expect(already.message).toBe('TypeError: dup');
  });

  it('degrades rather than throws on junk', () => {
    // An error path that can itself throw is worse than the vague message it
    // replaced, so every shape must come back with something printable.
    expect(describeGuestError(undefined).message).toBe('undefined');
    expect(describeGuestError('a string').message).toBe('a string');
    expect(describeGuestError({}).message).toBe('[object Object]');
    expect(describeGuestError({ message: 'no stack' }).message).toBe('no stack');
    expect(describeGuestError({ message: 'm', stack: 'unparseable' }).site).toBeUndefined();
  });

  it('truncates a pathologically long line instead of inlining it', () => {
    const long = `const x = ${'"y"+'.repeat(200)}"z";`;
    const d = describeGuestError(
      { name: 'TypeError', message: 'boom', stack: '    at <eval> (<program>:1:1)\n' },
      { source: long, filename: '<program>' },
    );
    expect(d.site?.text?.length).toBeLessThanOrEqual(160);
    expect(d.site?.text?.endsWith('…')).toBe(true);
  });
});

describe('a real sandbox failure', () => {
  it('reaches the host naming the call that broke, not just "not a function"', async () => {
    const ctx = await newNodeContext();
    const host = new QuickJSHost(ctx, { lintGate: false });
    host.defineGlobal('lesson', { widget: () => ({ name: 'w' }) });

    // This is the `derivative` shape from the live gate: a real API name used
    // on the wrong type. Syntactically clean, so only execution finds it.
    let caught: GuestError | undefined;
    try {
      host.run(SOURCE);
    } catch (e) {
      caught = e as GuestError;
    }

    expect(caught).toBeInstanceOf(GuestError);
    expect(caught?.message).toContain('TypeError');
    expect(caught?.message).toContain('buildTheThing');
    expect(caught?.message).toContain('p.poke(3)');
    expect(caught?.interrupted).toBe(false);
    expect(caught?.site?.line).toBe(2);
    host.dispose();
  });
});
