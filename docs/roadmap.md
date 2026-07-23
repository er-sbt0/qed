# roadmap — the first steps toward vision.md

**Status: a plan, not a promise.** This sequences the first concrete steps
toward `vision.md`. Each step is shippable alone, each produces the evidence
the next one consumes, and the early steps improve generation quality on the
current product while the vision assembles underneath it. If a step's evidence
contradicts the next step's premise, the plan changes — that is the point of
ordering it this way, and it has already happened once (see step 3).

The design principle is the repo's own proven methodology (`probe-algebra.md` →
`probe-graphs.md`): **never build ontology ahead of evidence.** Probe with an
example, keep a friction ledger, extract only what friction proves. The plan
therefore sequences the vision by "smallest thing that tests the deepest bet,"
not by architectural grandeur.

In one line: **Claim → probe → generalize → converse → branch.**

## Step 1 — the Claim primitive (the wedge) — **DONE**

`packages/library/src/claim.ts`, `View.claim`, an api-reference section.
`M.claim` takes two live quantities and a relation, or a predicate closure;
`status` is a derived *boolean* — the library's first non-numeric live value,
and the thin end of `Live<T>` without committing to the generalization.

Retrofitted into both corpus positions the vocabulary needs:

- **ftc** — a theorem. Left side is a difference quotient of the *area*, right
  side is the height of *f* off the curve; two independent routes asserted
  equal, so the badge surviving every drag is evidence the student produces.
- **bipartite** — a conjecture. The predicate genuinely 2-colors the graph and
  asks whether any edge came out monochromatic, so sliding the chord in breaks
  it, and that flip IS the counterexample.

The mst target this step was originally written against no longer exists — the
graphs slot is a recording now, so the bipartite retrofit is a hand-edit of
recorded output and its `meta.json` overstates what the model wrote.

**Unspent:** the deliberate `record`. `M.claim` is already exercised by two
examples in the prompt corpus, so a claim-flavored recording proves less per
dollar than the two below; it can ride along later or be answered incidentally
if a generation reaches for the vocabulary on its own.

## Step 2 — the vector-calculus probe (Green's theorem) — **DONE, ledger written**

`packages/library/src/field.ts` plus four views:

- **2a** fields from authored closures, `curl`/`divergence` as derived FIELDS,
  `View.field` (lattice arrows) and `View.heatmap`.
- **2b** oriented loops where the sign of the area *is* the orientation,
  `Field.rectangle` handing out `∂Ω` by construction, and circulation in both
  stances — reactive (follows a dragged corner and a parameter inside the rule)
  and traced (one event per edge for `demonstrate`).
- **2c** the curl probe, deliberately `Calc.Increment`'s shape down to falling
  back to the limit at zero radius instead of NaN.
- **2d** the tiling. Every lattice edge minted once, cells pick edges out of the
  tables, so adjacent cells hold the SAME segment handle — one forward, one
  reversed. Interior-vs-boundary is read off the lattice, not asserted.

Proven free: unit tests for the mathematics, `green.compose.test.ts` (a whole
lesson authored against the real scope), `field.sandbox.test.ts` (the vocabulary
across QuickJS — a field's rule is a guest closure the host re-invokes 144 times
per paint, a callback rate nothing else in the engine has).

The findings are in `docs/probe-vector.md`, and they **amended step 3 below**:
the evidence for `Live<T>` is overwhelming, and the evidence for `Space` is much
thinner than `vision.md` assumed.

**Remaining:** the `record` (step 2.6) and the `vector-calculus` key in
`DISCIPLINES`, which `plan.ts` forbids adding without an example behind it.

## Step 2.5 — finish the differential vocabulary — **DONE, free**

The Green probe built the *integral* half of vector calculus. The differential
half is two small functions away, and finishing it is what makes the second
derivative test in R² expressible — a lesson from a different discipline
reaching the same primitives, which is the cheapest possible check that the
vocabulary generalizes.

