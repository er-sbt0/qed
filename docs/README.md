# docs — what is here, and whether to believe it

`CLAUDE.md` at the repo root is the live entry point: how the loop works, where
to change things, which commands cost money. Nothing in this directory replaces
it, and where a document here disagrees with `CLAUDE.md` or with the code,
`CLAUDE.md` and the code win.

Everything below is either **current** (describes the system as it is, and is
worth reading before a design change) or **historical** (kept for the reasoning
that produced the current design — never as a description of it, and never as a
backlog). Archived files are not maintained; their stale claims are listed here
rather than edited into them, because a design document rewritten after the fact
stops being a record of why anything was decided.

## Current

| file | what it is |
| --- | --- |
| `architecture.md` | The engine architecture: the two-tier vocabulary, the semantic-object model, the lesson-program boundary, the sandbox, beats/seek, and the conversational layer (scene manifest, authoring log). **Read this before changing anything structural.** One caveat: it cites `spikes/{markov,myhill-nerode,ftc,determinant}/` throughout — that directory is now `examples/`, same programs, and per `CLAUDE.md` they are prompt input that may be freely rewritten, which the doc's "acceptance test" framing predates. It also refers to a saved-lesson corpus that no longer exists. |
| `renderer-backends.md` | A design note on the renderer backend seam — whether `packages/render` should sit on JSXGraph or stay hand-cut. **Step 1 (seam extraction: `applyState`/`dispose`/`capabilities`) is implemented; no second backend has been ported.** Its argument stands; its closing appeal to "the corpus stays valid" refers to saved generated lessons that have since been deleted. |
| `object-layer.md` | The companion decision for the SEMANTIC layer: factor the four discipline packages into shared core primitives, which disciplines to build next and in what order, and why the math stays LLM-trusted. **A direction, not an implementation** — nothing past its step 1 is scheduled. |
| `probe-algebra.md` | The result of that note's step 2: the dihedral-group example (`examples/dihedral/`) built entirely on existing automata primitives, with the friction ledger — what was free, what was awkward, which affordances are genuinely missing. **The factoring thesis held; no engine code was added.** |
| `vision.md` | The engine from first principles: which primitives are load-bearing (identity/correspondence, reactivity, traced provenance, LLM-authored closures), the four things that are too small (scalar-only reactivity, no notion of space, one conflated timeline, show-only verbs), the Claim primitive, and the three modes — lecture, explorable world, conversational — on one deterministic substrate. Ends with the Stokes/Green probe scoped for the present engine. **Still a direction, but no longer untouched: `Live<T>` and the Claim are built, the conversational mode is built, `Space` was deliberately shrunk to "a region owns its domain" on the vector probe's evidence, and the moment graph and ask-verbs remain unscheduled.** |
| `roadmap.md` | The sequenced first steps toward `vision.md`: Claim → vector-calculus probe → `Live<T>` → conversational mode → moment graph, each shippable alone and producing the evidence the next consumes. **Steps 1–4b are built, entirely in the free tier. Step 5 is deliberately blocked: its premise was that step 4 would teach it what navigation to build, and step 4 was proven by tests rather than by a conversation anyone held.** Read its "Where the plan now stands" table before spending a billed run. |
| `probe-vector.md` | The result of `roadmap.md` step 2, the vector-calculus probe: `packages/library/src/field.ts` (fields, curl, oriented loops, circulation in both stances, the curl probe, the shared-edge tiling) and its friction ledger. **No new idiom was needed — every piece landed on an existing pattern. Its recommendation deliberately shrinks `vision.md`'s `Space`: do `Live<T>` next, and extract only an oriented region that owns its domain.** |
| `probe-graphs.md` | The result of step 3, the first extraction allowed to move engine code: the `Graph` core (`packages/library/src/graph.ts` — traced walks/BFS/Kruskal, the structure map, undirected rendering), the `examples/mst/` lesson, and what automata and graphs turned out to actually share (`structure.ts`). **The shared-cores direction holds, with a corrected shape: the cores are mostly kernel protocols, not movable library code. d3-force was not needed.** |
| `projects/` | Forward-looking **direction** docs for the product bets, pursued as divergent stacks under three shared decisions (divergent stacks · keep CAS out · stateless POC). `projects/README.md` indexes five directions and their chosen directions; `projects/mathcopilot.md` is the one deep design (the flagship — the 4c loop promoted to a co-edited math workspace). **Plans, not descriptions — nothing here is built, and the four non-flagship entries are provisional briefs.** |

## Historical

| file | what it was, and what is false in it now |
| --- | --- |
| `archive/plan.md` | The step-navigation worklog (beats, seek, the 0ms fast-forward contract) plus a long session record of runtime traps and gate mistakes. Most of it shipped and the design reasoning was lifted into `architecture.md`. Its *evidence* is worth keeping — several entries are careful accounts of a belief that survived until someone measured it. Its *instructions* are not: it assumes an eight-lesson saved corpus, `./run.sh corpus`, a `remount` that replays saved generations, and programs (`cauchy-schwarz`, `dot-product`, `mvt`) that no longer exist. Its open items — pacing, the `as any` lint rule, two accepted behavioural gaps — are real but were never scheduled. |
| `archive/changes.md` | A pre-pivot robustness plan, already carrying its own superseded banner. It describes a validated-JSON `SceneSpec` pipeline the repo does not have, and argues "fail fast, no repair" — the exact inverse of `generate.ts`, which gates and repairs once. Kept because the instinct underneath it (a tight contract beats cleaning up bad output) is why repair is capped at one attempt. |
| `archive/options.md` | The three-way choice for how the model expresses a visualization: declarative spec, incremental tool calls, or sandboxed generated code. Reads as undecided; it is not. **Option 3 won** and is the whole architecture. One screenshot's worth of context for why the other two were live options. |
| `new_architecture/` | The source material `architecture.md` was written against: an external guidelines document (v0.2) and four worked explanation examples. Historical input, not a plan — `architecture.md`'s closing section explains at length why its §7 feature taxonomy must be read as a menu of what becomes expressible rather than as a build list. It keeps its path rather than moving under `archive/` because `examples/*/beats.ts` and `examples/*/api.ts` cite these files by name, and a comment pointing at nothing is worse than a directory whose name has aged badly. |
