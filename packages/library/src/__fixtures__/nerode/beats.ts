/**
 * beats.ts — Myhill–Nerode, beats 2–4, hand-authored against api.ts exactly as
 * the LLM would emit it. The test: does the language let a teacher speak?
 *
 * Four beats, each opened by a `lesson.beat(...)` marker — the boundaries the
 * student pages through (beat 1, the memory question, is out of scope):
 *
 * 1 "One future tells them apart"    compare-experiment on a distinguishing suffix
 * 2 "A pair no future separates"     the behavior table, built up column by column
 * 3 "Sort histories by how they act" the collapse: partition + stream of arrivals
 * 4 "The classes were the states"    edges derive themselves from the theorem
 */
import { M, View, F, lesson } from "./api";
import type { Word, Verdict } from "./api";

// ── shared setup (beat 1, the memory question, is out of scope) ──

const Sigma = M.alphabet(["0", "1"]);

const L = M.language({
  alphabet: Sigma,
  label: "even number of 1s",
  contains: w => w.count("1") % 2 === 0,
});

const membership = (w: Word): Verdict =>
  L.contains(w)
    ? { label: "ACCEPT", polarity: "accept" }
    : { label: "REJECT", polarity: "reject" };

lesson.beat("One future tells them apart");

const x = M.word("0");
const y = M.word("100");
const z = M.word("1");

lesson.show(View.tokens([x, y], { layout: "column" }));
lesson.say`Are ${x} and ${y} genuinely different pasts? Run the same future through both.`;

const exp = lesson.compareExperiment({
  subjects: [x, y],
  apply: h => h.append(z), // append's provenance is what the runtime animates
  judge: membership,
  layout: "side-by-side",
});

lesson.focus(exp, { emphasize: "disagreement" });
lesson.say`One continuation, two verdicts: the suffix ${z} distinguishes ${x} from ${y}. Any machine MUST tell these pasts apart.`;

/**
 * Deliberately NOT engine vocabulary — a macro composed from kernel pieces,
 * written the way a discipline library would be. It returns the handles it
 * mints so callers can keep linking to them (macro hygiene).
 */
function probeContinuations(
  histories: readonly [Word, Word],
  suffixTexts: readonly string[]
) {
  const suffixes = suffixTexts.map(t => M.word(t));
  const table = View.table({
    rowHeaders: histories, // headers ARE the token objects — live mentions
    colHeaders: suffixes,
    cell: (h, s) => membership(h.append(s)),
  });
  lesson.show(table);
  lesson.buildUp(table, {
    order: "column-by-column",
    pace: { start: "slow", end: "fast" },
  });
  return { table, suffixes };
}

lesson.beat("A pair no future separates");

const a = M.word("0");
const b = M.word("00");

lesson.say`Now compare ${a} and ${b}. Try future after future.`;
const probe = probeContinuations([a, b], ["", "0", "1", "01", "10", "11"]);
lesson.focus(probe.table, { emphasize: "agreement" });
lesson.say`Identical rows. NO future separates ${a} from ${b} — to any machine they are the same state of knowledge.`;

// the relation itself, as an addressable formula; the suffix ROLE covers all
// three occurrences of z, and linking the role lights the probed columns too
const nerode = F.tex`x \sim_L y \iff \forall ${F.span("suffix", "z")} \in \Sigma^{*} : x${F.span("suffix", "z")} \in L \Leftrightarrow y${F.span("suffix", "z")} \in L`;
lesson.show(View.formula(nerode));
lesson.link(nerode.span("suffix"), probe.suffixes, "represents");

lesson.beat("Sort histories by how they act");

const words = M.enumerateWords(Sigma, { maxLength: 4 });
const cloud = View.tokens(words, { layout: "scatter" });

lesson.show(cloud);
lesson.say`Histories are infinite in variety. Futures are not. Sort every history by how it behaves.`;

const byParity = M.partition(words, {
  by: w => w.count("1") % 2,
  labels: { 0: "EVEN", 1: "ODD" },
});
const buckets = View.partition(byParity, { as: "buckets" });

// cloud and buckets project the SAME underlying words ⇒ every token flies home
lesson.morph(cloud, buckets, { preserveIdentity: true });
lesson.say`Two buckets — ${byParity.class("EVEN")} and ${byParity.class("ODD")} — and nothing else.`;

// the "infinitely many" idiom: keep the stream coming; buckets never multiply.
// No bespoke verb: the partition is DERIVED from `words`, so growing the
// source animates each arrival into its bucket.
const more = M.enumerateWords(Sigma, { maxLength: 7, limit: 24 });
lesson.cascade(
  more.items,
  w => {
    lesson.show(w, { enterFrom: "top" });
    words.add(w);
  },
  { pace: { start: "slow", end: "fast" } }
);
lesson.say`However long the stream runs, no third bucket ever appears. That finiteness is the whole story.`;

lesson.beat("The classes were the states");

lesson.say`Now watch what appending one symbol does to a whole bucket.`;

const machine = M.stateMachine({
  statesFrom: byParity,
  alphabet: Sigma,
  // the transitions are COMPUTED, not drawn — this is the theorem doing work
  transition: (cls, s) => byParity.classOf(cls.representative.append(s)),
  accepting: cls => L.contains(cls.representative),
  initial: byParity.classOf(M.word("")),
  checkWellDefined: "sampled",
});

const graph = View.stateGraph(machine, { layout: "auto" });

// buckets and graph project DIFFERENT objects (partition vs machine); the
// morph is legal because stateMachine({statesFrom}) recorded class↔state
// counterpart-of edges at construction — identity rides the correspondence graph
lesson.morph(buckets, graph, { preserveIdentity: true });

// each edge remembers how it was derived; replay that derivation as the reveal
lesson.cascade(machine.edges, e => {
  lesson.demonstrate(e);
});

lesson.say`Reading ${M.word("0")} keeps the class. Reading ${M.word("1")} swaps them. The minimal DFA was never designed — it precipitated out of the language.`;
