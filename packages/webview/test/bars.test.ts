import { describe, expect, it } from "vitest";

import {
  barsAbove,
  barsFor,
  headOf,
  pinOf,
  type Bar,
  type Barred,
  type Seen,
  type Spread,
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
function card(
  id: string,
  path: string,
  column: number,
  y: number,
  height = 120,
) {
  return {
    id,
    path,
    x: column * 400,
    y,
    width: 300,
    height,
    column,
    isTest: false,
    language: "typescript",
    untouched: false,
    status: "modified",
  };
}

/**
 * The change, as the view model the placement is handed.
 *
 * The row gap is a parameter because one fixture below needs its folder bands
 * standing well clear of each other: the rule under test is about whether a
 * sibling band is on screen, and bands packed a few units apart are bands that
 * are always on screen together at any zoom worth testing at.
 */
function model(nodes: ReturnType<typeof card>[], rowGap = 40): ViewModel {
  return {
    width: 2000,
    height: 2000,
    rowGap,
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

/** Where each card of a real drawing ended up, keyed as the canvas keys it. */
function spotsOf(drawn: ReturnType<typeof place>): Record<string, Spread> {
  return Object.fromEntries(
    drawn.cards.map((placed) => [
      placed.node.id,
      {
        x: placed.x,
        y: placed.y,
        width: placed.width,
        height: placed.height,
      },
    ]),
  );
}

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
    spots: spotsOf(drawn),
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
 *
 * It is also the reader's first drawing, which is why the scroll tests below use
 * it rather than a fixture: `app`'s bar read `app / home` while `home`'s own
 * header sat on `home`'s frame directly beneath it, and both were on screen at
 * once.
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
    spots: spotsOf(drawn),
    root: at("labura"),
    app: at("labura/app"),
    home: at("labura/app/home"),
    media: at("labura/app/home/media"),
  };
}

/**
 * The reader's second drawing, which is the one this rule was corrected off.
 *
 * `frontend` holds three folder chains — `common/src/components/mui`,
 * `pages/app/home` and `web/src` — and the recording is of somebody scrolling
 * down through the middle one. The bands are stood well apart so that at the
 * zoom a reader is actually at, one band fills the window and the other two are
 * nowhere near it; that separation is the whole point of the fixture, because
 * the question under test is what a bar may say while its other children are off
 * screen.
 *
 * Drawn through `place()` for the reason `occupied` is: the claim is that a real
 * change produces a parent with three chains under it, one of which is two boxes
 * deep and is the whole of its own frame, and the way to claim that is to draw
 * one and look.
 */
function three() {
  const data = model(
    [
      card("m1", "frontend/common/src/components/mui/one.ts", 0, 0, 900),
      card("m2", "frontend/common/src/components/mui/two.ts", 1, 0, 900),
      card("h1", "frontend/pages/app/home/one.ts", 0, 4000, 900),
      card("h2", "frontend/pages/app/home/two.ts", 1, 4000, 900),
      card("g1", "frontend/pages/app/home/media/one.ts", 0, 6000, 900),
      card("g2", "frontend/pages/app/home/media/two.ts", 1, 6000, 900),
      card("w1", "frontend/web/src/one.ts", 0, 9000, 900),
      card("w2", "frontend/web/src/two.ts", 1, 9000, 900),
    ],
    600,
  );
  const drawn = place(data, arrangement(data), STANDING);
  const boxes = drawn.folders ?? [];
  const at = (path: string) => {
    const box = boxes.find((one) => one.path === path);
    if (!box) throw new Error(`no box was drawn for ${path}`);
    return box;
  };
  const root = at("frontend");
  const mui = at("frontend/common/src/components/mui");
  const app = at("frontend/pages/app");
  const home = at("frontend/pages/app/home");
  const media = at("frontend/pages/app/home/media");
  const web = at("frontend/web/src");
  return {
    boxes,
    spots: spotsOf(drawn),
    root,
    mui,
    app,
    home,
    media,
    web,
    /**
     * The four places in the recording, taken off the drawing rather than typed.
     *
     * Each is the middle of a stretch where one thing is true, so the
     * assertions do not sit a few units from a threshold — and each is worked
     * out from the boxes the placement actually produced, so a change to the
     * banding moves these with it instead of leaving four numbers pointing at
     * the wrong parts of a drawing that has shifted underneath them. Every test
     * using one of them says out loud what state it expects the reader to be
     * in, so a placement that moved them somewhere else fails rather than
     * quietly asserting something true of the wrong position.
     */
    reading: {
      /**
       * A few headers above `app`'s box, where `app`'s own header is plainly in
       * place. Near enough to the box that the box is on the screen even at the
       * closest zoom, where the window holds only a few hundred units of canvas,
       * and far enough down the gap between the chains that the first one is off
       * the top of it even at the furthest, where the window holds a couple of
       * thousand.
       */
      early: app.y - CLUSTER_HEAD * 5,
      /** Between `app`'s header and `home`'s, where exactly one of the two has gone. */
      partway: (app.y + home.y) / 2 - CLUSTER_HEAD,
      /** Well inside `home`, with neither neighbouring chain anywhere near. */
      deep: (home.y + media.y) / 2,
      /** On into the third chain, which the reader is now looking at instead. */
      beyond: web.y + web.height / 2,
    },
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
 * A window nobody has measured, which the module reads as the whole drawing
 * being in sight.
 *
 * It is the fallback the sight rule is built around and it is worth using
 * deliberately rather than treating as a placeholder: with nothing off screen,
 * "the folded child is the only box in sight and holds every card in sight"
 * collapses into "the only box, holding every card", which is the rule that
 * shipped before. So every test below that is not about what the reader can see
 * asks for this, and by doing so states that the older rule still holds where
 * sight cannot decide anything.
 */
const ANYWHERE: Seen = { left: 0, top: 0, width: 0, height: 0, cards: {} };

/**
 * The window the reader is actually looking through, in canvas units.
 *
 * Built from the same `Held` the labels are worked out against, the way the
 * canvas builds it: the camera reports the top of its window as `-view.y/scale`
 * and `Held.y` *is* `view.y`, so a test cannot put the reader at one place for
 * the stack and another place for the sight. The height is given in window
 * pixels for the same reason — it is a window, and it covers more of the drawing
 * the further back the reader is standing.
 *
 * Sideways it is wide enough to be out of the question unless a caller says
 * otherwise, because all but one of these fixtures is about scrolling down the
 * page. The one that is not passes its own.
 */
function through(
  held: Held,
  cards: Record<string, Spread>,
  tall: number,
  across: { left: number; width: number } = { left: -20_000, width: 40_000 },
): Seen {
  return {
    left: across.left,
    top: -held.y / held.scale,
    width: across.width,
    height: tall / held.scale,
    cards,
  };
}

/**
 * The same window, said as how much of the drawing it holds rather than as how
 * many pixels tall it is.
 *
 * Two helpers and not one, because the two questions are genuinely different.
 * Most of what is asked below is a window of a real size at three zooms, which
 * is the reader's own situation and the arrangement in which a conversion
 * between window pixels and canvas units can go wrong — that is `through`, and
 * it is what the recording is reproduced with. A few tests are about a
 * particular band dropping out of the window, and those need it in or out at
 * every zoom: a fixed pixel height cannot give that, because a reader pulled
 * back to four tenths has six times as much of the drawing in front of them as
 * one zoomed in to two and a half, and the same eight hundred pixels is two
 * thousand units of canvas at one end and three hundred at the other.
 */
function holding(
  held: Held,
  cards: Record<string, Spread>,
  units: number,
): Seen {
  return through(held, cards, units * held.scale);
}

/** How tall the reader's window is, in window pixels, for the drawn fixtures. */
const TALL = 700;

/**
 * A reader who has not scrolled down into the drawing at all.
 *
 * Every header is still where its box is, nothing has had to hold itself under
 * the chrome, and therefore no folded name has been handed up to the bar above
 * it. It is the state to state anything in that is not itself about scroll, and
 * there are a lot of those below: `barsFor` is asked for a view because what a
 * bar *says* depends on one, and nothing else it answers does.
 */
const UNSCROLLED: Held = looking(1, -10_000);

/**
 * Where a box's own header would sit in the stack if it joined it.
 *
 * The line just under the deepest bar that is actually drawn above it, which for
 * a folded box is the line it would be held on had the reader not folded it.
 * Counted off the map `barsFor` returned rather than off the folded set, so this
 * agrees with the module about which boxes draw and disagrees with it about
 * nothing.
 */
function wouldSit(
  boxes: readonly { path: string }[],
  bars: ReadonlyMap<string, Bar>,
  path: string,
): number {
  let slot = 1;
  for (const other of boxes) {
    if (path.startsWith(`${other.path}/`) && bars.has(other.path)) slot += 1;
  }
  return slot;
}

/**
 * Whether a box's own header has gone behind the stack at this scroll position.
 *
 * Asked of `pinHead`, which is the function the page asks. Writing the
 * comparison out here instead — the box's top against the chrome, say — would be
 * a second opinion about a line the stack already has an opinion about, and a
 * test carrying its own copy of the threshold it is checking passes whichever
 * way the threshold drifts.
 */
function outOfSight(
  boxes: readonly { path: string; y: number; height: number }[],
  bars: ReadonlyMap<string, Bar>,
  path: string,
  held: Held,
): boolean {
  const box = boxes.find((one) => one.path === path);
  if (!box) throw new Error(`no box was drawn for ${path}`);
  return (
    pinHead(held, {
      y: box.y,
      height: box.height,
      depth: wouldSit(boxes, bars, path),
    }) > 0
  );
}

/**
 * Whether a rectangle of the drawing is inside the window the reader has.
 *
 * The tests need this to say what state they have put the reader in — "the
 * sibling band really is off screen, or the assertion below proves nothing" — and
 * it is deliberately the plainest possible overlap rather than an import of the
 * module's own. `barsFor` keeps its comparison private, so a test that borrowed
 * it would agree with the module by construction and could not catch it
 * disagreeing with the drawing.
 */
function onScreen(seen: Seen, thing: Spread): boolean {
  return (
    thing.x < seen.left + seen.width &&
    thing.x + thing.width > seen.left &&
    thing.y < seen.top + seen.height &&
    thing.y + thing.height > seen.top
  );
}

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
  boxes: readonly { path: string; nodes: readonly string[] }[],
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
 *
 * Nothing here depends on what the reader can see — a slot counts the bars that
 * are drawn and a fold is a fold at every window size — so the window is the
 * unmeasured one throughout, which says so.
 */
describe("the pinned stack of folder bars when a folder in the middle is collapsed", () => {
  it("holds the innermost bar exactly one header below the outermost, at every zoom", () => {
    for (const scale of ZOOMS) {
      const { boxes, outer, inner } = nested();

      // Scrolled far enough that every box has run out from under the bar and
      // the names are genuinely being held there, which is the only
      // arrangement in which they can collide or leave a gap.
      const held = looking(scale, inner.y);
      const bars = barsFor(boxes, new Set([MIDDLE]), held, ANYWHERE);

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
      const held = looking(scale, inner.y);
      const open = barsFor(boxes, new Set(), held, ANYWHERE);
      const shut = barsFor(boxes, new Set([MIDDLE]), held, ANYWHERE);

      expect(open.has(MIDDLE)).toBe(true);
      expect(shut.has(MIDDLE)).toBe(false);

      // The same pair of names, a header nearer each other than they were.
      const spread = (bars: ReturnType<typeof barsFor>) =>
        barOnScreen(held, bars, inner) - barOnScreen(held, bars, outer);

      expect(spread(open)).toBeCloseTo(2 * CLUSTER_HEAD * scale, 6);
      expect(spread(shut)).toBeCloseTo(CLUSTER_HEAD * scale, 6);
    }
  });

  it("leaves the folded folder's header at the top of its own box, at every zoom", () => {
    for (const scale of ZOOMS) {
      const { boxes, outer, middle, inner } = nested();

      // Scrolled past all three tops, which is the arrangement in which a
      // header either holds itself under the chrome or goes with its box.
      const held = looking(scale, inner.y);
      const bars = barsFor(boxes, new Set([MIDDLE]), held, ANYWHERE);

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
    const bars = barsFor(
      boxes,
      new Set([outer.path, MIDDLE]),
      UNSCROLLED,
      ANYWHERE,
    );
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

      const open = barsFor(boxes, new Set(), held, ANYWHERE);
      const shut = barsFor(boxes, new Set([MIDDLE]), held, ANYWHERE);

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
      const open = barsFor(boxes, new Set(), held, ANYWHERE);
      const shut = barsFor(boxes, new Set([MIDDLE]), held, ANYWHERE);
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
 * Scrolling is held to the same promise, and so is panning, which is the newest
 * claim of the three: a bar's label now depends on where the reader is *and* on
 * what is in the window beside them. That makes the drawing change as they move,
 * and the thing to pin is that only the words change. `barsFor` is asked at a
 * spread of scroll positions and through windows of several sizes, and no card
 * and no edge has moved when it is asked again.
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
    const { boxes, spots } = nested();
    barsFor(boxes, new Set([MIDDLE]), UNSCROLLED, ANYWHERE);
    barsFor(
      boxes,
      new Set(["labura/common/mediaGroup", MIDDLE]),
      UNSCROLLED,
      ANYWHERE,
    );
    // And the whole of what scrolling and panning do to it, which is the same
    // nothing. The window is varied as well as the scroll, because the sight
    // rule is the newest way this could have acquired a write.
    for (const scale of ZOOMS) {
      for (const at of [-500, 0, 240, 390, 1010, 5000]) {
        const held = looking(scale, at);
        barsFor(boxes, new Set([MIDDLE]), held, ANYWHERE);
        for (const tall of [200, 700, 4000]) {
          barsFor(boxes, new Set([MIDDLE]), held, through(held, spots, tall));
        }
      }
    }

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
      barsFor(boxes, folded, UNSCROLLED, ANYWHERE);
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

  it("moves no card's title when a bar's label changes under the reader", () => {
    // The bars a card must clear are the bars that are drawn, and absorbing a
    // name into one does not draw another. So the one visible consequence of
    // crossing the threshold is the word on a bar: nothing reflows, nothing
    // steps down, and the file names in the column stay exactly where they
    // were. Worth pinning because the alternative is unpleasant and quiet — a
    // whole column of titles nudging by a header as the reader pans.
    const { boxes, app, home } = occupied();
    const folded = new Set([home.path]);
    for (const scale of ZOOMS) {
      const near = looking(scale, home.y - 100);
      const past = looking(scale, home.y + 100);
      const before = barsFor(boxes, folded, near, ANYWHERE);
      const after = barsFor(boxes, folded, past, ANYWHERE);

      // The label really did change between the two, or this proves nothing.
      expect(before.get(app.path)?.label).not.toBe(after.get(app.path)?.label);
      expect([...barsAbove(boxes, before)]).toEqual([
        ...barsAbove(boxes, after),
      ]);
      for (const box of boxes) {
        expect(before.get(box.path)?.slot).toBe(after.get(box.path)?.slot);
      }
    }
  });

  it("moves no card's title when a bar's label changes because the window did", () => {
    // The same promise for the newer half of the rule. Hold the reader still
    // and shrink the window until a sibling band drops off the bottom of it:
    // the label gains a folder and not a single slot moves, because absorbing a
    // name is not adding a bar and never was.
    //
    // Both windows are given as a stretch of the drawing rather than as pixels,
    // since what has to be true at all three zooms is that one of them reaches
    // `web/src` and the other does not.
    const { boxes, spots, root, app, home, reading } = three();
    const folded = new Set([app.path, home.path]);
    for (const scale of ZOOMS) {
      const held = looking(scale, reading.deep);
      const wide = holding(held, spots, 4000);
      const narrow = holding(held, spots, 1200);
      const before = barsFor(boxes, folded, held, wide);
      const after = barsFor(boxes, folded, held, narrow);

      expect(before.get(root.path)?.label).not.toBe(
        after.get(root.path)?.label,
      );
      expect([...barsAbove(boxes, before)]).toEqual([
        ...barsAbove(boxes, after),
      ]);
      for (const box of boxes) {
        expect(before.get(box.path)?.slot).toBe(after.get(box.path)?.slot);
      }
    }
  });
});

/**
 * What a bar says, which is its own folder's name and then whatever folded
 * folder is the whole of what the box contains *in sight* and has gone behind
 * the stack.
 *
 * This is the fifth answer to one question and the tests in this file have said
 * all five, so what they used to claim is worth writing down. First a folded
 * folder's name went into the bar above it unconditionally, which then read as a
 * path — `common` with `mediaGroup` folded into it read `common/mediaGroup`, and
 * on a real change the outermost bar in the drawing read `src / app / profile /
 * laborer` across a frame that also held a file of its own and a second folder.
 * Then it did not, and these tests asserted that a bar reads one name however
 * deep the folding below it goes. Then it did again under a sole-occupancy
 * condition. Then that condition gained a fourth clause about the scroll, which
 * is untouched and is stated in the describe after this one.
 *
 * The fifth is where the tests below change meaning rather than gain a test, and
 * each one says which. Sole occupancy used to be a property of the drawing: a
 * box could absorb a folded child only if that child was the one box in it and
 * held every card in it, full stop, at every scroll position and every window
 * size. Three of the tests below asserted exactly that, in those words, and two
 * of them said "true at any scroll position" out loud. It is now a property of
 * what the reader can see, so each of those three has become a pair — the box
 * refusing while the thing it would misdescribe is on screen, and the same box
 * absorbing once that thing has gone off it.
 *
 * What provoked the change is a recording: `frontend` holding three folder
 * chains absorbed none of them however far the reader scrolled, so a reader deep
 * inside one chain, with the other two nowhere near the window, saw one bar
 * saying `frontend` and two folded folders named nowhere at all. That drawing is
 * a fixture of its own further down.
 */
describe("the name a bar reads", () => {
  /**
   * A parent that is nothing but one folder, which is the case the rule is for.
   *
   * `app` holds two cards and `app/home` holds the same two, so the frame
   * labelled `app` and the frame labelled `app/home` enclose exactly the same
   * drawing.
   *
   * The frames are given plausible geometry rather than left off, because the
   * rule is now entirely about where they are. `app` opens at nought and `home` a
   * hundred and fifty units down it, which is the sort of gap the banding leaves
   * for a pad and a header, and the cards sit inside `home` where its cards
   * belong.
   */
  const sole: Barred[] = [
    { path: "app", depth: 1, nodes: ["h1", "h2"], x: 0, width: 800, y: 0, height: 900 },
    {
      path: "app/home",
      depth: 2,
      nodes: ["h1", "h2"],
      x: 40,
      width: 720,
      y: 150,
      height: 700,
    },
  ];
  const soleCards: Record<string, Spread> = {
    h1: { x: 80, y: 220, width: 300, height: 250 },
    h2: { x: 420, y: 220, width: 300, height: 250 },
  };

  /**
   * The same, with a second folder standing beside the folded one and well below
   * it, so that a short enough window holds one of them and not the other.
   */
  const beside: Barred[] = [
    {
      path: "src",
      depth: 1,
      nodes: ["h1", "h2", "p1", "p2"],
      x: 0,
      width: 800,
      y: 0,
      height: 1200,
    },
    {
      path: "src/home",
      depth: 2,
      nodes: ["h1", "h2"],
      x: 40,
      width: 720,
      y: 150,
      height: 400,
    },
    {
      path: "src/pages",
      depth: 2,
      nodes: ["p1", "p2"],
      x: 40,
      width: 720,
      y: 700,
      height: 400,
    },
  ];
  const besideCards: Record<string, Spread> = {
    h1: { x: 80, y: 220, width: 300, height: 250 },
    h2: { x: 420, y: 220, width: 300, height: 250 },
    p1: { x: 80, y: 770, width: 300, height: 250 },
    p2: { x: 420, y: 770, width: 300, height: 250 },
  };

  /** And with one card of the parent's own, outside the folded folder. */
  const loose: Barred[] = [
    {
      path: "src",
      depth: 1,
      nodes: ["h1", "h2", "readme"],
      x: 0,
      width: 800,
      y: 0,
      height: 1200,
    },
    {
      path: "src/home",
      depth: 2,
      nodes: ["h1", "h2"],
      x: 40,
      width: 720,
      y: 150,
      height: 400,
    },
  ];
  const looseCards: Record<string, Spread> = {
    h1: { x: 80, y: 220, width: 300, height: 250 },
    h2: { x: 420, y: 220, width: 300, height: 250 },
    readme: { x: 80, y: 700, width: 300, height: 250 },
  };

  /**
   * Two folders side by side rather than one above the other, for the one
   * question the vertical fixtures cannot ask.
   *
   * A folder box is routinely wider than the window — that is what makes it a
   * folder rather than a card — so a sibling can leave the screen sideways just
   * as surely as it can leave it downwards, and a rule that only looked at the
   * scroll would call a chain the reader has panned clean away from "in sight".
   */
  const apart: Barred[] = [
    {
      path: "src",
      depth: 1,
      nodes: ["h1", "h2", "p1", "p2"],
      x: 0,
      width: 2000,
      y: 0,
      height: 900,
    },
    {
      path: "src/home",
      depth: 2,
      nodes: ["h1", "h2"],
      x: 40,
      width: 700,
      y: 150,
      height: 700,
    },
    {
      path: "src/pages",
      depth: 2,
      nodes: ["p1", "p2"],
      x: 1200,
      width: 700,
      y: 150,
      height: 700,
    },
  ];
  const apartCards: Record<string, Spread> = {
    h1: { x: 80, y: 220, width: 250, height: 250 },
    h2: { x: 400, y: 220, width: 250, height: 250 },
    p1: { x: 1240, y: 220, width: 250, height: 250 },
    p2: { x: 1560, y: 220, width: 250, height: 250 },
  };

  /**
   * Far enough down that every folded header in these fixtures has gone behind
   * the stack, which is the half of the condition these tests are not about.
   */
  const PAST = looking(1, 5000);

  /** Scrolled just past the folded header, with the window still over the box. */
  const JUST = looking(1, 200);
  /** A little further, so that a short window clips the sibling's frame. */
  const NEAR = looking(1, 400);

  it("absorbs a folded child that is the whole of the box, in sight and in the drawing alike", () => {
    // The reader's first case, stated as the smallest fixture that can show it:
    // fold `home` inside `app` where nothing else is in `app`, scroll until
    // `home`'s own header has gone behind `app`'s bar, and one bar says
    // `app/home` instead of the name disappearing. Both frames are the same
    // rectangle round the same two cards, so the path is a true name for the
    // whole of it however much or little of it the reader can see — which is why
    // this is the one test in the group that is asked both ways and answers the
    // same.
    for (const seen of [
      ANYWHERE,
      through(JUST, soleCards, 700),
      through(JUST, soleCards, 4000),
    ]) {
      const bars = barsFor(sole, new Set(["app/home"]), JUST, seen);

      expect(bars.get("app")?.label).toBe("app/home");
      expect(bars.get("app")?.absorbed).toEqual(["app/home"]);
      // And the fold still did what folds are for: one bar where there were two.
      expect(bars.has("app/home")).toBe(false);
      expect(bars.get("app")?.slot).toBe(1);
    }
  });

  it("absorbs nothing while the box beside the folded one is on screen", () => {
    // This used to claim that `src` holding `home` and `pages` absorbs neither,
    // full stop — "true at any scroll position, which is why this is asked well
    // past the threshold". Half of that survives and is what is asserted here: a
    // bar reading `src/home` across the whole of `src` would be written over
    // `pages`'s cards, which are in `src` and are not in `src/home`, and the
    // reader is told what the frame is and then finds things in it the name does
    // not cover. The other half — that it is true wherever the reader happens to
    // be — is the test after this one, inverted.
    const seen = through(JUST, besideCards, 1000);
    const pages = beside[2]!;
    expect(onScreen(seen, pages)).toBe(true);

    const bars = barsFor(beside, new Set(["src/home"]), JUST, seen);

    expect(bars.get("src")?.label).toBe("src");
    expect(bars.get("src")?.absorbed).toEqual([]);
    // The sibling that is still open keeps its own bar, its own name and the
    // slot below its parent's.
    expect(bars.get("src/pages")?.label).toBe("pages");
    expect(bars.get("src/pages")?.slot).toBe(2);

    // And folding the sibling too is not a second question. There is no rule
    // here choosing between two names, which the first version of this needed
    // and could only answer by an accident of array order.
    const both = barsFor(
      beside,
      new Set(["src/home", "src/pages"]),
      JUST,
      seen,
    );
    expect(both.get("src")?.label).toBe("src");
    expect([...both.keys()]).toEqual(["src"]);
  });

  it("absorbs the folded one once that box has gone off the bottom of the window", () => {
    // The inversion, and the assertion that changed sides. Same drawing, same
    // fold, a window short enough that `pages` is below it: everything inside
    // `src` that the reader can see is inside `src/home`, so `src/home` is a
    // true name for the frame in front of them and `home` is named instead of
    // lost. The old rule read `src` here and left a folded folder with no name
    // anywhere.
    const seen = through(JUST, besideCards, 400);
    const home = beside[1]!;
    const pages = beside[2]!;
    expect(onScreen(seen, home)).toBe(true);
    expect(onScreen(seen, pages)).toBe(false);
    expect(onScreen(seen, besideCards["p1"]!)).toBe(false);

    const bars = barsFor(beside, new Set(["src/home"]), JUST, seen);
    expect(bars.get("src")?.label).toBe("src/home");
    expect(bars.get("src")?.absorbed).toEqual(["src/home"]);
  });

  it("absorbs nothing while a frame is on screen whose first card is not", () => {
    // Why the frames are asked and not only the cards, which is the one place
    // the two possible rules part company. The window here clips the top twenty
    // units of `pages`: its border and its header are on screen and its first
    // card is still below the fold, so a rule that only looked at cards would
    // absorb — and the reader would watch a rectangle open beneath a bar that
    // has just claimed everything in front of them is inside `src/home`.
    const seen = through(NEAR, besideCards, 400);
    const pages = beside[2]!;
    expect(onScreen(seen, pages)).toBe(true);
    expect(onScreen(seen, besideCards["p1"]!)).toBe(false);
    expect(onScreen(seen, besideCards["p2"]!)).toBe(false);

    const bars = barsFor(beside, new Set(["src/home"]), NEAR, seen);
    expect(bars.get("src")?.label).toBe("src");
    expect(bars.get("src")?.absorbed).toEqual([]);
  });

  it("absorbs nothing while a card of the box's own is on screen outside the folded one", () => {
    // This used to claim that a box holding a card outside the folded folder
    // absorbs nothing, as a fact about the box: "one child box and it is folded
    // and out of sight, so two of the three conditions hold and the card count
    // is the whole of what refuses this". The card is still the whole of what
    // refuses it — `src` has a file of its own and `src/home` is not where that
    // file is — but the refusal is now about that file being on screen.
    const seen = through(JUST, looseCards, 1000);
    const home = loose[1]!;
    expect(onScreen(seen, home)).toBe(true);
    expect(onScreen(seen, looseCards["readme"]!)).toBe(true);

    const bars = barsFor(loose, new Set(["src/home"]), JUST, seen);

    expect(bars.get("src")?.label).toBe("src");
    expect(bars.get("src")?.absorbed).toEqual([]);
    expect(bars.has("src/home")).toBe(false);
  });

  it("absorbs the folded one once that card has gone off the bottom of the window", () => {
    // And its inversion. A card sitting directly in `src` is the half of the
    // original `src / app / profile / laborer` complaint that no frame would
    // ever speak for, which is why the cards are asked one by one rather than
    // left to the boxes around them — and it is also why this case is a pair
    // rather than an absolute: a file the reader cannot see is not a file the
    // label is misdescribing to them.
    const seen = through(JUST, looseCards, 400);
    expect(onScreen(seen, looseCards["readme"]!)).toBe(false);
    expect(onScreen(seen, looseCards["h1"]!)).toBe(true);

    const bars = barsFor(loose, new Set(["src/home"]), JUST, seen);
    expect(bars.get("src")?.label).toBe("src/home");
    expect(bars.get("src")?.absorbed).toEqual(["src/home"]);
  });

  it("asks the question sideways as well as down the page", () => {
    // Two folders in the same band, one to the left of the window and one to the
    // right of it. A folder box is routinely wider than the screen, so a reader
    // panning across a change leaves boxes behind sideways exactly as they leave
    // them behind by scrolling, and a rule that only watched the scroll would
    // call `pages` visible while it sat several columns off the edge.
    const held = JUST;
    const home = apart[1]!;
    const pages = apart[2]!;

    const onHome = through(held, apartCards, 900, { left: -100, width: 1000 });
    expect(onScreen(onHome, home)).toBe(true);
    expect(onScreen(onHome, pages)).toBe(false);
    const absorbing = barsFor(apart, new Set(["src/home"]), held, onHome);
    expect(absorbing.get("src")?.label).toBe("src/home");

    // Pan out until both are in the window and the path stops being true of what
    // is in front of the reader, which is the moment it stops being drawn.
    const onBoth = through(held, apartCards, 900, { left: -100, width: 2200 });
    expect(onScreen(onBoth, home)).toBe(true);
    expect(onScreen(onBoth, pages)).toBe(true);
    const refusing = barsFor(apart, new Set(["src/home"]), held, onBoth);
    expect(refusing.get("src")?.label).toBe("src");
    expect(refusing.get("src")?.absorbed).toEqual([]);
  });

  it("absorbs nothing while two children could each claim the whole box", () => {
    // The condition about there being exactly one child, held on its own rather
    // than left to the card comparison to imply. On a real drawing it is
    // implied: sibling boxes hold different cards, so a parent with two of them
    // has cards outside either. This fixture is the case that cannot arise, and
    // it is here because the implementation reads the first element of a
    // filtered array — which is the exact shape of the rule the first version
    // of this feature had to be rescued from, where a bar read `common/util` on
    // one machine and `common/mediaGroup` on another with the same change in
    // front of it, and neither was wrong in a way anybody could report.
    //
    // What it used to claim was that two children refuse the walk whatever the
    // reader is doing. It now claims that two children *on screen* do, which is
    // the same guarantee against choosing between them: the absorbed child has
    // to be the one box in sight, so there is never more than one candidate.
    const twins: Barred[] = [
      { path: "a", depth: 1, nodes: ["one", "two"], x: 0, width: 800, y: 0, height: 900 },
      {
        path: "a/b",
        depth: 2,
        nodes: ["one", "two"],
        x: 40,
        width: 720,
        y: 150,
        height: 300,
      },
      {
        path: "a/c",
        depth: 2,
        nodes: ["one", "two"],
        x: 40,
        width: 720,
        y: 500,
        height: 300,
      },
    ];
    const spots: Record<string, Spread> = {
      one: { x: 80, y: 220, width: 250, height: 150 },
      two: { x: 400, y: 220, width: 250, height: 150 },
    };
    const seen = through(JUST, spots, 800);
    expect(onScreen(seen, twins[1]!)).toBe(true);
    expect(onScreen(seen, twins[2]!)).toBe(true);

    for (const order of [
      twins,
      [twins[1]!, twins[2]!, twins[0]!],
      [twins[2]!, twins[0]!, twins[1]!],
    ]) {
      for (const where of [seen, ANYWHERE]) {
        const bars = barsFor(order, new Set(["a/b", "a/c"]), PAST, where);
        expect(bars.get("a")?.label).toBe("a");
        expect(bars.get("a")?.absorbed).toEqual([]);
      }
    }
  });

  it("absorbs nothing when no box inside this one is on screen at all", () => {
    // The reader scrolled clean past everything the box holds. There is no child
    // in sight to take a name from, so the bar says its own name — which is the
    // conservative end of the rule and is what makes the choice above
    // deterministic: the absorbed child must be the one that is visible, so a
    // parent with two invisible children has no candidate rather than two.
    //
    // Nothing is lost by it. Every card `app` has is inside `app/home`, so if
    // `app/home` has left the window then so has everything in `app`, and
    // `app`'s own bar is sliding out at the foot of its box as this is asked.
    const held = looking(1, 2000);
    const seen = through(held, soleCards, 700);
    expect(onScreen(seen, sole[1]!)).toBe(false);

    const bars = barsFor(sole, new Set(["app/home"]), held, seen);
    expect(bars.get("app")?.label).toBe("app");
    expect(bars.get("app")?.absorbed).toEqual([]);
    // And the same reader, with the window unmeasured, gets the older answer —
    // which is what "an unmeasured window means the whole drawing" buys.
    const anywhere = barsFor(sole, new Set(["app/home"]), held, ANYWHERE);
    expect(anywhere.get("app")?.label).toBe("app/home");
  });

  it("absorbs nothing from a child that still draws its own bar", () => {
    // An open folder is already saying its name a header lower and holding it
    // there, so there is nothing for the bar above to say on its behalf. Sole
    // occupancy is not on its own a reason to concatenate, and neither is being
    // scrolled past, and neither is being the only thing on screen — a fold is.
    const bars = barsFor(sole, new Set(), PAST, ANYWHERE);

    expect(bars.get("app")?.label).toBe("app");
    expect(bars.get("app")?.absorbed).toEqual([]);
    expect(bars.get("app/home")?.label).toBe("home");
    expect(bars.get("app/home")?.slot).toBe(2);
  });

  it("gives every bar its own name when nothing is folded", () => {
    const chain: Barred[] = [
      { path: "a", depth: 1, nodes: ["one", "two"], x: 0, width: 800, y: 0, height: 900 },
      {
        path: "a/b",
        depth: 2,
        nodes: ["one", "two"],
        x: 40,
        width: 720,
        y: 150,
        height: 700,
      },
      {
        path: "a/b/c",
        depth: 3,
        nodes: ["one", "two"],
        x: 80,
        width: 640,
        y: 300,
        height: 500,
      },
    ];
    const bars = barsFor(chain, new Set(), PAST, ANYWHERE);
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
 * And when it says it, which is the half of the rule the reader reported first.
 *
 * A folded folder's name is handed up to the bar above for exactly as long as
 * the folder's own header cannot be read where it belongs, and handed back the
 * moment it can. So this is a claim about scroll and it is tested as one: the
 * same drawing, the same fold, the reader in two places.
 *
 * The window is the unmeasured one throughout, on purpose. This describe isolates
 * the threshold, and a real window would put a second reason for the label to
 * change into every assertion in it — the describe above is where sight is
 * varied, and here nothing may be off screen so that anything which moves has
 * moved because of the scroll.
 *
 * Every assertion here is made at three zooms, and that is not ceremony. The two
 * quantities in this decision are a bar measured in window pixels and a header
 * measured in canvas units, and every fault this feature has produced has been a
 * conversion between them that was exactly right at scale one — which is the
 * only scale a screenshot shows, and the scale a developer happens to be at.
 *
 * The threshold is `pinHead`'s and the tests borrow it rather than restating it.
 * `crossing` below finds the scroll position where the stack's own arithmetic
 * changes its mind, by bisection, without writing down a formula of its own; so
 * a test that passes is a test saying the label and the stack agree, rather than
 * a test saying the label agrees with a number typed into this file.
 */
describe("when a folded folder's name moves up into the bar above it", () => {
  /**
   * The scroll position at which a folded box's own header would begin to pin.
   *
   * Found by asking `pinHead`, narrowing on the answer rather than solving for
   * it. `pinHead` rises from nought as the reader scrolls and never falls, so
   * there is one crossing and a bisection finds it; and the point of doing it
   * this way is that nothing here knows what `headLine` computes. Somebody who
   * changes the rounding inside `heading.ts` moves this and the page together,
   * which is the only way the two can be checked against each other at all.
   */
  function crossing(
    scale: number,
    box: { y: number; height: number },
    slot: number,
  ): number {
    let below = -100_000;
    let above = 100_000;
    for (let step = 0; step < 80; step += 1) {
      const mid = (below + above) / 2;
      const held = looking(scale, mid);
      if (pinHead(held, { y: box.y, height: box.height, depth: slot }) > 0) {
        above = mid;
      } else {
        below = mid;
      }
    }
    return above;
  }

  it("reads only its own name while the folded header can still be read, at every zoom", () => {
    // The reader sitting where `home`'s box begins. `home` says `home` on its
    // own frame and `app` says `app` across the frame above it, and neither
    // repeats the other. This is the state the report was about: absorbing here
    // is the drawing saying `home` twice a few lines apart.
    for (const scale of ZOOMS) {
      const { boxes, app, home } = occupied();
      const held = looking(scale, home.y - 100);
      const bars = barsFor(boxes, new Set([home.path]), held, ANYWHERE);

      // Said first, because everything below is worthless if the reader is
      // actually on the far side of the threshold.
      expect(outOfSight(boxes, bars, home.path, held)).toBe(false);
      expect(pinOf(bars, home, held)).toBe(0);

      expect(bars.get(app.path)?.label).toBe("app");
      expect(bars.get(app.path)?.absorbed).toEqual([]);
      // And `home`'s header is where `home` is, which is where it always is.
      expect(headAt(held, bars, home)).toBeCloseTo(held.y + home.y * scale, 6);
    }
  });

  it("reads the merged path once the folded header has gone behind the stack, at every zoom", () => {
    // And the reader scrolled on. `home`'s header has passed behind `app`'s bar,
    // so the name would be gone; it is on `app`'s bar instead, as a segment that
    // presses back. This is the whole of what absorption is for.
    for (const scale of ZOOMS) {
      const { boxes, app, home } = occupied();
      const held = looking(scale, home.y + 100);
      const bars = barsFor(boxes, new Set([home.path]), held, ANYWHERE);

      expect(outOfSight(boxes, bars, home.path, held)).toBe(true);
      // Still not pinned, which is the promise folding made and which absorbing
      // must not quietly undo by putting the header back in the stack.
      expect(pinOf(bars, home, held)).toBe(0);

      expect(bars.get(app.path)?.label).toBe("app/home");
      expect(bars.get(app.path)?.absorbed).toEqual([home.path]);
      // `app`'s bar has not moved down to make room for the longer name: the
      // slot is the same number it was, because absorbing a name does not add a
      // bar to the stack.
      expect(bars.get(app.path)?.slot).toBe(2);
    }
  });

  it("hands the name back when the reader scrolls up again, at every zoom", () => {
    // The reverse transition, which is the thing a one-way implementation would
    // pass the two tests above and fail. Scrolled down, scrolled back, and the
    // drawing is exactly the drawing it was — the same label, the same empty
    // absorbed list, and `home` saying its own name on its own frame again.
    for (const scale of ZOOMS) {
      const { boxes, app, home } = occupied();
      const folded = new Set([home.path]);
      const near = looking(scale, home.y - 100);
      const far = looking(scale, home.y + 400);

      const there = barsFor(boxes, folded, near, ANYWHERE);
      const gone = barsFor(boxes, folded, far, ANYWHERE);
      const back = barsFor(boxes, folded, near, ANYWHERE);

      expect(there.get(app.path)?.label).toBe("app");
      expect(gone.get(app.path)?.label).toBe("app/home");
      expect(back.get(app.path)?.label).toBe("app");
      expect(back.get(app.path)?.absorbed).toEqual([]);
      // Nothing was remembered between the calls, which is the failure this
      // shape of code invites: a walk that appended to a list held outside the
      // loop would come back from `far` with `home` still on it.
      expect([...back].map(([path, bar]) => [path, bar.label])).toEqual(
        [...there].map(([path, bar]) => [path, bar.label]),
      );
    }
  });

  it("changes its mind exactly where the stack changes its, at every zoom", () => {
    // The claim the whole design rests on: one threshold, not two. The label
    // flips on the same side of the same line that `pinHead` flips on, so there
    // is no stretch of scroll where `app` reads `app / home` over a legible
    // `home`, and none where `home` has gone behind the bar with its name
    // nowhere. A second opinion about the line would show up here as a gap of a
    // fraction of a header, which is a fraction of a pixel pulled back and
    // several pixels zoomed in.
    for (const scale of ZOOMS) {
      const { boxes, app, home } = occupied();
      const folded = new Set([home.path]);
      const anywhere = barsFor(boxes, folded, UNSCROLLED, ANYWHERE);
      const slot = wouldSit(boxes, anywhere, home.path);
      // The line under `app`'s bar, which is where `home` would have been held.
      expect(slot).toBe((anywhere.get(app.path)?.slot ?? 0) + 1);

      const line = crossing(scale, home, slot);
      const hair = 1e-6;

      const just = barsFor(boxes, folded, looking(scale, line - hair), ANYWHERE);
      const over = barsFor(boxes, folded, looking(scale, line + hair), ANYWHERE);

      expect(just.get(app.path)?.label).toBe("app");
      expect(over.get(app.path)?.label).toBe("app/home");
    }
  });

  it("deepens the path one folder at a time as the reader scrolls, at every zoom", () => {
    // A chain of sole occupants does not arrive all at once. `b` goes behind the
    // stack before `c` does, because `c`'s box begins further down, so the bar
    // reads `a`, then `a/b`, then `a/b/c` as the reader goes — each name handed
    // up at the moment it stops being readable and not before. The unconditional
    // version of this drew `a/b/c` from the first frame, with `b` and `c` both
    // legible underneath it.
    const chain: Barred[] = [
      { path: "a", depth: 1, nodes: ["one", "two"], x: 0, width: 800, y: 0, height: 900 },
      {
        path: "a/b",
        depth: 2,
        nodes: ["one", "two"],
        x: 40,
        width: 720,
        y: 150,
        height: 700,
      },
      {
        path: "a/b/c",
        depth: 3,
        nodes: ["one", "two"],
        x: 80,
        width: 640,
        y: 300,
        height: 500,
      },
    ];
    const folded = new Set(["a/b", "a/b/c"]);
    for (const scale of ZOOMS) {
      const read = (at: number) =>
        barsFor(chain, folded, looking(scale, at), ANYWHERE).get("a")?.label;

      // `b` and `c` both draw their headers where their boxes are.
      expect(read(0)).toBe("a");
      // `b` has gone behind `a`'s bar; `c`'s box has not reached it yet.
      expect(read(200)).toBe("a/b");
      // And now both have.
      expect(read(600)).toBe("a/b/c");

      // Stated once more as the three crossings in order, so that a fixture
      // which stopped producing the staggering could not turn the three
      // assertions above into three readings of the same position.
      const bars = barsFor(chain, folded, UNSCROLLED, ANYWHERE);
      const atB = crossing(scale, chain[1]!, wouldSit(chain, bars, "a/b"));
      const atC = crossing(scale, chain[2]!, wouldSit(chain, bars, "a/b/c"));
      expect(atB).toBeLessThan(atC);
    }
  });
});

/**
 * The same rule again, read off a drawing rather than off a fixture.
 *
 * Everything above hands `barsFor` `Barred` literals for the shape of the rule,
 * which is the right way to state a rule and no way at all to claim that a real
 * change ever produces the shape the rule is about. A hand-built parent and
 * child can be given any relationship somebody types, and can be given any
 * geometry too. So this asks `place()` for a drawing and then asks whether the
 * boxes it actually drew are in the position the rule describes, which is the
 * part that would quietly stop being true if the placement's idea of which
 * folders are worth a box ever moved.
 *
 * It is also the reader's first example: `app` whose only content is `home`.
 */
describe("a bar reading a path off a drawing that was really placed", () => {
  /** Scrolled past every header in this fixture. */
  const PAST = looking(1, 5000);

  it("absorbs the sole occupant and leaves the crowded box alone", () => {
    const { boxes, root, app, home, media } = occupied();

    // The shape the rest of this rests on, said out loud so that a placement
    // that stopped producing it could not turn the assertions below into a
    // check of two boxes nobody would recognise.
    expect(home.nodes.length).toBe(app.nodes.length);
    expect(root.nodes.length).toBeGreaterThan(app.nodes.length);
    expect(media.nodes.length).toBeLessThan(home.nodes.length);

    const bars = barsFor(boxes, new Set([home.path]), PAST, ANYWHERE);

    // `app` is `app/home` and says so.
    expect(bars.get(app.path)?.label).toBe("app/home");
    expect(bars.get(app.path)?.absorbed).toEqual([home.path]);
    // `labura` is not: it holds `docs` and a file of its own, neither of which
    // is anywhere under `app` — and with the whole drawing in sight, that is
    // true of the screen as well as of the change.
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
    // for half of it — and with the whole drawing in sight, the other half is on
    // screen.
    const { boxes, app, home, media } = occupied();
    const bars = barsFor(boxes, new Set([home.path, media.path]), PAST, ANYWHERE);

    expect(bars.get(app.path)?.label).toBe("app/home");
    expect(bars.get(app.path)?.absorbed).toEqual([home.path]);
    // `media` is folded and absorbed by nobody, so it keeps its header on its
    // own frame and keeps it out of the stack.
    expect(bars.has(media.path)).toBe(false);
  });
});

/**
 * The recording, reproduced.
 *
 * A parent holding three folder chains, the reader scrolling down through one of
 * them, and the fault that made this the fifth reading of the absorption rule: at
 * the bottom of that scroll `app`'s header and `home`'s header have both gone
 * behind the stack, `frontend`'s bar is the only one left on the screen, and it
 * reads `frontend`. Two folded folders named nowhere at all, which is the exact
 * failure absorbing exists to prevent, and it happened because sole occupancy was
 * asked of the drawing — where `frontend` has three children and always will —
 * rather than of the window, where it has one.
 *
 * Stated at three zooms like everything else about this feature, and the fixture
 * is built with its bands well apart so that a window holds one of them at every
 * one of those zooms. That separation is doing real work and is not padding: at
 * the zoom the reader was actually at, one folder chain fills the screen, and a
 * fixture whose three chains all fit in the window at four tenths would be a
 * fixture that could only ever assert the old answer.
 */
describe("a parent holding three folder chains, scrolled down through one of them", () => {
  /**
   * The shape of the drawing, asserted rather than assumed.
   *
   * Everything below turns on `frontend` really having three boxes directly
   * inside it and on the middle chain really being two boxes deep with the inner
   * one holding every card of the outer. A placement that stopped producing that
   * would turn every assertion in this describe into a reading of some other
   * drawing, and all of them would still pass.
   */
  it("is really three chains under one parent, with the middle one two deep", () => {
    const { boxes, root, mui, app, home, media, web } = three();

    const children = boxes.filter((box) => box.depth === 2);
    expect(children.map((box) => box.path).sort()).toEqual(
      [mui.path, app.path, web.path].sort(),
    );
    expect(root.depth).toBe(1);
    expect(home.depth).toBe(3);
    expect(media.depth).toBe(4);
    // `home` is the whole of `app`, which is what makes the chain absorbable at
    // all; `media` is not the whole of `home`, which is where the walk stops.
    expect(home.nodes.length).toBe(app.nodes.length);
    expect(media.nodes.length).toBeLessThan(home.nodes.length);
    // And the bands stand clear of each other, which is what lets a window hold
    // one of them and not the others.
    expect(mui.y + mui.height).toBeLessThan(app.y);
    expect(app.y + app.height).toBeLessThan(web.y);
  });

  it("reads its own name while the chain's first header is still in place, at every zoom", () => {
    // The early frame. `frontend` is pinned at the top, `app` and `home` are both
    // saying their own names on their own frames further down, and `frontend`
    // says `frontend`. Absorbing here would be the drawing saying `app` twice a
    // few lines apart, which is the complaint the fourth condition answered.
    for (const scale of ZOOMS) {
      const { boxes, spots, root, app, home, mui, web, reading } = three();
      const folded = new Set([app.path, home.path]);
      const held = looking(scale, reading.early);
      const seen = through(held, spots, TALL);
      const bars = barsFor(boxes, folded, held, seen);

      // The reader really is on this side of the threshold, and the other two
      // chains really are off the screen — so what is asserted below is about
      // the header and not about a sibling.
      expect(outOfSight(boxes, bars, app.path, held)).toBe(false);
      expect(onScreen(seen, app)).toBe(true);
      expect(onScreen(seen, mui)).toBe(false);
      expect(onScreen(seen, web)).toBe(false);

      expect(bars.get(root.path)?.label).toBe("frontend");
      expect(bars.get(root.path)?.absorbed).toEqual([]);
    }
  });

  it("takes the first folder once its header has gone and the second is still in place, at every zoom", () => {
    // The middle frame, which the recording also shows and which nothing before
    // this named: `app` has gone behind the stack and `home` has not. One name
    // goes up and one stays where it is, so the reader reads `frontend / app` at
    // the top and `home` on its own frame below, each folder named exactly once.
    for (const scale of ZOOMS) {
      const { boxes, spots, root, app, home, reading } = three();
      const folded = new Set([app.path, home.path]);
      const held = looking(scale, reading.partway);
      const seen = through(held, spots, TALL);
      const bars = barsFor(boxes, folded, held, seen);

      expect(outOfSight(boxes, bars, app.path, held)).toBe(true);
      expect(outOfSight(boxes, bars, home.path, held)).toBe(false);

      expect(bars.get(root.path)?.label).toBe("frontend/app");
      expect(bars.get(root.path)?.absorbed).toEqual([app.path]);
    }
  });

  it("reads the whole folded chain once both headers have gone, at every zoom", () => {
    // The frame the reader stopped on. Neither `app` nor `home` is named
    // anywhere on the screen unless the bar says so, and the bar now says so.
    // This is the assertion that failed before the sight rule: `frontend` holds
    // three children, so the old test of sole occupancy refused here and went on
    // refusing however far anybody scrolled.
    for (const scale of ZOOMS) {
      const { boxes, spots, root, app, home, media, mui, web, reading } = three();
      const folded = new Set([app.path, home.path]);
      const held = looking(scale, reading.deep);
      const seen = through(held, spots, TALL);
      const bars = barsFor(boxes, folded, held, seen);

      expect(outOfSight(boxes, bars, app.path, held)).toBe(true);
      expect(outOfSight(boxes, bars, home.path, held)).toBe(true);
      // The other two chains are nowhere near the window, which is the whole of
      // why the path is honest here.
      expect(onScreen(seen, mui)).toBe(false);
      expect(onScreen(seen, web)).toBe(false);
      expect(onScreen(seen, spots["m1"]!)).toBe(false);
      expect(onScreen(seen, spots["w1"]!)).toBe(false);

      expect(bars.get(root.path)?.label).toBe("frontend/app/home");
      expect(bars.get(root.path)?.absorbed).toEqual([app.path, home.path]);
      // And the walk stops where it should: `media` holds half of `home`, so the
      // path does not run on into it, and `media` goes on drawing its own bar a
      // slot below `frontend`'s.
      expect(bars.get(media.path)?.label).toBe("media");
      expect(bars.get(media.path)?.slot).toBe(2);
      // Neither folded folder has crept back into the stack on the way up.
      expect(bars.has(app.path)).toBe(false);
      expect(bars.has(home.path)).toBe(false);
      expect(pinOf(bars, app, held)).toBe(0);
      expect(pinOf(bars, home, held)).toBe(0);
    }
  });

  it("hands the chain back when the reader scrolls up again, at every zoom", () => {
    // Down and back, in one test, because a rule that only ever gains segments
    // would pass the three above and leave `frontend / app / home` written over
    // `app`'s own header once the reader returned to it.
    for (const scale of ZOOMS) {
      const { boxes, spots, root, app, home, reading } = three();
      const folded = new Set([app.path, home.path]);

      const label = (at: number) => {
        const held = looking(scale, at);
        return barsFor(boxes, folded, held, through(held, spots, TALL)).get(
          root.path,
        )?.label;
      };

      expect(label(reading.early)).toBe("frontend");
      expect(label(reading.deep)).toBe("frontend/app/home");
      expect(label(reading.early)).toBe("frontend");
    }
  });

  it("read its own name at all three of those positions before the sight rule", () => {
    // What the recording actually showed, kept as a test so that the change is a
    // change and not a claim about one. Asked of the same drawing at the same
    // three places with the window unmeasured — which is the module's stand-in
    // for the old whole-drawing reading — `frontend` says `frontend` throughout,
    // including at the position where the reader could see neither folded name
    // anywhere on the screen.
    for (const scale of ZOOMS) {
      const { boxes, root, app, home, reading } = three();
      const folded = new Set([app.path, home.path]);
      for (const at of [reading.early, reading.partway, reading.deep]) {
        const bars = barsFor(boxes, folded, looking(scale, at), ANYWHERE);
        expect(bars.get(root.path)?.label).toBe("frontend");
      }
    }
  });

  it("gives the chain up again when the reader scrolls on to the next one", () => {
    // The honest limit, in the drawing it was found in. Scroll past `app`
    // entirely and into `web/src`, and `frontend`'s bar reads `frontend` again —
    // because `web/src` is the box in front of the reader now and `frontend /
    // app / home` would be a name for a rectangle they are no longer looking at.
    //
    // What that costs is recorded rather than hidden: `app` and `home` are named
    // nowhere at this position. They are also entirely off the screen, along with
    // every card in them, so what has been lost is a way back to two folders the
    // reader can see no trace of — and the alternative is a bar that describes
    // the part of the drawing they have left.
    for (const scale of ZOOMS) {
      const { boxes, spots, root, app, home, web, reading } = three();
      const folded = new Set([app.path, home.path]);
      const held = looking(scale, reading.beyond);
      const seen = through(held, spots, TALL);
      const bars = barsFor(boxes, folded, held, seen);

      expect(onScreen(seen, web)).toBe(true);
      expect(onScreen(seen, app)).toBe(false);
      expect(onScreen(seen, home)).toBe(false);

      expect(bars.get(root.path)?.label).toBe("frontend");
      expect(bars.get(root.path)?.absorbed).toEqual([]);
      expect(bars.get(web.path)?.label).toBe("src");
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
    const bars = barsFor(boxes, new Set([MIDDLE]), UNSCROLLED, ANYWHERE);

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
      const held = looking(scale, inner.y);
      const bars = barsFor(boxes, new Set([MIDDLE]), held, ANYWHERE);

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
    const bars = barsFor(
      boxes,
      new Set([MIDDLE, inner.path]),
      UNSCROLLED,
      ANYWHERE,
    );

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
    const open = barsFor(boxes, new Set(), UNSCROLLED, ANYWHERE);
    const shut = barsFor(boxes, new Set([MIDDLE]), UNSCROLLED, ANYWHERE);

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
    expect(
      barsAbove(boxes, barsFor(boxes, new Set(), UNSCROLLED, ANYWHERE)).get(
        "a1",
      ),
    ).toBe(2);
    expect(
      barsAbove(
        boxes,
        barsFor(boxes, new Set([MIDDLE]), UNSCROLLED, ANYWHERE),
      ).get("a1"),
    ).toBe(2);
  });

  it("gives no entry to a card no box holds, which the caller reads as nought", () => {
    const { boxes } = nested();
    const above = barsAbove(
      boxes,
      barsFor(boxes, new Set(), UNSCROLLED, ANYWHERE),
    );
    expect(above.has("nobody")).toBe(false);
    expect(above.get("nobody") ?? 0).toBe(0);
  });
});

/**
 * The way back out of a fold, which is what makes all of this safe to ship.
 *
 * A folded folder has to be openable again, and this feature has already shipped
 * once without that being true: two folded siblings under a parent that could
 * absorb neither left two folders with no bar, no way back and nothing anywhere
 * that undid the gesture which removed them. The reader had lost two folders.
 *
 * So the arrangement is two states and a single threshold between them. While a
 * folded box's own header can be read where it belongs, that header carries a
 * chevron which unfolds the folder. Once it has gone behind the stack, its name
 * is a pressable segment of the bar above. The threshold is one comparison, so
 * the two cannot both be false — which is the property the old design could not
 * state, because it balanced two conditions that could both decline.
 *
 * The honest limit is written down here rather than left to be discovered, and
 * the sight rule moved it rather than removing it. A folded folder whose parent
 * cannot absorb it is named on its own header and nowhere else. What "cannot
 * absorb it" means has changed from a fact about the drawing — which fixed the
 * set of losable folders the moment the boxes were built — to a fact about what
 * is on screen, so the invariant below is stated against the screen: a folded
 * folder is named in exactly one place at every scroll position at which its own
 * frame can be seen. A folder whose frame the reader can see is a folder they can
 * reach, and that is the whole of what reachability was ever about.
 *
 * Two stretches sit outside it and they are different in kind. A sibling band
 * coming into view takes the name off the bar above, because the path has stopped
 * being true of the screen and the only way to keep it would be to describe a
 * rectangle the reader can see it does not describe. And the folded box's own
 * frame leaving the window takes it too, at which point nothing inside that box
 * is on screen at all and the bar that would have carried the name is itself
 * sliding out at the foot of its box. Both are recorded below as tests so that
 * the next person weighing this knows both were weighed.
 */
describe("the way back from a fold, which is a chevron or a segment and never neither", () => {
  const chain: Barred[] = [
    { path: "a", depth: 1, nodes: ["one", "two"], x: 0, width: 800, y: 0, height: 900 },
    {
      path: "a/b",
      depth: 2,
      nodes: ["one", "two"],
      x: 40,
      width: 720,
      y: 150,
      height: 700,
    },
    {
      path: "a/b/c",
      depth: 3,
      nodes: ["one", "two"],
      x: 80,
      width: 640,
      y: 300,
      height: 500,
    },
  ];

  const siblings: Barred[] = [
    {
      path: "a",
      depth: 1,
      nodes: ["one", "two", "three"],
      x: 0,
      width: 800,
      y: 0,
      height: 900,
    },
    {
      path: "a/b",
      depth: 2,
      nodes: ["one", "two"],
      x: 40,
      width: 720,
      y: 150,
      height: 300,
    },
    { path: "a/c", depth: 2, nodes: ["three"], x: 40, width: 720, y: 550, height: 300 },
  ];

  /** Where the cards of those two fixtures sit, inside the deepest box holding them. */
  const chainCards: Record<string, Spread> = {
    one: { x: 120, y: 360, width: 250, height: 200 },
    two: { x: 400, y: 360, width: 250, height: 200 },
  };
  const siblingCards: Record<string, Spread> = {
    one: { x: 80, y: 220, width: 250, height: 150 },
    two: { x: 400, y: 220, width: 250, height: 150 },
    three: { x: 80, y: 620, width: 250, height: 150 },
  };

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

  /** A sweep of the drawing from above it to well past the end of it. */
  const SCROLLS = [-500, 0, 100, 200, 300, 400, 600, 900, 2000];

  /**
   * Where a folder's name can actually be read and pressed, as things stand.
   *
   * Three possibilities and they are meant to be mutually exclusive: its own bar
   * while it is in the stack, its own header in place while it is folded and
   * still visible, and a segment of somebody's bar once it is folded and is not.
   * This used to be able to return nothing at all, and returning nothing at all
   * was the bug.
   */
  function namedAt(
    boxes: readonly Barred[],
    bars: ReturnType<typeof barsFor>,
    path: string,
    held: Held,
  ): string[] {
    const where: string[] = [];
    if (bars.has(path)) where.push("its own bar, in the stack");
    else if (!outOfSight(boxes, bars, path, held)) {
      where.push("its own header, in place");
    }
    for (const [owner, bar] of bars) {
      if (bar.absorbed.includes(path)) where.push(`a segment of ${owner}`);
    }
    return where;
  }

  it("gives a bar to every box when nothing is folded at all", () => {
    // Which is the state the reader starts in, and the one where a header
    // sitting outside the stack would be a fold nobody asked for.
    for (const [boxes, spots] of [
      [chain, chainCards],
      [siblings, siblingCards],
    ] as const) {
      for (const at of SCROLLS) {
        const held = looking(1, at);
        for (const seen of [ANYWHERE, through(held, spots, 700)]) {
          const bars = barsFor(boxes, new Set(), held, seen);
          expect(boxes.filter((box) => !bars.has(box.path))).toEqual([]);
          for (const box of boxes) {
            expect(namedAt(boxes, bars, box.path, held)).toEqual([
              "its own bar, in the stack",
            ]);
          }
        }
      }
    }
  });

  it("names a folded sole occupant in exactly one place, at every fold and every scroll", () => {
    // The invariant, over every fold of the chain and the whole sweep down it,
    // with the window unmeasured — so this is the property exactly as it was
    // stated before the sight rule, and it still holds. Exactly one: never
    // nowhere, which is the folder the reader has lost, and never twice, which
    // is the folder named on its own header and again on the bar three lines
    // above it.
    for (const folded of everyFold(chain)) {
      for (const at of SCROLLS) {
        for (const scale of ZOOMS) {
          const held = looking(scale, at);
          const bars = barsFor(chain, folded, held, ANYWHERE);
          for (const box of chain) {
            const where = namedAt(chain, bars, box.path, held);
            expect({
              path: box.path,
              folded: [...folded],
              at,
              scale,
              where,
            }).toEqual({
              path: box.path,
              folded: [...folded],
              at,
              scale,
              where: [where[0]],
            });
            expect(where).toHaveLength(1);
          }
        }
      }
    }
  });

  it("names it in exactly one place through a real window too, wherever its frame is on screen", () => {
    // And the same invariant with a window that can actually leave things out,
    // which is the form the rule now takes: a folded folder whose frame the
    // reader can see is named in exactly one place. The chain has no siblings
    // anywhere in it, so the only thing that can take a name away is the frame
    // itself going off the window — and that is exactly the case this skips and
    // the test below records.
    //
    // The skip is counted so that a window which quietly stopped containing
    // anything could not turn this into a sweep over nothing at all.
    let asked = 0;
    for (const folded of everyFold(chain)) {
      for (const at of SCROLLS) {
        for (const scale of ZOOMS) {
          const held = looking(scale, at);
          const seen = through(held, chainCards, 700);
          const bars = barsFor(chain, folded, held, seen);
          for (const box of chain) {
            if (!onScreen(seen, box)) continue;
            asked += 1;
            expect({
              path: box.path,
              folded: [...folded],
              at,
              scale,
              where: namedAt(chain, bars, box.path, held),
            }).toEqual({
              path: box.path,
              folded: [...folded],
              at,
              scale,
              where: [namedAt(chain, bars, box.path, held)[0]],
            });
          }
        }
      }
    }
    expect(asked).toBeGreaterThan(100);
  });

  it("loses the name when the folded box's own frame leaves the window", () => {
    // The second of the two stretches outside the invariant, written down rather
    // than discovered. The reader has scrolled past the whole of `a`, so `a/b`
    // is folded, behind the stack, and off the screen — there is no child in
    // sight for `a` to take a name from, and `a` says its own name.
    //
    // Nothing readable is lost by it. `a` holds no card outside `a/b`, so if
    // `a/b` has left the window then every card in `a` has left it too, and `a`'s
    // own bar is sliding out at the foot of `a`'s box as this is asked. The way
    // back is a scroll upwards of any distance at all.
    const held = looking(1, 2000);
    const seen = through(held, chainCards, 700);
    const bars = barsFor(chain, new Set(["a/b"]), held, seen);

    expect(onScreen(seen, chain[1]!)).toBe(false);
    expect(namedAt(chain, bars, "a/b", held)).toEqual([]);
    expect(bars.get("a")?.label).toBe("a");
    // And the moment the frame is back in the window, so is the name.
    const back = looking(1, 400);
    const there = through(back, chainCards, 700);
    expect(onScreen(there, chain[1]!)).toBe(true);
    expect(
      namedAt(chain, barsFor(chain, new Set(["a/b"]), back, there), "a/b", back),
    ).toEqual(["a segment of a"]);
  });

  it("keeps a folded box out of the stack however it is named", () => {
    // Absorbing a name is not a way back into the stack. `a/b` folded has no
    // entry in the map at any scroll position, so the chrome the reader bought
    // stays bought whether or not its name has been handed up to `a`.
    for (const at of SCROLLS) {
      for (const scale of ZOOMS) {
        const held = looking(scale, at);
        for (const seen of [ANYWHERE, through(held, chainCards, 700)]) {
          const bars = barsFor(chain, new Set(["a/b"]), held, seen);
          expect(bars.has("a/b")).toBe(false);
          expect(bars.get("a")?.slot).toBe(1);
          expect(bars.get("a/b/c")?.slot).toBe(2);
        }
      }
    }
  });

  it("names a folded folder that cannot be absorbed on its own header", () => {
    // The other shape, and the first of the two limits. `a/b` sits beside `a/c`
    // and both are on the screen, so `a` cannot absorb it — the label would be
    // false of what the reader is looking at. While its header is visible that
    // header is the way back, which is the ordinary case and the one the whole
    // design is built for.
    const held = looking(1, 0);
    const seen = through(held, siblingCards, 900);
    expect(onScreen(seen, siblings[1]!)).toBe(true);
    expect(onScreen(seen, siblings[2]!)).toBe(true);
    const bars = barsFor(siblings, new Set(["a/b"]), held, seen);
    expect(namedAt(siblings, bars, "a/b", held)).toEqual([
      "its own header, in place",
    ]);
    expect(bars.get("a")?.label).toBe("a");

    // And scrolled past it, with the sibling still on the screen, the header goes
    // with its box — which is what an open folder's header does too once the
    // reader passes the foot of it. Recorded rather than asserted as desirable:
    // the alternative is writing `a/b` across a frame that visibly also holds
    // `a/c`.
    const past = looking(1, 500);
    const alongside = through(past, siblingCards, 900);
    expect(onScreen(alongside, siblings[2]!)).toBe(true);
    const gone = barsFor(siblings, new Set(["a/b"]), past, alongside);
    expect(namedAt(siblings, gone, "a/b", past)).toEqual([]);

    // Which is the stretch the sight rule shortened rather than removed. A
    // reader just past `a/b`'s header, with a window short enough that `a/c` is
    // below the bottom of it, gets the name on `a`'s bar — and under the old
    // whole-drawing rule there was no window at all that would, because `a/c`
    // existed.
    const near = looking(1, 200);
    const alone = through(near, siblingCards, 300);
    expect(onScreen(alone, siblings[1]!)).toBe(true);
    expect(onScreen(alone, siblings[2]!)).toBe(false);
    expect(onScreen(alone, siblingCards["three"]!)).toBe(false);
    const found = barsFor(siblings, new Set(["a/b"]), near, alone);
    expect(namedAt(siblings, found, "a/b", near)).toEqual(["a segment of a"]);
    expect(found.get("a")?.label).toBe("a/b");
    expect(
      barsFor(siblings, new Set(["a/b"]), near, ANYWHERE).get("a")?.label,
    ).toBe("a");
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
        const bars = barsFor(boxes, folded, UNSCROLLED, ANYWHERE);
        expect([...bars.keys()].every((path) => paths.includes(path))).toBe(true);
        expect(boxes.map((box) => box.path)).toEqual(paths);
      }
    }
  });

  it("takes a box's bar back the moment the reader unfolds it", () => {
    // Which is what pressing the chevron on a folded box's own header does, and
    // what pressing the segment that says its name does: the way back lands the
    // reader exactly where they were.
    const bars = barsFor(siblings, new Set(["a/b", "a/c"]), UNSCROLLED, ANYWHERE);
    expect([...bars.keys()]).toEqual(["a"]);
    expect(bars.get("a")?.absorbed).toEqual([]);

    const after = barsFor(siblings, new Set(["a/c"]), UNSCROLLED, ANYWHERE);
    expect(after.get("a/b")?.label).toBe("b");
    expect(after.get("a/b")?.slot).toBe(2);
    expect(after.has("a/c")).toBe(false);
  });

  it("answers the same way in every order the boxes may arrive in", () => {
    // The property that would fail silently: nothing here may depend on where a
    // box sits in the array it arrived in, and the slot loop, the folded lookup
    // and the walk that looks for an only child are all positioned to make that
    // easy to break. The walk is the most exposed, since `childrenOf` filters an
    // array, filters the answer again by what is on screen, and then asks how
    // long it is — and the slot it asks for on a folded box is counted by a
    // further pass over the same array.
    const past = looking(1, 5000);
    for (const order of orders(siblings)) {
      const bars = barsFor(order, new Set(["a/b", "a/c"]), past, ANYWHERE);
      expect([...bars.keys()]).toEqual(["a"]);
      expect(bars.get("a")?.label).toBe("a");
      expect(bars.get("a")?.absorbed).toEqual([]);
      expect(bars.get("a")?.slot).toBe(1);
    }

    // And through a window that leaves one of the two siblings out, which is the
    // order-sensitive case the sight rule adds: the walk now picks the child that
    // is on screen, and which array slot that child happens to sit in must not
    // change the answer.
    const held = looking(1, 200);
    const alone = through(held, siblingCards, 300);
    for (const order of orders(siblings)) {
      const bars = barsFor(order, new Set(["a/b"]), held, alone);
      expect(bars.get("a")?.label).toBe("a/b");
      expect(bars.get("a")?.absorbed).toEqual(["a/b"]);
    }

    for (const order of orders(chain)) {
      const bars = barsFor(order, new Set(["a/b"]), past, ANYWHERE);
      expect([...bars.keys()].sort()).toEqual(["a", "a/b/c"]);
      // The absorbing one, which is the reading that has an order to be
      // unstable about: `a` has one child here and the walk has to find it
      // wherever it was put.
      expect(bars.get("a")?.label).toBe("a/b");
      expect(bars.get("a")?.absorbed).toEqual(["a/b"]);
      expect(bars.get("a/b/c")?.slot).toBe(2);

      const both = barsFor(order, new Set(["a/b", "a/b/c"]), past, ANYWHERE);
      expect(both.get("a")?.label).toBe("a/b/c");
      expect(both.get("a")?.absorbed).toEqual(["a/b", "a/b/c"]);
    }
  });

  it("keeps an outermost box's bar even where the reader folded it", () => {
    // So an outermost box's header is never taken out of the stack and is never
    // absorbed into anything. There is no bar above it, and a drawing whose
    // top-level frames all sat outside the stack would be a change nobody could
    // say the shape of at a glance.
    const past = looking(1, 5000);
    const bars = barsFor(chain, new Set(["a", "a/b"]), past, ANYWHERE);
    expect(bars.get("a")?.slot).toBe(1);
    expect(bars.get("a")?.label).toBe("a/b");
    expect(bars.has("a/b")).toBe(false);
    expect(namedAt(chain, bars, "a", past)).toEqual([
      "its own bar, in the stack",
    ]);
  });
});
