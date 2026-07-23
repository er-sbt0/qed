/**
 * prelude.ts — the GUEST-side runtime, as a plain-JS string evaluated inside
 * the QuickJS sandbox before the lesson program.
 *
 * It is the mirror image of `bridge.ts` (the host side). Together they form a
 * synchronous JSON-string RPC across the wasm boundary:
 *
 *   - Every scope member the program touches (`M`, `Prob`, `View`, `Layout`,
 *     `F`, `lesson`) is a guest `Proxy` over an opaque host reference. NO host
 *     state — world, slots, DOM, numeric grids — ever crosses; only reference
 *     ids, primitives, and value-copied plain data.
 *   - A property read (`cls.representative`, `slot.value`) round-trips to the
 *     host (`op:'get'`); if the property is a host function the host answers
 *     with a method marker and the guest caches a stub that dispatches
 *     (`op:'invoke'`).
 *   - A guest closure handed to the host (`partition.by`, `compareExperiment.
 *     apply`, a `cascade` body) is retained in `fnTable` and invoked later —
 *     re-entrantly, live — through `__guest(fnId, argsJson)`.
 *
 * The host installs two globals before this runs: `__host(json)->json` (the
 * guest→host dispatch) and `__ROOTS` (JSON `{name: refId}` for the scope
 * members). This prelude installs `__guest` (the host→guest callback entry)
 * and binds the scope members as globals.
 */

export const GUEST_PRELUDE = String.raw`
(function () {
  'use strict';
  var HOST = globalThis.__host;
  var fnTable = new Map();
  var fnSeq = 0;
  var proxies = new Map(); // refId -> Proxy (interned: same ref -> same proxy)

  function encode(v) {
    if (v === null) return { k: 'p', v: null };
    if (v === undefined) return { k: 'u' };
    var t = typeof v;
    if (t === 'number') {
      if (v !== v) return { k: 'nf', v: 'nan' };
      if (v === Infinity) return { k: 'nf', v: 'inf' };
      if (v === -Infinity) return { k: 'nf', v: '-inf' };
      return { k: 'p', v: v };
    }
    if (t === 'string' || t === 'boolean') return { k: 'p', v: v };
    if (t === 'function') {
      var id = v.__fnId;
      if (id === undefined) { id = 'gfn#' + (++fnSeq); try { v.__fnId = id; } catch (_) {} fnTable.set(id, v); }
      else if (!fnTable.has(id)) fnTable.set(id, v);
      return { k: 'f', ref: id };
    }
    if (t === 'object') {
      if (v.__isProxy === true) return { k: 'r', ref: v.__ref };
      if (Array.isArray(v)) {
        var node = { k: 'a', v: v.map(encode) };
        if (v.raw && Array.isArray(v.raw)) node.raw = Array.prototype.slice.call(v.raw);
        return node;
      }
      var o = {};
      var keys = Object.keys(v);
      for (var i = 0; i < keys.length; i++) o[keys[i]] = encode(v[keys[i]]);
      return { k: 'o', v: o };
    }
    return { k: 'u' };
  }

  function decode(node) {
    switch (node.k) {
      case 'p': return node.v;
      case 'nf': return node.v === 'nan' ? NaN : (node.v === 'inf' ? Infinity : -Infinity);
      case 'u': return undefined;
      case 'r': return proxyFor(node.ref, node.id, node.kind);
      case 'm': return methodStub(node.ref, node.key);
      case 'a': {
        var arr = node.v.map(decode);
        if (node.raw) { try { arr.raw = node.raw; } catch (_) {} }
        return arr;
      }
      case 'o': {
        var o = {};
        var keys = Object.keys(node.v);
        for (var i = 0; i < keys.length; i++) o[keys[i]] = decode(node.v[keys[i]]);
        return o;
      }
      case 'err': throw new Error(node.msg);
      default: return undefined;
    }
  }

  function rpc(payload) {
    var res = HOST(JSON.stringify(payload));
    var node = JSON.parse(res);
    if (node.k === 'err') throw new Error(node.msg);
    return node;
  }

  function methodStub(ref, key) {
    var fn = function () {
      var args = new Array(arguments.length);
      for (var i = 0; i < arguments.length; i++) args[i] = encode(arguments[i]);
      return decode(rpc({ op: 'invoke', ref: ref, key: key, args: args }));
    };
    return fn;
  }

  function proxyFor(ref, id, kind) {
    var existing = proxies.get(ref);
    if (existing) return existing;
    var methodCache = new Map();
    var target = { __isProxy: true, __ref: ref, id: id, kind: kind };
    var p = new Proxy(target, {
      get: function (t, key) {
        if (key === '__isProxy') return true;
        if (key === '__ref') return ref;
        if (key === 'then') return undefined; // never a thenable
        if (typeof key === 'symbol') return undefined;
        if (key === 'id' && id !== undefined) return id;
        if (key === 'kind' && kind !== undefined) return kind;
        if (methodCache.has(key)) return methodCache.get(key);
        var node = rpc({ op: 'get', ref: ref, key: key });
        if (node.k === 'm') {
          var stub = methodStub(ref, key);
          methodCache.set(key, stub);
          return stub;
        }
        return decode(node);
      },
      has: function (t, key) {
        if (key === 'id' || key === 'kind' || key === '__isProxy' || key === '__ref') return true;
        return rpc({ op: 'has', ref: ref, key: key }).v === true;
      },
    });
    proxies.set(ref, p);
    return p;
  }

  // host -> guest: invoke a retained guest closure by id, live.
  globalThis.__guest = function (fnId, argsJson) {
    var fn = fnTable.get(fnId);
    if (!fn) return JSON.stringify({ k: 'err', msg: 'no such guest fn ' + fnId });
    var args;
    try {
      args = JSON.parse(argsJson).map(decode);
    } catch (e) {
      return JSON.stringify({ k: 'err', msg: 'bad args: ' + (e && e.message) });
    }
    try {
      return JSON.stringify(encode(fn.apply(undefined, args)));
    } catch (e) {
      return JSON.stringify({ k: 'err', msg: String((e && e.message) || e) });
    }
  };

  var roots = JSON.parse(globalThis.__ROOTS);
  var names = Object.keys(roots);
  for (var i = 0; i < names.length; i++) {
    globalThis[names[i]] = proxyFor(roots[names[i]], undefined, undefined);
  }
})();
`;
