/**
 * Bipartite iff no odd cycle. One idea, seen twice: coloring is FORCED along
 * every edge (each step flips), so a cycle only comes home to a consistent
 * color when its length is even. We split the dots, color by distance parity,
 * walk an even loop that closes cleanly and an odd loop that clashes at the
 * seam, then hand the student a chord to drag in and out — the odd cycle
 * appearing IS the moment bipartiteness dies.
 */

lesson.beat("Split the dots in two");

// a bipartite skeleton: a clean 6-cycle, every edge crossing between sides
const g = Graph.graph({
  nodes: ["A", "B", "C", "D", "E", "F"],
  edges: [
    ["A", "B"],
    ["B", "C"],
    ["C", "D"],
    ["D", "E"],
    ["E", "F"],
    ["F", "A"],
  ],
});
const gView = View.graph(g, { edgesMode: "deferred", weights: "none" });
lesson.show(gView);
lesson.demonstrate(g, { pace: { start: "slow", end: "fast" } });
lesson.say`A graph is BIPARTITE when its vertices split into two sides — call them black and white — so that every single edge crosses between the sides. No edge is allowed to join two vertices of the same color. Here is a ring of six; the question is whether we can two-color it under that rule.`;

lesson.beat("Color by distance from home");

// BFS from A: the discovery layering IS distance, and distance parity is
// exactly what will decide each vertex's color
const layer = Graph.bfs(g, { from: "A" });
lesson.demonstrate(layer, { pace: { start: "slow", end: "medium" } });
lesson.say`We are not free to choose colors independently: the moment we color ${g.node("A")} black, every neighbour is forced white, and their neighbours flip back to black. So sweep outward from ${g.node("A")} with a breadth-first search. Each step of distance flips the color, which means a vertex is black or white purely by whether its distance from ${g.node("A")} is even or odd — a coloring by PARITY.`;

lesson.beat("Walk a cycle, flip each step");

// walk the 6-cycle edge by edge and count the flips
const evenLoop = Graph.walk(g, { path: ["A", "B", "C", "D", "E", "F", "A"] });
lesson.demonstrate(evenLoop, { pace: { start: "slow", end: "medium" } });
const parity = F.tex`${F.span("start", "\\text{start}")}\;\xrightarrow{\;${F.span("len", "6")}\text{ flips}\;}\;${F.span("end", "\\text{opposite}")}`;
const parityView = View.formula(parity);
lesson.show(parityView);
lesson.link(parityView.formula.span("len"), evenLoop, "represents");
lesson.say`Now trace any cycle and watch the color. Every edge you cross flips it — black, white, black, white — so after walking ${evenLoop} edges you have flipped exactly that many times. Whether you come home to the same color or the opposite one depends only on whether the number of flips is even or odd.`;

lesson.beat("Even trip lands back home");

lesson.focus(evenLoop, { emphasize: "agreement" });
lesson.say`This loop has six edges: six flips. Black, white, black, white, black, white — the sixth flip lands us on the OPPOSITE color of ${g.node("A")}, and the closing edge ${g.edge("F", "A")} joins two different colors. An even cycle closes cleanly: no rule broken, the two-coloring survives.`;

lesson.beat("Odd trip breaks the color");

// add a chord A-C so A-B-C-A is a 3-cycle: an ODD loop
const gOdd = Graph.graph({
  nodes: ["A", "B", "C", "D", "E", "F"],
  edges: [
    ["A", "B"],
    ["B", "C"],
    ["C", "D"],
    ["D", "E"],
    ["E", "F"],
    ["F", "A"],
    ["A", "C"],
  ],
});
const gOddView = View.graph(gOdd, { edgesMode: "deferred", weights: "none" });
lesson.hide(gView);
lesson.hide(parityView);
lesson.show(gOddView);
lesson.demonstrate(gOdd, { pace: { start: "slow", end: "fast" } });
const oddLoop = Graph.walk(gOdd, { path: ["A", "B", "C", "A"] });
lesson.demonstrate(oddLoop, { pace: "slow" });
const oddParity = F.tex`${F.span("start", "\\text{start}")}\;\xrightarrow{\;${F.span("len", "3")}\text{ flips}\;}\;${F.span("end", "\\text{same!}")}`;
const oddView = View.formula(oddParity);
lesson.show(oddView);
lesson.link(oddView.formula.span("len"), oddLoop, "represents");
lesson.focus(gOdd.edge("A", "C"), { emphasize: "disagreement" });
lesson.say`Add a chord ${gOdd.edge("A", "C")} and the triangle ${g.node("A")} → B → C → back is a cycle of length three. Three flips: black, white, black — and the closing edge ${gOdd.edge("A", "C")} must now join a BLACK vertex to a BLACK vertex. The rule forbids it. An odd cycle forces start and end to the SAME color, so some edge is monochromatic and NO valid split can exist.`;

lesson.beat("No odd cycle, clean split");

// converse: strip the chord back out — with no odd cycle the parity coloring
// from beat 2 IS a genuine 2-coloring
lesson.hide(gOddView);
lesson.hide(oddView);
lesson.show(gView);
lesson.demonstrate(Graph.bfs(g, { from: "A" }), { pace: { start: "medium", end: "fast" } });
lesson.say`Run the argument backwards. Suppose there is NO odd cycle. Color every vertex by distance-parity from ${g.node("A")}. Two same-colored vertices could only be joined by an edge if walking out to one and back from the other closed an ODD loop — and we assumed there are none. So the parity coloring never clashes. No odd cycle means the split always works, and both directions meet: a graph is bipartite exactly when it has no cycle of odd length.`;

// the student's dial: grow the chord A-C in and out. The claim re-runs the
// forced coloring every time — with the chord out it holds, slid in the
// triangle makes it unsatisfiable and the badge flips. THAT flip is the
// counterexample, found by the student's own hand.
const chord = M.parameter("chord present (0=out, 1=in)", 0, { range: [0, 1] });
const ring = [["A", "B"], ["B", "C"], ["C", "D"], ["D", "E"], ["E", "F"], ["F", "A"]];
const bipartite = M.claim({
  label: "\\text{2-colorable}",
  predicate: () => {
    const edges = chord.value >= 0.5 ? ring.concat([["A", "C"]]) : ring;
    const color: Record<string, number> = { A: 0 };
    for (let pass = 0; pass < 6; pass++) {
      for (const [u, v] of edges) {
        if (color[u] !== undefined && color[v] === undefined) color[v] = 1 - color[u];
        if (color[v] !== undefined && color[u] === undefined) color[u] = 1 - color[v];
      }
    }
    return edges.every(([u, v]) => color[u] !== color[v]);
  },
});
lesson.show(gOddView);
lesson.show(View.claim(bipartite));
lesson.expose(gOdd.edge("A", "C"), { as: "draggable" });
lesson.enableInteraction(Interaction.drag(chord, { along: gOdd.edge("A", "C") }));
lesson.say`Your turn: grab the chord ${gOdd.edge("A", "C")} and drag it in and out, watching the badge. With it OUT only the even six-loop remains and the graph stays bipartite. Slide it IN and the odd triangle appears — and no matter how you paint the dots, that seam will clash. The badge re-runs the coloring on every move, so the instant it flips to broken is the exact instant an odd cycle destroys the split.`;
