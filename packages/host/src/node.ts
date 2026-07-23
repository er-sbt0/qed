/**
 * node.ts — the Node/test factory. Kept separate from `host.ts` so the
 * browser bundle never pulls in the Node wasm loader. Uses the default
 * `quickjs-emscripten` release build (sync variant, interrupt support).
 */

import { getQuickJS } from 'quickjs-emscripten';
import type { QuickJSContext } from 'quickjs-emscripten-core';

/** A fresh sandbox context, ready for `new QuickJSHost(ctx, ...)`. */
export async function newNodeContext(): Promise<QuickJSContext> {
  const QuickJS = await getQuickJS();
  return QuickJS.newContext();
}