- **Build**: `Field.gradient(f)` → `VectorField`, and `Field.hessian(f, at)` →
  a `Matrix2` whose four entries are `derivedNumber`s. Both are central
  differences, the same machinery `curl` already runs. `LinAlg.matrix` already
  accepts `NumericHandle` entries, so the Hessian composes into
  `LinAlg.eigen(H)` — which is **already live** (`linalg.ts:293`) — and the
  whole second derivative test falls out with no further engine work.
- **Fix the papercut**: `Eigen.values` is a live getter returning
  `[number, number]`, not handles, so `View.readout(eig.values[0])` throws and
  `M.claim({lhs: eig.values[0]})` silently snapshots. Expose them as
  `NumericHandle`s.
- **Not an engine gap, deliberately**: finding the critical point. The model
  authors it analytically and `M.claim({predicate: () => |∇f| < ε})` verifies
  it. No solver, no root-finder — that is the division of labour working.
- **Exit criterion**: unit tests, plus a compose test in the shape of
  `green.compose.test.ts` proving the R² second derivative test is authorable.

**Landed as written**, with one addition worth recording: the Hessian's
off-diagonal is the SAME handle in both slots, so it is symmetric by
construction and `eigen` never sees a matrix that drifted asymmetric from
finite-difference noise. `matrix2` was extracted from `linalg.ts` so there is
exactly one 2×2 in the library rather than `field.ts` growing a second one.

`secondderivative.compose.test.ts` is the exit criterion, and it does the
lesson's own move: rotating the slice direction never breaks the claim at a
minimum (a theorem) and breaks it at exactly `atan(1/√2)` at a saddle (a
conjecture, *located* rather than merely detected).

## Step 2.6 — the Green `record` — **SPENT, gated first attempt**

```
./run.sh record "Why does Green's theorem work?"
```

Deliberately **before** step 3, not after. It buys four things at once, and no
other action buys any of them:

1. Step 2's actual exit criterion — does the model reach for `Field.*` given
   only the api-reference section?
2. The browser gap. The four new views are proven headless but have **never
   been mounted in a real browser**; nothing in `verify` or `remount` touches
   them, and only an example changes that.
3. The `vector-calculus` key in `DISCIPLINES`, which cannot land without an
   example behind it.
4. A permanent free cassette either way.

It is also the run most likely to fail, which is the argument for spending it
now: a failure pins exactly which part of the surface didn't land while the
design is fresh, and per `CLAUDE.md` the failed half is the more valuable
artifact.

**Result: it gated on attempt 1, no repair.** Question (1) is answered plainly —
given only the api-reference section the model reached for `Field.vectorField`,
`rectangle`, `tile`, `walkTiles`, `circulation` and `contribution`, plus
`View.field`/`loop`/`tiling` and two `M.claim`s.

**The finding is about the prompt, not about Green.** It used `{ over: region }`
exactly zero times, although the reference marks it "PREFER this" and carries a
worked snippet. The few-shot example injected for `calculus` was the PREVIOUS
Green recording, which predates the option — **and the example plainly outweighs
the reference prose.** The newly promoted example does not use it either, so the
loop is self-sustaining: *a vocabulary the corpus does not demonstrate stays
unused no matter what the reference says about it.*

That generalizes past `over`, and it is the most useful thing this run bought.
The lever for adopting a new option is the CORPUS, not the reference: either
hand-edit an example to demonstrate it (and re-run `./run.sh examples`), or
record a question whose natural answer needs it. Adding more emphatic prose to
`api-reference.ts` is the move that does not work.

## Step 3 — `Live<T>`, extracted not designed — **DONE, free**

Generalize the reactive cell to arbitrary `T` and migrate `NumericHandle` to
an alias. It was mechanical, as predicted, and the free tier carried it —
cassette replay plus `remount` (all six examples still draw).

Three independent ledgers said the same thing, from three disciplines:

