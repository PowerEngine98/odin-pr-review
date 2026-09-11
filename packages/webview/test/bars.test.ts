import { describe, expect, it } from "vitest";

import {
  barsAbove,
  barsFor,
  headOf,
  type Barred,
} from "../src/app/canvas/bars.js";
import {
  CLUSTER_HEAD,
  headOnScreen,
  pinHead,
  titleLine,
  type Held,
} from "../src/app/canvas/heading.js";
import { place, type Standing } from "../src/app/canvas/placement.js";

import type { Arrangement, ViewModel } from "../src/app/model.js";

/*
 * Collapsing a folder's bar out of the stack held against the top of the window.
 *
 * The fixture is the same three-deep nest the header stacking was photographed
 * on, and it is rebuilt here rather than borrowed from `heading.test.ts`
 * because what is being asked is different again: that file asks where a name
 * lands, this one asks which names are drawn at all and what it costs the
 * geometry to answer — which is nothing, and proving it is nothing is most of
 * the point.
 */
function card(id: string, path: string, column: number, y: number) {
  return {
    id,
    path,
    x: column * 400,
    y,
    width: 300,
    height: 120,
    column,
    isTest: false,
    language: "typescript",
    untouched: false,
    status: "modified",
  };
}

function model(nodes: ReturnType<typeof card>[]): ViewModel {
  return {
    width: 2000,
    height: 2000,
    rowGap: 40,
    margin: 48,
    charWidth: 7,
    textLeft: 0,
    padding: 12,
    gutterWidth: 58,
    columnGap: 140,
    nodes,
    edges: [],
    parts: [],
    meta: { baseRef: "main", headRef: "topic" },
    arrangements: {
      withTests: { width: 0, height: 0, nodes: {} },
      withoutTests: { width: 0, height: 0, nodes: {} },
    },
    unified: false,
    canReview: false,
    review: "",
    viewer: "",
    viewerFace: "",
    comments: [],
  } as unknown as ViewModel;
}

function arrangement(data: ViewModel): Arrangement {
  return {
    width: data.width,
    height: data.height,
    nodes: Object.fromEntries(
      data.nodes.map((node) => [
        node.id,
        {
          x: node.x,
          y: node.y,
          width: node.width,
          height: node.height,
          column: node.column,
        },
      ]),
    ),
  };
}

const STANDING: Standing = {
  inPart: null,
  showInfra: true,
  hideViewed: false,
  viewed: new Set(),
  stranded: new Set(),
  clusters: true,
  measured: () => undefined,
};

/**
 * `labura` holding `labura/common` holding `labura/common/mediaGroup`.
 *
 * Each level has to hold more than one thing or no box is drawn for it at all,
 * so `labura` has a second folder beside `common` and `common` has a second
 * folder beside `mediaGroup`.
 */
function nested() {
  const data = model([
    card("m1", "labura/common/mediaGroup/one.ts", 0, 0),
    card("m2", "labura/common/mediaGroup/two.ts", 0, 200),
    card("m3", "labura/common/mediaGroup/three.ts", 1, 0),
    card("u1", "labura/common/util/one.ts", 0, 600),
    card("u2", "labura/common/util/two.ts", 1, 600),
    card("a1", "labura/app/one.ts", 2, 0),
    card("a2", "labura/app/two.ts", 2, 400),
  ]);
  const drawn = place(data, arrangement(data), STANDING);
  const boxes = drawn.folders ?? [];
  const at = (path: string) => {
    const box = boxes.find((one) => one.path === path);
    if (!box) throw new Error(`no box was drawn for ${path}`);
    return box;
  };
  return {
    drawn,
    boxes,
    outer: at("labura"),
    middle: at("labura/common"),
    inner: at("labura/common/mediaGroup"),
  };
}

/** The middle of the nest, which is the one worth collapsing. */
const MIDDLE = "labura/common";

/** The bar's underside, on a whole window pixel: what `headLine` starts from. */
const BAR = (chromeBottom: number) => Math.floor(chromeBottom - 1);

/**
 * A reader who has scrolled to a given line of the drawing.
 *
 * A fractional chrome height on purpose — the bar is measured off a bounding
 * rectangle and lands on a fraction more often than not, and a rounding that
 * only behaves on whole numbers is a rounding that behaves on a developer's
 * machine and nowhere else.
 */
