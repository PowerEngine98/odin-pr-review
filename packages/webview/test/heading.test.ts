import { describe, expect, it } from "vitest";

import {
  CLUSTER_HEAD,
  headOnScreen,
  headLine,
  pinHead,
  titleLine,
  type Held,
} from "../src/app/canvas/heading.js";
import { place, type Standing } from "../src/app/canvas/placement.js";

import type { Arrangement, ViewModel } from "../src/app/model.js";

/*
 * A change with three folders inside one another, which is the shape the fault
 * was reported on. Kept here rather than borrowed from `clusters.test.ts`
 * because what is being measured is different: that file asks where the boxes
 * are, this one asks where their names end up once the reader has moved.
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
        { x: node.x, y: node.y, width: node.width, height: node.height, column: node.column },
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
 * `labura` holding `labura/common` holding `labura/common/mediaGroup`, which is
 * the nest the fault was photographed on. Each level has to hold more than one
 * thing or it is not drawn at all, so `labura` has a second folder beside
 * `common` and `common` has a second folder beside `mediaGroup`.
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
    // Outermost first, which is the order they are read in and the order their
    // names have to appear in down the screen.
    chain: [at("labura"), at("labura/common"), at("labura/common/mediaGroup")],
  };
}

/** The bar's underside, on a whole window pixel: what `headLine` starts from. */
const BAR = (chromeBottom: number) => Math.floor(chromeBottom - 1);

/**
 * A reader who has scrolled to a given line of the drawing.
 *
 * Deliberately a fractional chrome height — the bar is measured off a bounding
 * rectangle and a real one lands on a fraction more often than not, and a
 * rounding that only behaves on whole numbers is a rounding that behaves on a
 * developer's machine.
 */
function looking(scale: number, at: number): Held {
  const chromeBottom = 48.5;
  return { chromeBottom, y: BAR(chromeBottom) - at * scale, scale };
}

/** Every zoom worth asking about: pulled well back, life size, and close in. */
const ZOOMS = [0.4, 1, 3];

/**
 * Folder names held under the bar, read as a column.
 *
 * The failure this guards is the one a reader sees as the stacking being wrong
 * and which is really the units being wrong. The bar across the top is chrome,
 * measured in window pixels; a header is part of the drawing, measured in canvas
 * units, and the canvas is one transformed layer so a canvas unit is `scale`
 * window pixels. A step of one header added on the wrong side of that division
 * is a step of thirty pixels standing in for a distance of thirty units: the
 * three names piled on top of one another with their text half covered when the
 * reader zoomed in, and drifted apart with the outermost no longer against the
 * bar when they zoomed out. It looked right at exactly one zoom, which is why
 * nothing short of measuring several of them catches it.
 */
describe("the names of nested folders held under the bar", () => {
  it("puts each name exactly one header below the one enclosing it, at every zoom", () => {
    for (const scale of ZOOMS) {
      const { chain } = nested();
      // Scrolled so that all three boxes have run out from under the bar and
      // all three names are being held there at once, which is the only
      // arrangement in which they can collide.
      const held = looking(scale, chain[2]!.y);
      const bar = BAR(held.chromeBottom);

      for (const box of chain) expect(pinHead(held, box)).toBeGreaterThan(0);

      const tops = chain.map((box) => headOnScreen(held, box));
      for (const [at, top] of tops.entries()) {
        // On the screen, in window pixels, which is where the reader's
        // complaint was made: the bar, then one header's worth per level.
        expect(top).toBeCloseTo(bar + at * CLUSTER_HEAD * scale, 6);
      }
    }
  });

  it("holds the outermost name flush against the bar however far the reader has zoomed", () => {
    for (const scale of ZOOMS) {
      const { chain } = nested();
      const held = looking(scale, chain[2]!.y);
      /*
       * Against the bar's underside, tucked a pixel behind it rather than
       * level with it. Level leaves a hairline of the drawing showing between
       * the two wherever the two edges land between device pixels, and a pixel
       * of overlap disappears under an opaque bar. A whole one at least, and
       * under two — the bar is measured off a bounding rectangle and lands on a
       * fraction, and the header's own top is put on a whole window pixel, so
       * the overlap is a pixel plus whatever fraction the bar came out at.
       *
       * The measurement is in window pixels at every zoom on purpose. This is
       * the number that was drifting: expressed in canvas units the same
       * tucking is a quarter of a pixel pulled back and three of them zoomed
       * in, which is a name hanging below the bar at one end and half swallowed
       * at the other.
       */
      const top = headOnScreen(held, chain[0]!);
      expect(held.chromeBottom - top).toBeGreaterThanOrEqual(1);
      expect(held.chromeBottom - top).toBeLessThan(2);
    }
  });

  it("steps by as much as a name occupies, rather than by a fixed number of pixels", () => {
    /*
     * The statement the fault violated, said in the one form that fails at
     * every zoom but the one it was written at. A header is `CLUSTER_HEAD`
     * canvas units tall, so on screen it is that many window pixels times the
     * zoom — and the gap between two names has to be the same number, or they
     * overlap on one side of scale one and separate on the other.
     */
    for (const scale of ZOOMS) {
      const { chain } = nested();
      const held = looking(scale, chain[2]!.y);
      const tops = chain.map((box) => headOnScreen(held, box));

      const drawn = CLUSTER_HEAD * scale;
      expect(tops[1]! - tops[0]!).toBeCloseTo(drawn, 6);
      expect(tops[2]! - tops[1]!).toBeCloseTo(drawn, 6);
    }
  });

  it("leaves a name at the top of its own box until that box has passed the bar", () => {
    // A folder still wholly on screen has nothing to solve: its name belongs at
    // the top of the thing it names, and sliding it would be the header coming
    // away from the box for no reason the reader could see.
    for (const scale of ZOOMS) {
      const { chain } = nested();
      const held = looking(scale, chain[0]!.y - 500);
      for (const box of chain) expect(pinHead(held, box)).toBe(0);
    }
  });

  it("never lets a name outlive the box it is about", () => {
    /*
     * The other end of the same promise. A header that followed the bar for
     * ever would end up over the cards of whatever folder came next, saying
     * they belong somewhere they do not.
     */
    for (const scale of ZOOMS) {
      const { chain } = nested();
      const inner = chain[2]!;
      // Far below the foot of the innermost box.
      const held = looking(scale, inner.y + inner.height + 2000);
      expect(pinHead(held, inner)).toBe(inner.height - CLUSTER_HEAD);
      expect(inner.y + pinHead(held, inner) + CLUSTER_HEAD).toBeLessThanOrEqual(
        inner.y + inner.height,
      );
    }
  });
});