1. **The claim's boolean** (step 1) — `status` had to be special-cased.
2. **`field.ts`'s faked geometry** (step 2) — `derivedNumber` being the only
   reactive wrapper forced every live thing to be a number, pushing all live
   GEOMETRY (segment endpoints, loop vertices, the vector at a moving point)
   into plain closures that re-run per read with no memoization, no equality,
   and no dependency tracking of the geometry itself.
3. **The Hessian and the eigen-decomposition** (step 2.5) — both faked with
   getters over a `world.derived`, structurally the same fake as (2).

**The open question this step used to carry is now answered: do NOT add `Space`
as a full noun.** Orientation-tagged regions were all Green actually needed. So
what landed is the small thing: `PlaneRegion` owns a live `domain`, and the
four plane views borrow it with `{ over: region }` rather than each restating
an extent that can silently disagree with the geometry. Metric, measure,
products and charts stay unbuilt — nothing has asked for them.

What landed, in `packages/lesson/src/types.ts` and `packages/library/src/live.ts`:

- `Live<T>`; `NumericHandle` is now literally `Live<number>`. `world.derived<T>`
  in core was **already generic**, so the scalar-only constraint lived entirely
  in the protocol type and the one wrapper — a widening, not a new mechanism.
- **Equality is the load-bearing part.** A derived over a structural value
  allocates a fresh array every run, so without an `equals` every dependent
  invalidates on every read and nothing downstream can short-circuit. That is
  the concrete cost the three fakes were paying, and the tests assert it
  directly rather than asserting that `.value` works.
- `claim.verdict` is a `Live<Verdict>` compared by identity, so it only
  invalidates when the claim actually FLIPS — not on every drag frame that
  leaves it holding.
- `Segment.path` / `OrientedLoop.path` are live and memoized; `from()`/`to()`/
  `midpoint()`/`delta()`/`points()` read them, so the authoring surface did not
  move. A program still says `seg.midpoint()`.

**Not done, deliberately: no `M.live` on the prompt surface.** The
generalization is internal. A program has no use for authoring an arbitrary
live value that `M.derived` and `M.claim({predicate})` do not already cover,
and adding one would be exactly the speculative ontology this plan's method
forbids. It goes in when a generation reaches for it and cannot say it.

## Step 3.5 — the second derivative test lesson — **SPENT, gated first attempt**

The engine side was done at step 2.5 and `secondderivative.compose.test.ts`
proved the lesson authorable. This run answered the only question a test cannot:
does the MODEL reach for it? **Yes, and unprompted, on attempt 1.**

```
Field.scalarField → Field.gradient → Field.hessian(f, [0,0])
  → LinAlg.eigen(H) → eig.values[0..1]  (8 uses)  → M.claim ×4
```