function looking(scale: number, at: number): Held {
  const chromeBottom = 48.5;
  return { chromeBottom, y: BAR(chromeBottom) - at * scale, scale };
}

/** Pulled well back, life size, and close in. */
const ZOOMS = [0.4, 1, 2.5];

/**
 * Where a bar actually ends up on screen, worked out the way the page does it.
 *
 * `Clusters.svelte` hands `heading.ts` the box's *slot* where it used to hand it
 * the box's depth, and nothing else about the arithmetic changes. That
 * substitution used to be written out here as an object literal, which meant
 * this said what the page ought to do rather than what it does — and the page's
 * copy of it was the one in a `.svelte` file with nothing testing it. It goes
 * through `headOf` now, so the conversion checked below is the conversion
 * performed, which is the rule the rest of `heading.ts` is tested under.
 */
function barOnScreen(
  held: Held,
  bars: ReturnType<typeof barsFor>,
  box: { path: string; y: number; height: number },
): number {
  const head = headOf(bars, box);
  if (!head) throw new Error(`no bar is drawn for ${box.path}`);
  return headOnScreen(held, head);
}

/**
 * The bars a card has above it, asked of the function the page asks.
 *
 * This was a reimplementation of `Canvas.svelte`'s loop written out here, which
 * meant the test and the page agreed only for as long as somebody kept them
 * agreeing by hand — and a test that keeps its own copy of the thing under test
 * passes whatever the page does. `barsAbove` is now the page's own count, so
 * this is a lookup into its answer and nothing more.
 */
function barsOver(
  boxes: readonly { path: string; nodes: string[] }[],
  bars: ReturnType<typeof barsFor>,
  id: string,
): number {
  return barsAbove(boxes, bars).get(id) ?? 0;
}

/**
 * The stack of bars held against the top of the window, once one has been
 * folded away.
 *
 * The saving collapsing offers is measured in window pixels of chrome, and the
 * step between two bars is measured in canvas units, and the two are joined by
 * a scale the reader changes whenever they like. That is the fault `heading.ts`
 * was split out of this component to make untestable-by-accident, and it is
 * exactly the fault a new number stepping the same stack can reintroduce: a
 * slot that agrees with a depth at scale one and disagrees everywhere else
 * looks perfect in a screenshot and wrong on the machine it is reported from.
 *
 * So the promise is stated on the screen, in window pixels, at three zooms. Fold
 * the middle of a three-deep nest and the innermost name is one header below the
 * outermost rather than two — one header meaning `CLUSTER_HEAD` canvas units,
 * which is that many window pixels times whatever the reader has done to the
 * zoom.
 */
describe("the pinned stack of folder bars when a folder in the middle is collapsed", () => {
  it("holds the innermost bar exactly one header below the outermost, at every zoom", () => {
    for (const scale of ZOOMS) {
      const { boxes, outer, inner } = nested();
      const bars = barsFor(boxes, new Set([MIDDLE]));

      // Scrolled far enough that every box has run out from under the bar and
      // the names are genuinely being held there, which is the only
      // arrangement in which they can collide or leave a gap.
      const held = looking(scale, inner.y);

      const outerSlot = bars.get(outer.path)?.slot;
      const innerSlot = bars.get(inner.path)?.slot;
      expect(outerSlot).toBe(1);
      expect(innerSlot).toBe(2);

      const top = barOnScreen(held, bars, outer);
      const below = barOnScreen(held, bars, inner);
      expect(below - top).toBeCloseTo(CLUSTER_HEAD * scale, 6);
    }
  });

  it("draws no bar for the folded folder, so the stack is one shorter", () => {
    for (const scale of ZOOMS) {
      const { boxes, outer, inner } = nested();
      const open = barsFor(boxes, new Set());
      const shut = barsFor(boxes, new Set([MIDDLE]));

      expect(open.has(MIDDLE)).toBe(true);
      expect(shut.has(MIDDLE)).toBe(false);

      // The same pair of names, a header nearer each other than they were.
      const held = looking(scale, inner.y);
      const spread = (bars: ReturnType<typeof barsFor>) =>
        barOnScreen(held, bars, inner) - barOnScreen(held, bars, outer);

      expect(spread(open)).toBeCloseTo(2 * CLUSTER_HEAD * scale, 6);
      expect(spread(shut)).toBeCloseTo(CLUSTER_HEAD * scale, 6);
    }
  });

  it("never folds away an outermost bar, whatever the reader has folded", () => {
    // It is the one bar that says what the change is in rather than which
    // corner of it this is, and there is no bar above it to fall back to. The
    // component offers no chevron on one; this is the same rule said where a
    // fold stored by an older reading cannot get round it.
    const { boxes, outer } = nested();
    const bars = barsFor(boxes, new Set([outer.path, MIDDLE]));
    expect(bars.has(outer.path)).toBe(true);
    expect(bars.get(outer.path)?.slot).toBe(1);
  });
});

