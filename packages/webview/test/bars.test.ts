import { describe, expect, it } from "vitest";

import { barsFor, type Barred } from "../src/app/canvas/bars.js";
import {
  CLUSTER_HEAD,
  headOnScreen,
  titleLine,
  type Held,
} from "../src/app/canvas/heading.js";
import { place, type Standing } from "../src/app/canvas/placement.js";

import type { Arrangement, ViewModel } from "../src/app/model.js";

/*
 * Collapsing a folder's bar into its parent's.
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
 * `Clusters.svelte` hands `heading.ts` the box's *slot* where it used to hand
 * it the box's depth, and nothing else about the arithmetic changes. Doing the
 * same substitution here rather than reimplementing the sum means the test is
 * checking the conversion the page performs instead of a second opinion about
 * it written next door, which is the rule the rest of `heading.ts` is tested
 * under.
 */
function barOnScreen(
  held: Held,
  box: { y: number; height: number },
  slot: number,
): number {
  return headOnScreen(held, { y: box.y, height: box.height, depth: slot });
}

/**
 * The bars a card has above it, counted the way `Canvas.svelte` counts them.
 *
 * The boxes that hold the card and draw a bar, which is no longer simply the
 * boxes that hold it.
 */
function barsOver(
  boxes: readonly { path: string; nodes: string[] }[],
  bars: ReadonlyMap<string, unknown>,
  id: string,
): number {
  let over = 0;
  for (const box of boxes) {
    if (bars.has(box.path) && box.nodes.includes(id)) over += 1;
  }
  return over;
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

      const top = barOnScreen(held, outer, outerSlot!);
      const below = barOnScreen(held, inner, innerSlot!);
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
        barOnScreen(held, inner, bars.get(inner.path)!.slot) -
        barOnScreen(held, outer, bars.get(outer.path)!.slot);

      expect(spread(open)).toBeCloseTo(2 * CLUSTER_HEAD * scale, 6);
      expect(spread(shut)).toBeCloseTo(CLUSTER_HEAD * scale, 6);
    }
  });

  it("never folds away an outermost bar, which has no parent to fold into", () => {
    // Folding one would delete the name rather than move it, and the reader
    // would be left with an unnamed frame and no way of discovering what it is.
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
 * What a merged bar says, which has to be the same sentence on everybody's
 * repository.
 *
 * Collapsing folds a name into the bar above it, so `common` with `mediaGroup`
 * folded into it reads `common/mediaGroup` and the reader is told where the
 * cards actually live rather than being left to conclude they are directly
 * inside `common`.
 *
 * The case with a decision in it is two folded children of the same parent.
 * There is one bar and two names, and every rule for choosing between them —
 * the first in the array, the shortest, the one that sorts first — is either
 * invisible to the reader or an accident of how the boxes happened to be built.
 * The first in the array is the worst of the three precisely because it looks
 * like a rule: the same drawing would read `common/mediaGroup` on one machine
 * and `common/util` on another, and neither would be wrong in any way anybody
 * could report. So the walk degrades instead, and these permutations are what
 * says it degrades the same way whatever order the boxes arrive in.
 */
describe("the name a bar reads once folders have been folded into it", () => {
  /** A nest as `barsFor` sees it: paths and how many boxes enclose each. */
  const chain: Barred[] = [
    { path: "a", depth: 1 },
    { path: "a/b", depth: 2 },
    { path: "a/b/c", depth: 3 },
  ];

  it("reads the whole chain when each step has exactly one folded child", () => {
    const bars = barsFor(chain, new Set(["a/b", "a/b/c"]));
    expect(bars.get("a")?.label).toBe("a/b/c");
    expect(bars.get("a")?.absorbed).toEqual(["a/b", "a/b/c"]);
    // And the two that were folded draw nothing, so one bar stands where three
    // did — which is the saving, said in bars rather than in pixels.
    expect([...bars.keys()]).toEqual(["a"]);
    expect(bars.get("a")?.slot).toBe(1);
  });

  it("stops at the folded folder when the one below it is still open", () => {
    const bars = barsFor(chain, new Set(["a/b"]));
    expect(bars.get("a")?.label).toBe("a/b");
    // `a/b/c` still draws, and is now one slot nearer the bar than its depth
    // would have put it. Its box has not moved.
    expect(bars.get("a/b/c")?.slot).toBe(2);
    expect(bars.get("a/b/c")?.label).toBe("c");
  });

  it("names neither of two folded siblings, in every order they may arrive in", () => {
    const siblings: Barred[] = [
      { path: "a", depth: 1 },
      { path: "a/b", depth: 2 },
      { path: "a/c", depth: 2 },
    ];

    /** Every order the boxes could have been built in. */
    const orders: Barred[][] = [];
    for (const first of siblings) {
      for (const second of siblings) {
        for (const third of siblings) {
          const order = [first, second, third];
          if (new Set(order).size === 3) orders.push(order);
        }
      }
    }
    expect(orders).toHaveLength(6);

    for (const order of orders) {
      const bars = barsFor(order, new Set(["a/b", "a/c"]));
      // Its own name and nothing appended: a bar that named one of the two
      // would be naming it because of where it sat in this array.
      expect(bars.get("a")?.label).toBe("a");
      expect(bars.get("a")?.absorbed).toEqual([]);
      expect([...bars.keys()]).toEqual(["a"]);
    }
  });

  it("absorbs an only folded child even where an open sibling stands beside it", () => {
    // One folded child is unambiguous however many open ones there are: the
    // open one draws its own bar and says its own name, so nothing is lost and
    // nothing has been chosen between.
    const bars = barsFor(
      [
        { path: "a", depth: 1 },
        { path: "a/b", depth: 2 },
        { path: "a/c", depth: 2 },
      ],
      new Set(["a/b"]),
    );
    expect(bars.get("a")?.label).toBe("a/b");
    expect(bars.get("a/c")?.label).toBe("c");
    expect(bars.get("a/c")?.slot).toBe(2);
  });

  it("gives every bar its own name back when nothing is folded", () => {
    const bars = barsFor(chain, new Set());
    expect([...bars.keys()]).toEqual(["a", "a/b", "a/b/c"]);
    for (const box of chain) {
      // The ordinary case, and the one where slot and depth agree exactly —
      // which is why the two are so easy to confuse and why this says it.
      expect(bars.get(box.path)?.slot).toBe(box.depth);
      expect(bars.get(box.path)?.absorbed).toEqual([]);
    }
  });
});
