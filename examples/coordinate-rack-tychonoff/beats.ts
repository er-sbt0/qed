/**
 * The Coordinate Rack — Tychonoff Scene I.
 *
 * Hand-authored (roadmap step (c), docs/visual.md) to prove the View.diagram
 * geometry escape hatch inside qed's real pipeline: the figure is drawn
 * mark-by-mark in a named MATH-SPACE frame (no pixels), reads live signals
 * (a Parameter and an M.derived count), and the count -> infinity plus the
 * finiteness claim move under lesson.vary with no per-mark wiring — proof that
 * a captured draw closure survives the lint, the QuickJS authoring pass, and
 * the stepped player.
 */

// The product space {0,1}^N, drawn as a receding row of coordinate columns.
const VIS = 7;
const pv = [1, 0, 1, 1, 0, 1, 0]; // the point: one bit chosen in every coordinate

// Column geometry, in math-space (domain and range are both [0,1]). Widths
// shrink left-to-right so the row runs off the page toward a "forever" tail —
// recession, not an ellipsis. Computed once; the draw closure only reads it.
const centers: number[] = [];
{
  let x = 0.05;
  let w = 0.165;
  for (let k = 0; k < VIS; k += 1) {
    centers.push(x + w / 2);
    x += w + 0.014;
    w *= 0.86;
  }
}
const rowOne = 0.66; // y of the value-1 row
const rowZero = 0.34; // y of the value-0 row
const rowY = (bit: number): number => (bit ? rowOne : rowZero);

// The one cell the student's switch moves: product topology (0) vs box (1).
const boxMode = M.parameter("box topology (0 = product, 1 = box)", 0, { range: [0, 1] });
const isBox = (): boolean => boxMode.value >= 0.5;

// A basic open set pins only FINITELY many coordinates in the product topology,
// and EVERY one in the box topology. That single difference is the whole scene.
const PRODUCT_PINS = [1, 4]; // finitely many, chosen to agree with the point
function pinAt(k: number): number | null {
  if (isBox()) return pv[k]; // box: every coordinate is clamped
  return PRODUCT_PINS.indexOf(k) >= 0 ? pv[k] : null;
}

// The number that carries the theorem: finite in the product topology, infinite
// in the box. An M.derived, so every view that reads it moves when boxMode does.
const clampedCount = M.derived(() => (isBox() ? Infinity : PRODUCT_PINS.length), "clamped coordinates");

const rack = View.diagram(
  { domain: [0, 1], range: [0, 1], width: 960, height: 340, pad: 14 },
  (pen) => {
    pen.text(0.5, 0.92, "{0,1}^ℕ   —   the coordinate rack", { anchor: "middle" });
    pen.text(0.03, rowOne, "1", { anchor: "end", role: "neutral" });
    pen.text(0.03, rowZero, "0", { anchor: "end", role: "neutral" });

    for (let k = 0; k < VIS; k += 1) {
      const cx = centers[k];
      const pin = pinAt(k);
      const free = pin === null;
      // The column's guide: loud amber where the coordinate is FREE (freedom is
      // the content of the theorem), quiet blue where it is clamped.
      pen.path(
        [
          [cx, 0.22],
          [cx, 0.78],
        ],
        { role: free ? "free" : "constraint" },
      );
      pen.text(cx, 0.13, String(k), { anchor: "middle", role: "neutral" });
      // The pin: a ring around the clamped value's cell.
      if (pin !== null) pen.glyph(cx, rowY(pin), "ring", { role: "constraint", size: 13 });
      // The point: a dot at its value here. Red if it disagreed with a clamp
      // (it never does in this scene, but the mark is ready to say so).
      const bad = pin !== null && pin !== pv[k];
      pen.glyph(cx, rowY(pv[k]), "dot", { role: bad ? "reject" : free ? "free" : "neutral", size: 8 });
    }

    // The receding tail: a control meaning "and so on, forever", not just "...".
    pen.text(0.955, 0.5, "⋯", { anchor: "middle", role: "neutral" });
    pen.text(0.955, 0.34, "forever", { anchor: "middle", role: "neutral" });

    // The count, drawn big: a finite number, or the box topology's infinity.
    pen.text(0.5, 0.04, `clamped coordinates:   ${isBox() ? "∞" : String(PRODUCT_PINS.length)}`, {
      anchor: "middle",
      role: isBox() ? "reject" : "neutral",
    });
  },
  { label: "the coordinate rack" },
);

// Membership: the point lies inside the basic open set iff no clamped
// coordinate contradicts it. A live proposition, re-judged as the switch moves.
const membership = M.claim({
  predicate: () => {
    for (let k = 0; k < VIS; k += 1) {
      const pin = pinAt(k);
      if (pin !== null && pin !== pv[k]) return false;
    }
    return true;
  },
  label: "the point lies inside the basic open set",
});

// The theorem's hinge: the open set pins only finitely many coordinates. It
// holds in the product topology and the box topology BREAKS it — and that break
// is exactly Tychonoff's compactness dying.
const finiteness = M.claim({
  predicate: () => Number.isFinite(clampedCount.value),
  label: "the basic open set pins only finitely many coordinates",
});
const finitenessView = View.claim(finiteness);

lesson.beat("An infinite row of switches");
lesson.say`A point of ${rack} is one choice of 0 or 1 in every coordinate — an infinite row of switches, running off toward "forever".`;
lesson.show(rack);

lesson.beat("A basic open set is a mask");
lesson.say`A basic open set clamps a few coordinates (blue rings) and leaves all the rest wide open (amber). The openness is the freedom left behind.`;

lesson.beat("Count the constraints");
lesson.say`In the product topology that clamp list is ${clampedCount} entries long — pin as many coordinates as you like, it stays finite.`;
lesson.show(finitenessView);

lesson.beat("Is the point inside?");
lesson.say`The point sits inside the set exactly when no clamp contradicts it there.`;
lesson.show(View.claim(membership));

lesson.beat("Throw the box switch");
lesson.say`The box topology clamps every coordinate at once. Watch the count, and watch the claim.`;
lesson.vary(boxMode, { to: 1, over: "1.6s" });

lesson.beat("No finite subcover — where Tychonoff dies");
lesson.say`Now every basic open set pins infinitely many coordinates, so a singleton is open: uncountably many disjoint open points, and the cover by singletons has no finite subcover. Compactness — Tychonoff — dies in the box topology.`;
lesson.focus(finitenessView, { emphasize: "disagreement" });