/**
 * And the file's own name, which is the last one in the same column.
 *
 * A card starts below the last bar above it, so folding one has to move it up
 * by exactly the height of the bar that went away. Too little and the title
 * sits where the folded bar used to be, leaving a strip of nothing between the
 * stack and the file's name; too much — which is what counting boxes instead of
 * bars gives — and the file's name is drawn on top of the folder's, which is
 * the complaint this whole column of numbers exists to answer.
 */
describe("where a card's title may start when a folder holding it is collapsed", () => {
  it("starts a card inside a folded box exactly one header higher, at every zoom", () => {
    for (const scale of ZOOMS) {
      const { boxes } = nested();
      const held = looking(scale, 1000);

      const open = barsFor(boxes, new Set());
      const shut = barsFor(boxes, new Set([MIDDLE]));

      // `m1` lives in the innermost folder, so all three boxes hold it.
      expect(barsOver(boxes, open, "m1")).toBe(3);
      expect(barsOver(boxes, shut, "m1")).toBe(2);

      const before = titleLine(held, barsOver(boxes, open, "m1"));
      const after = titleLine(held, barsOver(boxes, shut, "m1"));

      // In window pixels, because that is what `titleLine` answers in and what
      // the reader is looking at. One header's worth, scaled.
      expect(before - after).toBeCloseTo(CLUSTER_HEAD * scale, 6);
    }
  });

  it("leaves a card outside the folded folder exactly where it was", () => {
    // `a1` is in `labura/app`, which is beside `common` rather than inside it.
    // Collapsing somebody else's folder is not a reason to move its name.
    for (const scale of ZOOMS) {
      const { boxes } = nested();
      const held = looking(scale, 1000);
      const open = barsFor(boxes, new Set());
      const shut = barsFor(boxes, new Set([MIDDLE]));
      expect(titleLine(held, barsOver(boxes, shut, "a1"))).toBe(
        titleLine(held, barsOver(boxes, open, "a1")),
      );
    }
  });
});

/**
 * The invariant the whole feature is built around, stated so that breaking it
 * fails here rather than in a screenshot.
 *
 * Collapsing changes nothing geometric. Not one card moves, not one box edge
 * moves, and no box's depth changes. The saving is in the pinned stack, which
 * is chrome, and chrome is not what the placement is about — `bandsFor` goes on
 * reserving a pad and a header for every box that opens at a band whether or
 * not that box's bar is drawn.
 *
 * This is the assertion a later tidying breaks first, and it would break it for
 * a good-sounding reason: a folded folder's header is reserved room nobody is
 * using, so why not stop reserving it. Because the reader pressed a chevron to
 * recover thirty pixels of label and would get the entire drawing re-flowing
 * underneath them — every card moved, every arrow redrawn, and the thing they
 * were looking at somewhere else on the screen.
 *
 * The second half is about `depth` itself. The tempting implementation of all
 * this is to recompute `FolderBox.depth` with the folded boxes left out, since
 * depth is what the stacking used to step by. `placement.ts` finds a box's
 * parent with `other.depth === box.depth - 1` and its children with
 * `other.depth === box.depth + 1`, so a parent and a child given equal depths
 * simply stop being related and the child is drawn out through the parent's own
 * edge, silently and only on a change deep enough to notice. So depth is pinned
 * to its own definition here.
 */
