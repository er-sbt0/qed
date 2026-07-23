/**
 * bridge.ts — the HOST side of the marshalling seam.
 *
 * This is milestone 4's cut, validated: the GUEST sees handles + method stubs;
 * ALL state stays host-side. A guest call to `M.partition(...)` or
 * `lesson.morph(...)` arrives here as an `invoke`, is dispatched to the REAL
 * in-process scope object, and the result is handed back as an opaque
 * reference (or value-copied plain data). Guest closures arrive as `f` nodes;
 * we wrap each in a host function that calls back into the live VM.
 *
 * Design notes:
 *  - The ONLY long-lived QuickJS handles are `__host` and `__guest`; objects
 *    and closures are tracked by id in plain JS maps, so there is no per-value
 *    handle lifetime to manage (encode/decode dispose transient handles only).
 *  - Host objects are interned (`objIds` WeakMap) so the same object always
 *    gets the same ref — identity survives the round trip, which the
 *    correspondence graph and `preserveIdentity` depend on.
 *  - `isHandle` (and the reactive Slot/Collection/Derived, which implement
 *    Handle) ⇒ by reference; arrays ⇒ materialized; other objects ⇒
 *    value-copied. Functions returned standalone never occur in this surface;
 *    functions reached via `get` become method markers.
 */

import { isHandle } from '@math-ai/core';
import type { QuickJSContext, QuickJSHandle } from 'quickjs-emscripten-core';
import { GuestError } from './protocol.js';
import { describeGuestError } from './guest-error.js';
import type { HostCall, WireNode } from './protocol.js';

export interface BridgeHooks {
  /** Called with a GuestError whenever a guest callback throws mid-authoring. */
  onGuestError?(err: GuestError): void;
}

export class Bridge {
  private readonly objs = new Map<string, object>();
  private readonly objIds = new WeakMap<object, string>();
  private objSeq = 0;
  /** Diagnostics: how many guest→host dispatches have crossed the boundary. */
  dispatches = 0;

  /**
   * The program currently loaded, so a guest callback that throws can quote the
   * line that threw. A closure body (`partition.by`, `transition`, a `cascade`)
   * fails at interaction time, long after the authoring pass returned, and
   * "not a function" with no location is exactly as unrepairable there.
   */
  programSource: string | undefined;

  /** The guest `__guest` callback entry, grabbed after the prelude evaluates. */
  private guestEntry: QuickJSHandle | null = null;
  private hostFn: QuickJSHandle | null = null;

  constructor(
    private readonly ctx: QuickJSContext,
    private readonly hooks: BridgeHooks = {},
  ) {}

  /** Register a host object as a root the guest can reach; returns its ref id. */
  register(obj: object): string {
    return this.refFor(obj);
  }

  /**
   * Install `__host` (guest→host dispatch) as a guest global. Call before
   * evaluating the prelude.
   */
  install(): void {
    const fn = this.ctx.newFunction('__host', (payloadHandle) => {
      const payload = JSON.parse(this.ctx.getString(payloadHandle)) as HostCall;
      let node: WireNode;
      try {
        node = this.dispatch(payload);
      } catch (err) {
        node = { k: 'err', msg: err instanceof Error ? err.message : String(err) };
      }
      return this.ctx.newString(JSON.stringify(node));
    });
    this.ctx.setProp(this.ctx.global, '__host', fn);
    this.hostFn = fn;
  }

  /** Grab the guest `__guest` callback entry (call right after the prelude runs). */
  bindGuestEntry(): void {
    this.guestEntry = this.ctx.getProp(this.ctx.global, '__guest');
  }

  dispose(): void {
    this.hostFn?.dispose();
    this.guestEntry?.dispose();
    this.hostFn = null;
    this.guestEntry = null;
  }

  // ─────────────────────────────── dispatch ───────────────────────────────

  private dispatch(call: HostCall): WireNode {
    this.dispatches += 1;
    const obj = this.objs.get(call.ref);
    if (!obj) throw new Error(`unknown host ref ${call.ref}`);
    if (call.op === 'has') {
      return { k: 'p', v: call.key in (obj as Record<string, unknown>) };
    }
    const value = (obj as Record<string, unknown>)[call.key];
    if (call.op === 'get') {
      if (typeof value === 'function') return { k: 'm', ref: call.ref, key: call.key };
      return this.encode(value);
    }
    // invoke
    if (typeof value !== 'function') {
      throw new Error(`ref ${call.ref}.${call.key} is not a function`);
    }
    const args = call.args.map((n) => this.decode(n));
    const result = (value as (...a: unknown[]) => unknown).apply(obj, args);
    return this.encode(result);
  }

  // ──────────────────────────────── encode ────────────────────────────────

