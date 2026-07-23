# vision — the engine from first principles

**Status: a direction, not an implementation.** Nothing here is scheduled. This
document exists so that near-term decisions (new disciplines, new affordances,
prompt-surface growth) can be checked against where the engine is ultimately
going, instead of each one re-deriving the destination. Where it disagrees with
`architecture.md`, this one is describing the future and that one the present.

It came out of a concrete question — *what would it take to explain Stokes'
Theorem?* — pushed until it stopped being about Stokes. The answer to the narrow
question is at the end; the body is the general one: what mathematical
explanation is made of, which of our primitives are load-bearing, and which
parts of the current shape are accidents of being built first.

## What a math explanation is made of

Strip away pedagogy-speak and an explanation is built from six moves:

1. **Objects and their representations.** Mathematical understanding is largely
   fluency at seeing one thing many ways — a function as formula, graph, table,
   machine. The *sameness across representations* is the content, not a
   presentation detail.
2. **Co-variation.** "Wiggle this, watch what moves" is the epistemic core of
   *why*. Nearly every aha is noticing what responds, what doesn't, and where
   behavior changes regime.
3. **Process.** Algorithms and constructions unfolding — computation as
   choreography.
4. **Claims.** The actual content of math is propositions: these two quantities
   are equal; this property survives that operation. A theorem is a claim that
   stays true under every variation you can throw at it.
5. **Argument.** Why the claim holds: decomposition, cancellation, invariants,
   induction, case splits, adversarial games (ε–δ).
6. **The student's hand.** Predicting, probing, breaking. An explanation that
   cannot be poked is a lecture.

## What the current kernel gets right — keep at all costs

Graded against that list, the two laws and their consequences are exactly
right, and would survive a from-scratch rewrite untouched:

- **Identity + the correspondence graph** is move 1 made mechanical.
  Morph-legality-via-provenance is a real invention. It is the crown jewel.
- **Reactivity** is move 2 made mechanical. Derived values re-reading cells is
  the dependency structure of mathematics, made draggable.
- **Traced ops** — provenance replayed as choreography — is move 3 solved
  cleanly, including the two-stance doctrine (snapshot the traced op,
  re-read the reactive one).
- **LLM-authored closures as the math brain** is the right division of labor.
  The engine never needs a CAS; it needs structure, identity, and display. The
  closure the model writes (`language.contains`, a field rule) *is* the
  semantics, and it doubles as the checker for anything the student produces.

## Four things that are too small

All four are *around* the kernel, not in it. That is what makes this a growth
path rather than a rewrite.

### 1. Reactivity is scalar-only

`NumericHandle` is the only live type. There is no way to say "a derived
*curve*", "a derived *region*", "a derived *truth value*". The generalization
is **`Live<T>`** for arbitrary `T` — points, vectors, functions, sets,
geometry, booleans. Every view then samples a live value; `View.plot` becomes
"a chart of a `Live<Fn>`" rather than a special case, and a deforming surface
or a watchable proposition stops being inexpressible.

### 2. There is no notion of space — only views on a flat stage

Objects currently live nowhere; views project them onto a shared SVG. But math
objects live *in* spaces (an interval, a region, a graph, ℝ³, a configuration
space), and spaces carry structure — orientation, metric, measure — that
theorems are *about*. Stokes is literally a statement relating structure on a
space to structure on its boundary.

First-class **Space** — with subspaces, boundary as an operator (`∂Ω`
corresponding to `Ω` by construction), products, and indexed families over a
space (a vector at every point = a field) — is the single biggest ontology
upgrade. Display then becomes **charts**: a view is a chosen projection of a
space into screen coordinates. Multiple simultaneous charts of one space, plus
morph-between-charts, gives "change of coordinates" — itself a major
mathematical topic — for free from the existing morph idiom. It also demotes 3D
to a backend detail: a chart of ℝ³ that happens to project through WebGL, on
the seam `renderer-backends.md` already cut.

### 3. Time is conflated — this is why the format feels like slides

An explanation has three independent time-like axes: **narrative time** (the
telling), **process time** (an algorithm running), and **deformation time** (a
homotopy parameter sweeping). The current timeline flattens all three into one
step sequence — `demonstrate` embeds process time into narrative time; `vary`
embeds deformation into it.

