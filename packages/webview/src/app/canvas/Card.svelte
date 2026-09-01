<!--
  One file, as a card: its name and counts along the top, the change to it
  below.

  The card does not place itself. Where it goes is the layout engine's answer,
  handed to the canvas, and a card that also had an opinion about it would be a
  second place for those two to disagree. What it does own is its own size —
  the width and height it was measured at — because everything inside is drawn
  to fit them, and every arrow on the page is aimed at an edge of them.

  It must never change that height by rendering something extra. A row the
  layout engine did not count moves every arrow below this card down the
  canvas, which is why the mark for a file ending without a newline lives inside
  its row and why the rows past the cap are hidden rather than absent.
-->
<script lang="ts">
  import type { NodeView } from "../model.js";
  import { host, model, notify, settings, travel, ui, view } from "../state.svelte.js";
  import { anchors, lineIn, measure } from "./measured.svelte.js";
  import type { Mark } from "./deltas.js";
  import { legibleAt } from "./legible.js";
  import { near } from "./near.svelte.js";
  import { patchOf, railSide, spanOf, type Piece } from "./picking.js";
  import {
    begin,
    composeOnFile,
    drop,
    extendTo,
    gesture,
    grip,
    open,
  } from "./picking.svelte.js";
  import { marksFor } from "./marked.svelte.js";
  import { sideOf } from "../marks/marks.js";
  import { threadsOf } from "../panels/Thread.svelte";
  import Viewed from "../shared/Viewed.svelte";
  import Row from "./Row.svelte";
  import {
    anchorsFor,
    cardTitle,
    held,
    numbered,
    pairKey,
    pairRows,
    rowKey,
    type CardTitle,
    type RowPair,
    type RowView,
  } from "./rows.js";

  let {
    node,
    rows = [],
    /**
     * What the change says about this file: its counts, the name it had, and
     * why nothing could be read from it. The view model carries a placed node
     * rather than a diff, so this comes from the host beside it.
     */
    title = undefined,
    /**
     * How many rows this card was measured to show, per reading.
     *
     * Each mode caps its own card: a split card is shorter, having put pairs of
     * lines on one row, so the two disagree about how much is behind the bar.
     * Both are the layout engine's numbers — a card that worked out its own cap
     * would be measuring in a browser what was measured in the extension, and
     * the arrows are placed against the extension's answer.
     */
    splitCap = undefined,
    unifiedCap = undefined,
    /**
     * Drawn as one column of code rather than two. A file that exists on one
     * side only has one text to show, and a schema is not a diff at all.
     */
    single = undefined,
    /**
     * Where the bottom of the chrome falls on the screen, so a title knows when
     * its card has run out from under it. Measured by the page, which owns the
     * bar; the card only does the arithmetic for its own name.
     */
    chromeBottom = 0,
    /**
     * Where the canvas put this card, in canvas units.
     *
     * The card still does not place itself — this is told to it, and it is used
     * for one thing: knowing when its own top has gone under the chrome. The
     * model's own `y` is the engine's estimate for one of the four arrangements,
     * and a card in a part, or below one that measured taller than it was
     * counted at, is not there any more.
     */
    top = undefined,
    /**
     * Where the canvas put this card across, in canvas units.
     *
     * The horizontal twin of `top`, and told to the card for the same reason:
     * the model's own `x` is the engine's estimate for one of four
     * arrangements, and a card inside an open part has been packed somewhere
     * else since.
     */
    left = undefined,
    /**
     * The right-hand edge of what the reader can see, in canvas units.
     *
     * A wide card runs off the side of the window long before it runs off the
     * end, and its controls live at its far end — so on the file a reader is
     * actually reading, the buttons are somewhere off to the right with the
     * rest of the line. This is what lets them come back into view.
     */
    viewRight = 0,
    /** The left-hand edge of what the reader can see, in canvas units. */
    viewLeft = 0,
  }: {
    node: NodeView;
    rows?: RowView[];
    title?: Partial<CardTitle>;
    splitCap?: number;
    unifiedCap?: number;
    single?: boolean;
    chromeBottom?: number;
    top?: number;
    left?: number;
    viewRight?: number;
    viewLeft?: number;
  } = $props();

  const head = $derived(cardTitle(node, title));

  /* ------------------------------------------------- zoomed out past reading */

  /**
   * How few device pixels a character can be and still be a character.
   *
   * Under about three across, a glyph has no interior left: the strokes and the
   * gaps between them fall inside one pixel and the browser averages them into
   * a smear. Three is a floor rather than a preference — it is where the
   * question stops being "can this be read" and becomes "is there anything here
   * to read at all".
   */
  // Shared with everything else pinned to the drawing that is made of words.


  /** How big the name is drawn on screen, whatever the drawing is scaled to. */
  const NAME_SIZE = 13;

  /**
   * The zoom at which code stops being code, worked out rather than picked.
   *
   * From the character width the layout engine measured, because that is the
   * thing which has to shrink past legibility and the model already carries it.
   * At the metrics this page is built with — a character 7.45 units wide — the
   * cut lands at 0.40, where a line of a twelve-unit font stands under five
   * device pixels tall. That is the same answer from the other direction, and
   * the reason to derive it rather than write it down: change the font and the
   * number follows instead of going stale.
   */
  const legible = $derived(legibleAt(model.current.charWidth));

  /**
   * Past that, a card gives up drawing its code and draws its shape instead.
   *
   * This is where the rendering cost is. Every row of every card on screen is
   * several elements the browser lays out, paints and composites for a picture
   * in which not one character can be made out — so past the cut the rows are
   * not built at all and a single block stands in for the body.
   */
  const simplified = $derived(view.scale < legible);

  /**
   * Whether this card is close enough to the window to be worth drawing.
   *
   * The other reason a card draws its shape instead of its code, and the one
   * that pays on a large change: the reader is looking at three files out of
   * seventy, and the other sixty-seven were laying out every row of themselves
   * somewhere off the edge of the window.
   *
   * Measured against where the canvas actually put this card, which is not
   * where the model says it is. `node.x` and `node.y` are the engine's estimate
   * for one arrangement, and the page is drawn from whichever of the four the
   * reader is in: on this change the canvas puts `review.ts` at 4741 while the
   * model still says 1833. Judging a card at a position it is not in decides
   * the question against the wrong part of the drawing entirely — which showed
   * as a card three screens from the edge of the window refusing to draw itself.
   *
   * So it is read off the slot the canvas placed, in the canvas's own units.
   * Once per placement rather than per frame: the effect below wakes on the
   * things that move cards, and the answer sits in state until one of them
   * happens.
   */
  let place = $state<{ x: number; y: number } | null>(null);

  $effect(() => {
    // The signals that re-place a card. `top` is the placement's own answer for
    // this one, so it changes whenever the arrangement does.
    void top;
    void settings.unified;
    void settings.showTests;
    void ui.part;
    const slot = element?.parentElement;
    if (slot) place = { x: slot.offsetLeft, y: slot.offsetTop };
  });

  const nearby = $derived(
    near({
      x: place?.x ?? node.x,
      y: place?.y ?? top ?? node.y,
      width: node.width,
      height: tall,
    }),
  );

  /**
   * A block rather than code: too small to read, or too far away to be read.
   *
   * One state and one appearance for both, because they are the same statement
   * — there is nothing here the reader can be looking at — and two would mean a
   * card that changed how it looked as the reason changed.
   */
  const flat = $derived(simplified || !nearby);

  /**
   * Every card past the cut wears its name, with nothing filtered.
   *
   * An earlier rule dropped the names that were wider than their own card, on
   * the grounds that one lying across its neighbours says less than the blocks
   * did alone. It was wrong about what the reader is doing out here: they are
   * looking for a file, and a drawing where two thirds of the blocks are
   * anonymous cannot be searched at all. Names that collide are a smaller
   * problem than names that are not there.
   */
  const named = $derived(simplified);

  /**
   * Whether the block is drawn as two halves rather than one colour.
   *
   * The rule the map uses, so the two pictures read as one at different sizes:
   * a file with both additions and deletions, read as two panes, says what it
   * lost down the left and what it gained down the right. A file that only
   * gained or only lost has nothing to put on one of the halves and keeps the
   * single colour its status gives it.
   */
  const twoSided = $derived(
    !settings.unified && head.additions !== "" && head.deletions !== "",
  );

  const oneSided = $derived(
    single ?? (node.status === "added" || node.status === "deleted"),
  );

  /**
   * Which lines an arrow touches.
   *
   * A card's height cap is for tails of untouched context and nothing else: a
   * line the change made, or one a reference points at, must never be behind
   * the bar however the cap was arrived at. Read from the edges the page is
   * actually drawing, so the two cannot fall out of step — a page that capped
   * its cards from one set of measurements and drew its arrows from another put
   * arrows through the bar at the foot of a card.
   */
  const anchored = $derived(anchorsFor(model.current.edges, node.id));

  /**
   * The words on this card that an arrow is about, keyed by the line they are
   * written on. Gathered once here rather than in each row: a change carries
   * hundreds of edges and a card carries hundreds of rows, and asking every row
   * to search every edge is that product, for an answer that is almost always
   * nothing.
   */
  const symbols = $derived(marksFor(node.id));

  /**
   * What the last rebuild did to this card.
   *
   * A live reading redraws itself whenever the file moves, and the redraw is
   * silent: the rows are simply different ones. This is what makes an edit
   * visible while it is happening — rewritten lines wear a wash of yellow,
   * arriving lines green, and lines that went leave a red box behind them that
   * closes up. Empty on every card the rebuild did not touch, which is nearly
   * all of them.
   */
  const delta = $derived(ui.deltas.get(node.id));

  /** The removals to draw above a given row, when any were taken from there. */
  function goneAbove(row: RowView | undefined): number {
    if (!delta || !row) return 0;
    let lines = 0;
    for (const run of delta.gone) if (run.before === row) lines += run.lines;
    return lines;
  }

  /** What to say about one row, in either reading. */
  function flashOf(row: RowView | undefined): Mark | undefined {
    return delta && row ? delta.marks.get(row) : undefined;
  }

  /** And the ones taken from the end of the card, which sit above nothing. */
  const goneAtEnd = $derived(
    delta?.gone.reduce((n, run) => (run.before ? n : n + run.lines), 0) ?? 0,
  );

  /**
   * The rows as they are drawn, which is the rows with both gutters answered.
   *
   * Context fetched around an arrow arrives numbered on one side only, and a
   * card read as two panes needs both. See `numbered`: it is the same list in
   * the same order, and every row it had nothing to add to is the row itself.
   */
  const shown = $derived(numbered(rows));

  const pairs = $derived(pairRows(shown));
  const splitLimit = $derived(splitCap ?? pairs.length);
  const unifiedLimit = $derived(unifiedCap ?? shown.length);
  const behind = $derived(
    settings.unified ? shown.length - unifiedLimit : pairs.length - splitLimit,
  );

  /**
   * The same pairs, over the rows exactly as the host sent them.
   *
   * What a rebuild did is remembered against the row objects it compared, and a
   * line whose empty gutter has since been filled in is a copy of one of those
   * rather than the row itself — so asking about the copy finds nothing, and a
   * line an agent had just rewritten stopped lighting up. Filling in a number
   * changes no row's kind, so the two pairings have the same shape and the row
   * the rebuild knows is the one at the same index. Built only while there is a
   * rebuild to describe, which on a reading nobody is editing under is never.
   */
  const asGiven = $derived(delta ? pairRows(rows) : null);

  /** The row behind a pair, as the rebuild knows it. */
  function asSent(pair: RowPair, at: number): RowView | undefined {
    const was = asGiven?.[at] ?? pair;
    return was.right ?? was.left ?? was.band;
  }

  /**
   * Which sides of the file actually changed.
   *
   * For the reading of a card too small to show its lines: a two-pane card
   * painted half red would be claiming removals from a file that only ever
   * gained.
   */
  const onlyAdded = $derived(head.deletions === "");
  const onlyRemoved = $derived(head.deletions !== "" && head.additions === "");

  const viewed = $derived(ui.viewed.has(node.path));
  const remarks = $derived(
    model.current.comments.filter((comment) => comment.path === node.path).length,
  );

  /**
   * The first thing anybody said about this file, by where they said it.
   *
   * By line rather than by when it was written: the count is pressed to start
   * reading the conversation about a file, and a conversation about a file is
   * read down it. A reply is not a candidate — it is answering something
   * further up, and landing on it would open a thread in the middle.
   */
  const firstRemark = $derived.by(() => {
    const here = threadsOf(model.current.comments ?? []).filter(
      (thread) => thread.root.path === node.path,
    );
    if (here.length === 0) return null;

    return here.reduce((first, thread) =>
      lineOfComment(thread.root) < lineOfComment(first.root) ? thread : first,
    );
  });

  /** Where a remark sits, preferring the top of a range it was left against. */
  function lineOfComment(comment: { line?: number; startLine?: number }): number {
    return comment.startLine ?? comment.line ?? 1;
  }

  /** Everything the card is holding back, shown in one go. */
  let expanded = $state(false);

  /** The pointer is on the file's name, which is where its path belongs. */
  let overName = $state(false);

  /** The title's own height, measured rather than assumed. */
  let titleHeight = $state(0);
  /**
   * The code's height, measured rather than counted.
   *
   * The layout engine arrives at a card's height by counting rows and
   * multiplying, in an extension where nothing has been drawn. It is close and
   * it is never exact, and every arrow on the page is aimed at an edge of this
   * card, so the difference is arrows landing a little wrong all the way down a
   * column.
   *
   * The body is what is measured, not the card. A card is given a height and
   * clips itself to it; the body is a plain block of rows that takes the height
   * its contents need, whatever the card around it has been told. That is what
   * keeps this from feeding itself: being told the card is taller cannot make
   * the body taller, so the measurement is the same the second time it is taken
   * and the pass settles after one round. Nought until a browser has drawn it,
   * which is what a page rendered to a string on the server reports.
   */
  let bodyHeight = $state(0);
  let copied = $state(false);

  /** This card's own element, for answering where its rows are. */
  let element: HTMLDivElement;

  /**
   * How tall this card really is: its title and everything under it.
   *
   * Remembered rather than read straight off the measurement, because the
   * measurement goes away. A card pulled back past reading stops rendering what
   * is inside it, and a body that is not being rendered has no height — so a
   * card that took its size from the moment would shrink to the engine's
   * estimate the instant the reader zoomed out, and every arrow in its column
   * would shift to meet it. What it was measured at is still what it is; it is
   * only not being drawn.
   *
   * The engine's estimate stands until something has measured it, so the first
   * paint and the server's rendering are the shape the arrows were already
   * aimed at rather than a card of no height at all.
   */
  let measured = $state(0);

  $effect(() => {
    if (bodyHeight > 0 && titleHeight > 0) measured = titleHeight + bodyHeight;
  });

  const tall = $derived(measured > 0 ? measured : node.height);

  /**
   * Told to whatever is placing the cards.
   *
   * Reported rather than written into the model. The measurement is kept beside
   * the placement, which reads it and never writes it — put back into the view
   * model it would re-run every reader of the model, re-render this card, and
   * ask this effect the same question again.
   */
  $effect(() => {
    measure(node.id, tall);
  });

  /**
   * How to find a row on this card, handed over afresh whenever they move.
   *
   * A band opening, the card unfolding, the reader switching readings: each of
   * them moves every row below it, and the arrows landing on those rows have to
   * be told. The body's height is the one signal all of them change, and handing
   * over a new function each time is what makes an arrow layer redraw — it is
   * reading this, so it is asked again.
   */
  /**
   * Where each line was found while the card was drawing them.
   *
   * A card too small to read does not build its rows — a few hundred elements
   * per card for a picture in which not one character resolves — and the arrows
   * then had nowhere to land, so they fell back to the middle of the card. What
   * that produced was a second drawing at a distance: twenty arrows converging
   * on one point, none of them where they would be if the reader moved closer.
   * The reader zoomed out to see the shape of the change and was shown a shape
   * the change does not have.
   *
   * So the positions outlive the rows. They are in the card's own coordinates
   * and the card does not change size with the zoom, so what was true up close
   * is still true from across the room.
   */
  const remembered = new Map<string, number>();

  /**
   * And where a row would be on a card nobody has read yet.
   *
   * Rows are one height, so the arithmetic is the layout engine's own: the body
   * divided by the rows in it. It is an estimate, and it is the same estimate
   * the engine sized the card with — near enough that an arrow lands on the
   * right row, which is the whole question being asked.
   */
  function guessAt(side: "base" | "head", line: number, fileLevel: boolean): number | null {
    const head = titleHeight || 0;
    if (fileLevel) return head / 2;

    const capped = settings.unified ? shown.slice(0, unifiedLimit) : null;
    const at = capped
      ? capped.findIndex((row) => (side === "base" ? row.oldLine : row.newLine) === line)
      : pairs
          .slice(0, splitLimit)
          .findIndex((pair) =>
            side === "base" ? pair.left?.oldLine === line : pair.right?.newLine === line,
          );
    if (at < 0) return null;

    const body = Math.max(0, (tall || 0) - head);
    const count = capped ? capped.length : Math.min(pairs.length, splitLimit);
    if (body <= 0 || count <= 0) return null;
    return head + ((at + 0.5) * body) / count;
  }

  const rowsAt = $derived.by(() => {
    const drawn = bodyHeight;
    const blocked = flat;
    // Read so that a card which has just folded, unfolded or changed reading
    // hands over a new function: the positions below change with all three.
    void tall;
    void settings.unified;

    return (side: "base" | "head", line: number, fileLevel: boolean) => {
      const key = `${side}|${line}|${fileLevel ? 1 : 0}`;
      if (!blocked && drawn > 0) {
        const found = lineIn(element, side, line, fileLevel);
        if (found !== null) remembered.set(key, found);
        return found;
      }
      return remembered.get(key) ?? guessAt(side, line, fileLevel);
    };
  });

  $effect(() => {
    anchors(node.id, rowsAt);
    return () => anchors(node.id, null);
  });

  /**
   * How far the title has to slide down its own card to stay in view.
   *
   * A long file is taller than the window, and once its title has scrolled past
   * the bar there is nothing on screen saying which file the code belongs to —
   * the one question a reader of a graph asks most often. The forge solves this
   * with a sticky header; here there is no scrolling ancestor to be sticky
   * inside, because the canvas is one transformed layer, so the title is moved
   * down its own card.
   *
   * It stops at the foot of the card rather than following the bar forever, so
   * a title never outlives the code it names: as the card leaves, its name
   * slides out with it and the next card's takes over.
   */
  const pin = $derived.by(() => {
    // Where the bar sits in the drawing's own coordinates. A pixel above it
    // rather than level with it: level leaves a hairline of code showing
    // between the two once the canvas scale turns whole pixels into fractions,
    // and a pixel of overlap disappears under an opaque bar.
    const line = (chromeBottom - 1 - view.y) / view.scale;
    // Rounded down so what is left of the border goes under the bar rather
    // than beside it.
    const offset = Math.floor(line - (top ?? node.y));
    if (offset <= 0 || tall <= titleHeight) return 0;
    return Math.min(offset, tall - titleHeight);
  });

  /** The title bar's own width, and the two things inside it worth measuring. */
  let titleWidth = $state(0);
  let nameWidth = $state(0);
  let controlsWidth = $state(0);

  /**
   * How far each end of the title travels to stay in view.
   *
   * The horizontal twin of `pin`, and the same problem: a card wider than the
   * window has its far end off the side of the screen, and the buttons that act
   * on the file — copy the path, open it, mark it read, say something about it
   * — are at that far end. The reader is looking at the file and cannot reach
   * any of them without panning away from what they are reading.
   *
   * The name has the same problem at the other end: pan right and the card's
   * beginning goes off the left of the window, taking its name, its mark and
   * its counts with it, so the reader is looking at code with nothing saying
   * whose it is.
   *
   * Both stop at the free middle of the bar rather than sliding the whole way.
   * The alternative is to let the name shrink and ellipsis itself, and the name
   * is the one thing on a card that must always be legible. So the two take the
   * space between them and no more; once that is used up they sit against each
   * other and go off the side together, which is the honest end of the trade.
   */
  const stuck = $derived.by(() => {
    const none = { name: 0, controls: 0 };
    if (!titleWidth || !controlsWidth || !nameWidth) return none;

    const x = left ?? node.x;
    /*
     * How far each end of the card lies outside what the reader can see.
     *
     * Measured from the header rather than from `node.width`. That number is
     * the engine's width for one arrangement, and a card is a different width
     * in each: read unified, a card laid out for split is reported wider than
     * it is drawn. The right edge then appears to be off the screen while the
     * whole card is plainly on it, and the buttons set off to meet a reader who
     * can already reach them — which is them sitting in the middle of a card
     * with room to spare on either side.
     *
     * The header is the element they actually live in and it is measured, so it
     * cannot disagree with what is on screen.
     */
    const offLeft = viewLeft ? Math.max(0, viewLeft - x) : 0;
    const offRight = viewRight ? Math.max(0, x + titleWidth - viewRight) : 0;
    if (offLeft <= 0 && offRight <= 0) return none;

    // The free middle of the bar: everything not already spoken for by the
    // name, the buttons, the padding and the gap between them. `padding` is the
    // layout's own number, so the room is measured rather than guessed at.
    const pad = model.current.padding ?? 0;
    const room = Math.max(
      0,
      titleWidth - pad * 2 - nameWidth - controlsWidth - TITLE_GAP,
    );
    if (room <= 0) return none;

    // The two travel towards each other and share one gap, so the second is
    // only offered what the first left behind. The name has first claim: it is
    // the answer to "which file am I looking at", and a reader who cannot see
    // that is worse off than one who cannot reach a button. In practice they
    // rarely compete — the sums only meet when the window is narrower than a
    // name and a row of buttons side by side.
    const name = Math.min(Math.floor(offLeft), room);
    const controls = Math.min(Math.floor(offRight), room - name);
    return { name, controls };
  });

  /** The gap the title bar puts between what is in it, in canvas units. */
  const TITLE_GAP = 8;

  /**
   * Marking a file read.
   *
   * The set is replaced rather than added to: a plain `Set` inside reactive
   * state is not watched from the inside, so a card that called `add` would
   * change nothing anybody could see. The host's own handler replaces it for
   * the same reason, and this keeps the two doing one thing.
   */
  function markViewed(on: boolean) {
    const next = new Set(ui.viewed);
    if (on) next.add(node.path);
    else next.delete(node.path);
    ui.viewed = next;
    notify("viewed", { path: node.path, viewed: on });
  }

  /* ------------------------------------------------------- picking lines */

  /**
   * Whether a remark can begin on this card at all.
   *
   * There has to be somewhere to send it — a page opened from disk has no forge
   * behind it, and offering to write a review comment there is an invitation to
   * a dead end. A file the reader has marked read is bowed out of the way for
   * the same reason its card is: they have finished with it.
   */
  const canComment = $derived(model.current.canReview && !viewed);

  /** The gesture running on this card, if it is this one's. */
  const picking = $derived(gesture.pick?.nodeId === node.id);

  /** The range on this card, as a value that changes when either end moves. */
  const range = $derived(
    gesture.pick && gesture.pick.nodeId === node.id
      ? { side: gesture.pick.side, ...spanOf(gesture.pick) }
      : null,
  );

  /**
   * The picked range, drawn as one box rather than as a tint on each row.
   *
   * A wash painted per row leaves a hairline at every boundary: the canvas is
   * scaled by a fraction, so whole-pixel row heights land their shared edge
   * between device pixels and the card shows through. The diff's own colours
   * close that seam by painting a pixel into their neighbour, which works
   * because the rows of a run are siblings — and a picked range is not
   * necessarily anything of the sort, since a collapsed band can sit in the
   * middle of one. One box has no interior edge to show, whatever is inside it.
   *
   * Measured rather than counted. Rows are not all a line high — a band is
   * shorter, and rows can be folded away entirely — so the only honest answer
   * comes from the pieces of the range that are actually on screen. Which is
   * also what makes it agree with the handles: they are rendered into those
   * same rows, so the box and its two ends are placed by one measurement.
   */
  let patch = $state<Piece | null>(null);

  /**
   * The line joining the range's two grips.
   *
   * From the centre of one to the centre of the other, so they sit on it rather
   * than beside it: a rail that stops short at each end reads as a mark with
   * two buttons near it instead of as one control with a grip at either end.
   * One element for the whole range, for the same reason the wash is one box —
   * a line assembled per row shows a seam at every boundary.
   *
   * Nothing for a range of one line, which has one grip and nothing to join.
   */
  let rail = $state<{ x: number; top: number; height: number } | null>(null);

  $effect(() => {
    // Named so the dependencies are plain: the box is measured again when the
    // range moves, when the rows move under it, and when the reading changes.
    const here = range;
    void bodyHeight;
    void settings.unified;
    void expanded;

    if (!here || !element) {
      patch = null;
      rail = null;
      return;
    }

    // Where something sits inside the card, in the card's own units. Walked up
    // the offset chain rather than taken from a screen rectangle, because the
    // canvas is scaled and these have to be the numbers the card is laid out in.
    const within = (el: HTMLElement) => {
      let x = 0;
      let y = 0;
      for (let at: HTMLElement | null = el; at && at !== element; at = at.offsetParent as HTMLElement | null) {
        x += at.offsetLeft;
        y += at.offsetTop;
      }
      return { x, y };
    };

    // The rail joining the two grips, measured from the grips. They are drawn
    // from the pick, so taking the line from them is one measurement rather
    // than a second opinion about where the range is.
    const grips = [...element.querySelectorAll<HTMLElement>(".pick-grip")].filter(
      (g) => g.offsetParent !== null,
    );
    if (grips.length > 1) {
      const ends = grips.map((g) => {
        const at = within(g);
        return { mid: at.y + g.offsetHeight / 2, x: at.x + g.offsetWidth / 2 };
      });
      const top = Math.min(...ends.map((e) => e.mid));
      const foot = Math.max(...ends.map((e) => e.mid));
      rail = { x: ends[0]!.x, top, height: foot - top };
    } else {
      rail = null;
    }

    const pieces: Piece[] = [];
    for (const part of element.querySelectorAll<HTMLElement>(".picked")) {
      // Folded away, or below the cap: it is part of the range and it is not
      // part of the picture, so it says nothing about where the box goes.
      if (part.offsetParent === null) continue;
      pieces.push({
        top: part.offsetTop,
        left: part.offsetLeft,
        width: part.offsetWidth,
        height: part.offsetHeight,
        across: !part.classList.contains("gap"),
      });
    }
    patch = patchOf(pieces);
  });

  /**
   * Where an agent is working, on the lines it was asked about.
   *
   * The margin says a conversation exists and the badge under it says who is
   * acting — neither says *which lines*, and on a card of forty rows that is
   * the whole question.
   *
   * Measured on its own rather than alongside the picked range. Those two look
   * like the same job and share not one dependency: the pick moves when the
   * reader drags, this when an agent starts or stops — and the pick's effect
   * gives up early when nothing is picked, which is almost always, so anything
   * measured inside it is measured almost never.
   */
  let busy = $state<{ box: Piece; task: string }[]>([]);

  /** Turns still going, on this file. */
  const running = $derived(
    (model.current.comments ?? []).filter(
      (comment) =>
        comment.local &&
        !comment.agent &&
        comment.path === node.path &&
        (comment.task === "working" ||
          comment.task === "queued" ||
          comment.task === "asking"),
    ),
  );

  /**
   * Set once the card exists, so measuring can wait for it.
   *
   * `element` is a plain binding rather than reactive state, so reading it
   * subscribes to nothing: an effect that runs before the binding lands reads
   * `undefined`, measures nothing, and — with no other dependency that changes
   * afterwards — never runs again. The picked range never noticed because it
   * depends on the reader dragging, which cannot happen before the card is on
   * screen. This has no such luck: an agent can already be working when the
   * card first draws.
   */
  let mounted = $state(false);
  $effect(() => {
    mounted = true;
  });

  $effect(() => {
    void running;
    void bodyHeight;
    void settings.unified;
    void expanded;
    busy = mounted && element ? busyBoxes() : [];
  });

  function busyBoxes(): { box: Piece; task: string }[] {
    const out: { box: Piece; task: string }[] = [];

    for (const comment of running) {
      const side = comment.side === "LEFT" ? "base" : "head";
      const first = Math.min(comment.startLine || comment.line, comment.line);
      const last = Math.max(comment.startLine || comment.line, comment.line);

      const pieces: Piece[] = [];
      for (let line = first; line <= last; line++) {
        // Folded into a band, or below the cap: part of the range and not part
        // of the picture, so it says nothing about where the box goes.
        const row = rowFor(side, line);
        if (!row) continue;
        pieces.push({
          top: row.offsetTop,
          left: row.offsetLeft,
          width: row.offsetWidth,
          height: row.offsetHeight,
          across: true,
        });
      }
      const box = patchOf(pieces);
      if (box) out.push({ box, task: comment.task ?? "working" });
    }
    return out;
  }

  /**
   * The row the composer will hang under.
   *
   * The last one the gesture touched, which is the last line of the pick that
   * is certainly on screen — the pointer was over it. A line folded inside a
   * closed band has no position, and a box hung off one ends up wherever nought
   * happens to be. Not reactive: nothing renders from it, and a rectangle is
   * not a fact that stays true anyway.
   */
  let anchorRow: HTMLElement | null = null;

  /**
   * The rail under a press, and the line it stands for.
   *
   * Read off the row rather than worked out again. The row already decided
   * whether this gutter names a line the forge can see, and wrote the answer
   * into the attribute; deciding it a second time here is how the two come to
   * disagree about which lines may be commented on.
   */
  function railAt(target: EventTarget | null): { side: "base" | "head"; line: number } | null {
    const rail = (target as Element | null)?.closest?.("[data-gutter][data-line]");
    if (!rail) return null;
    const side = railSide(rail.getAttribute("data-gutter"));
    const line = Number(rail.getAttribute("data-line"));
    return side !== null && Number.isFinite(line) ? { side, line } : null;
  }

  /** The row the reader last asked about, so its mark can be taken off again. */
  let asked: Element | null = null;

  /**
   * Right-clicking a line, which is a question about that line.
   *
   * The editor draws the menu, not this page, so what happens here is only to
   * tell it what was clicked: `data-vscode-context` is read off the DOM when
   * the menu opens, and a command contributed against it is handed the same
   * object back. Set on the element rather than through the model because the
   * menu opens on this very event — a reactive update lands a microtask later,
   * by which time the editor has already read the attribute and found the last
   * line the reader asked about instead of this one.
   *
   * The line is marked while the menu is up because a context menu covers the
   * thing it is about: without it the reader picks "open at this line" from a
   * menu sitting over four other lines and has to trust it meant the right one.
   */
  /**
   * Pressing the outline around a name, which is one end of an arrow.
   *
   * A box is an arrow naming its ends, so pressing one asks to be taken to the
   * other — the same journey the arrow itself offers, from the end the reader
   * happens to be looking at. Outgoing and incoming are the same gesture read
   * from opposite ends: the box on a call goes to the definition, the box on a
   * definition goes to the call, and neither needs the reader to work out which
   * kind they have got hold of.
   *
   * Handled here rather than on the box because a box is drawn inside the code
   * and there are hundreds of them on a card; one listener on the card costs
   * one, and the row underneath goes on doing what it did.
   */
  function follow(event: MouseEvent): boolean {
    const box = (event.target as Element | null)?.closest?.(".symbol-box");
    const id = box?.getAttribute("data-edge");
    if (!id) return false;

    const edge = model.current.edges.find((e) => e.id === id);
    if (!edge) return false;

    // The far end. `out` means this card holds the call, so the journey is to
    // what it reached; `in` means it holds the definition, so it is back to
    // whoever reached it.
    const far =
      box?.getAttribute("data-role") === "out"
        ? { path: edge.toPath, line: edge.toLine, side: edge.toSide }
        : { path: edge.fromPath, line: edge.fromLine, side: edge.fromSide };
    if (!far.path || !far.line) return false;

    event.stopPropagation();
    ui.activeEdge = edge.id;
    travel.toLine?.(far.path, far.line, far.side === "base" ? "base" : "head");
    return true;
  }

  function asking(event: MouseEvent): void {
    unask();

    const row = (event.target as Element | null)?.closest?.(".row");
    // The head side if the row has one — a line that exists in the working
    // tree is the one a reader means by "open this". A deleted line only
    // exists on the base side, and that is what opens instead.
    const head = row?.getAttribute("data-new");
    const base = row?.getAttribute("data-old");
    const line = Number(head || base || 0);
    if (!row || !line) {
      element?.removeAttribute("data-vscode-context");
      return;
    }

    row.classList.add("asked");
    asked = row;

    element?.setAttribute(
      "data-vscode-context",
      JSON.stringify({
        webviewSection: "line",
        odinPath: node.path,
        odinLine: line,
        odinSide: head ? "head" : "base",
        preventDefaultContextMenuItems: true,
      }),
    );
  }

  /** Takes the mark off, whatever became of the menu. */
  function unask(): void {
    asked?.classList.remove("asked");
    asked = null;
  }

  $effect(() => {
    // A menu is dismissed by pressing somewhere, and nothing tells the page it
    // closed — so the mark comes off at the next press anywhere in the window.
    const off = () => unask();
    window.addEventListener("pointerdown", off, true);
    return () => {
      window.removeEventListener("pointerdown", off, true);
      unask();
    };
  });

  function press(event: PointerEvent): void {
    if (event.button !== 0 || !canComment) return;

    // A handle first, because it sits over the code rather than on the rail and
    // means something different: take hold of the end it marks and leave the
    // other where the reader put it.
    const end = (event.target as Element | null)?.closest?.("[data-end]");
    if (end && gesture.pick?.nodeId === node.id) {
      event.preventDefault();
      grip(end.getAttribute("data-end") === "start" ? "start" : "end");
      anchorRow = end.closest(".row");
      element.setPointerCapture(event.pointerId);
      return;
    }

    const at = railAt(event.target);
    if (!at) return;

    // Otherwise the press begins a text selection, and the drag that follows
    // sweeps the code as well as the lines.
    event.preventDefault();

    const held = gesture.pick;
    // Extending the open pick rather than starting a new one. Shift-clicking a
    // second line exists alongside the drag because the two are used in
    // different moods — dragging while reading, shift-clicking after having
    // read — and neither is discoverable enough to be the only one.
    if (event.shiftKey && held && held.nodeId === node.id && held.side === at.side) {
      extendTo(at.line);
    } else {
      begin({ nodeId: node.id, path: node.path, side: at.side, from: at.line, to: at.line });
    }
    anchorRow = (event.target as Element).closest(".row");

    // The card takes the pointer for the rest of the gesture. Without it a
    // release outside the card — off the edge, past the window — never arrives,
    // and the pick is left lit with nothing to finish it.
    element.setPointerCapture(event.pointerId);
  }

  function sweep(event: PointerEvent): void {
    const held = gesture.pick;
    if (!gesture.dragging || !held || held.nodeId !== node.id) return;
    // Buttons, not button: a move reports what is still held down.
    if (!(event.buttons & 1)) return;

    // The pointer is captured, so the event says nothing about what is under
    // it; the document is asked instead. Once a pick has begun the reader is
    // dragging down the code rather than down the rail, and asking for the rail
    // again meant a drag that left the numbers column stopped extending — which
    // reads as the gesture having been dropped.
    //
    // The whole stack under the pointer, not just the top of it. The composer
    // is pinned below the passage it is about, so dragging the lower handle
    // downwards goes straight underneath it — and the topmost thing there is a
    // box with no rows in it, which read as the range refusing to grow.
    let under: Element | null = null;
    for (const hit of document.elementsFromPoint(event.clientX, event.clientY)) {
      const row = hit.closest?.(".row");
      if (row && element.contains(row)) {
        under = row;
        break;
      }
    }
    if (!under) return;

    // The rail for the side the pick is on, which exists only where that side
    // of that row is a line the forge can see. A row whose other side happens
    // to be in the patch does not offer one, so the range cannot wander onto
    // lines that would be refused.
    const rail = under.querySelector(`[data-gutter="${held.side}"][data-line]`);
    const line = rail ? Number(rail.getAttribute("data-line")) : NaN;
    if (!Number.isFinite(line)) return;

    extendTo(line);
    anchorRow = under as HTMLElement;
  }

  /** The row showing one line of this card, when it is on screen. */
  function rowFor(side: "base" | "head", line: number): HTMLElement | null {
    const body = element.querySelector<HTMLElement>(".card-body") ?? element;
    const row = body.querySelector<HTMLElement>(
      `.row[${side === "base" ? "data-old" : "data-new"}="${line}"]`,
    );
    return row && row.offsetParent !== null ? row : null;
  }

  /**
   * The text of the lines a pick covers, in the order they are read.
   *
   * A suggestion is drawn by the forge as a change — what it replaces above
   * what it proposes — so the box has to be told what is being replaced. The
   * card is the only thing that knows: it holds the rows, and the pick names a
   * side and a span of line numbers on that side.
   *
   * Gaps are walked into, because a range can run across a fold the reader has
   * opened, and the lines inside one are as much a part of the passage as the
   * lines either side of it.
   */
  function picked(pick: { side: "base" | "head"; from: number; to: number }): string[] {
    if (!Array.isArray(rows)) return [];
    const { start, end } = spanOf(pick);
    const found: { line: number; text: string }[] = [];

    const walk = (list: readonly RowView[]): void => {
      for (const row of list) {
        if (row.kind === "gap") {
          if (row.rows) walk(row.rows);
          continue;
        }
        const line = pick.side === "base" ? row.oldLine : row.newLine;
        if (line !== undefined && line >= start && line <= end) {
          found.push({ line, text: row.text });
        }
      }
    };
    walk(rows);

    // By line rather than by where they happened to sit: a split card holds
    // both sides interleaved, and a suggestion has to read down the file.
    found.sort((a, b) => a.line - b.line);
    return found.map((one) => one.text);
  }

  function release(event: PointerEvent): void {
    if (!gesture.dragging) return;
    try {
      element.releasePointerCapture(event.pointerId);
    } catch {
      /* the browser had already taken it back */
    }
    const pick = gesture.pick;
    if (pick?.nodeId !== node.id) return;

    /*
     * However this ends, the gesture ends.
     *
     * The rail is hidden while a drag is in progress — `hint` is null whenever
     * `gesture.dragging` is — so a press that begins a pick and then fails to
     * turn it into a box leaves the drag switched on forever, and the `+` never
     * appears again on any line of any file. One press that went wrong, and
     * commenting is over until the page is reloaded.
     *
     * So the gesture is closed here whatever happens, and anything that went
     * wrong is left to reach the console rather than being swallowed with it.
     */

    try {
      // Under the last line of the passage, not under wherever the gesture
      // happened to stop. Dragging the top handle finishes at the first line,
      // and hanging the box there put it over the very range it was about —
      // including the two handles, so the range could be widened once and
      // never narrowed again.
      /*
       * Somewhere to hang the box, whatever happens.
       *
       * The last line of the passage, or the line the gesture began on — and
       * failing both, the card itself. Both of the first two can come back with
       * nothing: a line folded into a closed band has no rectangle, and neither
       * has one held below the card's height cap. This gave up there, which
       * meant a reader pressed the plus on a line and nothing happened at all —
       * no box, no message, nothing to try differently. A box against the card
       * rather than against the line is much better than that, and the remark
       * it writes is about the right lines either way: they come from the pick,
       * not from where the box was drawn.
       */
      const row =
        rowFor(pick.side, spanOf(pick).end) ??
        (anchorRow?.offsetParent ? anchorRow : null) ??
        element;
      open(
        { row: row.getBoundingClientRect(), card: element.getBoundingClientRect() },
        picked(pick),
      );
    } catch (error) {
      drop();
      throw error;
    }
  }

  /**
   * The lines stop being lit when there is no longer a box asking about them.
   *
   * The wash means "this is what the open composer is about", so a pick that
   * outlived a cancelled composer would be a yellow band over code nobody is
   * discussing — and the reader has no way to put it out, having already
   * dismissed the only thing it referred to.
   */
  $effect(() => {
    if (!ui.composer && !gesture.dragging && gesture.pick?.nodeId === node.id) drop();
  });

  /**
   * The gesture also ends wherever the hand happens to let go.
   *
   * The card listens for the release on itself, which is right until the press
   * ends on something that handles its own pointer events — a handle on the
   * rail, a control on the bar, a box that has just appeared under the cursor.
   * Then the card never hears it: the passage stays lit, the drag stays open,
   * and no composer appears. What the reader sees is a selection they made and
   * nothing to write in, which is exactly what has been reported.
   *
   * So the window is asked as well, while this card's own pick is in progress.
   * `release` is safe to call twice — it does nothing once the gesture is over.
   */
  $effect(() => {
    if (!gesture.dragging || gesture.pick?.nodeId !== node.id) return;
    const finish = (event: PointerEvent) => release(event);
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    return () => {
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
  });

  /**
   * Puts the path on the clipboard, or as close as the host allows.
   *
   * Webviews do not always grant the clipboard API, and saying nothing at all
   * would leave the reader pasting whatever was there before.
   */
  async function copyPath() {
    const done = () => {
      copied = true;
      setTimeout(() => (copied = false), 1200);
    };

    try {
      await navigator.clipboard.writeText(node.path);
      done();
      return;
    } catch {
      /* the host refused it; there is one thing left to try */
    }

    const field = document.createElement("textarea");
    field.value = node.path;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();
    try {
      if (document.execCommand("copy")) done();
    } catch {
      /* nothing left to try */
    }
    field.remove();
  }
</script>

<!--
  The same mark the file list puts beside the name, so a card and its row in the
  list are recognisably the same file. Drawn rather than written, because a
  glyph is centred on its font's baseline and side bearings rather than on the
  box it sits in.
-->
{#snippet statusMark(status: string)}
  <svg viewBox="0 0 10 10" width="9" height="9" aria-hidden="true">
    {#if status === "added"}
      <rect x="4.2" y="1.4" width="1.6" height="7.2" rx="0.6" fill="currentColor" />
      <rect x="1.4" y="4.2" width="7.2" height="1.6" rx="0.6" fill="currentColor" />
    {:else if status === "modified"}
      <circle cx="5" cy="5" r="2.4" fill="currentColor" />
    {:else if status === "deleted"}
      <rect x="1.4" y="4.2" width="7.2" height="1.6" rx="0.6" fill="currentColor" />
    {:else if status === "renamed"}
      <path
        d="M1.6 5h6M5.4 2.6 8.2 5 5.4 7.4"
        fill="none"
        stroke="currentColor"
        stroke-width="1.4"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    {:else if status === "phantom"}
      <circle cx="5" cy="5" r="1.5" fill="currentColor" />
    {/if}
  </svg>
{/snippet}

<div
  class="card status-{node.status}"
  class:unresolved={head.note !== ""}
  class:is-test={node.isTest}
  class:is-viewed={viewed}
  class:expanded
  class:only-added={onlyAdded}
  class:only-removed={onlyRemoved}
  class:picking={picking && gesture.dragging}
  class:simplified={flat}
  data-id={node.id}
  data-path={node.path}
  style:height="{tall}px"
  bind:this={element}
  onclick={(event) => void follow(event)}
  oncontextmenu={asking}
  onpointerdown={press}
  onpointermove={sweep}
  onpointerup={release}
  onpointercancel={() => gesture.dragging && drop()}
>
  <div
    class="card-title"
    class:pinned={pin > 0}
    style:transform={pin > 0 ? `translateY(${pin}px)` : null}
    bind:offsetHeight={titleHeight}
    bind:offsetWidth={titleWidth}
  >
    <!-- Everything that names the file, as one block: it is measured as one,
         and it is the thing the controls must never slide over.

         Not `card-name`, which is taken: that is the label a shrunken card
         wears above itself, and it is positioned absolutely. Borrowing the
         name lifted the file's name, its mark and its counts clean out of the
         header and parked them over the card. -->
    <span
      class="title-name"
      class:slid={stuck.name > 0}
      style:transform={stuck.name > 0 ? `translateX(${stuck.name}px)` : null}
      bind:offsetWidth={nameWidth}
      onpointerenter={() => (overName = true)}
      onpointerleave={() => (overName = false)}
    >
      <!--
        Where the file actually lives, for a name that only says the last part
        of it.

        Drawn rather than left to the browser's own tooltip, which the header
        already asked for and which a reader on a live change rarely sees: the
        native one waits about a second and any redraw under the pointer starts
        that wait again, so on a picture that rebuilds while an agent works it
        mostly never appears. This one is immediate, and it is legible at any
        zoom — sized against the canvas's scale the way the label over a
        shrunken card is, since a tip drawn in canvas units is unreadable at
        exactly the zoom where the name is too short to help.
      -->
      {#if overName}
        <span class="path-tip">{node.path}</span>
      {/if}
      <span class="box">{@render statusMark(node.status)}</span>
      {head.name}
      {#if head.was}<span class="was">{head.was}</span>{/if}
      <span class="stats">
        {#if head.additions || head.deletions}
          <!-- The counts carry the diff's own colours, so the header reads at a
               glance rather than being read. -->
          {#if head.additions}<span class="added">{head.additions}</span>{/if}
          {#if head.deletions}<span class="removed">{head.deletions}</span>{/if}
        {:else}
          {head.stats}
        {/if}
      </span>
      {#if head.note}
        <span class="note" title="Odin could not look for references in this file"
          >{head.note}</span
        >
      {/if}
    </span>

    <!--
      The controls the forge puts on a file header, in the order it puts them:
      the path, the whole file, whether it has been read, and what has been said
      about it. Grouped at the end so the name keeps the middle.
    -->
    <span
      class="card-controls"
      class:slid={stuck.controls > 0}
      style:transform={stuck.controls > 0 ? `translateX(${-stuck.controls}px)` : null}
      bind:offsetWidth={controlsWidth}
    >
      <button
        class="copy-path"
        class:done={copied}
        data-hint="Copy the path to this file"
        title="Copy the path"
        aria-label="Copy the path"
        onclick={(event) => {
          event.stopPropagation();
          copyPath();
        }}
      >
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <rect x="5.2" y="1.8" width="8" height="9.4" rx="1.6" stroke="currentColor" stroke-width="1.3" fill="none" />
          <path
            d="M10.8 13.2a1.6 1.6 0 0 1-1.6 1.6H4.4a1.6 1.6 0 0 1-1.6-1.6V5.6"
            stroke="currentColor"
            stroke-width="1.3"
            fill="none"
            stroke-linecap="round"
          />
        </svg>
      </button>

      <!-- Both directions at once: this opens what a card is not showing, and
           closes it again. -->
      <button
        class="unfold"
        data-hint="Show every line this card is holding back"
        title="Show the whole file"
        aria-label="Show the whole file"
        onclick={(event) => {
          event.stopPropagation();
          expanded = !expanded;
        }}
      >
        <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
          <path
            d="M5 6.2 8 3.2l3 3M5 9.8l3 3 3-3"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>

      <!--
        Opening the real file, rather than reading the change to it. Absent
        until the page finds a host that can open one — the same document is
        served from disk, where nothing here can reach an editor, and a button
        that silently does nothing is worse than no button.
      -->
      {#if host}
        <button
          class="jump"
          data-hint="Open this file in the editor"
          title="Open the file"
          aria-label="Open the file"
          onclick={(event) => {
            event.stopPropagation();
            notify("open", { path: node.path });
          }}
        >
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
            <path
              d="M9.5 2.5H13v3.5M13 2.5L8 7.5"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <path
              d="M12.5 9.5v3a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1h3"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </button>
      {/if}

      <!--
        A remark about the file rather than about a line in it.

        The gutter starts one about a passage, which covers nearly everything a
        reviewer wants to say — but not "this file should not exist", and not
        "this belongs in the other package". Those were reachable only by a
        keyboard shortcut, which is to say reachable only by somebody who
        already knew it was there.

        Shown whenever there is a forge to send it to, including on a file the
        reader has marked read: the gutter bows out of the way on those because
        a drag across lines they have finished with is in the way, and a button
        in the title bar is not. The keyboard shortcut has always allowed it.
      -->
      {#if model.current.canReview}
        <button
          class="remark-file"
          data-hint="Comment on this file"
          title="Comment on this file"
          aria-label="Comment on this file"
          onclick={(event) => {
            event.stopPropagation();
            ui.activeNode = node.id;
            composeOnFile(node.id, node.path);
          }}
        >
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
            <path
              d="M2.5 3.4h11a1 1 0 0 1 1 1v5.6a1 1 0 0 1-1 1H8l-3.4 2.6V11H2.5a1 1 0 0 1-1-1V4.4a1 1 0 0 1 1-1Z"
              fill="none"
              stroke="currentColor"
              stroke-width="1.4"
              stroke-linejoin="round"
            />
            <path
              d="M8 5.6v3.6M6.2 7.4h3.6"
              fill="none"
              stroke="currentColor"
              stroke-width="1.4"
              stroke-linecap="round"
            />
          </svg>
        </button>
      {/if}

      <!--
        The same box the sidebar's rows and the settings panel draw. It was
        three separate checkboxes wearing three appearances, two of them the
        platform's own — which on a dark editor is a stark white square that
        pulls the eye off the filename, the one thing on the row worth reading.
      -->
      <Viewed label checked={viewed} hint="Mark this file as read" onchange={markViewed} />

      <!--
        What has been said about this file. Absent at nought rather than showing
        it: nothing said about this file yet is nothing to say about it.

        Pressing it opens the first of them, which is what a count on a file
        is asking to be pressed for. The camera goes to the line as well as the
        thread: a conversation opened over a card the reader cannot see is a
        panel about nothing.
      -->
      {#if remarks > 0}
        <button
          class="remarks"
          data-hint="Go to the first comment on this file"
          title="Comments on this file"
          aria-label="Comments on this file"
          onclick={(event) => {
            event.stopPropagation();
            ui.activeNode = node.id;

            const first = firstRemark;
            if (!first) return;
            // The mark is anchored to a row, and the row has to be on screen
            // before there is anywhere to anchor it to.
            travel.toLine?.(
              node.path,
              lineOfComment(first.root),
              sideOf(first.root.side),
            );
            ui.thread = { id: first.root.id, anchor: null };
          }}
        >
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
            <path
              d="M2.5 3.4h11a1 1 0 0 1 1 1v5.6a1 1 0 0 1-1 1H8l-3.4 2.6V11H2.5a1 1 0 0 1-1-1V4.4a1 1 0 0 1 1-1Z"
              fill="none"
              stroke="currentColor"
              stroke-width="1.4"
              stroke-linejoin="round"
            />
          </svg>
          <span class="tally">{remarks}</span>
        </button>
      {/if}
    </span>
  </div>

  <!--
    One reading of the change is in the document, not both.

    The old renderer wrote both into the markup and kept the spare in a
    `template`, because re-rendering meant shipping the renderer and the diff to
    the browser. There is nothing to keep in reserve now: the rows are data, and
    switching modes redraws from them. What both arrangements had to avoid is
    still avoided — a card carries a few hundred rows and a change carries
    dozens of cards, and having both readings live doubles every element on the
    page for a mode the reader is not in.
  -->
  <!--
    Under the code and over whatever the rows are coloured, which is why it is
    written here rather than inside the body: both are painted by position, and
    among things that are, the order in the document is the order on screen.
  -->
  <!--
    Under the picked range on purpose. A reader picking lines is doing something
    now; an agent working on them is something that is happening to them. Where
    the two land on the same rows, the one being done by hand is on top.
  -->
  {#each busy as one, at (at)}
    <div
      class="busy-box {one.task}"
      style="top:{one.box.top}px;left:{one.box.left}px;width:{one.box.width}px;height:{one.box.height}px"
    ></div>
  {/each}

  {#if patch}
    <div
      class="pick-box"
      style="top:{patch.top}px;left:{patch.left}px;width:{patch.width}px;height:{patch.height}px"
    ></div>
  {/if}
  {#if rail}
    <div class="pick-rail" style="top:{rail.top}px;left:{rail.x}px;height:{rail.height}px"></div>
  {/if}

  {#if flat}
    <!--
      The whole body as one rectangle, the way the map draws a file.

      Not the rows hidden — the rows never built. This state exists for the cost
      of drawing them: a few hundred elements per card, laid out and painted and
      composited for a picture in which not one character resolves. One block
      says what the map says at the same moment, which is what makes the two
      read as one picture at two sizes.

      The counts wait under the pointer. They are markup, not a `title`: the
      native tooltip takes a second to appear and cannot be styled, and the
      reader out here is sweeping over blocks rather than resting on one. It
      costs one span per card and no work at all until a pointer arrives, since
      what reveals it is a hover rule rather than anything this component runs.
    -->
    <div class="card-block" class:two-sided={twoSided}>
      <span class="card-tally">
        {#if head.additions}<span class="added">{head.additions}</span>{/if}
        {#if head.deletions}<span class="removed">{head.deletions}</span>{/if}
      </span>
    </div>
  {:else if settings.unified}
    <!-- Both readings measure themselves the same way: a split card is shorter,
         having put pairs of lines on one row, and the height every arrow is
         placed against has to be the height of the one on screen. -->
    <div class="card-body unified-view" bind:offsetHeight={bodyHeight}>
      {#each shown as row, i (rowKey(row, i))}
        {@render removed(goneAbove(rows[i]))}
        <Row
          {row}
          single={oneSided}
          nodeId={node.id}
          {canComment}
          marks={symbols}
          flash={flashOf(rows[i])}
          beyondCap={i >= unifiedLimit && !held(row, anchored)}
          revealed={expanded}
        />
      {/each}
      {@render removed(goneAtEnd)}
      {@render moreBar()}
    </div>
  {:else}
    <div class="card-body split-view" bind:offsetHeight={bodyHeight}>
      {#each pairs as pair, i (pairKey(pair, i))}
        {@render removed(goneAbove(asSent(pair, i)))}
        <Row
          {pair}
          single={oneSided}
          nodeId={node.id}
          {canComment}
          marks={symbols}
          flash={flashOf(asSent(pair, i))}
          beyondCap={i >= splitLimit &&
            !held(pair.left, anchored) &&
            !held(pair.right, anchored)}
          revealed={expanded}
        />
      {/each}
      {@render removed(goneAtEnd)}
      {@render moreBar()}
    </div>
  {/if}
</div>

<!--
  The file's name, for a drawing pulled back past reading it.

  A sibling of the card rather than a child, because a card clips what is inside
  it to the size the layout engine gave it — and this belongs above that box, in
  the gap between one card and the one over it. It is absolutely positioned in
  the slot the canvas already placed, so it takes part in nothing: the card is
  the height it was measured at whether the name is showing or not.

  Sized against `--zoom`, which the canvas keeps in step with its own transform.
  The whole drawing is one scaled layer, so a name written in canvas units would
  shrink exactly as fast as the code it stands in for, which is no use to
  anybody. Dividing by the scale cancels that: the name is drawn larger and
  larger in the drawing's own units as the reader pulls back, and lands on the
  screen the same size every time.
-->
{#if named}
  <div class="card-name status-{node.status}">{head.name}</div>
{/if}

<!--
  The bar at the foot, when the card is holding lines back.

  Gone once the card is unfolded, rather than staying as a bar that says nothing
  is left to show: it is both the statement that there is more and the way to
  reach it.
-->
<!--
  Lines that are no longer here.

  Every other kind of feedback can be drawn on the thing it is about; a removal
  has nothing left to draw on. So it is drawn as the space the lines used to
  take, which then closes — the shape of the edit rather than a note about it,
  and the reason a reader who was looking elsewhere still sees that something
  went from there.

  Keyed by how many lines it stands for, so that a second rebuild removing more
  lines from the same place plays again instead of leaving the first box up.
-->
{#snippet removed(lines: number)}
  {#if lines > 0}
    {#key lines}
      <div class="row-gone" style="--gone:{lines}" aria-hidden="true">
        <i></i>
      </div>
    {/key}
  {/if}
{/snippet}

{#snippet moreBar()}
  {#if behind > 0 && !expanded}
    <div
      class="row more"
      role="button"
      tabindex="0"
      onclick={() => (expanded = true)}
      onkeydown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        expanded = true;
      }}
    >
      <span class="text">show {behind} more lines</span>
    </div>
  {/if}
{/snippet}

<style>
  .card {
    /* The card is what its rows measure themselves against: a row asked where it
       sits answers relative to the nearest positioned ancestor, and every arrow
       on the page is placed from that answer. Without this the ancestor is
       whatever the canvas happens to have put the card inside, and the arrows
       move when that changes. */
    position: relative;
    /* Exactly the slot it was placed in, rather than a width of its own.
       `node.width` is what the engine sized this file at for the reading the
       page was built in, and a reader in the other one is placed by a different
       arrangement entirely: unified slots with split cards in them meant every
       card overhung its lane by hundreds of pixels, cards in neighbouring
       columns overlapped, the arrows and their dots left from a border the card
       no longer had, and the canvas was sized for a drawing narrower than the
       one on it. The placement is one answer and the card takes it. */
    width: 100%;
    background: var(--card-bg);
    border: 1.5px solid var(--status-modified);
    border-radius: 14px;
    /* Its own contents are clipped to the size the layout engine gave it: a
       long line, or a row past the cap, must not push the card out of the shape
       every arrow on the page was aimed at. */
    overflow: hidden;
    transition: box-shadow 160ms ease, border-color 160ms ease, opacity 160ms ease;
  }

  .card.status-added    { border-color: var(--status-added); }
  .card.status-modified { border-color: var(--status-modified); }
  .card.status-deleted  { border-color: var(--status-deleted); }
  .card.status-renamed  { border-color: var(--status-renamed); }
  .card.status-phantom  { border-color: var(--status-phantom); border-style: dashed; }

  /* The body of a card, out where its code cannot be read.

     Sized to what is left under the title, so it fills exactly the box the
     layout engine gave the card and moves nothing. The colour is the file's
     status, from the same vocabulary the card's border and the map's rectangles
     use — `--status-*` is for files, and this is a file. The diff's own green
     and red are for lines, and there are no lines here. */
  .card-block {
    height: calc(100% - var(--title-height));
    background: color-mix(in srgb, var(--status-modified) 26%, var(--card-bg));
  }
  .card.status-added   .card-block { background: color-mix(in srgb, var(--status-added) 30%, var(--card-bg)); }
  .card.status-deleted .card-block { background: color-mix(in srgb, var(--status-deleted) 28%, var(--card-bg)); }
  .card.status-renamed .card-block { background: color-mix(in srgb, var(--status-renamed) 24%, var(--card-bg)); }
  .card.status-phantom .card-block { background: var(--card-bg); }

  /* A file read as two panes says the same thing at a distance that it says up
     close: what it was down the left, what it became down the right. One flat
     colour throws that away at exactly the zoom where the split is the only
     thing still legible about the card. */
  .card-block.two-sided,
  .card.status-renamed .card-block.two-sided {
    background: linear-gradient(
      to right,
      color-mix(in srgb, var(--status-deleted) 26%, var(--card-bg)) 0 50%,
      color-mix(in srgb, var(--status-added) 26%, var(--card-bg)) 50% 100%
    );
  }

  /* How big the change to this file was, for a block that cannot show it.

     Only under the pointer, because forty of these at once is a wall of numbers
     over the shape they are supposed to describe. Counter-scaled like the name,
     so it is the same size on screen wherever the reader is. */
  .card-tally {
    display: flex;
    align-items: center;
    gap: calc(6px / var(--zoom, 1));
    padding: calc(4px / var(--zoom, 1)) calc(6px / var(--zoom, 1));
    font-size: calc(12px / var(--zoom, 1));
    font-weight: 600;
    white-space: nowrap;
    opacity: 0;
    transition: opacity 90ms ease;
    pointer-events: none;
  }
  .card-block:hover .card-tally { opacity: 1; }
  .card-tally .added { color: var(--added); }
  .card-tally .removed { color: var(--removed); }

  /* The name, in the gap above the card it belongs to.

     Placed against the slot the canvas put the card in rather than against the
     card, so that nothing here can reach the height every arrow below is aimed
     at. `bottom: 100%` is the slot's top edge, which is the card's.

     Both measurements undo the canvas's scale, so the name and the air under it
     are the same size on screen at every zoom the reader passes through. */
  .card-name {
    position: absolute;
    left: 0;
    bottom: 100%;
    /*
     * Over every card, not merely over its own.
     *
     * A name sits above the card it belongs to, and in a packed column that is
     * on top of the card above. Slots are drawn in order, so without this the
     * name is painted first and the next card covers it — the label was being
     * cut off by whatever happened to be laid down after it. A slot positions
     * itself without taking a z-index, so it makes no stacking context of its
     * own and this number is compared against the cards directly.
     */
    z-index: var(--z-name, 10);
    margin-bottom: calc(5px / var(--zoom, 1));
    font-size: calc(13px / var(--zoom, 1));
    line-height: 1.15;
    font-weight: 600;
    white-space: nowrap;
    /* Cards in a column are packed closer than a name is tall — the gap is a
       few pixels on screen where the name needs twenty — so a name sits partly
       across the card above its own. It stays where the reader expects it,
       directly over the card it belongs to, and carries the page's own colour
       around it so it is legible against whatever it happens to cross rather
       than dissolving into that card's smudge. */
    text-shadow:
      0 0 calc(3px / var(--zoom, 1)) var(--bg),
      0 0 calc(3px / var(--zoom, 1)) var(--bg),
      0 0 calc(6px / var(--zoom, 1)) var(--bg);
    /* A label, not a control: it must not take a press meant for the card
       under it, nor stop a drag of the drawing that happens to cross it. */
    pointer-events: none;
    user-select: none;
    color: var(--status-modified);
  }
  .card-name.status-added   { color: var(--status-added); }
  .card-name.status-deleted { color: var(--status-deleted); }
  .card-name.status-renamed { color: var(--status-renamed); }
  .card-name.status-phantom { color: var(--status-phantom); }

  /* The full path, under the name it is the rest of.

     Sized and offset against `--zoom`, like the label a shrunken card wears:
     the canvas is one scaled layer, so a tip written in canvas units shrinks
     exactly as fast as the name it is explaining, which is no use at the zoom
     where the explaining is needed.

     Below the name rather than above it: above is where the card's own label
     goes when the drawing is pulled back, and two things in one place is one of
     them covering the other. */
  .path-tip {
    position: absolute;
    top: 100%;
    left: 0;
    z-index: 6;
    margin-top: calc(4px / var(--zoom, 1));
    padding: calc(3px / var(--zoom, 1)) calc(7px / var(--zoom, 1));
    border: 1px solid var(--line);
    border-radius: calc(4px / var(--zoom, 1));
    background: var(--bg);
    color: var(--text);
    font-size: calc(11px / var(--zoom, 1));
    line-height: 1.3;
    font-weight: 400;
    white-space: nowrap;
    box-shadow: 0 calc(2px / var(--zoom, 1)) calc(8px / var(--zoom, 1)) rgb(0 0 0 / 0.35);
    /* A label, not a control: it must not take the press meant for the header
       it is hanging off, nor swallow the drag that crosses it. */
    pointer-events: none;
    user-select: none;
  }

  /* A box is a place to press, so it says so under the pointer. */
  .card :global(.symbol-box) { cursor: pointer; }

  /* An arrow inside a card, not a bar and not a hand.
     A card is a picture of a file rather than a document to be edited, and an
     I-beam over it invites a selection the canvas takes away again the moment a
     drag begins. The rail keeps its own cursor, because that is the one place a
     press does mean something. */
  .card-block,
  .card-body { cursor: default; }

  /* The line the reader has just asked about, while the menu is over it.
     Global because the row is another component's markup: this component owns
     the question, not the row. */
  :global(.card .row.asked) {
    background-color: color-mix(in srgb, #4da3ff 22%, transparent);
    box-shadow: inset 2px 0 0 0 color-mix(in srgb, #4da3ff 70%, transparent);
  }

  /* While a range is being chosen the card is not text to be selected. A drag
     down the rail would otherwise sweep the code along with the lines, and the
     reader would finish the gesture holding a selection they did not ask for. */
  .card.picking { user-select: none; }

  .card-title {
    /* Sits above the code so it can be moved down over it: the card's name stays
       in view while the card runs off the top of the window.

       Opaque, and said outright rather than inherited. While the title is
       pinned the file's rows pass underneath it, and a header any of them show
       through is not a header — the whole point of pinning is that the name
       stays readable while the contents move. It is also no longer the only
       thing in a card that lifts out of the flow: the button that starts a
       remark raises itself above the code it sits beside, so the title's own
       place in the order has to be stated rather than left to whatever happens
       to be painted last. Three beats that button's two, and neither is a
       number anything else in this component uses. */
    position: relative;
    z-index: 3;
    background-color: var(--card-bg);
    height: var(--title-height);
    padding: 0 var(--padding);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    font-size: calc(var(--font-size) + 1px);
    color: var(--status-modified);
    cursor: pointer;
  }
  /* Only while it is being held in place, so a card sitting still in the middle
     of the canvas looks exactly as it did. */
  .card-title.pinned {
    box-shadow: 0 1px 0 0 color-mix(in srgb, var(--text) 14%, transparent),
                0 6px 12px color-mix(in srgb, #000 30%, transparent);
  }

  /* The file list's own mark, in the title's colour: the card says what kind of
     change it is in the same shape the list does. */
  .card-title .box {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 13px;
    height: 13px;
    flex: 0 0 auto;
    border: 1px solid currentColor;
    border-radius: 3px;
    background: color-mix(in srgb, currentColor 16%, transparent);
  }
  .card.status-phantom .card-title .box { border-style: dashed; }

  .card.status-added    .card-title { color: var(--status-added); }
  .card.status-deleted  .card-title { color: var(--status-deleted); }
  .card.status-renamed  .card-title { color: var(--status-renamed); }
  .card.status-phantom  .card-title { color: var(--status-phantom); }

  .card-title .was { color: var(--muted); font-size: calc(var(--font-size) - 1px); }
  .card-title .stats { color: var(--muted); font-size: calc(var(--font-size) - 2px); }
  .card-title .stats .added { color: var(--added); }
  .card-title .stats .removed { color: var(--removed); }

  /* A file nothing could read. Marked rather than left blank, because a card
     with no arrows otherwise looks like a file that references nothing. */
  .card-title .note {
    color: var(--warning);
    font-size: calc(var(--font-size) - 2px);
    border: 1px solid color-mix(in srgb, var(--warning) 45%, transparent);
    background: color-mix(in srgb, var(--warning) 12%, transparent);
    border-radius: 5px;
    padding: 0 6px;
    white-space: nowrap;
    flex: 0 0 auto;
  }
  .card.unresolved { border-style: dashed; }

  /* The reviewed box is a component now; what stays here is how loud it is on
     a card nobody is hovering. Quieter than the sidebar's rows, which is what
     the box defaults to: a title bar already carries the file's name and its
     counts, and a note about the reader's own progress is the last thing on it
     that should be read.

     The padding is the box's own hit area. Without it those four pixels fall
     through to the title, whose press moves the canvas to this card — so
     aiming at the checkbox and missing by two pixels would fly the camera
     instead of ticking it off. */
  .card-title {
    --viewed-quiet: 0.35;
  }
  .card-title :global(.viewed) { padding: 0 2px; }
  .card.is-viewed { opacity: 0.45; }

  /* The forge's file-header controls, grouped at the end of the title. */
  /* The name, as one block, and never allowed to give ground. A card wider
     than the window puts its far end off the side of the screen; the buttons
     there come back to meet the reader, and the one thing they may not do on
     the way is squeeze the answer to "which file is this". */
  .title-name {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    flex: 0 0 auto;
    min-width: 0;
    white-space: nowrap;
    /* Over the bar's own background while it travels, the same as the buttons
       at the other end. */
    position: relative;
    z-index: 1;
  }

  /* The mirror of the buttons' own treatment: a tint and a rule on the side it
     came from, so the group reads as held in place rather than as a card that
     has grown a second name. */
  .title-name.slid {
    background-color: var(--card-bg);
    padding-right: 6px;
    box-shadow: 1px 0 0 0 color-mix(in srgb, var(--text) 12%, transparent),
                8px 0 10px -6px color-mix(in srgb, #000 35%, transparent);
  }

  .card-controls {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-left: auto;
    flex: 0 0 auto;
    /* Over the bar's own background while it travels, so the name and the
       counts pass behind it rather than through it. */
    position: relative;
    z-index: 1;
  }

  /* Only while it is being held in view, so a card sitting still on the canvas
     looks exactly as it did. The tint and the rule on its left say the group
     has left its place rather than that the card has grown a second header. */
  .card-controls.slid {
    background-color: var(--card-bg);
    padding-left: 6px;
    box-shadow: -1px 0 0 0 color-mix(in srgb, var(--text) 12%, transparent),
                -8px 0 10px -6px color-mix(in srgb, #000 35%, transparent);
  }
  .card-controls > button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    flex: 0 0 auto;
    height: 20px;
    min-width: 20px;
    padding: 0 4px;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-size: calc(var(--font-size) - 2px);
    cursor: pointer;
    transition: color 120ms ease, background-color 120ms ease;
  }
  .card-controls > button:hover {
    color: var(--text);
    background: color-mix(in srgb, var(--text) 14%, transparent);
  }
  /* Said in the button itself for as long as it holds, because a copy that
     leaves no trace is indistinguishable from one that failed. */
  .card-controls .copy-path.done { color: var(--added); }
  .card-controls .remarks .tally { font-variant-numeric: tabular-nums; }

  /* Opening the file is a separate intention from reading the change to it, so
     it gets a control of its own rather than a modifier on the filename. */
  .card-title .jump {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    width: 20px;
    height: 20px;
    padding: 0;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: var(--muted);
    opacity: 0.8;
    cursor: pointer;
    transition: opacity 120ms ease, background-color 120ms ease;
  }
  .card-title .jump:hover {
    opacity: 1;
    color: var(--text);
    background: color-mix(in srgb, var(--text) 14%, transparent);
  }

  /* The passage being talked about, in one piece.

     Opaque rather than a tint, so that everything under it — the diff's own
     colours, the grey of a band the range was dragged through — is covered
     instead of showing through in stripes. It is the colour a wash of the pick
     over the card would have produced, mixed once here rather than composited
     per row. */
  /*
    Lines an agent is working on, breathing.

    A wash rather than an outline: an outline reads as a selection, which is
    something the reader made, and this is something happening to them. The
    colours are the ones the badge under the mark uses, so the two read as one
    fact said in two places.
  */
  .busy-box {
    position: absolute;
    z-index: 1;
    pointer-events: none;
    border-radius: 3px;
    background: color-mix(in srgb, var(--warning, #e2b341) 16%, transparent);
    box-shadow: inset 2px 0 0 var(--warning, #e2b341);
    animation: busy-breathing 1.7s ease-in-out infinite;
  }

  .busy-box.asking {
    background: color-mix(in srgb, var(--vscode-textLink-foreground, #4aa3ff) 18%, transparent);
    box-shadow: inset 2px 0 0 var(--vscode-textLink-foreground, #4aa3ff);
  }

  @keyframes busy-breathing {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.35; }
  }

  .pick-box {
    position: absolute;
    background: color-mix(in srgb, var(--warning) 22%, var(--card-bg));
    pointer-events: none;
  }

  /* The spine of a picked range, from one grip to the other.

     Centred on the grips rather than run down the edge of the wash: a line at
     the pane's border and buttons in the code column are three marks that
     happen to be near each other, and the reader has to work out that they are
     one thing. Drawn under the grips, so they sit on it.

     Its colour is taken from the same place theirs is, so the three cannot come
     apart by one declaration being changed and the others not. */
  .pick-rail {
    position: absolute;
    width: 2px;
    margin-left: -1px;
    background: var(--status-renamed);
    pointer-events: none;
  }

  .card-body { padding: var(--padding) 0; }

  /* The space lines used to take, closing up.

     It starts at exactly their height and animates to nothing, so the rows
     under it rise the way they would have risen instantly — the removal is
     shown by being played rather than by being described. Red because that is
     what a deletion is everywhere else in this page; a removal that flashed
     some other colour would be a new thing to learn.

     It takes no space, and that is deliberate: the body's height is what every
     arrow on the page is placed against, so a box that pushed the rows down
     would move every arrow landing on this card for as long as it played. The
     box inside it is drawn over the rows below — which is where the lines
     were — while the card itself does not move. */
  .row-gone {
    position: relative;
    height: 0;
  }
  .row-gone > i {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    display: block;
    overflow: hidden;
    pointer-events: none;
    background: color-mix(in srgb, var(--removed) 30%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--removed) 55%, transparent);
    animation: gone-closing 620ms cubic-bezier(0.2, 0, 0, 1) forwards;
  }

  @keyframes gone-closing {
    /* Held for a moment at full height before it closes: a box that starts
       shrinking on the first frame is a flicker, not a removal. */
    0% { height: calc(var(--gone) * var(--line-height)); opacity: 1; }
    35% { height: calc(var(--gone) * var(--line-height)); opacity: 1; }
    100% { height: 0; opacity: 0; }
  }

  /* A reader who has asked for less movement is told the same thing without
     the travel: the box appears where the lines were and fades. */
  @media (prefers-reduced-motion: reduce) {
    .row-gone > i { animation: gone-fading 620ms linear forwards; }
    @keyframes gone-fading {
      0% { height: calc(var(--gone) * var(--line-height)); opacity: 1; }
      100% { height: calc(var(--gone) * var(--line-height)); opacity: 0; }
    }
  }

  /* The foot of a card that is holding lines back. A row like any other, so it
     sits in the same rhythm as the code above it. */
  .row.more {
    display: flex;
    height: var(--line-height);
    line-height: var(--line-height);
    background: var(--gap-bg);
    color: var(--muted);
    font-size: calc(var(--font-size) - 1px);
    justify-content: center;
    white-space: pre;
    cursor: pointer;
    user-select: none;
  }
  .row.more:hover { color: var(--text); }
  .row.more .text { flex: 0 0 auto; }
</style>