  private refFor(obj: object): string {
    let id = this.objIds.get(obj);
    if (id === undefined) {
      id = `href#${++this.objSeq}`;
      this.objIds.set(obj, id);
      this.objs.set(id, obj);
    }
    return id;
  }

  /** Host value → wire node (bound for the guest). */
  encode(v: unknown): WireNode {
    if (v === null) return { k: 'p', v: null };
    if (v === undefined) return { k: 'u' };
    const t = typeof v;
    if (t === 'number') {
      const n = v as number;
      if (Number.isNaN(n)) return { k: 'nf', v: 'nan' };
      if (n === Infinity) return { k: 'nf', v: 'inf' };
      if (n === -Infinity) return { k: 'nf', v: '-inf' };
      return { k: 'p', v: n };
    }
    if (t === 'boolean' || t === 'string') {
      return { k: 'p', v: v as string | boolean };
    }
    if (t === 'function') {
      // A standalone host function reaching the guest as data is out of surface;
      // encode as undefined so a stray read degrades rather than corrupts.
      return { k: 'u' };
    }
    if (isHandle(v)) {
      const ref = this.refFor(v as object);
      return { k: 'r', ref, id: (v as { id: string }).id, kind: (v as { kind: string }).kind };
    }
    if (Array.isArray(v)) {
      const node: WireNode = { k: 'a', v: v.map((x) => this.encode(x)) };
      const raw = (v as { raw?: readonly string[] }).raw;
      return raw && Array.isArray(raw) ? { ...node, raw: [...raw] } : node;
    }
    if (t === 'object') {
      const o: Record<string, WireNode> = {};
      for (const key of Object.keys(v as object)) {
        o[key] = this.encode((v as Record<string, unknown>)[key]);
      }
      return { k: 'o', v: o };
    }
    return { k: 'u' };
  }

  // ──────────────────────────────── decode ────────────────────────────────

  /** Wire node (from the guest) → host value. */
  decode(node: WireNode): unknown {
    switch (node.k) {
      case 'p':
        return node.v;
      case 'nf':
        return node.v === 'nan' ? NaN : node.v === 'inf' ? Infinity : -Infinity;
      case 'u':
        return undefined;
      case 'r': {
        const obj = this.objs.get(node.ref);
        if (!obj) throw new Error(`guest handed back unknown ref ${node.ref}`);
        return obj;
      }
      case 'f':
        return this.wrapGuestFn(node.ref);
      case 'a': {
        const arr = node.v.map((n) => this.decode(n)) as unknown[];
        if (node.raw) Object.defineProperty(arr, 'raw', { value: node.raw, enumerable: false });
        return arr;
      }
      case 'o': {
        const o: Record<string, unknown> = {};
        for (const key of Object.keys(node.v)) o[key] = this.decode(node.v[key]!);
        return o;
      }
      case 'm':
      case 'err':
      default:
        return undefined;
    }
  }

  // ───────────────────────── host → guest callbacks ─────────────────────────

  /**
   * Wrap a retained guest closure in a host function. Every call marshals its
   * host arguments back into the VM and invokes the guest `__guest` entry
   * synchronously — the live re-invocation `partition.by` / `transition` /
   * `apply` / `judge` / a `cascade` body all ride. A guest throw or a frame
   * budget interrupt surfaces here as a `GuestError`.
   */
  private wrapGuestFn(fnId: string): (...args: unknown[]) => unknown {
    return (...args: unknown[]): unknown => {
      const entry = this.guestEntry;
      if (!entry) throw new Error('guest entry not bound');
      const argsJson = JSON.stringify(args.map((a) => this.encode(a)));
      const idHandle = this.ctx.newString(fnId);
      const argsHandle = this.ctx.newString(argsJson);
      try {
        const res = this.ctx.callFunction(entry, this.ctx.undefined, idHandle, argsHandle);
        if (res.error) {
          const dumped = this.ctx.dump(res.error) as unknown;
          res.error.dispose();
          const { message, rawMessage, guestStack, site } = describeGuestError(dumped, {
            ...(this.programSource !== undefined && { source: this.programSource }),
            filename: '<program>',
          });
          // Classify on the engine's own message: the enriched one quotes a
          // line of the program, which must not be able to spoof "interrupt".
          const interrupted = /interrupt/i.test(rawMessage);
          const err = new GuestError(message, interrupted, { guestStack, site });
          this.hooks.onGuestError?.(err);
          throw err;
        }
        const out = this.ctx.getString(res.value);
        res.value.dispose();
        const node = JSON.parse(out) as WireNode;
        if (node.k === 'err') {
          const err = new GuestError(node.msg);
          this.hooks.onGuestError?.(err);
          throw err;
        }
        return this.decode(node);
      } finally {
        idHandle.dispose();
        argsHandle.dispose();
      }
    };
  }
}