Separate them. Narrative becomes a **graph of moments** — the linear lecture is
just the default path through it — while each moment owns its running processes
and scrubbable deformations. Then branching is natural ("what happens if det
goes negative?" is a *place* the student can enter, not a beat they pass), a
deformation is a first-class object (playable, reversible, scrubbable) rather
than a one-shot `vary`, and wandering off the narrated path is a supported
motion instead of a seek hack. The beat system survives as the degenerate case:
a path with no branches. Nothing about the QuickJS authoring pass changes — the
program writes a moment graph instead of a step list.

### 4. All verbs show; none ask

There is no primitive for the student's epistemic input: predict-then-reveal
("place where the point will land"), author-an-object ("draw a loop; we measure
its circulation"), hunt-a-counterexample ("find a graph where this fails" —
checkable, because the LLM-authored closure is the checker). Mechanically cheap
— `compareExperiment`'s judge shape already exists — and pedagogically
transformative.

## The missing noun: the Claim

Today "∮F·dr = ∬curl dA" exists only as typesetting plus a readout comparison.
Make claims first-class: two live values (or a live boolean), an asserted
relation, evidence links into the scene. Reactivity then yields something
genuinely new: **a theorem is a claim whose status never flips no matter what
the student drags.** Invariance-under-variation is checkable, displayable, and
feelable — the student tries to break the equality and cannot. A *conjecture*
is a claim the student can break, and the moment it breaks is a counterexample:
addressable, focusable, narratable. This single primitive is the difference
between animated illustrations and manipulable mathematics.

## The kernel this converges on

Small, stable, and what the model must reliably author:

| primitive | what it is |
| --- | --- |
| `Live<T>` | general reactive values; parameters and slots as today, derived over any type |
| `Space` | structure-carrying domains; subspace / boundary / product, correspondence by construction |
| `Field` | a `Live<T>` indexed over a space |
| `Map` | between spaces, per-element correspondence recorded — `structureMap` promoted from graphs to everything |
| `Claim` | live proposition + evidence links |
| `Process` | traced computation (unchanged) |
| `Deformation` | a path in object-space with its own scrub parameter |
| `Moment` graph | narrative as a graph; say/show/focus/morph attach to moments |
| ask-verbs | predict, place, author, hunt |
| correspondence | unchanged |

Discipline libraries (Calc, LinAlg, Graph, Prob, a future Vec/Geometry) remain
vocabularies compiled onto that kernel — already the architecture's shape, per
`object-layer.md` and the probe results. Arguably the kernel *shrinks*:
`Live<T>` and `Space` collapse many specials into generals.

## The scene was never the slides

Underneath the timeline there is already a persistent reactive world — handles,
cells, the correspondence graph. The beat sequence is merely the only authoring
mode built so far. Three modes share that substrate:

1. **Authored lecture** (today) — one pre-computed path through the scene.
2. **Explorable world** — the moment graph; the scene persists, the student
   wanders, narration attaches to places rather than to a clock.
3. **Conversational** — the LLM appends to the scene turn by turn.

Mode 3 is architecturally cheap because of a property the linter already
enforces: **lesson programs are deterministic** (no `Date`, no `Math.random`,
no I/O). The world state *is* the program text — state = fold(program). So a
chat turn needs no long-lived sandbox session:

- Each turn emits a **program fragment**, not a whole program. It is linted by
  the same gate, appended to the accumulated program, and the whole thing
  re-executes in QuickJS (milliseconds). The new tail plays immediately.
- **Handles make cross-turn reference work.** The fragment mints new objects
  and links them to existing ones by id. Each turn's prompt carries a *scene
  manifest* — what exists, kinds, labels, current values, **including where the
  student has dragged things** — so the model can say "you've pulled det
  negative; look what happened to the orientation."
- Reactivity wires new derived values into existing cells automatically; the
  correspondence graph accretes; morph legality is still checked per fragment.

"Explanation progresses" stops meaning "timeline advances" and becomes "the
world accretes": objects enter, get linked, get transformed, get retired — and
a student's mid-stream question is just another authoring event.

The unification this buys: a lesson and a conversation become the same artifact
— an **event log of authoring acts**, some by the model, some by the student's
hands. Replayable end to end, which extends the cassette machinery to whole
conversations: one billed chat session becomes a permanent free regression
test, exactly as `record` does for single generations today.

What mode 3 actually needs built: fragment-level generation (delta authoring
against a scene manifest instead of whole-program authoring), revision verbs
(`retire`/`replace` — `hide` alone is too weak), and the repair loop pointed at
fragments. Sandbox, gate, reactivity, identity, rendering all carry over.

## Honest expressibility ledger

What the frame above unlocks, against what the present engine can say:

| concept | today | under this vision |
| --- | --- | --- |
| Stokes / Green | yes-with-additions (see below) | native: Claim tested by deformation |
| ε–δ, quantifier games | inexpressible | ask-verbs + moment-graph branching |
| induction, case splits | narrative order only | Claims with dependency links |
| anything not planar | no | Space + charts; 3D as a backend |
| exploration off the rails | pre-exposed drags only | moment graph |
| a derived curve / region / proposition | no | `Live<T>` |

## The constraint that disciplines all of this

The product question is unchanged: *can a model reliably author this?* Every
ontology expansion raises that bar. The current design wins precisely because
the surface is small and idiomatic, so the mitigation is layering: the kernel
stays under ~15 concepts, breadth lives in discipline libraries, and the API
reference serves discipline slices instead of the whole surface (it is ~900
lines already; Stokes does not need the automata section). Cassette replay and
the gate carry over unchanged — and the gate gets *stronger*, because Claims
and Spaces give the linter semantic invariants to check: an unoriented space
cannot be integrated over; a claim must reference live values on both sides.

## Appendix: the Stokes probe, scoped for the present engine

The near-term answer to the question that started this, kept here because it
doubles as the first test of the frame. Target **Green's theorem** — the stage
is 2D, and Green delivers the entire mechanism (circulation = summed
microscopic circulation, interior cancellation, boundary survives) for a
fraction of the cost of 3D; state the generalization in a formula beat.

Gaps, in build order:

1. **Vector field + field view + curl + heatmap.** `Field.vectorField((x,y) =>
   [P, Q])` — the rule is the LLM-authored closure. `View.field` samples arrows
   on a grid (`View.vectors` is origin-anchored and cannot do this);
   `View.heatmap` shows curl as a scalar field. A parameter inside the rule
   makes the whole field redraw under a drag for free.
2. **Oriented loop + circulation.** An oriented path as a first-class handle
   (precedent: `Polygon.area` is already signed — "the sign is the
   orientation"); a region hands out its boundary by construction. Circulation
   in both stances: traced (`demonstrate` walks the loop inking in F·dr
   contributions) and reactive (follows a field-parameter drag).
3. **Circulation density — the curl probe.** The exact shape of `Increment`
   (`width`/`approxHeight`/`averageRate`): probe loop at a live point, shrink a
   radius Parameter, circulation/area converges to curl via
   `readout({compareTo})`. Zero new idioms.
4. **Tiling with shared-edge identity — the crown jewel.** `Field.tile(region,
   {n})`, Riemann-style: each cell a handle with its own tiny circulation,
   traced so `demonstrate` inks cells one at a time. Non-negotiable design
   point: **adjacent cells' shared edge segments are the same handle** (or
   counterpart-linked by construction), carrying both opposing contributions.
   That is what makes the cancellation beat authorable — focus a shared edge,
   the two contributions sum to zero; focus the boundary with
   `emphasize:"stillness"` — it is what does *not* cancel. Without
   by-construction sharing the model would hand-link O(n²) correspondences and
   the beat dies.
5. **Later, a separate decision:** a projected-3D chart for literal Stokes —
   not before Green lessons generate reliably.

The encouraging meta-result: nothing in the probe required a new *idiom* —
every piece landed on an existing pattern (traced vs reactive, signed
orientation, Increment limits, Riemann tiling, correspondence by construction).
That is decent evidence the kernel's two laws are the right abstraction, and
that the vision above is growth along the grain rather than against it.
