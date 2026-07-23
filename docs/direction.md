# direction — qed, from the math-ai baseline

**Status: decided 2026-07-24, unbuilt.** The first document written for `qed`
rather than inherited from `math-ai`. It records ten decisions taken in one
design session, the reasoning behind them, and — marked throughout — what was
**verified in the code or on screen** versus what is still a proposal.

Where it disagrees with `architecture.md`, this one wins; that document
describes the engine we copied. Where it disagrees with `vision.md`, read
`vision.md` as the older, wider survey: it proposed `Space`, `Deformation`, a
moment graph and ask-verbs, and this document adopts none of them yet.

The product, restated: **a visualizer and explainer for mathematical concepts,
theorems and proofs — conveying the meaning behind an argument, at academic
level, across many disciplines.**

## The ten decisions

| # | Question | Decision |
|---|----------|----------|
| 1 | What does "academic level" mean? | **Grounded, not verified** |
| 2 | How do we open the visual ceiling? | **Curated views now; revisit at topology** |
| 3 | Which discipline next? | **Group theory** |
| 4 | Is "the meaning behind proofs" an ontology gap? | **Yes — argument is first-class** |
| 5 | Where is the argument authored? | **In the lesson program, in TypeScript** |
| 6 | How does a student move through it? | **Linear path + drill-down** |
| 7 | What is the visual reference standard? | **Per-lesson register, not one aesthetic** |
| 8 | Which quality lever first? | **Composition & layout engine** |
| 9 | Order against the argument work? | **Visual push first, then argument** |
| 10 | Must curves deform live under a drag? | **No — a per-case feature, deferred** |

## Kept from the baseline, untouched

These would survive a from-scratch rewrite and nothing below disturbs them:

- **Identity + correspondence recorded by construction.** Morph legality as
  reachability in a graph nobody hand-authored. The crown jewel.
- **`Live<T>` reactivity.** Co-variation made mechanical, over any type.
- **Provenance replayed as choreography** (`demonstrate`).
- **The LLM authors closures; the engine hosts no CAS.** Decision 1 does not
  reverse this.
- **Authoring without coordinates.** The spikes wrote ~120-line lessons with
  zero hard-coded geometry. Decision 8 must not spend this — see below.
- **Never build ontology ahead of evidence.** `Space` was proposed in
  `vision.md` and correctly *rejected* at roadmap step 3 because Green's
  theorem only needed oriented regions. Decisions 2, 3 and 10 all apply it.
- **Free-vs-billed test tiering.** Cassette replay makes generation regressions
  free; `verify`/`remount` need no key. Do not erode it.

---

# Part I — the visual layer (do this first)

## The finding: semantically strong, visually a prototype

**Verified on screen.** `./run.sh verify --shots` (free, 96s, 22/22 passed)
against the bipartite lesson:

- **There is no composition.** The stage is a scrolling vertical column of small
  grey boxes, one per view, ~325px wide in a 1280px viewport. Two graph views
  stack; the second is cut off below the fold.
- **Figures are small and the panel is mostly empty.** At beat 4, ~90% of the
  visual panel is dead white space with the graph pushed off the bottom edge.
- **Prose dominates the picture.** ~200 words of dense small grey text per beat
  beside the figure. Reading is the primary activity and the visual is
  decoration — an inversion of the product's premise.
- **The visual vocabulary is thin.** 1px grey edges, small outlined circles,
  single-letter labels. No emphasis hierarchy and no annotation layer: no
  callouts, braces, dimension marks or labelled arrows.
- **No axis furniture exists.** `frame.ts` — the shared coordinate frame behind
  every plot — has no tick, gridline, nice-number or axis-label logic at all.
  `plane.ts` is the only renderer file that mentions ticks. `PlotView` draws
  axes as two `M...L...` segments.

**What already works and must be protected:** the inline `edge#13` / `A` chips
in narration are live, linked mentions of scene objects. Narrative↔visual
binding is real and is a genuine differentiator.