/**
 * And the file's own name, which is the last one in the same column.
 *
 * The card works out its own pin, and it is told where it may start by the
 * canvas rather than counting the folders in its path. That number crosses the
 * same boundary in the other direction — the card divides by the zoom, so the
 * headers it is being pushed past have to be scaled on the way out — and it is
 * the half of the fault that shows as a file's name sitting in the middle of its
 * own code at one zoom and underneath a folder's name at another.
 */
describe("where a card's title may start under the stacked folder names", () => {
  /** Card.svelte's own arithmetic, so what is checked is what it does. */
  function cardTitleOnScreen(
    held: Held,
    card: { top: number; tall: number; titleHeight: number },
    boxes: number,
  ): number {
    const line = (titleLine(held, boxes) - 1 - held.y) / held.scale;
    const offset = Math.floor(line - card.top);
    const pin =
      offset <= 0 || card.tall <= card.titleHeight
        ? 0
        : Math.min(offset, card.tall - card.titleHeight);
    return held.y + (card.top + pin) * held.scale;
  }

  it("starts a held title where the innermost folder's name ends, at every zoom", () => {
    for (const scale of ZOOMS) {
      const held = looking(scale, 1000);
      // Inside three boxes, so the fourth name down the column is the file's.
      const boxes = 3;
      const mine = headLine(held, boxes + 1);
      // A card whose own top has gone a little way past that line, so it is
      // genuinely being held rather than simply sitting below it.
      const card = { top: mine - 40, tall: 200, titleHeight: 30 };

      const under = BAR(held.chromeBottom) + boxes * CLUSTER_HEAD * scale;
      const top = cardTitleOnScreen(held, card, boxes);
      // Within a window pixel: the card rounds its own pin to a whole canvas
      // unit, which is its business, and a unit is under a pixel of slack here.
      expect(Math.abs(top - under)).toBeLessThanOrEqual(1);
    }
  });

  it("never starts a title above a folder name it is inside", () => {
    /*
     * The complaint in its plainest form. Whatever the zoom, however deep the
     * nest and wherever down the card the bar has got to, the file's name may
     * not be drawn over the folder's — the folder name is the one about to
     * leave the screen, and the one a reader has least other way of recovering.
     *
     * A long file, because a short one has a separate and deliberate answer:
     * once a card has run out from under the bar its title stops at the card's
     * own foot rather than following the bar for ever, and the two names do
     * then share a line for the moment the card is leaving. That is the card
     * letting go of its name, not the stacking failing, and it is Card.svelte's
     * promise rather than this one's.
     */
    for (const scale of ZOOMS) {
      for (const boxes of [1, 2, 3]) {
        for (const past of [-400, -40, 0, 40, 400]) {
          const held = looking(scale, 1000);
          const card = { top: headLine(held, boxes + 1) + past, tall: 1200, titleHeight: 30 };
          const under = BAR(held.chromeBottom) + boxes * CLUSTER_HEAD * scale;
          expect(cardTitleOnScreen(held, card, boxes)).toBeGreaterThan(under - 1);
        }
      }
    }
  });
});