describe("what collapsing a folder is not allowed to change", () => {
  /** Everything about the drawing that a reader would see move. */
  function geometry() {
    const { drawn, boxes } = nested();
    return {
      cards: drawn.cards.map((one) => ({
        id: one.node.id,
        x: one.x,
        y: one.y,
        width: one.width,
        height: one.height,
      })),
      folders: boxes.map((box) => ({
        path: box.path,
        depth: box.depth,
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
      })),
    };
  }

  it("moves no card and no box edge, and changes no depth", () => {
    const before = geometry();

    // The whole of what folding does to the page, performed between the two
    // readings: the layout is never told, so there is nothing for it to answer
    // differently. If this ever stops being true — if the folded set acquires a
    // route into `place()` or `Standing` — this is where it shows.
    const { boxes } = nested();
    barsFor(boxes, new Set([MIDDLE]));
    barsFor(boxes, new Set(["labura/common/mediaGroup", MIDDLE]));

    const after = geometry();
    // Said out loud so that a fixture which stopped producing cards or boxes
    // could not turn this into a comparison of two empty lists quietly passing.
    expect(before.cards).toHaveLength(7);
    expect(before.folders.length).toBeGreaterThanOrEqual(3);
    expect(after).toEqual(before);
    // And the boxes handed to `barsFor` are themselves untouched by it, which
    // is the mutation this would most plausibly acquire.
    expect(
      boxes.map((box) => ({
        path: box.path,
        depth: box.depth,
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
      })),
    ).toEqual(before.folders);
  });

  it("leaves every depth meaning how many boxes enclose it, folded or not", () => {
    const { boxes } = nested();
    for (const folded of [
      new Set<string>(),
      new Set([MIDDLE]),
      new Set([MIDDLE, "labura/common/mediaGroup", "labura/app"]),
    ]) {
      barsFor(boxes, folded);
      for (const box of boxes) {
        // `placement.ts`'s own definition, written out. Counting boxes and not
        // path segments: the levels that hold one thing each are never drawn.
        const enclosing = boxes.filter((other) =>
          box.path.startsWith(`${other.path}/`),
        ).length;
        expect(box.depth).toBe(1 + enclosing);
      }
    }
  });
});

/**
 * What a bar says, which is its own folder's name and nothing else.
 *
 * This was the other way round and the tests below said so. A folded folder's
 * name went into the bar above it, which then read as a path — `common` with
 * `mediaGroup` folded into it read `common/mediaGroup` — on the argument that
 * the reader had to be told where the cards went rather than left to conclude
 * they sat directly inside `common`. The rule was overturned by what it did to
 * the bar at the top of the drawing: fold a few folders under an outermost box
 * and its bar read `src / app / profile / laborer`, four folders' worth of name
 * on the one bar whose job is to say `src`. A path belongs to the box it names
 * and not to the bar of a box that merely contains it.
 *
 * So there is nothing to concatenate and nothing to choose between, and the two
 * things that follow from that are worth stating rather than assuming. A bar
 * reads one name however deep the folding below it goes, and a parent with two
 * folded children is no longer a special case at all — it used to need a
 * degradation rule, because one bar cannot say two names, and the rule had to
 * be proved deterministic over every order the boxes might arrive in.
 */
