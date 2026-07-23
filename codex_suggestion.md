# Suggested plan — from lesson programs to conversational math artifacts

**Status: design proposal, not a commitment.**

## Outcome

Keep TypeScript programs and LLM-authored closures as the expressive math
language, but stop treating one monolithic program as the whole artifact.

The durable artifact should become an **inspectable, replayable, revisioned
event log** containing program fragments, student interactions, presentation
state, and conversational edits. This gives the model both things it needs:

1. flexible code for constructing mathematical behavior;
2. a stable protocol for understanding and changing what it already created.

## What is missing today

The current engine has the right kernel: stable handles, reactivity,
correspondence, provenance, traced processes, claims, and sandboxed execution.
The weak point is the boundary between that runtime and later LLM turns.

- The live `World`, `Stage`, and QuickJS VM stay inside the browser canvas. A
  follow-up request sends only a new question, so the model cannot see the
  scene it is discussing.
- IDs exist, but there is no registry that enumerates every object together
  with its label, value, dependencies, domain, capabilities, and lifecycle.
- Re-executing the program restores authored definitions but loses student
  state such as dragged parameters.
- Generated IDs depend on construction order and are too fragile for durable
  cross-turn references.
- Closures contain mathematical behavior but are opaque to inspection.
- The timeline remains the main organizational structure, so the product still
  behaves like a sequence of slides over a world rather than a persistent world
  with multiple explanatory paths.
- `Claim` can display a live verdict, but it does not yet expose assumptions,
  quantification, evidence, or whether its status is exact, sampled, or simply
  judged by an authored predicate.

## Proposed artifact model

Separate four kinds of state:

1. **Definition state** — mathematical objects, functions, relations, claims,
   views, and authored processes.
2. **Session state** — current parameter values, student-created objects, and
   meaningful interaction checkpoints.
3. **Presentation state** — current moment, visibility, focus, camera, active
   processes, and enabled interactions.
4. **Conversation state** — user questions, model answers, object references,
   revisions, and branches.

A conceptual artifact envelope:

```ts
interface Artifact {
  id: string;
  revision: number;
  events: ArtifactEvent[];
  exports: Record<string, ObjectRef>;
  session: {
    currentMoment?: string;
    selected: ObjectRef[];
    inputs: Record<string, SerializableValue>;
  };
}

type ArtifactEvent =
  | { type: "fragment"; id: string; source: string }
  | { type: "set-input"; target: ObjectRef; value: unknown }
  | { type: "student-object"; spec: unknown }
  | { type: "replace-fragment"; target: string; source: string }
  | { type: "retire"; target: ObjectRef }
  | { type: "navigate"; moment: string };
```

Events must replay in their original order. For example:

```text
turn-1 fragment creates a field and parameter
student sets the parameter to -1
turn-2 fragment observes -1 and explains the reversal
```

Applying student state only after all fragments run would be incorrect because
later fragments may have been authored in response to that state. Continuous
pointer movement does not need to become thousands of events; coalesce it into
one checkpoint when the student asks a question, saves, or branches.

## Semantic registry and scene manifest

Every constructor should register an inspectable record for the object it
creates. At minimum:

```ts
interface ObjectDescriptor {
  ref: string;                  // durable symbolic reference
  id: string;                   // runtime identity
  kind: string;
  label?: string;
  description?: string;
  createdBy: string;            // fragment/event id
  capabilities: string[];
  dependencies: ObjectRef[];
  relations: RelationDescriptor[];
  currentValue?: ValueSummary;
  domain?: ObjectRef;
  lifecycle: "active" | "retired";
}
```

Do not attempt to JSON-serialize every arbitrary `Live<T>`. Each kind should
provide a bounded value serializer and a list of supported queries. A vector
field manifest should summarize its domain, dependencies, and current regime;
the model can request point evaluations separately.

The manifest should contain semantic state, not DOM state or raw SVG. Spatial
metadata such as bounds and anchors may be included when it helps reference
what the student sees.

