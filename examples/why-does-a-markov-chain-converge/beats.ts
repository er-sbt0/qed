/**
 * Why a Markov chain converges to a stationary distribution.
 * Six beats: introduce the chain, one step = multiply by P, iterate,
 * two starts merge, the fixed point, and the contraction that explains it all.
 */

lesson.beat("A walker roams the states");

const S = Prob.states(["A", "B", "C"]);

// irreducible, aperiodic transition matrix — rows sum to 1
const P = Prob.stochasticMatrix({
  states: S,
  values: [
    [0.5, 0.3, 0.2],
    [0.2, 0.6, 0.2],
    [0.3, 0.3, 0.4],
  ],
  editable: "renormalize-row",
});

const chain = Prob.markovChain({ states: S, transitions: P });

const matrixView = View.matrix(P);
const graph = View.stateGraph(chain, { edgeLabels: "probability" });

const start = Prob.distribution(S, { A: 1, B: 0, C: 0 });
const massSlot = M.slot(start);
const graphMass = View.stateGraph(chain, { mass: massSlot });
const bars = View.bars(massSlot, { label: "mass over states" });

lesson.show(Layout.columns([matrixView, graph]));
lesson.say`A walker roams three states ${S.state("A")}, ${S.state("B")}, ${S.state("C")}. The arrows of ${matrixView} give the chance of hopping between them, and every row of ${matrixView} sums to 1.`;

lesson.show(Layout.columns([graphMass, bars]));
lesson.say`A distribution is a vector of probability mass sitting on the states. Right now all of it starts piled on ${S.state("A")} — this is ${bars}.`;

lesson.beat("One step is multiply by P");

const fwd = F.tex`${F.span("v", "v")} \mapsto ${F.span("v", "v")}${F.span("op", "P")}`;
lesson.show(View.formula(fwd));
lesson.link(fwd.span("op"), matrixView, "represents");
lesson.say`One step of the chain is one multiplication by ${matrixView}: ${fwd}. Each pile of mass splits along the outgoing arrows and lands on the next states.`;

const afterOne = chain.step(massSlot.peek());
massSlot.set(afterOne, { via: "derivation" });
lesson.say`After a single step the mass on ${S.state("A")} has spread out toward ${S.state("B")} and ${S.state("C")} — you can watch it travel along the edges into ${bars}.`;

lesson.beat("Step again and again");

lesson.say`Keep applying ${matrixView}. Each step redistributes the mass again — but the changes get smaller and smaller as the distribution settles.`;
lesson.cascade(M.range(6), () => {
  massSlot.set(chain.step(massSlot.peek()), { via: "derivation" });
});
lesson.focus(bars, { emphasize: "stillness" });
lesson.say`By now ${bars} barely moves from one step to the next — the distribution is homing in on a fixed shape.`;

lesson.beat("Two starts, same destination");

const startU = Prob.distribution(S, { A: 1, B: 0, C: 0 });
const startV = Prob.distribution(S, { A: 0, B: 0, C: 1 });
const slotU = M.slot(startU);
const slotV = M.slot(startV);

const barsU = View.bars(slotU, { label: "start on A" });
const barsV = View.bars(slotV, { label: "start on C" });

lesson.show(Layout.columns([barsU, barsV]));
lesson.say`Take two very different starts: all mass on ${S.state("A")} versus all mass on ${S.state("C")}. Apply ${matrixView} to both, step for step, and watch what happens.`;

lesson.parallel(() => {
  lesson.cascade(M.range(7), () => {
    slotU.set(chain.step(slotU.peek()), { via: "derivation" });
    slotV.set(chain.step(slotV.peek()), { via: "derivation" });
  });
});
lesson.focus([barsU, barsV], { emphasize: "agreement" });
lesson.say`Though ${barsU} and ${barsV} began at opposite corners, each step of ${matrixView} nudges them toward the same evolving shape — the destination does not depend on where you started.`;

lesson.beat("The distribution stops moving");

const pi = Prob.stationary(chain);
const piBars = View.bars(pi, { label: "\\pi" });

const fixed = F.tex`${F.span("pi", "\\pi")} ${F.span("op", "P")} = ${F.span("pi", "\\pi")}`;
lesson.show(Layout.columns([View.formula(fixed), piBars]));
lesson.link(fixed.span("op"), matrixView, "represents");
lesson.link(fixed.span("pi"), piBars, "represents");
lesson.say`Both histories lock onto one vector ${piBars}: the balance point where pushing through ${matrixView} changes nothing, ${fixed}. At ${piBars} the inflow to each state exactly equals its outflow — it is the eigenvector of ${matrixView} with eigenvalue 1.`;

lesson.beat("P contracts the gap");

const gap = M.derived(() => {
  const u = slotU.value;
  const v = slotV.value;
  return S.items.reduce((acc, s) => acc + Math.abs(u.mass(s) - v.mass(s)), 0);
}, "\\|u-v\\|");

const gapReadout = View.readout(gap, { label: "distance between the two" });
lesson.show(Layout.stack([Layout.columns([barsU, barsV]), gapReadout]));
lesson.say`Here is the essence. Track the distance ${gap} between the two runs. Because ${matrixView} spreads and blends mass across connected, aperiodic states, ${matrixView} is a contraction: ${gap} strictly shrinks every step.`;

lesson.cascade(M.range(6), () => {
  slotU.set(chain.step(slotU.peek()), { via: "derivation" });
  slotV.set(chain.step(slotV.peek()), { via: "derivation" });
});
lesson.focus(gapReadout, { emphasize: "agreement" });
lesson.say`No matter how far apart they began, ${gap} is crushed toward zero — every initial difference is forgotten, so all starting vectors collapse onto the single fixed point ${piBars}.`;

// Now YOU steer it: edit a transition probability and watch pi relocate live.
lesson.expose(matrixView, { as: "sliders" });
lesson.say`Drag any cell of ${matrixView} — each row rescales to stay stochastic — and watch ${piBars} settle onto a new stationary distribution. The contraction still erases the start; only the destination moves.`;