describe("the name a bar reads", () => {
  /** A nest as `barsFor` sees it: paths and how many boxes enclose each. */
  const chain: Barred[] = [
    { path: "a", depth: 1 },
    { path: "a/b", depth: 2 },
    { path: "a/b/c", depth: 3 },
  ];

  it("reads only its own name however deep the folding below it goes", () => {
    // The failure this exists to prevent, said in the smallest fixture that can
    // show it: an outermost bar reading `src/app/profile/laborer` because
    // somebody folded three folders underneath it. The reader asked for less
    // chrome and was given the longest label in the drawing, on the one bar
    // that cannot be folded away to be rid of it.
    const deep: Barred[] = [
      { path: "src", depth: 1 },
      { path: "src/app", depth: 2 },
      { path: "src/app/profile", depth: 3 },
      { path: "src/app/profile/laborer", depth: 4 },
    ];
    const bars = barsFor(
      deep,
      new Set(["src/app", "src/app/profile", "src/app/profile/laborer"]),
    );

    expect(bars.get("src")?.label).toBe("src");
    // And no other reading of it, stated as the whole map so that a label
    // arriving on some other bar instead would not pass quietly.
    expect([...bars].map(([path, bar]) => [path, bar.label])).toEqual([
      ["src", "src"],
    ]);
    expect(bars.get("src")?.slot).toBe(1);
  });

  it("says nothing about the folder below it when that one is folded", () => {
    // This used to read `a/b`, and the `b` half of it was pressable. What the
    // reader gets instead is a stub on `a/b`'s own frame, which `barsFor` says
    // by giving `a/b` no bar.
    const bars = barsFor(chain, new Set(["a/b"]));
    expect(bars.get("a")?.label).toBe("a");
    expect(bars.has("a/b")).toBe(false);
    // `a/b/c` still draws, and is now one slot nearer the top of the window
    // than its depth would have put it. Its box has not moved.
    expect(bars.get("a/b/c")?.slot).toBe(2);
    expect(bars.get("a/b/c")?.label).toBe("c");
  });

  it("reads the same name whether one child under it is folded or two", () => {
    // The degradation this replaces: with a parent able to absorb one child's
    // name but not two, folding a second child changed what the first fold had
    // done to the parent's bar, and the rule for it had to be proved stable
    // over all six orders three boxes can arrive in. A bar that says its own
    // name has nothing to be unstable about.
    const siblings: Barred[] = [
      { path: "a", depth: 1 },
      { path: "a/b", depth: 2 },
      { path: "a/c", depth: 2 },
    ];

    const one = barsFor(siblings, new Set(["a/b"]));
    expect(one.get("a")?.label).toBe("a");
    // The sibling that is still open keeps its own bar, its own name and the
    // slot below its parent's.
    expect(one.get("a/c")?.label).toBe("c");
    expect(one.get("a/c")?.slot).toBe(2);

    const both = barsFor(siblings, new Set(["a/b", "a/c"]));
    expect(both.get("a")?.label).toBe("a");
    expect([...both.keys()]).toEqual(["a"]);
  });

  it("gives every bar its own name when nothing is folded", () => {
    const bars = barsFor(chain, new Set());
    expect([...bars.keys()]).toEqual(["a", "a/b", "a/b/c"]);
    expect([...bars.values()].map((bar) => bar.label)).toEqual(["a", "b", "c"]);
    for (const box of chain) {
      // The ordinary case, and the one where slot and depth agree exactly —
      // which is why the two are so easy to confuse and why this says it.
      expect(bars.get(box.path)?.slot).toBe(box.depth);
    }
  });
});

/**
 * The number the component hands the header arithmetic, which was the part
 * nobody was holding.
 *
 * Everything above this tests a module, and the modules were the easy half. The
 * two of them are joined together inside `.svelte` files, and this repository
 * mounts no components in any of its tests — so the join was uncovered, and it
 * was uncovered in the one way that says nothing when it breaks. It was checked
 * by hand: with the choice spelled out in `Clusters.svelte` as `depth:
 * bars.get(box.path)?.slot ?? box.depth`, changing it to `depth: box.depth` —
 * feeding the arithmetic the old number, which is the single most likely
 * regression this feature has and the one the whole `slot` idea exists to
 * prevent — left all twelve tests above passing and the drawing wrong.
 *
 * So the choice is `headOf`'s now and this is what watches it. The first test
 * states it as a number because that is unambiguous; the second states it in
 * window pixels on the screen at three zooms, because a slot that agrees with a
 * depth at scale one and disagrees everywhere else is exactly the shape of bug
 * `heading.ts` was split out to catch, and a screenshot only ever shows one
 * scale.
 */