It also built the pedagogy sketched below without being told to: a `theta`
parameter rotating the slice direction, `Calc.fn` restricting f to that line,
and the claim narrated as a theorem at the minimum ("this badge never breaks no
matter how you rotate the slice") and broken by hand at the saddle.

**`View.readout(eig.values[0])` is the sharpest result in the whole plan so
far.** That call THREW before step 2.5 fixed the papercut, and the model reached
for it at its first opportunity — so the fix was load-bearing rather than
tidying, and no amount of free testing could have established that. It is the
cleanest instance of this plan's standing pattern: the free tier proves the
engine CAN express a thing, and only a billed run proves the model will reach
for it.

It claimed the `calculus` slot from Green, per `promote.ts` rule 1. That is the
intended one-per-discipline behaviour; git holds the Green example and its
cassette is permanent regardless.


The real test of 2.5 + 3: does a model reach for `Field.hessian` →
`LinAlg.eigen` → `M.claim` unprompted?

Scope it to **R²** and state the Rⁿ generalization in a formula beat — the same
move that scoped Stokes down to Green. Rⁿ is structurally out of reach (every
closure signature is `(x)` or `(x, y)`; `eigen2x2` is literally 2×2) and it is
not what the lesson needs.

The core beat requires no 3D backend: restrict f to a line through the critical
point and let the student rotate the direction. At a **saddle** the 1D slice
visibly flips from bowl-up to bowl-down and the direction where it flips IS the
eigenvector; at a **minimum** it never flips. So "the slice curves upward in
every direction" is a theorem at a minimum and a conjecture the student breaks
at a saddle — the sharpest use of `M.claim` yet.

**Conditional follow-on — contours: RETIRED, do not build.** A level-set view
was gated on this step's evidence, on the rule that *if the slice beat carried
the lesson, the contour view is decoration*. The slice beat carried the lesson —
the model chose it on its own and never reached for a level set. The condition
resolved against building it.

## Step 4 — conversational mode probe

Before the moment graph, because it is mostly **planner-side** work, the engine
barely changes, and it delivers the user-facing "chat affects the scene" win
while narrative is still linear. Split in two so the manifest is tested in
isolation before any write path exists.

### 4a — read-only: answer from the scene — **BUILT, free; exit criterion unspent**

Landed: `packages/render/src/manifest.ts`, `claim.evidence`,
`FOLLOWUP_SYSTEM`/`answerFollowup` in the planner, `POST /api/followup`, and
the browser wiring.

Two findings worth carrying forward, both from building it:

- **There is no registry of minted handles.** `IdRegistry` keeps counters, not
  objects, so a manifest cannot enumerate the world. It does not need to: it
  walks `stage.views` and the timeline, whose step payloads hold the LIVE host
  objects, and reads `.value` off them. Student drags then come for free — a
  drag calls `setValueLive` on the very object the timeline points at, so there
  is no second store and no way for the manifest to disagree with the screen.
  The cost is a real boundary: an object never shown, varied, exposed,
  mentioned or linked is invisible. So is it to the student, which is why that
  is the right boundary for now. Adding `Map<Id, Handle>` to the world is the
  escape hatch if 4b needs it; nothing has yet.
- **The manifest is a DESCRIBER, not a snapshot.** `LessonCanvas` hands up a
  closure, called at the moment of asking. A manifest captured at mount is
  stale by the time anyone has a question about it, which is the whole premise
  of the step.

`claim.evidence` is the honesty fix, and it went in as specified:
`exact-comparison` / `sampled` / `authored-predicate`, carried verbatim into
the manifest. Most of `FOLLOWUP_SYSTEM`'s length is spent on not letting an
authored predicate's opinion be narrated as a proof.

- **Exit criterion, still unspent (BILLED)**: the model correctly answers "why
  did that turn red?" about a student-modified claim, naming existing handles
  from the manifest. What is free to prove — that the dragged value, the
  flipped verdict and the ids all reach the prompt — is proven; if those were
  missing no prompt could rescue the run.

### 4b — write: fragments and events — **BUILT, free; exit criterion unspent**

Landed: `packages/host/src/conversation.ts` (the log, replay, the
transaction), `M.byId`, `lesson.retire`/`lesson.replace`,
`classifyFollowup`, `compileFragment`, `fragmentSystem`/`generateFragment`.

Two findings, both now engine features rather than notes:

- **`host.run` evaluates in the guest GLOBAL scope.** Turn 2 redeclaring
  `const spin` died with a bare `SyntaxError: redeclaration of 'spin'` —
  nothing in it pointing at conversations. The real pipeline never hits it
  because `compileProgram` emits esbuild's `format: 'iife'`, so every turn
  arrives already wrapped; `isolate()` makes that requirement explicit rather
  than incidental. The consequence is the one the design wanted: a fragment
  cannot see earlier bindings, so ids are the only way back.
- **`M.byId` resolves against the manifest's own index**, because 4a already
  established there is no registry of minted handles. That turned out to be
  the right boundary rather than a workaround — a fragment can name what the
  student was shown and nothing else, and cannot resurrect a retired object.

The design points below all survived contact, and the ordering rule earned its
own test: the same fragment with the same drag, before versus after, really are
different worlds.


- **Classify before generating.** A follow-up is one of explain / manipulate /
  extend / revise / explore, and only some of those need generation at all:
  "set a = 0" appends a `set-input` **event**, not a generated fragment — no
  billed call, no gate, no latency.
- Fragment authoring: a prompt variant in `prompts.ts`, append-and-re-execute
  in the app route (determinism makes this fold-the-program, already enforced
  by the linter), `lesson.retire`/`replace` verbs, and the repair loop pointed
  at fragments.
- **The artifact is an ordered log of fragments AND student events, replayed
  in original order.** A turn-2 fragment may be authored *against* the dragged
  value it observed, so applying student state after all fragments is wrong by
  construction. Continuous drags coalesce into one checkpoint event when the
  student asks, saves, or branches — not thousands of pokes.
- On failure, keep the old log: gate the candidate fold headlessly; if it
  rejects, the prior artifact is untouched. That one rule is the whole
  transaction story at this step.
- **Ids are not fragile here — do not add a naming layer.** The linter
  enforces determinism, so the fold of an unchanged program prefix mints
  identical ids every time; appended turns reference turn-1 handles by id
  safely. Ids only shift under mid-log `replace`, so a symbolic
  `publish`/`use` namespace is deferred until conversation cassettes show
  id-references actually failing — it is authoring ceremony, and ceremony
  raises the bar on the product question.
- **Prove**: fragment-level replay cassettes; one recorded multi-turn session
  becomes the first conversation cassette.
- **Exit criterion (BILLED, unspent)**: a three-turn RECORDED session where turn
  2 references a turn-1 handle and turn 3 responds to a student drag — and the
  full log replays from scratch to the same state. The engine half of exactly
  that shape is proven free in `conversation.sandbox.test.ts`, with
  hand-written fragments; what a recording buys is whether a MODEL writes them.

**Not wired into the app yet**, deliberately. `/api/followup` is the read-only
route from 4a; a write route wants the classifier, the fragment pass and the
log to be exercised by a real recorded session first, and that is billed. The
pieces are all exported and tested.

### 4c — the agentic turn: the scene as an instrument, not a snapshot — **BUILT free; exit criterion SPENT, passed**

4a and 4b are one-shot in both directions: the model answers from a manifest
it cannot interrogate, and someone must pick the read prompt or the write
prompt *before* the model has seen the question. Both limits are the same
limit. A follow-up turn becomes a **tool loop**: one conversational call, the
scene exposed as typed tools, the model choosing its own acts. What 4a/4b
built does not change — it becomes the tool implementations.

The tools, and the machinery each one is a thin RPC over:

- **Read probes.** `inspect(id)` — the full structured value of ONE object
  (matrix entries, loop vertices), so the manifest itself stays terse;
  `evalAt(id, args)` — sample a field or function handle at a point;
  `whyChanged(id)` — the dependency path from a verdict or derived value back
  to the inputs that moved, read off the reactive graph. This is the
  provenance machinery finally reaching the model: "why did that turn red?"
  answered causally instead of narrated plausibly.
- **Experiment probes — where determinism pays out.** `state = fold(log)`, so
  the host can fold a CANDIDATE log headlessly and throw it away —
  `commitEntry` already does exactly this to gate writes. Exposed as a tool it
  is a counterfactual: "would claim#2 still hold at k = 5?" runs in a
  disposable fold, reports, discards. The host can even BISECT the parameter
  value where a claim flips and hand back the exact threshold — a fact no
  snapshot could contain. The model must never do arithmetic the engine can
  do; scratch folds make the engine the model's calculator, grounded in the
  actual scene objects.
- **Write acts.** `appendFragment(source)` — the 4b pipeline as a tool; the
  gate runs on the argument and a rejection returns as the tool error, so the
  repair loop stops being separate machinery and becomes ordinary tool-retry.
  `setInput(id, value)` — the event path. `classifyFollowup` survives as the
  free fast path in front: a turn it decides never reaches the model at all.

What this dissolves: the explain/extend/revise/explore split stops being a
routing problem — explain is a turn that used only read tools, extend is one
that appended, and a mixed turn ("set k to 3 and show me why that breaks it")
is just a turn: an event, a fragment, and prose, in one loop. Nothing
pre-classifies what the model can decide with the tools in hand.

Two cheap manifest-side fixes ride along, because they are what the first
probes will reach for:

- **Feed the transition, not just the state.** The coalesced `set-input`
  events since the last question, plus which claims flipped, go into the
  brief. "Why did that turn red" is a question about a TRANSITION, and today
  the manifest only describes now.
- **Carry the plan into the conversation.** The plan's `summary` and per-beat
  `claim`s are the lesson's argument structure, and they are discarded after
  generation. Persist them in the artifact and inject them — the follow-up
  model currently sees the narration but not the reasoning the lesson was
  built from.

**The free half landed as specified** — the tool layer in
`packages/host/src/tools.ts` (typed calls, errors as data, resolution and
folding as injected hooks), the driver in `packages/planner/src/loop.ts`
behind the existing `ModelClient` seam, `toolLoopSystem` sharing the
evidence-honesty and fragment rules with the 4a/4b prompts by construction,
and loop cassettes that replay the model half while RE-EXECUTING the tools
live, so drift comes back as named data. Findings from building it, each now
an engine fact rather than a note:

- **The reactive graph already retained edges** — `whyChanged` needed one
  query method (`dependsOn()`), not a rewrite. The stated flip side: edges
  describe the current value, so a branch not taken is not a dependency.
- **The first sandbox probe found a real engine bug**: `View.field` and
  `View.heatmap` never projected their subject, so a full-screen field was
  absent from the manifest and `inspect` answered unknown-id about the biggest
  thing on screen. Invisible to every existing test; fixed. That is the probe
  methodology paying for itself before any money moved.
- **Tool calls travel as text** (fenced json, fragment source in a sibling
  `ts` fence) because `ModelClient.complete` is string→string — which is
  exactly what keeps loop cassettes on the same replay-by-call-order
  machinery as generation cassettes.
- **`Math.random` is a lint WARNING, not a gate error** — a fragment reaching
  for it gates successfully and will not trigger tool-retry. Left as is;
  worth revisiting if a recorded fragment ever actually does it.

**Exit criterion (BILLED) — SPENT, passed on the single run.** Cassette:
`packages/planner/src/loop-cassettes/why-red-spin.json`; the drag pushes
`spin` 1 → 1.8 past the claim `2·spin ≤ 3`. Asked "why did that turn red?",
the model probed before narrating, unprompted: `whyChanged(claim#1)` first
(the chain claim → gap → doubled → spin), then `bisectFlip` using the
manifest's range as bounds, and the prose names **spin = 1.5** read off the
returned bracket — the true threshold, not a guess. Three model calls, no
malformed rounds, no ignored tools. Evidence honesty held ("just barely
still holds" matches `holdsAtLo` exactly; every number in the prose came
from a tool result), which answers 4a's subsumed criterion in the same
recording. Replay of the cassette against a fresh fold shows zero drift, and
`loop-replay.test.ts` now runs it in the standard free suite.

Two findings the run bought:

- **The model omits `maxProbes`**, so bisection ran 40 disposable folds
  tightening the bracket to ~5e-10 — prose needs ~1e-3. The fix is the
  engine's, not the prompt's: lower `BISECT_DEFAULT_PROBES` in `tools.ts`.
- **Watch-item, not a defect**: the prose extrapolated "1.5 or below turns it
  green again" from two bracket ends — monotonicity that happens to hold
  here. A non-monotone scene is the test of whether the honesty rules need a
  word about it.

## Step 5 — moment graph + ask-verbs — **BLOCKED ON EVIDENCE, correctly**

Last, deliberately: it is the biggest player/render change, it raises authoring
complexity (the exact thing the product question punishes), and by now step 4
will have taught us what navigation the narrative layer actually needs. Beats
become the degenerate linear path; ask-verbs (predict, place, author, hunt)
ride on the same input machinery.

**It is still not startable, and that is the plan working rather than failing.**
The two runs spent so far were 2.6 and 3.5, neither of which touches
conversation. Step 4 was built entirely in the free tier, so its premise — "step 4 will have taught
us what navigation the narrative layer actually needs" — is satisfied by
construction and not by evidence. Nobody has held a conversation with this
engine yet. Building a moment graph now would be ontology ahead of evidence,
which is the one thing this plan's method forbids, and it would be the most
expensive possible instance of it: a player/render rewrite justified by a guess
about branching nobody has tried to do.

The ask-verbs are the same story one size smaller. They are cheap — the judge
shape already exists in `compareExperiment` — but no lesson has asked for one,
so which verb to build first is unknown.

**What unblocks it**: the 4b exit criterion. A recorded multi-turn session will
show where a student actually wanders off the narrated path, and *that* is the
navigation the moment graph has to serve.

## Where the plan now stands

Everything reachable without spending money is done: steps 1, 2, 2.5, 3, 4a,
4b and 4c's whole free half (tools, loop, cassette replay), all in the free
tier. What is left beyond that is the queued generations, which are now the
ONLY source of the evidence the remaining work needs:

| run | what it answers | state |
| --- | --- | --- |
| **2.6** Green | does the model reach for `Field.*`? | **spent** — yes, gated attempt 1. Finding: the corpus, not the reference, is what adopts a new option |
| **3.5** 2nd derivative test | does it reach for `hessian` → `eigen` → `claim`? | **spent** — yes, gated attempt 1, and it built the slice-rotation lesson unprompted |
| **4a** exit | does it answer from a manifest without overstating a verdict? | **answered by 4c's recording** — evidence honesty held; no separate spend |
| **4b** exit | does it write a FRAGMENT rather than a whole program? | queued — and this one unblocks step 5 |
| **4c** exit | does it PROBE before narrating — `whyChanged`/counterfactual, then prose? | **spent** — yes, first try: `whyChanged` → `bisectFlip`, named the true threshold off the bracket |

Each becomes a permanent free cassette. The pattern holds throughout, and 3.5
is its cleanest instance yet: the free tier proves the engine can express a
thing, and only a billed run proves the model will reach for it — the
`eig.values[0]` papercut fixed at 2.5 was the first thing the model touched.

**Both spent runs gated on attempt 1**, which is worth noticing on its own: the
repair loop was not exercised by either, so nothing here says whether the
current gate messages are still actionable. 4c's run kept the streak — no
malformed rounds, no fragment, so no retry either. The next failed recording
is still the one that buys that. (The gate-rejection-then-retry PATH is
proven, but only against a scripted model, in `loop.sandbox.test.ts`.)

## Cost accounting

Steps 1, 2, 2.5, 3, 4a, 4b and 4c's free half were all delivered in the free
tier. **Three billed runs have now been spent — 2.6, 3.5 and 4c — and all
three succeeded on the first attempt.** Letting the free work run ahead keeps
paying: 4c's single turn answered its own exit criterion AND 4a's, and cost
three model calls because everything around them was already proven free.

One generation remains queued: the exit criterion of **4b** — the three-turn
recorded session, which unblocks step 5 and is now the only spend left before
it. Step 1's `record` stays deferred as the weakest spend.

That is roughly 4–5 billed generations across the whole plan, each becoming a
permanent free cassette. No `gate` runs except at step boundaries.