### The root cause, stated in the code

`packages/render/src/view.ts:12`:

> *"Views never position themselves; layout is CSS flow + the layout container
> views."*

That is a deliberate decision, and it is the one to revisit. Nothing measures,
allocates, or fits. `packages/render/src/layout/` contains exactly one file —
graph autolayout — so `Layout.{columns, stack, overlay}` is flexbox.

### Why this is cheaper than it sounds — verified

The 23 views split into two populations:

| population | count | what it means for layout |
| --- | --- | --- |
| extends `FramedView` | 11 | owns a `CoordFrame` (domain/range/width/height/pad). Intrinsic bounds are already known; fit-to-rect is a viewBox rewrite. |
| extends `View` | 12 | HTML panels — matrix, table, readout, formula, claim, tokens, partition, bars, history, experiment, stateGraph, layout. Want natural size; need measuring and placing, not scaling. |

The figures — where fit-to-space actually matters — are the family that already
carries geometry. That is the cheap path.

## Decision 7 — the register is per-lesson

"Journal figure", "cinematic", "interactive instrument" are **all correct, for
different questions.** A homotopy wants choreographed motion; Lagrange wants a
print-grade figure; a derivative wants a draggable instrument. So the register
is a **property of the lesson, chosen by the plan** — not a global aesthetic.

`architecture.md` already reserves this seam and left it unbuilt: *"Director
layer (audience / depth / rigor / emphasis knobs) — `AnswerPlan.style` reserves
the fields; the plan pass is the single insertion point."* This decision
activates it, minimally: a register selects a **token set** — typography scale,
stroke weights, density, palette, motion pacing, whether axis furniture is
drawn — consumed by the composition pass. No view learns about registers; they
read tokens.

## Decision 8 — the composition engine

Three passes, replacing "CSS flow":

1. **Measure** — every view reports intrinsic content bounds. Free for the 11
   `FramedView`s (they have a `CoordFrame`); a DOM measure for the other 12.
2. **Allocate** — roles and the active register produce rects. **Roles, not
   coordinates**: a program says a view is `focal` / `support` / `readout`, and
   the engine allocates. This is the constraint that protects
   coordinate-free authoring — if the model must place panels by hand we have
   spent the property the spikes proved.
3. **Fit** — a `FramedView` rewrites its viewBox to fill its rect; a `View`
   panel is sized and placed at natural size.

Two properties fall out that the shots show missing: figures fill their space,
and the focal panel can change per beat (the `focus` verb already exists, so
allocation can respond to it).

**Deliberately not in scope:** a constraint solver. Semantic templates first,
per `architecture.md`'s own deferral. Add one if templates crack.

---

# Part II — the argument layer (after the visual push)

## The thesis

Decisions 1, 4 and 5 are one idea:

> **An argument is a directed graph of Claims, and every claim carries honest
> evidence about how it is known.**

Each half fixes a real gap. The timeline is a flat beat list, so a proof's
structure — what depends on what, which case, what is assumed — lives only in
prose ordering. And `M.claim` reports a verdict with no argument modelled
around it.

Composed, they give what neither gives alone: a proof whose skeleton is
manipulable *and* whose every node is explicit about whether it was checked
exactly, sampled within a tolerance, asserted by a model-authored closure, or
simply assumed. That is what "academic level" means here — not machine-checked
truth, but **no assertion may look better-established than it is.**

### Decision 1 — grounded, not verified

`architecture.md` says *"Correctness is deliberately not a priority. No CAS, no
symbolic kernel, no proof obligation."* Keep the no-CAS half; reject the
complacency half. The *epistemic status* of a claim becomes gated rather than
courtesy:

- `ClaimEvidence` (`packages/library/src/claim.ts:51`) is today
  `exact-comparison | sampled | authored-predicate`. It grows two leaf kinds for
  argument roots: **`assumed`** (a hypothesis taken as given) and **`cited`** (a
  named external theorem).