describe("the number a folder box's header arithmetic is fed", () => {
  it("answers with the box's slot and never with its depth", () => {
    const { boxes, outer, middle, inner } = nested();
    const bars = barsFor(boxes, new Set([MIDDLE]));

    // Three boxes enclose the innermost one and only two bars stand above it,
    // because the middle folder's bar is not drawn. Said as two separate
    // assertions so that a failure names which of the two numbers came out,
    // rather than reporting that some number was not two.
    expect(inner.depth).toBe(3);
    expect(headOf(bars, inner)?.depth).toBe(2);

    // The outermost is the case where the two agree, which is why nothing
    // caught this: with nothing folded above it, a slot is a depth.
    expect(headOf(bars, outer)?.depth).toBe(outer.depth);

    // And the geometry is passed straight through. A function in `bars.ts` that
    // adjusted a `y` or a `height` would be collapsing moving the drawing,
    // which is the one thing the whole feature promises not to do.
    expect(headOf(bars, inner)).toEqual({
      y: inner.y,
      height: inner.height,
      depth: 2,
    });
    expect(headOf(bars, middle)).toBeUndefined();
  });

  it("holds the bar one header higher than its depth would, at every zoom", () => {
    for (const scale of ZOOMS) {
      const { boxes, inner } = nested();
      const bars = barsFor(boxes, new Set([MIDDLE]));
      const held = looking(scale, inner.y);

      // Where the page actually holds it.
      const fed = headOnScreen(held, headOf(bars, inner)!);
      // And where the regression would have held it: the box's own depth, which
      // is what this line said before the decision was lifted out of the
      // component. One header lower, in window pixels, which is a strip of the
      // drawing showing through a stack that is meant to be solid.
      const stale = headOnScreen(held, {
        y: inner.y,
        height: inner.height,
        depth: inner.depth,
      });

      expect(stale - fed).toBeCloseTo(CLUSTER_HEAD * scale, 6);
      // Not nought at any zoom, which is what would make the assertion above
      // pass vacuously if the fixture ever stopped nesting.
      expect(stale - fed).toBeGreaterThan(0);
    }
  });

  it("answers with nothing for a folded box, rather than with a stale depth", () => {
    // There used to be a `?? box.depth` behind this, which looked like caution
    // and was a bug. Nothing drawing a bar ever reached it — a box with no bar
    // is skipped by the loop that draws them — so the only caller that could
    // was the hover tip, which asks where a name sits in order to put itself
    // underneath it. A folded box has no name, so the tip was pushed down the
    // screen by as many headers as the folder was deep and sat in the middle of
    // the cards it was meant to be labelling.
    const { boxes, middle, inner } = nested();
    const bars = barsFor(boxes, new Set([MIDDLE, inner.path]));

    expect(headOf(bars, middle)).toBeUndefined();
    expect(headOf(bars, inner)).toBeUndefined();
    // Which is the answer the tip turns into nought, rather than into the two
    // and three headers of offset those depths would have bought.
    for (const scale of ZOOMS) {
      const held = looking(scale, middle.y);
      expect(
        pinHead(held, { y: middle.y, height: middle.height, depth: middle.depth }),
      ).toBeGreaterThan(0);
    }
  });
});

/**
 * And the same hole one layer along, in the count a card's own title clears.
 *
 * `Canvas.svelte` works out how many names are stacked over each card and hands
 * the number to `titleLine`. It is four lines of loop and it had the same
 * problem as the line next door: written inside the component it could not be
 * exercised without mounting a page, and the obvious wrong version of it —
 * counting the boxes that hold a card rather than the boxes that draw a bar —
 * is the version that was correct right up until a bar could be folded away.
 *
 * What it costs to get wrong is a file's name drawn on top of a folder's, or a
 * strip of nothing between the stack and the file's name, depending on which
 * way the count went. Both are the complaint this column of numbers exists to
 * answer, and neither throws.
 */
describe("how many bars stand above a card, as the canvas counts them", () => {
  it("counts the boxes that draw a bar and not the boxes that hold the card", () => {
    const { boxes } = nested();
    const open = barsFor(boxes, new Set());
    const shut = barsFor(boxes, new Set([MIDDLE]));

    // `m1` lives in the innermost folder, so three boxes hold it whatever the
    // reader has folded — that is what `depth` means and it does not move.
    const holding = boxes.filter((box) => box.nodes.includes("m1")).length;
    expect(holding).toBe(3);

    expect(barsAbove(boxes, open).get("m1")).toBe(3);
    expect(barsAbove(boxes, shut).get("m1")).toBe(2);
    // Said out loud: folding changed the count of names and not the count of
    // boxes, and a loop that counted boxes would have answered three twice.
    expect(barsAbove(boxes, shut).get("m1")).not.toBe(holding);
  });

  it("leaves a card outside the folded folder on the same count", () => {
    // `a1` is in `labura/app`, which is beside `common` rather than inside it.
    // Somebody else's fold is not a reason to move its name.
    const { boxes } = nested();
    expect(barsAbove(boxes, barsFor(boxes, new Set())).get("a1")).toBe(2);
    expect(barsAbove(boxes, barsFor(boxes, new Set([MIDDLE]))).get("a1")).toBe(2);
  });

  it("gives no entry to a card no box holds, which the caller reads as nought", () => {
    const { boxes } = nested();
    const above = barsAbove(boxes, barsFor(boxes, new Set()));
    expect(above.has("nobody")).toBe(false);
    expect(above.get("nobody") ?? 0).toBe(0);
  });
});

