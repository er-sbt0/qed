/**
 * The Coordinate Rack — Tychonoff Scene I.
 *
 * Hand-authored (roadmap steps (c)/(d), docs/visual.md) to prove and then dress
 * the View.diagram geometry escape hatch: the figure is drawn mark-by-mark in a
 * named MATH-SPACE frame (no pixels), reads live signals (a Parameter and an
 * M.derived count), and moves under lesson.vary with no per-mark wiring. The
 * column/cell/marker idioms extracted in step (d) — pen.bands({recede}),
 * pen.band, pen.marker — do the drawing; rackColumn below is the userland macro
 * that composes them, the "idiom above the kernel" the corpus demonstrates.
 */

const VIS = 7;
const pv = [1, 0, 1, 1, 0, 1, 0]; // the point: one bit chosen in every coordinate
const rowOne = 0.6; // y of the value-1 row
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
// in the box. An M.derived, so every view reading it moves when boxMode does.
const clampedCount = M.derived(() => (isBox() ? Infinity : PRODUCT_PINS.length), "clamped coordinates");

// The idiom: one coordinate column drawn as a cell — the receding strip, its
// value rows, the pin ring on a clamped value, and the point marker (amber when
// the coordinate is free, red if it ever contradicts a clamp). Composed from the
// step-(d) pen idioms; this is the shape a lesson reaches for, dropping to the
// kernel only for the labels.
function rackColumn(pen, k: number, cx: number, width: number): void {
  const pin = pinAt(k);
  const free = pin === null;
  pen.band(cx, { width, y0: 0.24, y1: 0.7, role: free ? "free" : "constraint" });
  pen.text(cx, 0.17, String(k), { anchor: "middle", role: "neutral", size: 10.5 });
  if (pin !== null) pen.glyph(cx, rowY(pin), "ring", { role: "constraint", size: 10 });
  const bad = pin !== null && pin !== pv[k];
  pen.marker(cx, rowY(pv[k]), { state: bad ? "violated" : free ? "free" : "constrained", size: 6 });
}

const rack = View.diagram(
  { domain: [0, 1], range: [0, 1], width: 980, height: 380, pad: 18, cols: VIS },
  (pen) => {
    // value-row labels, once at the left margin
    pen.text(0.035, rowOne, "1", { anchor: "end", role: "neutral", size: 12 });
    pen.text(0.035, rowZero, "0", { anchor: "end", role: "neutral", size: 12 });

    // the columns, receding toward "forever" — a control, not an ellipsis
    const cols = pen.bands(VIS, { recede: 0.86, padding: 0.36 });
    for (let k = 0; k < VIS; k += 1) rackColumn(pen, k, cols[k].center, cols[k].width);

    const tailX = cols[VIS - 1].center + cols[VIS - 1].width * 1.3;
    pen.text(tailX, 0.47, "⋯", { anchor: "middle", role: "neutral", size: 20 });
    pen.text(tailX, 0.17, "forever", { anchor: "middle", role: "neutral", size: 10.5 });

    // the count, drawn big: the whole scene turns on it going finite → ∞
    pen.text(0.5, 0.95, "clamped coordinates", { anchor: "middle", role: "neutral", size: 11.5 });
    pen.text(0.5, 0.76, isBox() ? "∞" : String(PRODUCT_PINS.length), {
      anchor: "middle",
      size: 52,
      role: isBox() ? "reject" : "neutral",
    });
  },
  { label: "\\{0,1\\}^{\\mathbb{N}}\\ \\text{— the coordinate rack}" },
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
lesson.say`A basic open set clamps a few coordinates (blue, ringed) and leaves all the rest wide open (amber). The openness is the freedom left behind.`;

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
