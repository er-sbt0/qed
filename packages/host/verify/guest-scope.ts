/**
 * guest-scope.ts — the GUEST-side stand-in for a spike's `./api` module. The
 * bundler aliases each spike's `import ... from "./api"` onto this file, which
 * re-exports the scope members the prelude installed as guest globals. It is
 * the exact mirror of milestone 4's `spike-api/*.ts` shim — there the shim
 * read `getActiveScope()` in-process; here it reads the marshalled globals the
 * QuickJS host injected. The beats programs are bundled byte-for-byte
 * unmodified.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const globalThis: any;

export const M = globalThis.M;
export const Prob = globalThis.Prob;
export const Calc = globalThis.Calc;
export const LinAlg = globalThis.LinAlg;
export const Graph = globalThis.Graph;
export const Field = globalThis.Field;
export const Interaction = globalThis.Interaction;
export const View = globalThis.View;
export const Layout = globalThis.Layout;
export const F = globalThis.F;
export const lesson = globalThis.lesson;
