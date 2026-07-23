/**
 * timeline.ts — timeline structure and ordering. No animation, no rendering.
 *
 * Steps enqueue in call order (implicit sequence — the spikes killed the
 * explicit `sequence` verb). `cascade` groups paced per-item iterations,
 * `parallel` groups concurrent children, `loop` marks repeated choreography
 * (e.g. `demonstrate({loop: true})` at milestone 2). Pace is metadata only;
 * playback interprets it later.
 */

import type { Handle, Id } from './identity.js';

export type PaceRate = 'slow' | 'medium' | 'fast';

export interface Pace {
  readonly start?: PaceRate;
  readonly end?: PaceRate;
}

/** What the timeline needs from its world: id minting and the purity guard. */
export interface TimelineHost {
  mint(kind: string, explicitId?: Id): Id;
  assertMutable(what: string): void;
}

export interface ActionStep extends Handle<'step'> {
  readonly type: 'action';
  /** Namespaced operation name, e.g. `slot:set`, `collection:add`, or a verb. */
  readonly op: string;
  readonly payload?: unknown;
  readonly pace?: Pace;
}

export interface CascadeStep extends Handle<'step'> {
  readonly type: 'cascade';
  /** One sequential group of steps per item, in item order. */
  readonly iterations: ReadonlyArray<readonly TimelineNode[]>;
  readonly pace?: Pace;
}

export interface ParallelStep extends Handle<'step'> {
  readonly type: 'parallel';
  readonly children: readonly TimelineNode[];
}

export interface LoopStep extends Handle<'step'> {
  readonly type: 'loop';
  readonly children: readonly TimelineNode[];
  /** `undefined` means loop until superseded by the next timeline step. */
  readonly times?: number;
  readonly pace?: Pace;
}

export type TimelineNode = ActionStep | CascadeStep | ParallelStep | LoopStep;

/** Every timeline-enqueuing call returns its node — the spike API's `Step`. */
export type Step = TimelineNode;

export interface StepOpts {
  readonly pace?: Pace;
  readonly id?: Id;
}

export class Timeline {
  private readonly rootNodes: TimelineNode[] = [];
  /** Stack of open containers; steps enqueue into the innermost one. */
  private readonly stack: TimelineNode[][] = [this.rootNodes];

  constructor(private readonly host: TimelineHost) {}

  /** The root sequence (grows as the program runs). */
  get root(): readonly TimelineNode[] {
    return this.rootNodes;
  }

  /** Enqueue a leaf step into the current container. */
  step(op: string, payload?: unknown, opts?: StepOpts): ActionStep {
    this.host.assertMutable('timeline.step');
    return this.enqueue(
      Object.freeze({
        ...this.mintStep(opts?.id),
        type: 'action' as const,
        op,
        payload,
        pace: opts?.pace,
      }),
    );
  }

  /**
   * Paced iteration: `per` runs immediately for each item; the steps it
   * enqueues become that item's sequential group.
   */
  cascade<T>(
    items: readonly T[],
    per: (item: T, index: number) => void,
    opts?: StepOpts,
  ): CascadeStep {
    this.host.assertMutable('timeline.cascade');
    const base = this.mintStep(opts?.id);
    const iterations: Array<readonly TimelineNode[]> = [];
    items.forEach((item, index) => {
      iterations.push(this.collect(() => per(item, index)));
    });
    return this.enqueue(
      Object.freeze({
        ...base,
        type: 'cascade' as const,
        iterations: Object.freeze(iterations) as ReadonlyArray<readonly TimelineNode[]>,
        pace: opts?.pace,
      }),
    );
  }

  /** Steps enqueued inside `build` run concurrently. */
  parallel(build: () => void, opts?: StepOpts): ParallelStep {
    this.host.assertMutable('timeline.parallel');
    const base = this.mintStep(opts?.id);
    const children = this.collect(build);
    return this.enqueue(Object.freeze({ ...base, type: 'parallel' as const, children }));
  }

  /** Steps enqueued inside `build` repeat `times` times (or until superseded). */
  loop(build: () => void, opts?: StepOpts & { times?: number }): LoopStep {
    this.host.assertMutable('timeline.loop');
    const base = this.mintStep(opts?.id);
    const children = this.collect(build);
    return this.enqueue(
      Object.freeze({
        ...base,
        type: 'loop' as const,
        children,
        times: opts?.times,
        pace: opts?.pace,
      }),
    );
  }

  private collect(build: () => void): readonly TimelineNode[] {
    const container: TimelineNode[] = [];
    this.stack.push(container);
    try {
      build();
    } finally {
      this.stack.pop();
    }
    return Object.freeze(container) as readonly TimelineNode[];
  }

  private enqueue<N extends TimelineNode>(node: N): N {
    const current = this.stack[this.stack.length - 1];
    if (!current) throw new Error('unreachable: timeline container stack is empty');
    current.push(node);
    return node;
  }

  private mintStep(id?: Id): Handle<'step'> {
    return { id: this.host.mint('step', id), kind: 'step' };
  }
}
