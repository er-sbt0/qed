/**
 * registry.ts — the handle→DOM multi-map that makes emergent linking real.
 *
 * Every view registers the DOM nodes it draws under the ids of the SEMANTIC
 * objects they project (not just the view's own subpart ids). Two views
 * projecting the same object therefore answer to the same key — matrix-cell ↔
 * graph-edge sync, narration mentions lighting tokens, formula spans glowing
 * when their linked objects animate: all of it is `nodesFor(id)` plus a
 * one-hop correspondence walk (see Stage.resonance), never authored wiring.
 *
 * String alias keys exist for trace events that reference things by label
 * ('Sunny'); views register label aliases alongside handle ids.
 */

import { isHandle } from '@math-ai/core';
import type { Handle, Id } from '@math-ai/core';

export type NodeKey = Id | Handle;

export class NodeRegistry {
  private readonly byKey = new Map<string, Set<Element>>();

  /** Register one element under one or more keys; returns the deregister. */
  register(el: Element, ...keys: readonly NodeKey[]): () => void {
    const ks = keys.map((k) => (isHandle(k) ? k.id : k));
    for (const k of ks) {
      let set = this.byKey.get(k);
      if (!set) {
        set = new Set();
        this.byKey.set(k, set);
      }
      set.add(el);
    }
    return () => {
      for (const k of ks) this.byKey.get(k)?.delete(el);
    };
  }

  nodesFor(key: NodeKey): readonly Element[] {
    const k = isHandle(key) ? key.id : key;
    const set = this.byKey.get(k);
    return set ? [...set] : [];
  }

  has(key: NodeKey): boolean {
    return this.nodesFor(key).length > 0;
  }
}