- The gate rejects a conclusion claiming stronger evidence than its dependencies
  support, and rejects unlabelled assertion.
- Object-boundary invariant spot-checks stay the mechanism of choice —
  `checkWellDefined: "sampled"` already reports rather than crashes.

No solver, no root-finder, no proof obligation. The model stays the math brain;
it may no longer narrate an opinion as a proof.

### Decision 5 — and what the code already gives us

**Verified.** `packages/core/src/correspondence.ts` is already a generic
labelled-edge graph — `record` / `link` / `edgesOf` / `neighbors` / `path` /
`reachable` — and `Relation` (line 14) is a plain union of five kinds. An
argument edge is a **sixth kind**, `justifies`, over Claim handles. Storage,
dedup by `(a, b, rel)` and incidence indexing come free.

**The one real friction, and it is honest:** that graph is *undirected by
design* — `path()` says so in its own comment, because "correspondence means
these refer to each other". An argument is directed and acyclic. Direction is
recoverable (`edge.a` → `edge.b` is stored in order), so what is needed is a
directed traversal option and a cycle check for the gate. A small addition to a
143-line file, not a subsystem.

### Decision 6 — drill-down is seek, not a moment graph

- Beats declare what they establish: `lesson.beat(title, { establishes: claim })`.
  Beats stay **flat markers** — `architecture.md` argues for this at length and
  every timeline walker depends on it. Nothing becomes a container.
- The argument DAG is an **index over beats**, not a second timeline.
- "Why does this hold?" = seek to the beat span establishing that claim;
  returning = seek back. Forward-seek plus rebuild-for-backward already works
  and is already gated (*landing on beat k by jumping backward matches having
  stepped forward to k*).

Roadmap step 5's moment graph stays unbuilt, correctly — its blocker still holds
(nobody has held a conversation with this engine yet), and this design gets
branching-shaped navigation without a player rewrite.

## Decision 3 — why group theory

The cheapest available test of the deepest bet. Almost every group-theory visual
lands on an idiom that already exists:

| concept | existing idiom |
| --- | --- |
| Cayley graph | `View.graph` / `View.stateGraph` |
| cosets | `View.partition` |
| quotient group | the `reinterpret` macro (partition → structure) |
| group action, homomorphism | `structureMap`, correspondence by construction |
| orbit / stabilizer | partition + the correspondence between them |

That is what makes decision 2 affordable: the registry barely grows for this
probe. And the proofs are ideal first arguments — Lagrange is a three-node DAG
(cosets partition G → all cosets are equinumerous → `|H|` divides `|G|`) whose
every node is drawable today. It also doubles as the showcase for Part I.

`abstract-algebra` is already a key in `DISCIPLINES` (`plan.ts:37`) with **no
library and no example behind it**, so this fills a slot the planner already
believes in.

Topology is deliberately not next: it forces deformation as a first-class
scrubbable object, non-planar space, and a rendering backend beyond SVG. It is
also where the escape-hatch question gets genuinely forced rather than guessed.

---

## The standing gaps ledger

All three outlive this plan.

**1. The geometry escape hatch was promised and never built.** Architecture
decision #6 — *"a geometry escape hatch reachable from every altitude; layers
without a downward escape get sealed, and then the human is the bottleneck
again"* — does not exist. `View.*` is a closed registry of 23 names backed by
hand-written renderers. A visual nobody hand-wrote is currently **unsayable**.

Decision 2 defers rather than resolves this: curated through group theory,
revisited when topology forces it. The stated goal — give the model building
blocks, don't constrain the visuals — is **live, not dropped**, and this is the
entry most likely to change.

**2. The corpus, not the API, is the real ceiling.** Roadmap step 2.6 bought the
most important sentence in the repo: *a vocabulary the corpus does not
demonstrate stays unused no matter what the reference says about it.* The model
ignored `{ over: region }` despite the reference marking it "PREFER this",
because the injected example predated it. `prompts.ts` injects exactly **one**
example per discipline, and only **two** exist (probability, graphs).

