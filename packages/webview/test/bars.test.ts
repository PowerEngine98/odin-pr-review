import { describe, expect, it } from "vitest";

import {
  barsAbove,
  barsFor,
  headOf,
  pinOf,
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

/**
 * The other shape, where one folder really is the whole of what its parent holds.
 *
 * `labura/app` is drawn as a box and the only box inside it is `labura/app/home`,
 * which holds every card `app` holds — so `app` is `app/home` and saying so on
 * one bar is a true statement about the whole frame. `labura` around it is not
 * in that position at all: it holds `docs`, and a file of its own, neither of
 * which is anywhere under `app`.
 *
 * Built through `place()` rather than written out as `Barred` literals, because
 * the rule turns on a relationship between two boxes and a hand-built pair can
 * be given any relationship at all. What is being claimed is that a real drawing
 * produces this shape, and the way to claim it is to draw one.
 */
function occupied() {
  const data = model([
    card("l1", "labura/one.ts", 0, 0),
    card("h1", "labura/app/home/one.ts", 0, 200),
    card("h2", "labura/app/home/two.ts", 1, 0),
    card("d1", "labura/docs/one.ts", 2, 0),
    card("g1", "labura/app/home/media/one.ts", 1, 400),
    card("g2", "labura/app/home/media/two.ts", 0, 600),
  ]);
  const drawn = place(data, arrangement(data), STANDING);
  const boxes = drawn.folders ?? [];
  const at = (path: string) => {
    const box = boxes.find((one) => one.path === path);
    if (!box) throw new Error(`no box was drawn for ${path}`);
    return box;
  };
  return {
    boxes,
    root: at("labura"),
    app: at("labura/app"),
    home: at("labura/app/home"),
    media: at("labura/app/home/media"),
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
 * Where a box's header ends up on screen whether or not it is in the stack.
 *
 * `barOnScreen` above refuses a box with no bar, which is right for the question
 * it answers and useless for the one the fold raises: a folded header is drawn,
 * it is simply drawn where its box is. So this is the page's own line — the top
 * of the box, plus however far `pinOf` slides it down, which for a folded box is
 * nothing at all.
 *
 * It repeats an addition that `headOnScreen` also performs, which is the sort of
 * second copy the two helpers above were written to get rid of, so the tests
 * that use it check the two against each other on a box that does pin. What
 * cannot be borrowed is `headOnScreen` itself: it takes a `Headed`, and a folded
 * box has none to give it.
 */
function headAt(
  held: Held,
  bars: ReturnType<typeof barsFor>,
  box: { path: string; y: number; height: number },
): number {
  return held.y + (box.y + pinOf(bars, box, held)) * held.scale;
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
 *
 * And the folded folder's own header is stated in the same breath and the same
 * units, because the two halves are one promise. The stack is a header shorter
 * *and* the folded box still says what it is, at the top of its own frame, where
 * it would have been anyway had the reader not scrolled past it. A version of
 * this feature that took the header away instead of taking it out of the stack
 * would pass every assertion about spacing above and be the wrong drawing.
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

  it("leaves the folded folder's header at the top of its own box, at every zoom", () => {
    for (const scale of ZOOMS) {
      const { boxes, outer, middle, inner } = nested();
      const bars = barsFor(boxes, new Set([MIDDLE]));

      // Scrolled past all three tops, which is the arrangement in which a
      // header either holds itself under the chrome or goes with its box.
      const held = looking(scale, inner.y);

      // It does not hold. Not at any of the three zooms, and not because
      // nothing is holding here: its two neighbours are both against the
      // chrome at this moment, and the middle box would be too — `pinHead` is
      // asked directly, with the depth the box has always had, and answers that
      // an unfolded header in this position slides a long way down.
      expect(pinOf(bars, middle, held)).toBe(0);
      expect(pinOf(bars, outer, held)).toBeGreaterThan(0);
      expect(pinOf(bars, inner, held)).toBeGreaterThan(0);
      expect(
        pinHead(held, {
          y: middle.y,
          height: middle.height,
          depth: middle.depth,
        }),
      ).toBeGreaterThan(0);

      // So it is drawn where its frame is and nowhere else, in window pixels.
      expect(headAt(held, bars, middle)).toBeCloseTo(
        held.y + middle.y * scale,
        6,
      );
      // Which at this scroll position is off the top of the window: the box has
      // gone past, so its name has gone past with it, exactly as an open one
      // does once it runs out. What it never does is stop at the chrome.
      expect(headAt(held, bars, middle)).toBeLessThan(
        barOnScreen(held, bars, outer),
      );

      // And the two that do hold are held, one header apart, where the helper
      // above and `headOnScreen` agree to the unit.
      expect(headAt(held, bars, outer)).toBeCloseTo(
        barOnScreen(held, bars, outer),
        6,
      );
      expect(headAt(held, bars, inner)).toBeCloseTo(
        barOnScreen(held, bars, inner),
        6,
      );
      expect(headAt(held, bars, inner) - headAt(held, bars, outer)).toBeCloseTo(
        CLUSTER_HEAD * scale,
        6,
      );
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
 * What a bar says, which is its own folder's name and then whatever folded
 * folder turns out to be the whole of what the box contains.
 *
 * This is the third answer to the same question and the tests below have said
 * all three, so what they used to claim is worth writing down. First a folded
 * folder's name went into the bar above it unconditionally, which then read as a
 * path — `common` with `mediaGroup` folded into it read `common/mediaGroup`.
 * Then it did not, and these tests asserted that a bar reads one name however
 * deep the folding below it goes. Neither is right, and the reason the middle
 * one was overturned is the reason the first one was: the failure was never
 * concatenation, it was concatenating a path that was not true of the frame it
 * was written across. `src / app / profile / laborer` on a box that also held a
 * second folder and a file of its own named a thread through the box and offered
 * it as a name for the box.
 *
 * So the condition is sole occupancy, tested against the drawing as it stands:
 * a parent absorbs a folded child only while that child is a box holding every
 * card the parent holds, so that everything inside the frame really is inside
 * the path on the bar. Two folded children is not an ambiguity to be resolved by
 * some rule the reader cannot see — which is what the first version needed and
 * had to prove stable over every order three boxes can arrive in — it is a frame
 * with two things in it, and it is declined for the same reason a stray card
 * declines it.
 */
describe("the name a bar reads", () => {
  /**
   * A parent that is nothing but one folder, which is the case the rule is for.
   *
   * `app` holds two cards and `app/home` holds the same two, so the frame
   * labelled `app` and the frame labelled `app/home` enclose exactly the same
   * drawing.
   */
  const sole: Barred[] = [
    { path: "app", depth: 1, nodes: ["h1", "h2"] },
    { path: "app/home", depth: 2, nodes: ["h1", "h2"] },
  ];

  /** The same, with a second folder standing beside the folded one. */
  const beside: Barred[] = [
    { path: "src", depth: 1, nodes: ["h1", "h2", "p1", "p2"] },
    { path: "src/home", depth: 2, nodes: ["h1", "h2"] },
    { path: "src/pages", depth: 2, nodes: ["p1", "p2"] },
  ];

  /** And with one card of the parent's own, outside the folded folder. */
  const loose: Barred[] = [
    { path: "src", depth: 1, nodes: ["h1", "h2", "readme"] },
    { path: "src/home", depth: 2, nodes: ["h1", "h2"] },
  ];

  it("absorbs a folded child that is the whole of what the box holds", () => {
    // The reader's case, stated as the smallest fixture that can show it: fold
    // `home` inside `app` where nothing else is in `app`, and one bar says
    // `app/home` rather than a bar saying `app` with a stub on the frame below
    // it saying `home`. Both frames are the same rectangle round the same two
    // cards, so two labels for it is the drawing saying the same thing twice.
    const bars = barsFor(sole, new Set(["app/home"]));

    expect(bars.get("app")?.label).toBe("app/home");
    expect(bars.get("app")?.absorbed).toEqual(["app/home"]);
    // And the fold still did what folds are for: one bar where there were two.
    expect(bars.has("app/home")).toBe(false);
    expect(bars.get("app")?.slot).toBe(1);
  });

  it("absorbs nothing when another box stands beside the folded one", () => {
    // `src` holds `home` and `pages`. A bar reading `src/home` across the whole
    // of `src` would be written over `pages`'s cards, which are in `src` and are
    // not in `src/home` — the reader is told what the frame is and then finds
    // things in it the name does not cover.
    const bars = barsFor(beside, new Set(["src/home"]));

    expect(bars.get("src")?.label).toBe("src");
    expect(bars.get("src")?.absorbed).toEqual([]);
    // The sibling that is still open keeps its own bar, its own name and the
    // slot below its parent's.
    expect(bars.get("src/pages")?.label).toBe("pages");
    expect(bars.get("src/pages")?.slot).toBe(2);

    // And folding the sibling too is not a second question. There is no rule
    // here choosing between two names, which the first version of this needed
    // and could only answer by an accident of array order.
    const both = barsFor(beside, new Set(["src/home", "src/pages"]));
    expect(both.get("src")?.label).toBe("src");
    expect([...both.keys()]).toEqual(["src"]);
  });

  it("absorbs nothing when the box holds a card outside the folded one", () => {
    // One child box and it is folded, so the first condition holds and the
    // second is the whole of what refuses this. `src` has a file of its own
    // sitting directly in it, and `src/home` is not where that file is.
    const bars = barsFor(loose, new Set(["src/home"]));

    expect(bars.get("src")?.label).toBe("src");
    expect(bars.get("src")?.absorbed).toEqual([]);
    expect(bars.has("src/home")).toBe(false);
  });

  it("walks a whole chain of sole occupants down to the last of them", () => {
    // The label the second version of this was written to prevent, on the shape
    // where it is not a complaint at all. Every box here holds the same two
    // cards, so `src`, `src/app`, `src/app/profile` and the `laborer` inside it
    // are four frames around one drawing, and the bar that says so is saying
    // what the reader would otherwise have to read off four stubs.
    const deep: Barred[] = [
      { path: "src", depth: 1, nodes: ["one", "two"] },
      { path: "src/app", depth: 2, nodes: ["one", "two"] },
      { path: "src/app/profile", depth: 3, nodes: ["one", "two"] },
      { path: "src/app/profile/laborer", depth: 4, nodes: ["one", "two"] },
    ];
    const bars = barsFor(
      deep,
      new Set(["src/app", "src/app/profile", "src/app/profile/laborer"]),
    );

    expect(bars.get("src")?.label).toBe("src/app/profile/laborer");
    expect(bars.get("src")?.absorbed).toEqual([
      "src/app",
      "src/app/profile",
      "src/app/profile/laborer",
    ]);
    // Said as the whole map so that a label arriving on some other bar instead
    // would not pass quietly.
    expect([...bars].map(([path, bar]) => [path, bar.label])).toEqual([
      ["src", "src/app/profile/laborer"],
    ]);
    expect(bars.get("src")?.slot).toBe(1);
  });

  it("stops the walk at the first folder that is not the whole of its parent", () => {
    // The same chain with one card left behind in `profile`, which is exactly
    // the difference between the label above and the one that was reported. The
    // walk takes `app` and `profile` and refuses `laborer`, so the bar says what
    // is true of the frame and stops.
    const deep: Barred[] = [
      { path: "src", depth: 1, nodes: ["one", "two"] },
      { path: "src/app", depth: 2, nodes: ["one", "two"] },
      { path: "src/app/profile", depth: 3, nodes: ["one", "two"] },
      { path: "src/app/profile/laborer", depth: 4, nodes: ["one"] },
    ];
    const bars = barsFor(
      deep,
      new Set(["src/app", "src/app/profile", "src/app/profile/laborer"]),
    );

    expect(bars.get("src")?.label).toBe("src/app/profile");
    expect(bars.get("src")?.absorbed).toEqual(["src/app", "src/app/profile"]);
    // And the folder the walk refused is not lost. It has no bar and no segment
    // in anybody's label, which now means only that its own header stays on its
    // own frame and out of the stack — where the reader can read it and press
    // the chevron on it.
    expect(bars.has("src/app/profile/laborer")).toBe(false);
    expect(
      [...bars.values()].some((bar) =>
        bar.absorbed.includes("src/app/profile/laborer"),
      ),
    ).toBe(false);
  });

  it("absorbs nothing where two children could each claim the whole box", () => {
    // The condition about there being exactly one child, held on its own rather
    // than left to the count comparison to imply. On a real drawing it is
    // implied: sibling boxes hold different cards, so a parent with two of them
    // has cards outside either. This fixture is the case that cannot arise, and
    // it is here because the implementation reads the first element of a
    // filtered array — which is the exact shape of the rule the first version
    // of this feature had to be rescued from, where a bar read `common/util` on
    // one machine and `common/mediaGroup` on another with the same change in
    // front of it, and neither was wrong in a way anybody could report.
    const twins: Barred[] = [
      { path: "a", depth: 1, nodes: ["x", "y"] },
      { path: "a/b", depth: 2, nodes: ["x", "y"] },
      { path: "a/c", depth: 2, nodes: ["x", "y"] },
    ];
    for (const order of [twins, [twins[1]!, twins[2]!, twins[0]!], [twins[2]!, twins[0]!, twins[1]!]]) {
      const bars = barsFor(order, new Set(["a/b", "a/c"]));
      expect(bars.get("a")?.label).toBe("a");
      expect(bars.get("a")?.absorbed).toEqual([]);
    }
  });

  it("absorbs nothing from a child that still draws its own bar", () => {
    // An open folder is already saying its name a header lower, so there is
    // nothing for the bar above to say on its behalf. Sole occupancy is not on
    // its own a reason to concatenate — a fold is.
    const bars = barsFor(sole, new Set());

    expect(bars.get("app")?.label).toBe("app");
    expect(bars.get("app")?.absorbed).toEqual([]);
    expect(bars.get("app/home")?.label).toBe("home");
    expect(bars.get("app/home")?.slot).toBe(2);
  });

  it("gives every bar its own name when nothing is folded", () => {
    const chain: Barred[] = [
      { path: "a", depth: 1, nodes: ["x", "y"] },
      { path: "a/b", depth: 2, nodes: ["x", "y"] },
      { path: "a/b/c", depth: 3, nodes: ["x", "y"] },
    ];
    const bars = barsFor(chain, new Set());
    expect([...bars.keys()]).toEqual(["a", "a/b", "a/b/c"]);
    expect([...bars.values()].map((bar) => bar.label)).toEqual(["a", "b", "c"]);
    for (const box of chain) {
      // The ordinary case, and the one where slot and depth agree exactly —
      // which is why the two are so easy to confuse and why this says it.
      expect(bars.get(box.path)?.slot).toBe(box.depth);
      expect(bars.get(box.path)?.absorbed).toEqual([]);
    }
  });
});

/**
 * The same rule again, read off a drawing rather than off a fixture.
 *
 * Everything above hands `barsFor` `Barred` literals, which is the right way to
 * state a rule and no way at all to claim that a real change ever produces the
 * shape the rule is about. A hand-built parent and child can be given any
 * relationship somebody types. So this asks `place()` for a drawing and then
 * asks whether the boxes it actually drew are in the position the rule
 * describes, which is the part that would quietly stop being true if the
 * placement's idea of which folders are worth a box ever moved.
 *
 * It is also the reader's own example: `app` whose only content is `home`.
 */
describe("a bar reading a path off a drawing that was really placed", () => {
  it("absorbs the sole occupant and leaves the crowded box alone", () => {
    const { boxes, root, app, home, media } = occupied();

    // The shape the rest of this rests on, said out loud so that a placement
    // that stopped producing it could not turn the assertions below into a
    // check of two boxes nobody would recognise.
    expect(home.nodes.length).toBe(app.nodes.length);
    expect(root.nodes.length).toBeGreaterThan(app.nodes.length);
    expect(media.nodes.length).toBeLessThan(home.nodes.length);

    const bars = barsFor(boxes, new Set([home.path]));

    // `app` is `app/home` and says so.
    expect(bars.get(app.path)?.label).toBe("app/home");
    expect(bars.get(app.path)?.absorbed).toEqual([home.path]);
    // `labura` is not: it holds `docs` and a file of its own, neither of which
    // is anywhere under `app`.
    expect(bars.get(root.path)?.label).toBe("labura");
    expect(bars.get(root.path)?.absorbed).toEqual([]);
    // And the box below the absorbed one carries on drawing its own bar, one
    // slot nearer the top of the window than its depth would have put it.
    expect(media.depth).toBe(4);
    expect(bars.get(media.path)?.slot).toBe(3);
    expect(bars.get(media.path)?.label).toBe("media");
  });

  it("refuses the folder below it, which holds half of what its parent does", () => {
    // Fold both, and the walk takes `home` and stops: `media` has two of
    // `home`'s four cards, so `app/home/media` across that frame would be a name
    // for half of it.
    const { boxes, app, home, media } = occupied();
    const bars = barsFor(boxes, new Set([home.path, media.path]));

    expect(bars.get(app.path)?.label).toBe("app/home");
    expect(bars.get(app.path)?.absorbed).toEqual([home.path]);
    // `media` is folded and absorbed by nobody, so it keeps its header on its
    // own frame and keeps it out of the stack.
    expect(bars.has(media.path)).toBe(false);
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
 * The way back out of a fold, which every folded box now carries itself.
 *
 * A folded folder has to be openable again, and for a while the arrangement was
 * delicate: a folded box had a name in one of two places — a pressable segment
 * of the bar that absorbed it, or a small stub on its own frame where no bar
 * did — and the tests here asserted that it was always in exactly one of them,
 * never both and never neither. That was the right invariant for that design and
 * it is the wrong one for this. Every box draws its own header now, folded or
 * not, so a folded folder's name is always on its own frame with a chevron on it
 * that opens the folder; the parent's bar may say the name a second time where
 * the folder is the whole of what that box holds, and two true statements about
 * one folder is not a contradiction to be broken by choosing one of them.
 *
 * The failure being guarded against is still the same failure, and it is not
 * hypothetical: this feature shipped once with two folded siblings under a
 * parent that could absorb neither, which left two folders with no bar, no
 * segment and nothing anywhere that undid the gesture that removed them. What
 * has changed is that the guard no longer has to be a rule about balancing two
 * places. It is the one place: the header on the box. So what is asserted below,
 * exhaustively over every folded subset of a couple of shapes, is the pair of
 * facts the component turns into that header — that no box ever disappears from
 * the drawing, and that a folded box is exactly a box with no bar, which is what
 * makes its chevron read the other way round.
 */
describe("the way back from a fold, which every folded box carries on its own header", () => {
  const chain: Barred[] = [
    { path: "a", depth: 1, nodes: ["x", "y"] },
    { path: "a/b", depth: 2, nodes: ["x", "y"] },
    { path: "a/b/c", depth: 3, nodes: ["x", "y"] },
  ];

  const siblings: Barred[] = [
    { path: "a", depth: 1, nodes: ["x", "y", "z"] },
    { path: "a/b", depth: 2, nodes: ["x", "y"] },
    { path: "a/c", depth: 2, nodes: ["z"] },
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

  /** Every set of folders the reader could have folded, including none. */
  function everyFold(boxes: readonly Barred[]): Set<string>[] {
    const out: Set<string>[] = [];
    for (let mask = 0; mask < 1 << boxes.length; mask++) {
      out.push(
        new Set(boxes.filter((_, at) => mask & (1 << at)).map((box) => box.path)),
      );
    }
    return out;
  }

  /**
   * Where a box's name is said, which is what the component draws.
   *
   * Every box gets a header on its own frame, so the first answer is never
   * absent; what varies is whether that header is held against the top of the
   * window. The rest is the bars above, each of which may say the name again as
   * a segment the reader can press. This used to be able to return nothing at
   * all, and returning nothing at all was the bug.
   */
  function saidOn(bars: ReturnType<typeof barsFor>, path: string): string[] {
    const where = [bars.has(path) ? "pinned header" : "header out of the stack"];
    for (const [owner, bar] of bars) {
      if (bar.absorbed.includes(path)) where.push(`segment of ${owner}`);
    }
    return where;
  }

  it("gives a bar to every box when nothing is folded at all", () => {
    // Which is the state the reader starts in, and the one where a header
    // sitting outside the stack would be a fold nobody asked for.
    for (const boxes of [chain, siblings]) {
      const bars = barsFor(boxes, new Set());
      expect(boxes.filter((box) => !bars.has(box.path))).toEqual([]);
      for (const box of boxes) {
        expect(saidOn(bars, box.path)).toEqual(["pinned header"]);
      }
    }
  });

  it("names every folded folder on its own header, whatever is folded", () => {
    // The invariant, over every fold of both shapes. It used to read "in exactly
    // one place", which was a rule about a stub and a segment balancing each
    // other; it is now the plainer thing that rule was trying to buy — the
    // folder is named where the folder is, and it is never named nowhere.
    for (const boxes of [chain, siblings]) {
      for (const folded of everyFold(boxes)) {
        const bars = barsFor(boxes, folded);
        for (const box of boxes) {
          const where = saidOn(bars, box.path);
          // The outermost box never leaves the stack, whatever the reader
          // folded, so it is the one place folding and the bar come apart.
          const pinned = box.depth === 1 || !folded.has(box.path);
          expect({ path: box.path, folded: [...folded], head: where[0] }).toEqual({
            path: box.path,
            folded: [...folded],
            head: pinned ? "pinned header" : "header out of the stack",
          });
        }
      }
    }
  });

  it("may also say a folded folder's name in the bar above, which is two ways back", () => {
    // The claim that replaces "exactly one place". `a/b` folded inside a `a`
    // that holds nothing else is a segment of `a`'s bar and has a header of its
    // own, and both presses open the same folder. Beside an open sibling it is
    // simply not absorbed, and the header is the only way back — which is the
    // ordinary case and the one the stub existed for.
    const together = barsFor(chain, new Set(["a/b"]));
    expect(saidOn(together, "a/b")).toEqual([
      "header out of the stack",
      "segment of a",
    ]);
    expect(together.get("a")?.label).toBe("a/b");

    const apart = barsFor(siblings, new Set(["a/b"]));
    expect(saidOn(apart, "a/b")).toEqual(["header out of the stack"]);
    expect(apart.get("a")?.label).toBe("a");
  });

  it("keeps every box in the drawing, so there is always a header to press", () => {
    // The other half of it, and the half no assertion about `bars` can make on
    // its own: the component draws a header for each of the boxes it is handed,
    // and folding is not allowed to take a box off that list. Every bar belongs
    // to a box that was handed in, and every fold leaves the list of boxes
    // exactly as long as it was.
    for (const boxes of [chain, siblings]) {
      const paths = boxes.map((box) => box.path);
      for (const folded of everyFold(boxes)) {
        const bars = barsFor(boxes, folded);
        expect([...bars.keys()].every((path) => paths.includes(path))).toBe(true);
        expect(boxes.map((box) => box.path)).toEqual(paths);
      }
    }
  });

  it("takes a box's bar back the moment the reader unfolds it", () => {
    // Which is what pressing the chevron on a folded box's own header does, and
    // what pressing the segment that says its name does: the way back lands the
    // reader exactly where they were.
    const bars = barsFor(siblings, new Set(["a/b", "a/c"]));
    expect([...bars.keys()]).toEqual(["a"]);
    expect(bars.get("a")?.absorbed).toEqual([]);

    const after = barsFor(siblings, new Set(["a/c"]));
    expect(after.get("a/b")?.label).toBe("b");
    expect(after.get("a/b")?.slot).toBe(2);
    expect(after.has("a/c")).toBe(false);
  });

  it("answers the same way in every order the boxes may arrive in", () => {
    // The property that would fail silently: nothing here may depend on where a
    // box sits in the array it arrived in, and the slot loop, the folded lookup
    // and now the walk that looks for an only child are all positioned to make
    // that easy to break. The walk is the newest of the three and the most
    // exposed, since `childrenOf` filters an array and then asks how long the
    // answer is.
    for (const order of orders(siblings)) {
      const bars = barsFor(order, new Set(["a/b", "a/c"]));
      expect([...bars.keys()]).toEqual(["a"]);
      expect(bars.get("a")?.label).toBe("a");
      expect(bars.get("a")?.absorbed).toEqual([]);
      expect(bars.get("a")?.slot).toBe(1);
    }

    for (const order of orders(chain)) {
      const bars = barsFor(order, new Set(["a/b"]));
      expect([...bars.keys()].sort()).toEqual(["a", "a/b/c"]);
      // The absorbing one, which is the reading that has an order to be
      // unstable about: `a` has one child here and the walk has to find it
      // wherever it was put.
      expect(bars.get("a")?.label).toBe("a/b");
      expect(bars.get("a")?.absorbed).toEqual(["a/b"]);
      expect(bars.get("a/b/c")?.slot).toBe(2);

      const both = barsFor(order, new Set(["a/b", "a/b/c"]));
      expect(both.get("a")?.label).toBe("a/b/c");
      expect(both.get("a")?.absorbed).toEqual(["a/b", "a/b/c"]);
    }
  });

  it("keeps an outermost box's bar even where the reader folded it", () => {
    // So an outermost box's header is never taken out of the stack and is never
    // absorbed into anything. There is no bar above it, and a drawing whose
    // top-level frames all sat outside the stack would be a change nobody could
    // say the shape of at a glance.
    const bars = barsFor(chain, new Set(["a", "a/b"]));
    expect(bars.get("a")?.slot).toBe(1);
    expect(bars.get("a")?.label).toBe("a/b");
    expect(bars.has("a/b")).toBe(false);
    expect(saidOn(bars, "a")).toEqual(["pinned header"]);
  });
});