## Durable cross-turn references

Generated IDs may remain useful internally, but fragments should publish
stable symbolic names:

```ts
artifact.fragment("turn-1", ({ publish }) => {
  const strength = M.parameter("strength", 1, { range: [-2, 2] });
  const field = Field.vectorField((x, y) => [
    -strength.value * y,
    strength.value * x,
  ]);

  publish("main.strength", strength);
  publish("main.field", field);
});
```

Later fragments import those names rather than depending on lexical variables
or generated construction-order IDs:

```ts
artifact.fragment("turn-2", ({ use, publish }) => {
  const field = use("main.field");
  const curl = Field.curl(field);
  publish("main.curl", curl);
});
```

Fragment-local scope avoids variable collisions. Publishing can also assign a
stable runtime ID derived from `(fragment id, local export name)`.

## LLM inspection and mutation interface

Give the model a compact manifest plus query tools instead of placing the
entire scene and full API reference in every prompt.

Read operations:

- `scene.list({ kind, visible, changedSince })`
- `scene.get(ref)`
- `scene.resolve(name)`
- `scene.dependencies(ref)`
- `scene.relations(ref)`
- `scene.evaluate(ref, args)`
- `scene.trace(ref)`
- `scene.capabilities(ref)`
- `scene.currentState()`

Write operations:

- `artifact.setInput(ref, value)`
- `artifact.addFragment(fragment)`
- `artifact.replaceFragment(id, fragment)`
- `artifact.retire(ref)`
- `artifact.addMoment(moment)`
- `artifact.applyPatch(patch)`
- `artifact.previewPatch(patch)`

Every mutation should be transactional:

- include the artifact `baseRevision`;
- declare imported objects and expected kinds;
- lint and execute headlessly before commit;
- compute a semantic diff;
- commit atomically or roll back completely;
- return diagnostics with valid alternatives.

Whole-artifact replay is acceptable initially. Incremental execution is an
optimization, not a prerequisite.

## Conversational response modes

Do not generate a new program for every follow-up. First classify the requested
operation:

- **Explain** — answer from existing objects without mutation.
- **Manipulate** — change an existing parameter, selection, or focus.
- **Extend** — add a view, claim, process, or explanatory moment.
- **Revise** — replace an existing definition or explanation.
- **Explore** — create a branch or counterexample while preserving the
  original.

Examples:

- “Why did that turn red?” inspects the broken claim and answers in prose.
- “Set `a = 0`” appends a `set-input` event; it needs no generated fragment.
- “Show why the interior edges cancel” adds a process or moment linked to the
  existing tiling.
- “Try a nonlinear field” creates a branch or replaces the field fragment.
- “Compare both fields” preserves the original and adds another
  representation.

Rendered references in an answer should remain live: clicking a mentioned
object focuses it in the scene, using the existing identity/correspondence
machinery.

## Scenes and moments

The persistent mathematical world should be primary. A moment is a lens over
that world, specifying:

- narration;
- visible and focused objects;
- active view or camera;
- enabled student interactions;
- running processes;
- available branches.

Transitions animate the difference between moments. Mathematical objects do
not need to be recreated merely because the narrative moved.

Narrative time, process time, and deformation time should remain independent:

- narrative time chooses the current moment;
- process time controls an algorithm or construction;
- deformation time controls a scrubbable parameterized path.

The existing beat timeline becomes the degenerate linear form of a moment
graph, not a competing system.

## Inspectable mathematical semantics

Closures should remain executable, but constructors should wrap them in
descriptors:

```ts
Field.vector({
  name: "rotationField",
  domain: region,
  dependsOn: [strength],
  description: "counterclockwise rotation with adjustable strength",
  evaluate: (x, y) => [-strength.value * y, strength.value * x],
});
```

This makes the rule queryable without trying to serialize its code or infer
its meaning later.

Claims should grow to record:

- a structured statement;
- referenced objects and domain;
- assumptions and quantifiers;
- evidence links to constructions, processes, and other claims;
- current witnesses or counterexamples;
- status provenance such as `exact-comparison`, `sampled`,
  `authored-predicate`, or `unverified`.

This does not require a theorem prover or CAS. It prevents a sampled predicate
from being presented as though it were a proof and gives the conversational
model concrete evidence to discuss.

## Phased delivery

### Phase 1 — general live values

Finish `Live<T>` and migrate numeric-only reactivity. Define bounded
serialization and equality policies for common values such as booleans,
vectors, points, arrays, and geometry.

**Exit:** a live point/vector/boolean can be inspected and survives a reactive
update without view-specific resampling logic.

### Phase 2 — registry and introspection

Add the semantic object registry, descriptors, capability metadata, dependency
queries, and scene-manifest serializer.

**Exit:** a deterministic headless test can answer “what exists?”, “what is
currently visible?”, “what depends on this parameter?”, and “which claim is
broken?” without knowing program-local variable names.

### Phase 3 — durable session state

Represent student mutations as replayable events and expose artifact snapshots
from the canvas.

**Exit:** drag a parameter, rebuild or navigate backward, and recover the same
current state. A manifest sent to the server contains the dragged value.

### Phase 4 — read-only conversational probe

Send the current manifest with follow-up questions. Allow the model to inspect
objects and answer without modifying the artifact. Render object references as
clickable/focusable mentions.

**Exit:** the model correctly answers a question about a student-modified claim
and names the relevant existing handles.

### Phase 5 — fragment event log

Introduce isolated fragments, `publish`/`use`, stable names, fragment-level
linting, and full-log replay.

**Exit:** turn 1 creates an object, the student drags it, turn 2 references it
by export name and extends the scene, and the complete artifact replays from
scratch identically.

### Phase 6 — transactional revision

Add revision checks, preview/diff, replacement, retirement, rollback, and
fragment repair.

**Exit:** a failed follow-up leaves the previous artifact untouched; a valid
replacement updates all dependents and preserves unrelated objects and state.

### Phase 7 — moments and branching

Promote beats into persistent moments, add branches, and separate process and
deformation clocks from narrative navigation.

**Exit:** the student can branch into a counterexample or alternate
representation, return to the original path, and keep both artifacts coherent.

### Phase 8 — richer claims and evidence

Add domain-scoped and quantified claims, status provenance, evidence links, and
addressable witnesses/counterexamples.

**Exit:** the model can explain why a claim currently holds, disclose whether
the evidence is exact or sampled, and focus the construction that supports it.

## Design constraints

- Preserve the current identity, correspondence, reactivity, provenance, and
  sandbox boundaries.
- Keep the authoring kernel small; discipline libraries remain thin
  instantiations over it.
- Keep a geometry escape hatch, but require escape-hatch objects to register
  handles, descriptors, anchors, and capabilities. Raw DOM/SVG should not
  become the source of truth.
- Prefer inspection and explicit protocols over asking the model to reconstruct
  state from old source code.
- Never silently discard prior artifact state when a follow-up fails.
- Label authored, numerical, sampled, and verified mathematical knowledge
  honestly.
- Continue using probe-driven development: each phase must be justified by a
  concrete conversational example and captured as a replay cassette.

## First concrete probe

Use an existing Green's theorem artifact:

1. Generate the field, oriented region, tiling, circulation, and live claim.
2. Drag the field parameter until orientation or sign changes.
3. Ask: “Why did the circulation change sign?”
4. Answer by inspecting the existing parameter, field, loop orientation,
   circulation, and claim—without generating a new lesson.
5. Ask: “Show the cancellation again, but for the current field.”
6. Append one fragment that adds a new explanatory moment using the existing
   field and tiling.
7. Replay the complete artifact from scratch and assert that the dragged state,
   object references, new moment, and claim status all agree.

This single probe tests observation, durable references, interaction replay,
read-only reasoning, fragment extension, and deterministic reconstruction—the
minimum credible definition of a conversational mathematical scene.
