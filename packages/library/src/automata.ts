/**
 * automata.ts — the automata discipline library, in USERLAND: everything here
 * is plain code over `@math-ai/core` operations (defineOp / ctx.value /
 * ctx.trace / ctx.link), exactly the way an LLM-authored library would be
 * written. No engine features were added for it.
 *
 * The surface implements spikes/myhill-nerode/api.ts:
 *   - `Word.append` is a traced operation: the result carries `came-from`
 *     provenance (auto edge to its base) and an `append` trace event, so
 *     `demonstrate`/compare replay can show the token growing.
 *   - `Language` wraps the authored membership predicate. (In-process for
 *     now — sandboxing is milestone 5.)
 *   - `Partition` is DERIVED from a reactive `Collection` via the key
 *     closure, with a core `Incremental` doing the per-arrival fold: growing
 *     the source re-buckets automatically, and each member records a
 *     `contributes-to` edge to its class (what makes the cloud→buckets morph
 *     legal).
 *   - `StateMachine` derives states from partition classes (`counterpart-of`
 *     recorded per class↔state) and edges by RUNNING the transition closure;
 *     each edge's witness derivation (member leaves, symbol appends, landing)
 *     is emitted as trace events tagged with the edge's handle, so
 *     `demonstrate(edge)` replays exactly that edge's derivation.
 *   - `checkWellDefined: "sampled"` spot-checks that sampled members of each
 *     class agree under every symbol. Disagreements become DIAGNOSTICS on the
 *     machine (`machine.diagnostics`) — never a throw, never a CAS.
 */

import type { Collection, Handle, OpContext, Operation, World } from '@math-ai/core';
import { byLabel, findOr, reportDiagnostics } from './structure.js';

// ─────────────────────────────── types ───────────────────────────────

export interface Alphabet extends Handle<'alphabet'> {
  readonly symbols: readonly string[];
}

export interface Word extends Handle<'word'> {
  readonly text: string;
  append(suffix: string | Word): Word;
  count(symbol: string): number;
}

export interface Language extends Handle<'language'> {
  readonly label: string;
  readonly alphabet: Alphabet;
  contains(w: Word): boolean;
}

export interface EquivClass<T extends Handle = Handle> extends Handle<'class'> {
  readonly label: string;
  readonly representative: T;
  /** The sampled members currently present (classes may be infinite). Live. */
  readonly members: readonly T[];
}

export interface Partition<T extends Handle = Handle> extends Handle<'partition'> {
  readonly classes: readonly EquivClass<T>[];
  /** The reactive source collection this partition is derived from. */
  readonly source: Collection<T>;
  /** Total: computes the key for items outside the source collection too. */
  classOf(item: T): EquivClass<T>;
  /**
   * Subpart addressing by display label, or by the partition key `by` returned
   * when no label matches. Throws (listing both spellings) when unknown.
   */
  class(label: string): EquivClass<T>;
}

export interface MachineState extends Handle<'state'> {
  readonly label: string;
  readonly accepting: boolean;
}

export interface MachineEdge extends Handle<'edge'> {
  readonly from: MachineState;
  readonly to: MachineState;
  readonly symbol: string;
}

/** A coherence problem found while deriving a machine. Reported, never thrown. */
export interface MachineDiagnostic {
  readonly kind: 'well-definedness' | 'transition-mismatch' | 'unknown-target';
  readonly classLabel: string;
  readonly symbol: string;
  readonly message: string;
}

export interface StateMachine extends Handle<'machine'> {
  readonly states: readonly MachineState[];
  readonly edges: readonly MachineEdge[];
  readonly initial: MachineState;
  readonly diagnostics: readonly MachineDiagnostic[];
  state(label: string): MachineState;
  edge(fromLabel: string, symbol: string): MachineEdge;
}

export interface StateMachineOpts<T extends Handle> {
  readonly statesFrom: Partition<T>;
  readonly alphabet: Alphabet;
  readonly transition: (cls: EquivClass<T>, symbol: string) => EquivClass<T>;
  readonly accepting: (cls: EquivClass<T>) => boolean;
  readonly initial: EquivClass<T>;
  readonly checkWellDefined?: 'sampled' | 'off';
}