/**
 * The boxes left with no bar, which is where a stub goes.
 *
 * There was a `stranded` beside `barsFor` that answered this, and it had to,
 * because while a parent could absorb a child's name a folded folder was
 * usually not silent at all — its name was in the bar above and pressable
 * there, and only the pair of siblings the absorbing refused to choose between
 * fell through to a stub on their own frame. Working out which folders those
 * were took reading every bar's absorbed list.
 *
 * With no concatenation anywhere, a folded box's name is on a stub and nowhere
 * else, so the set is simply the boxes `barsFor` gave no bar to — a lookup, and
 * `Clusters.svelte` now asks for a bar and draws a stub where there is none in
 * the same breath. That is what makes it impossible for a box to end up with
 * both a bar and a stub, or with neither, and what is asked here is that the
 * map says so: a missing bar means folded, and a bar means not, with no third
 * state in between for a box to get lost in.
 */
describe("the boxes left with no bar, which is where a stub goes", () => {
  const chain: Barred[] = [
    { path: "a", depth: 1 },
    { path: "a/b", depth: 2 },
    { path: "a/b/c", depth: 3 },
  ];

  const siblings: Barred[] = [
    { path: "a", depth: 1 },
    { path: "a/b", depth: 2 },
    { path: "a/c", depth: 2 },
  ];

  /** Every order the boxes could have been built in. */
  function orders(boxes: Barred[]): Barred[][] {
    const out: Barred[][] = [];
    for (const first of boxes) {
      for (const second of boxes) {
        for (const third of boxes) {
          const order = [first, second, third];
          if (new Set(order).size === 3) out.push(order);
        }
      }
    }
    return out;
  }

  it("gives a bar to every box when nothing is folded at all", () => {
    // Which is the state the reader starts in, and the one where a stub
    // appearing at all would be a name said in a place nobody asked for it.
    for (const boxes of [chain, siblings]) {
      const bars = barsFor(boxes, new Set());
      expect(boxes.filter((box) => !bars.has(box.path))).toEqual([]);
    }
  });

  it("leaves exactly the folded boxes without one, and so with a stub", () => {
    // Every one of them, which is the change: this used to be only the folders
    // a degrading parent could not name, and the rest had their names in a bar
    // above. One affordance now, in the same place on every folded box.
    const bars = barsFor(chain, new Set(["a/b", "a/b/c"]));
    expect([...bars.keys()]).toEqual(["a"]);
    expect(bars.has("a/b")).toBe(false);
    expect(bars.has("a/b/c")).toBe(false);
  });

  it("takes a box's bar back the moment the reader unfolds it", () => {
    // Which is what pressing a stub does, and the reason a stub is enough of an
    // answer on its own: the way back is one press on the box the reader
    // folded, and it lands them exactly where they were.
    const bars = barsFor(siblings, new Set(["a/b", "a/c"]));
    expect([...bars.keys()]).toEqual(["a"]);

    const after = barsFor(siblings, new Set(["a/c"]));
    expect(after.get("a/b")?.label).toBe("b");
    expect(after.get("a/b")?.slot).toBe(2);
    expect(after.has("a/c")).toBe(false);
  });

  it("answers the same way in every order the boxes may arrive in", () => {
    // The property the degradation rule needed proving over six permutations,
    // kept because it is the one that would fail silently: nothing here may
    // depend on where a box sits in the array it arrived in, and both the slot
    // loop and the folded lookup are positioned to make that easy to break.
    for (const order of orders(siblings)) {
      const bars = barsFor(order, new Set(["a/b", "a/c"]));
      expect([...bars.keys()]).toEqual(["a"]);
      expect(bars.get("a")?.label).toBe("a");
      expect(bars.get("a")?.slot).toBe(1);
    }

    for (const order of orders(chain)) {
      const bars = barsFor(order, new Set(["a/b"]));
      expect([...bars.keys()].sort()).toEqual(["a", "a/b/c"]);
      expect(bars.get("a/b/c")?.slot).toBe(2);
    }
  });

  it("keeps an outermost box's bar even where the reader folded it", () => {
    // So an outermost box never gets a stub. There is no bar above it, and a
    // drawing whose top-level frames were all stubs would be a change nobody
    // could say the shape of at a glance.
    const bars = barsFor(chain, new Set(["a", "a/b"]));
    expect(bars.get("a")?.label).toBe("a");
    expect(bars.get("a")?.slot).toBe(1);
    expect(bars.has("a/b")).toBe(false);
  });
});