Direct consequence for decision 2: **growing the registry does nothing on its
own.** Every new view or register needs corpus demonstration or it will not be
reached for. A plan that adds views without adding examples is a plan that does
not work.

**3. Rendering is SVG/DOM only.** No canvas, no WebGL, no 3D. Fine for
everything above; a hard blocker for topology.

## Build order

Sequenced so each step produces the evidence the next consumes. Nothing is
scheduled; nothing billed without asking.

**Part I — visual (decision 9 puts this first).**

- **V1. Measure + fit.** `contentBounds()` on `FramedView` from its `CoordFrame`;
  viewBox fit-into-rect. Immediately fixes small, clipped, off-screen figures.
- **V2. Allocation by role.** `focal` / `support` / `readout`; the stage
  composes instead of stacking. Coordinate-free authoring preserved.
- **V3. Register tokens.** Wire `AnswerPlan.style` → a token set (typography,
  stroke weight, density, palette, motion, axis furniture on/off). Two registers
  to start — journal and instrument — because two is what proves the seam.
- **V4. Figure craft.** Axis furniture in `frame.ts` (ticks, nice numbers,
  typeset labels, optional grid) and an annotation layer (callouts, braces,
  labelled arrows). Shared by all 11 `FramedView`s at once.
- **V5. Prose/visual rebalance.** Prompt-side: shorter narration paced against
  the figure. Cheap, and it is what makes V1–V4 legible.

Re-run `./run.sh verify --shots` after each — it is free, and this whole part is
judged on screen, not in assertions.

**Part II — argument.**

- **A1.** `justifies` relation + directed traversal + cycle check in `core`.
- **A2.** Evidence taxonomy grows (`assumed` / `cited`) and the gate rule that a
  conclusion may not outrank its dependencies.
- **A3.** `beat({ establishes })` and the claim→beat index.
- **A4.** Drill-down over existing seek; the argument map as a view. Gated
  invariant to extend: descending into a claim and returning leaves the student
  where they were.
- **A5.** A group-theory lesson authored by hand against the real scope, in the
  shape of `green.compose.test.ts`. Lagrange first. Keep a friction ledger;
  extract only what friction proves.

**The one billed step.**

- **B1.** `./run.sh record "Why does Lagrange's theorem hold?"` — answers what no
  free test can: does the model reach for the argument vocabulary and the new
  registers unprompted? Buys the `abstract-algebra` example slot and a permanent
  free cassette either way. **Ask before spending.**

Everything except B1 is free.

## Deferred, with the seam left open

- **The geometry escape hatch** — gap 1; revisited at topology.
- **Live deformation under a drag** (decision 10). `plot.ts:58-65` samples `f(x)`
  once at authoring time and replays a frozen polyline, because a guest closure
  re-sampled per frame would re-enter the sandbox thousands of times per drag.
  When this returns it should be **per-declaration, not global** — a restricted
  re-samplable form the host evaluates natively, not arbitrary guest closures.
- **`Space`, fields-over-space, charts** — rejected on evidence at roadmap step
  3; still unrequested.
- **The moment graph and ask-verbs** (roadmap step 5) — still blocked on the same
  missing evidence; decision 6 reduces the pressure.
- **A constraint layout solver** — semantic templates first.
- **Any verification kernel** — decision 1 forecloses it deliberately.

## Housekeeping — inherited docs to distrust

`CLAUDE.md` came over from math-ai intact and references files absent from the
copied tree: `docs/renderer-backends.md`, `docs/probe-vector.md`,
`docs/archive/`, `docs/new_architecture/`, and `spikes/`. Only four documents
existed under `docs/` before this one. `architecture.md` cites the spike
directories as its acceptance layer; those programs are gone, though their
descendants survive as `packages/library/src/__fixtures__/` and `examples/`.
`view.ts` also cites `docs/renderer-backends.md`. Treat pointers in inherited
docs as historical until checked.