export interface AutomataLib {
  alphabet(symbols: readonly string[]): Alphabet;
  word(text: string): Word;
  words(texts: readonly string[]): Collection<Word>;
  enumerateWords(
    alphabet: Alphabet,
    opts: { readonly maxLength: number; readonly limit?: number },
  ): Collection<Word>;
  language(opts: {
    readonly alphabet: Alphabet;
    readonly label: string;
    readonly contains: (w: Word) => boolean;
  }): Language;
  partition<T extends Handle>(
    source: Collection<T>,
    opts: {
      readonly by: (item: T) => string | number;
      readonly labels?: Readonly<Record<string, string>>;
    },
  ): Partition<T>;
  stateMachine<T extends Handle>(opts: StateMachineOpts<T>): StateMachine;
}

// ───────────────────────────── factory ─────────────────────────────

const WELLDEF_SAMPLE = 4;

function displayText(w: Word): string {
  return w.text === '' ? 'ε' : w.text;
}

export function createAutomata(world: World): AutomataLib {
  // The two word operations. `append` is where came-from provenance and the
  // token-growth trace event live — computing and explaining share this one
  // structure (spike F2).
  interface WordOps {
    word: Operation<[string], Word>;
    append: Operation<[Word, string | Word], Word>;
  }
  const ops = {} as WordOps;

  const mkWord = (ctx: OpContext, text: string): Word =>
    ctx.value('word', {
      text,
      count(this: Word, symbol: string): number {
        let n = 0;
        for (const ch of this.text) if (ch === symbol) n += 1;
        return n;
      },
      append(this: Word, suffix: string | Word): Word {
        return ops.append(this, suffix);
      },
    });

  ops.word = world.defineOp('M.word', (ctx, text: string): Word => mkWord(ctx, text));

  ops.append = world.defineOp('M.append', (ctx, base: Word, suffix: string | Word): Word => {
    const suffixText = typeof suffix === 'string' ? suffix : suffix.text;
    const result = mkWord(ctx, base.text + suffixText);
    ctx.trace({ type: 'append', subject: result, base: base.text, suffix: suffixText });
    return result;
  });

  // ─────────────────────────── partition ───────────────────────────

  function createPartition<T extends Handle>(
    source: Collection<T>,
    opts: {
      readonly by: (item: T) => string | number;
      readonly labels?: Readonly<Record<string, string>>;
    },
  ): Partition<T> {
    interface Bucket {
      readonly cls: EquivClass<T>;
      readonly members: T[];
    }
    const buckets = new Map<string, Bucket>();
    const order: string[] = [];

    const keyOf = (item: T): string => String(opts.by(item));

    const ensureClass = (key: string, representative: T): Bucket => {
      let bucket = buckets.get(key);
      if (!bucket) {
        const members: T[] = [];
        const handle = world.handle('class');
        const cls: EquivClass<T> = Object.freeze({
          id: handle.id,
          kind: 'class' as const,
          label: opts.labels?.[key] ?? key,
          representative,
          get members(): readonly T[] {
            return members;
          },
        });
        bucket = { cls, members };
        buckets.set(key, bucket);
        order.push(key);
      }
      return bucket;
    };

    const addMember = (item: T): void => {
      const bucket = ensureClass(keyOf(item), item);
      bucket.members.push(item);
      // the by-construction edge that makes morph(cloud → buckets) legal
      world.graph.record(item, bucket.cls, 'contributes-to', 'construction');
    };

    // The reactive fold: one Incremental over the source collection — each
    // arrival re-buckets exactly the new item (spike F3, "the infinitely many
    // idiom is just reactivity").
    const inc = world.incremental<T, number>(source, {
      init: (items) => {
        for (const item of items) addMember(item);
        return buckets.size;
      },
      apply: (_state, delta) => {
        addMember(delta.item);
        return buckets.size;
      },
    });
    inc.peek(); // fold the construction-time items eagerly (stable class ids)

    const base = world.handle('partition');
    return Object.freeze({
      id: base.id,
      kind: 'partition' as const,
      source,
      get classes(): readonly EquivClass<T>[] {
        return order.map((key) => buckets.get(key)!.cls);
      },
      classOf(item: T): EquivClass<T> {
        // Total: unseen keys mint a fresh (empty) class lazily. All keys a
        // machine construction will replay are cached by the construction
        // itself, so replay never mints here.
        return ensureClass(keyOf(item), item).cls;
      },
      class(label: string): EquivClass<T> {
        for (const key of order) {
          const bucket = buckets.get(key)!;
          if (bucket.cls.label === label) return bucket.cls;
        }
        // Fall back to the PARTITION KEY — what `by` returned. When `labels`
        // renames a key for display, the key is still the natural way to
        // address the class, and demanding the display string instead is a
        // trap: `labels: {"hole 0": "Hole 0"}` reads as if either spelling
        // works. Labels win when both match, so this only ever rescues a
        // lookup that used to throw.
        const byKey = buckets.get(label);
        if (byKey) return byKey.cls;
        const available = order
          .map((key) => {
            const shown = buckets.get(key)!.cls.label;
            return shown === key ? key : `${shown} (key: ${key})`;
          })
          .join(', ');
        throw new Error(
          `partition ${base.id} has no class labeled "${label}" — available: ${available || '(none)'}`,
        );
      },
    });
  }

  // ─────────────────────────── state machine ───────────────────────────

  type AnyTransition = (cls: EquivClass, symbol: string) => EquivClass;
  type AnyAccepting = (cls: EquivClass) => boolean;

  const machineOp = world.defineOp(
    'M.stateMachine',
    (
      ctx,
      partition: Partition,
      alphabet: Alphabet,
      transition: AnyTransition,
      accepting: AnyAccepting,
      initial: EquivClass,
      checkWellDefined: 'sampled' | 'off',
    ): StateMachine => {
      const classes = partition.classes;
      const diagnostics: MachineDiagnostic[] = [];

      // states from partition classes, counterpart-of recorded per pair —
      // this is what makes morph(buckets → graph) legal (spike F1)
      const states: MachineState[] = classes.map((cls) => {
        const state: MachineState = ctx.value('state', {
          label: cls.label,
          accepting: Boolean(accepting(cls)),
        });
        ctx.link(cls, state, 'counterpart-of');
        return state;
      });
      const stateByClassId = new Map(classes.map((cls, i) => [cls.id, states[i]!]));

      const edges: MachineEdge[] = [];
      classes.forEach((cls, i) => {
        const fromState = states[i]!;
        for (const symbol of alphabet.symbols) {
          const target = transition(cls, symbol);
          const toState = stateByClassId.get(target.id);
          if (!toState) {
            diagnostics.push({
              kind: 'unknown-target',
              classLabel: cls.label,
              symbol,
              message:
                `transition(${cls.label}, "${symbol}") landed in class "${target.label}" which is ` +
                `not a state of this machine (not in statesFrom at construction) — edge skipped`,
            });
            continue;
          }
          const edge: MachineEdge = ctx.value('edge', { from: fromState, to: toState, symbol });
          // the edge's witness derivation, tagged with the edge so
          // demonstrate(edge) replays exactly these two events
          const witness = cls.representative as Word;
          const witnessText = typeof witness.text === 'string' ? displayText(witness) : cls.label;
          const landedWord =
            typeof witness.append === 'function'
              ? witness.append(symbol) // the landing derivation itself (came-from provenance)
              : undefined;
          ctx.trace({
            type: 'hop',
            subject: edge,
            from: fromState,
            to: toState,
            member: witnessText,
            symbol,
          });
          ctx.trace({
            type: 'edge.derive',
            subject: edge,
            from: fromState,
            to: toState,
            member: witnessText,
            symbol,
          });
          edges.push(edge);

          // coherence between the authored closure and the witness landing
          if (landedWord) {
            const landed = partition.classOf(landedWord);
            if (landed.id !== target.id) {
              diagnostics.push({
                kind: 'transition-mismatch',
                classLabel: cls.label,
                symbol,
                message:
                  `class ${cls.label}: the authored transition sends "${symbol}" to ` +
                  `${target.label}, but the representative "${witnessText}" actually lands in ` +
                  `${landed.label}`,
              });
            }
          }
        }
      });

      if (checkWellDefined === 'sampled') {
        for (const cls of classes) {
          const sample = cls.members.slice(0, WELLDEF_SAMPLE) as unknown as readonly Word[];
          for (const symbol of alphabet.symbols) {
            const landings = sample
              .filter((m) => typeof m.append === 'function')
              .map((member) => ({
                member,
                cls: partition.classOf(member.append(symbol)),
              }));
            const first = landings[0];
            if (!first) continue;
            const disagreeing = landings.find((l) => l.cls.id !== first.cls.id);
            if (disagreeing) {
              diagnostics.push({
                kind: 'well-definedness',
                classLabel: cls.label,
                symbol,
                message:
                  `class ${cls.label}: members "${displayText(first.member)}" and ` +
                  `"${displayText(disagreeing.member)}" disagree under append("${symbol}") — ` +
                  `${first.cls.label} vs ${disagreeing.cls.label}. The partition does not ` +
                  `respect the transition; the machine drawn from it is not well-defined.`,
              });
            }
          }
        }
      }

      const initialState = stateByClassId.get(initial.id) ?? states[0];
      if (!initialState) throw new Error('stateMachine: statesFrom partition has no classes');

      const machine = ctx.value('machine', {
        states: Object.freeze([...states]),
        edges: Object.freeze([...edges]),
        initial: initialState,
        diagnostics: Object.freeze([...diagnostics]),
        state(label: string): MachineState {
          return byLabel(states, label, 'machine has no state');
        },
        edge(fromLabel: string, symbol: string): MachineEdge {
          return findOr(
            edges,
            (e) => e.from.label === fromLabel && e.symbol === symbol,
            () => `machine has no edge from "${fromLabel}" on symbol "${symbol}"`,
          );
        },
      });
      return machine as StateMachine;
    },
    // No automatic came-from edges: the closures/partition/initial-class
    // inputs would put 1-hop edges between every machine subpart and the
    // initial class, polluting morph routes. The meaningful correspondence —
    // class ↔ state counterpart-of — is recorded explicitly above.
    { autoEdges: false },
  );

  // ─────────────────────────── the library ───────────────────────────

  return Object.freeze({
    alphabet(symbols: readonly string[]): Alphabet {
      return Object.freeze({
        ...world.handle('alphabet'),
        symbols: Object.freeze([...symbols]),
      });
    },

    word(text: string): Word {
      return ops.word(text);
    },

    words(texts: readonly string[]): Collection<Word> {
      return world.collection(texts.map((t) => ops.word(t)));
    },

    enumerateWords(
      alphabet: Alphabet,
      opts: { readonly maxLength: number; readonly limit?: number },
    ): Collection<Word> {
      const texts: string[] = [''];
      let frontier: string[] = [''];
      for (let len = 1; len <= opts.maxLength; len += 1) {
        const next: string[] = [];
        for (const prefix of frontier) {
          for (const symbol of alphabet.symbols) next.push(prefix + symbol);
        }
        texts.push(...next);
        frontier = next;
      }
      // With a `limit`, keep the TAIL of the enumeration (the longest words):
      // the stream idiom wants fresh, longer strings, not repeats of the short
      // ones that an earlier enumeration already showed.
      const chosen = opts.limit !== undefined && opts.limit < texts.length
        ? texts.slice(texts.length - opts.limit)
        : texts;
      return world.collection(chosen.map((t) => ops.word(t)));
    },

    language(opts: {
      readonly alphabet: Alphabet;
      readonly label: string;
      readonly contains: (w: Word) => boolean;
    }): Language {
      return Object.freeze({
        ...world.handle('language'),
        label: opts.label,
        alphabet: opts.alphabet,
        contains: (w: Word): boolean => Boolean(opts.contains(w)),
      });
    },

    partition: createPartition,

    stateMachine<T extends Handle>(opts: StateMachineOpts<T>): StateMachine {
      const machine = machineOp(
        opts.statesFrom as unknown as Partition,
        opts.alphabet,
        opts.transition as unknown as AnyTransition,
        opts.accepting as unknown as AnyAccepting,
        opts.initial as unknown as EquivClass,
        opts.checkWellDefined ?? 'off',
      );
      reportDiagnostics('stateMachine', machine.id, machine.diagnostics);
      return machine;
    },
  });
}
