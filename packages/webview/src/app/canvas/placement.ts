/**
 * Where every card on the canvas ends up, and how much room they need.
 *
 * Nothing here reads the document or the reactive state — the placement is a
 * function of the change, the arrangement the engine chose for the reading in
 * force, and what the cards have measured so far. That is deliberate and it is
 * the same argument `wire.ts` makes about the arrows: this is the arithmetic
 * with the accumulators in it, the part that decides how wide the drawing is and
 * therefore what `fit` frames, and every question it answers is answerable at a
 * desk. Held in the camera module it could only be exercised by mounting a page.
 */

import { folderOf } from "@odin/core/layout/folders.js";

import type { Arrangement, EdgeView, NodeView, ViewModel } from "../model.js";
/*
 * The header's height comes from the module that draws with it.
 *
 * The placement reserves the room and `heading.ts` puts the header in it, so
 * the two have to agree exactly — a reservation that is not the header's own
 * height is either a bar lying across the first card or a strip of nothing
 * above it. They were two literals in two files, which is how they came to
 * disagree once already; now there is one number and only one place to change
 * it.
 */
import { CLUSTER_HEAD } from "./heading.js";
import { isSchema } from "./wire.js";

/**
 * A folder, as a box drawn around the cards that live in it.
 *
 * Derived geometry rather than a node of its own: nothing is placed here. The
 * banding keeps a folder's cards in the same run of canvas across every column
 * the folder reaches into, which makes them a rectangle, and this is the
 * rectangle they occupy.
 */
export interface FolderBox {
  /** The folder, as a path — `src/components/media`. Never empty. */
  path: string;
  /** What the header says, which is the last segment of that path. */
  label: string;
  /**
   * How many boxes enclose this one, counting itself. One for an outermost box.
   *
   * Boxes and not folders. `frontend/common/src/components/carousel` is five
   * folders deep and may be drawn as two boxes, because the levels in between
   * hold one thing each and a frame around a frame says nothing — so counting
   * path segments pushed every header and every card title down by three
   * headers that were never drawn. What decides how far a name sits below the
   * bar is how many names are actually above it.
   */
  depth: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** The cards inside it, by id. */
  nodes: string[];
}

/** A card, at the coordinates the arrangement in force gives it. */
export interface Placed {
  node: NodeView;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One card's place in an arrangement. */
type Spot = Arrangement["nodes"][string];

/**
 * Everything the placement needs that is not in the view model.
 *
 * Passed in rather than read, so that the arithmetic below can be run at a desk:
 * it is the part with the accumulators in it, and the part that was wrong. The
 * camera does the reading, in three lines with nothing in them to get wrong.
 */
export interface Standing {
  /** The part of the change on screen, or nothing for the whole of it. */
  inPart: ReadonlySet<string> | null;
  showInfra: boolean;
  hideViewed: boolean;
  viewed: ReadonlySet<string>;
  /**
   * Untouched files with no arrow left to them.
   *
   * A file the change never touched is on the canvas only because something
   * pointed at it. Turn that something off — unchanged references, imports, the
   * part on screen — and what is left is a card that says `untouched`, carries
   * no diff, and is joined to nothing: a file from the repository sitting in a
   * picture of a change for no reason the reader can see.
   *
   * Worked out by the caller rather than here, from the same filter the arrows
   * obey. Asked twice in two spellings the two drift, and the way that shows is
   * a card surviving a filter its own arrow did not.
   */
  stranded: ReadonlySet<string>;
  /**
   * Draw the cards grouped by the folder they live in.
   *
   * A reading choice rather than a property of the change, and one that costs
   * height: a folder reserves the same run of canvas in every column it reaches
   * into, so that it is one rectangle rather than a clump per column. What keeps
   * that cost down is that two folders standing over different columns are not
   * in each other's way, and share the run rather than queueing for it.
   */
  clusters: boolean;
  /** What a card turned out to be, where a browser has drawn one. */
  measured: (id: string) => number | undefined;
}

/**
 * Positions for one part of the change, closed up.
 *
 * A part keeps the coordinates the whole change gave it, and those were chosen
 * with forty other files in the picture: columns as wide as the widest card
 * anywhere, rows spaced for cards that are no longer on screen. Read on its own,
 * a part of three files was three cards in the corners of an empty canvas.
 *
 * The cards keep their sizes and their column order, which is what the arrows
 * were routed around; only the space between them closes. Each column takes the
 * width of the widest card still in it, and the whole part is brought back to
 * the margin.
 *
 * Worked from the engine's own numbers rather than from the measured ones. What
 * closes here is empty space, and a card that turned out taller than it was
 * estimated at still starts where the engine put it — carrying that difference
 * down the column is the next pass's business, and doing it in both would
 * subtract the same space twice.
 */
export function packed(
  data: ViewModel,
  arrangement: Arrangement,
  inPart: ReadonlySet<string>,
): Arrangement {
  const columns = new Map<number, { id: string; spot: Spot }[]>();
  let top = Infinity;

  for (const node of data.nodes) {
    if (!inPart.has(node.id)) continue;
    const spot = arrangement.nodes[node.id];
    if (!spot) continue;
    const bucket = columns.get(spot.column);
    if (bucket) bucket.push({ id: node.id, spot });
    else columns.set(spot.column, [{ id: node.id, spot }]);
    top = Math.min(top, spot.y);
  }

  // Vertical bands nobody in this part occupies. Rows were spaced for files that
  // are no longer here, and a part read on its own should not open with two
  // screens of nothing between its second and third card. Gaps close to the same
  // clearance the engine leaves; the order and the rough alignment that keeps
  // arrows level survive, because only the empty stretches move.
  const spans: [number, number][] = [];
  for (const bucket of columns.values()) {
    for (const entry of bucket) {
      spans.push([entry.spot.y, entry.spot.y + entry.spot.height]);
    }
  }
  spans.sort((a, b) => a[0] - b[0]);

  const lifts: { from: number; by: number }[] = [];
  let lifted = 0;
  let reach = -Infinity;
  for (const span of spans) {
    if (reach !== -Infinity && span[0] - reach > data.rowGap) {
      lifted += span[0] - reach - data.rowGap;
    }
    lifts.push({ from: span[0], by: lifted });
    reach = Math.max(reach, span[1]);
  }

  const liftFor = (y: number): number => {
    let by = 0;
    for (const lift of lifts) {
      if (lift.from > y) break;
      by = lift.by;
    }
    return by;
  };

  const nodes: Arrangement["nodes"] = {};
  let x = data.margin;
  let right = data.margin;
  let bottom = data.margin;

  for (const column of [...columns.keys()].sort((a, b) => a - b)) {
    const bucket = columns.get(column)!;
    const widest = bucket.reduce((max, e) => Math.max(max, e.spot.width || 0), 0);

    for (const entry of bucket) {
      const y = entry.spot.y - liftFor(entry.spot.y) - top + data.margin;
      // Centred in the column the way the engine centres them, so a narrow card
      // beside a wide one keeps its arrows level.
      const offset = Math.round((widest - (entry.spot.width || 0)) / 2);
      nodes[entry.id] = {
        x: x + offset,
        y,
        width: entry.spot.width,
        height: entry.spot.height,
        column: entry.spot.column,
      };
      bottom = Math.max(bottom, y + entry.spot.height);
      // The far edge of a card, not of the lane it sits in. Taking it after the
      // gap had been added left a column's worth of clearance hanging off the
      // right of a part that ends there, and the part then framed as though it
      // had another column nobody could see.
      right = Math.max(right, x + offset + (entry.spot.width || 0));
    }

    x += widest + data.columnGap;
  }

  return {
    nodes,
    width: Math.round(right + data.margin),
    height: Math.round(bottom + data.margin),
  };
}

/** Every card on the canvas, placed, and the room they need between them. */
export interface Layout {
  cards: Placed[];
  width: number;
  height: number;
  /** The folder boxes, when the cards were asked to be grouped into them. */
  folders?: FolderBox[];
}

/**
 * The drawing as it actually stands.
 *
 * The arrangement's own coordinates are treated as immutable and never written
 * back to, so there is exactly one source of truth to drift from — the previous
 * renderer nudged cards by a delta per action, and any action that reset
 * positions left those nudges recorded but no longer applied, so the next one
 * subtracted the same space twice and stacked cards on top of each other. Every
 * pass here starts from the engine's numbers and derives the whole answer.
 *
 * A vertex the arrangement has nothing to say about is not drawn: that is how
 * the layout engine says a file belongs to the other reading of the change.
 *
 * The heights are the measured ones where a card has been drawn and reported
 * itself, and the estimates until then. A card that turned out taller than it
 * was counted at pushes the rest of its column down by the difference, and a
 * running floor keeps the engine's clearance between neighbours — the shift
 * alone does not, because a card going away subtracts space, and if something
 * above it has grown the two can meet in the middle.
 *
 * Both sides of the extent come out of the cards this pass placed, and neither
 * is taken from the arrangement's own header. The header is the engine's answer
 * about every card in the change, laid out for one reading of it: read unified,
 * the arrangement in force is the one the engine drew for unified and its width
 * is a different number from the width the drawing is actually occupying; with a
 * part open, or the infrastructure hidden, most of that width is space the cards
 * that are gone left behind. Deriving both from what is on the canvas is what
 * makes the number true of the picture rather than of some other one — and it
 * reproduces the engine's own figure exactly when nothing has been filtered,
 * which is the case it was ever right in.
 */
/**
 * Room between a folder's box and the cards inside it, and the height of its
 * own header above them.
 *
 * Kept here rather than in the engine's metrics because nothing the engine does
 * depends on them: the bands are worked out on this side, where the cards' real
 * heights are known.
 *
 * Raised from forty-four, to answer the same complaint the horizontal step
 * answers. A box and the box inside it were set two hundred units apart
 * sideways and seventy-four apart down the page, and seventy-four is not really
 * the figure either: thirty of it is the enclosing folder's own header, which is
 * a bar with a name written on it rather than room, so the actual daylight
 * between a parent's bar and its child's was forty-four against two hundred. A
 * nest read as deliberately stepped when scanned across and as a stack of rules
 * ruled together when scanned down, which is the same drawing giving two
 * different accounts of how deep a thing is.
 *
 * Not raised to the horizontal figure, which was measured and costs too much.
 * The two are not the same kind of number, and that is the whole of the
 * judgement here. Sideways the step is a ceiling: `boxesFor` works out what each
 * box may actually take from the room that is really beside it, so a box hemmed
 * in by a neighbour takes less and a box holding nothing pays nothing at all.
 * Down the page it is a reservation, it is charged twice to every box that opens
 * at a band, and it is charged whether or not anything is nested inside — so an
 * ordinary change of flat sibling folders pays the nesting bill in full without
 * having any nesting.
 *
 * Measured on four shapes rather than guessed at. Against the drawing's height
 * as it stands: eight flat sibling folders grow by a third, a change with a
 * couple of folders nested two deep grows by about two fifths, and a six-deep
 * nest grows by half. Taking the step the whole way to two hundred — which
 * wants a pad of a hundred and seventy — costs between a half and five sixths
 * instead, and two hundred costs between two thirds and a doubling. Height is
 * the expensive direction because `fit` frames the whole drawing into a window
 * that is wider than it is tall, so height is usually the binding side: doubling
 * it halves the scale a reader is handed when they ask to see everything, and
 * the cards they are being shown are already small at that point.
 *
 * A hundred and twenty doubles the visible step, from seventy-four to a hundred
 * and fifty, which is plainly stepped beside the two hundred going across and
 * still leaves the overview legible.
 *
 * For a long time this only opened the gap at the *top* of a nested box, and
 * the paragraph that said so outlived the repair, so it is worth saying where
 * things now stand. Where a child held the last card in its parent the two
 * bottom edges were drawn flush and stayed flush at any value of this, because
 * `boxesFor` measured both from that same last card; the room below was reserved
 * all along and simply was not what the rectangle was measured from. The foot is
 * measured from the reservation now, so it steps like the head does, and this
 * number moves both ends.
 */
const CLUSTER_PAD = 120;

/**
 * What a box spends to close, which is what it spent to open.
 *
 * The opening pays a pad and a header, because a bar is drawn in the room it
 * buys; the closing used to pay the pad alone, because nothing is drawn at the
 * foot. That is true of what is drawn there and false of what it looks like: a
 * reader sees the gap between one frame and the frame inside it, and it came
 * out a header narrower at the bottom than at the top — near enough to even to
 * read as a mistake rather than as a margin, which is the worst a margin can
 * do.
 *
 * So the foot matches the head, and the header's height is in the figure for
 * the sake of the symmetry rather than to make room for anything. It costs one
 * header per nesting level and nothing else.
 */
const CLUSTER_FOOT = CLUSTER_PAD + CLUSTER_HEAD;

/**
 * Room between a box's own edge and what it holds.
 *
 * Generous on purpose, and affordable: the only thing this has to stay clear of
 * is the lane beside it, and a column gap is a hundred and forty, so an edge of
 * this size still leaves most of the corridor unused. Drawn tight against the
 * cards a box reads as a border somebody put on the files rather than as a room
 * they are standing in, which is the whole of what a folder is meant to say.
 */
const CLUSTER_EDGE = 30;

/**
 * And how much further out each enclosing box sits than the one inside it.
 *
 * A whole card's width of it, because a nest of folders has to be readable as a
 * nest. Five boxes around one run of cards — `frontend`, `common`, `src`,
 * `components`, `interfaces`, which is an ordinary enough path — were coming out
 * with their left edges ten units apart, so at any zoom a reader is actually
 * reading code at they were five lines ruled together and the reader could not
 * say which of them any card was in. The step is what says how deep a thing is,
 * and a step the thickness of a border says nothing.
 *
 * Affordable because it is a ceiling rather than a reservation: what a box
 * actually takes is worked out side by side in `boxesFor` from the room that is
 * really there, so a box with a neighbour beside it takes what fits and a box
 * with open canvas beside it takes all of this. A folder only ever pays for the
 * levels drawn inside it, so a box holding no other box pays nothing at all.
 */
const CLUSTER_STEP = 200;

/** The band a file belongs to, which is the folder it lives in. */
const LOOSE = "\u0000loose";

function bandKey(path: string): string {
  return folderOf(path) ?? LOOSE;
}

interface Bands {
  /** Where this file's band begins, in canvas units. */
  of(path: string): number | undefined;
  /** Which band it is, so a column can be put in band order. */
  rank(path: string): number;
  /** Every folder worth a box, innermost last. */
  real: { key: string; top: number; bottom: number; depth: number }[];
  /**
   * Bands hung inside a box that is nowhere on their own path, and by whom.
   *
   * The schema is the only thing this happens to, and the reason it has to be
   * said out loud rather than inferred from the paths is that the paths are
   * exactly what stopped agreeing. Every other band is inside the boxes its own
   * folder is under, so a box can work out what it holds from a path prefix; an
   * adopted band cannot be found that way by the box that took it in, and a box
   * that cannot find its own contents is drawn straight over them.
   */
  adopted: { key: string; owner: string }[];
}

/** Every folder on the way down to a file, outermost first. */
function ancestry(folder: string): string[] {
  const parts = folder.split("/");
  return parts.map((_, at) => parts.slice(0, at + 1).join("/"));
}

/**
 * One thing that wants a run of canvas: a folder's cards, or a folder's box.
 *
 * The two are laid out by the same arithmetic because they are the same
 * question — how much height does this need, and how far across the drawing
 * does it stand — and a box is only the recursion of it. A box holds the bands
 * of the files directly in it, the boxes of the folders beneath it, and any
 * band whose own folder was not worth a box of its own; nothing else can be
 * inside it, so nothing else can be over its cards.
 *
 * `first` and `last` are columns and not pixels. Columns are the dependency
 * chain read left to right by call order, which is the one thing clustering
 * must not touch, so they are the only horizontal fact this side is allowed to
 * reason from — and they are enough, because a card never leaves the lane its
 * column gives it.
 */
interface Slab {
  /** The folder it stands for, or `LOOSE` for the files at the top of a project. */
  key: string;
  /** A drawn box, rather than a run of cards. */
  box: boolean;
  /** The leftmost column anything inside it landed in, and the rightmost. */
  first: number;
  last: number;
  /** The height it takes, its own frame and the clearance after it included. */
  extent: number;
  /**
   * For a box, where each thing inside it sits relative to its own top, and
   * how much room they came to between them. Empty for a band.
   *
   * An offset each rather than a list of rows, because there are no longer any
   * rows: two things inside a box may start at heights that have nothing to do
   * with each other, and the only figure that survives the packing is where
   * each one was actually put. See `pack`, which is where the argument for that
   * is written down.
   */
  inside: { at: Map<Slab, number>; height: number };
}

/**
 * Which things can stand side by side, and which have to queue.
 *
 * The fix for the drawing's worst habit. A folder whose files are purely
 * downstream — components that are called and never call back — has every one
 * of its cards in a column to the right of the folder that uses them, and the
 * old banding still gave it a run of canvas of its own below, because a band
 * was a full-width stripe whether or not anything else was standing in it. Two
 * screens of vertical nothing to say something the columns had already said.
 *
 * Two slabs whose column ranges do not touch cannot overlap horizontally, so
 * they cannot be drawn over each other and neither can swallow the other's
 * cards. That is the whole of the rule, and the way it is enforced is a floor
 * per column: each slab is dropped to the lowest height every column it reaches
 * into leaves free, so anything already standing in one of those columns ends
 * above it. No clearance column is demanded — the case this is for is exactly
 * the one where the downstream folder starts in the very next column, and
 * asking for a gap would refuse it. What keeps the two boxes off each other's
 * edges is the corridor in `boxesFor`, which is capped at half a column gap for
 * this reason.
 *
 * The disjointness survives that unchanged, by the same argument in the other
 * direction: if two slabs overlap vertically then neither ended above the
 * other, so no column they share can have been occupied when the second was
 * placed, so they share no column at all — and a slab never leaves the columns
 * its cards are in. Anything at the same height as a box therefore stands in
 * lanes the box does not reach, which is what stops a box being drawn over a
 * card it does not hold.
 *
 * A floor per column rather than a row, because the things being packed are
 * nothing like the same height and a row charges every one of them the tallest.
 * A band is as tall as the cards in it and a card is as tall as its diff, so the
 * heights in one drawing differ by a factor of twenty: on the largest change in
 * the repository a folder standing eighty thousand units tall shared a row with
 * one standing five thousand, and the short one was charged the tall one's
 * height with nothing drawn in the canvas underneath it. That empty canvas is
 * most of what a reader is looking at when they say a clustered drawing is
 * mostly nothing.
 *
 * Packing slabs rather than bands is what keeps the nesting honest. A parent is
 * packed against its siblings as one thing, with the column range of everything
 * beneath it, so its descendants can never be dropped into a stretch of canvas
 * that something foreign is also standing in — which would put that foreign card
 * inside the parent's rectangle. Within a parent the same rule runs again on its
 * children, where everything being packed is the parent's own and there is
 * nothing to swallow.
 */
function pack(slabs: Slab[]): { at: Map<Slab, number>; height: number } {
  /*
   * Leftmost first, and the odds and ends at the top of a project last.
   *
   * Leftmost first is what makes one pass enough: a slab only ever has to look
   * at the floors left by the slabs already down, and taking them in column
   * order means the one that settles highest is asked for first. The loose files
   * go at the end rather than by their column because a drawing that opens with
   * them buries the part somebody came to read — they still land beside
   * something if they fit, which costs nothing and is no longer a stripe.
   */
  const order = [...slabs].sort(
    (a, b) =>
      Number(a.key === LOOSE) - Number(b.key === LOOSE) ||
      a.first - b.first ||
      a.last - b.last ||
      a.key.localeCompare(b.key),
  );

  /** How far down the canvas is already spoken for, column by column. */
  const skyline = new Map<number, number>();
  const at = new Map<Slab, number>();
  let height = 0;

  for (const slab of order) {
    let top = 0;
    for (let column = slab.first; column <= slab.last; column++) {
      top = Math.max(top, skyline.get(column) ?? 0);
    }
    at.set(slab, top);
    for (let column = slab.first; column <= slab.last; column++) {
      skyline.set(column, top + slab.extent);
    }
    height = Math.max(height, top + slab.extent);
  }

  return { at, height };
}

/**
 * Where each folder's band sits, decided across every column at once.
 *
 * Across every column, and that is the whole of it. A band given whatever room
 * each column happened to need would be a different height in each, and a box
 * drawn round it would cut through the cards of the column next door. Reserving
 * the same run of canvas in every column a folder reaches into costs height — a
 * column inside that reach with nothing in the band leaves the band's room
 * empty — and is what makes the box a rectangle that contains its own files and
 * nobody else's.
 *
 * What it does not cost is a full-width stripe per folder. A folder only stands
 * in the columns its own cards landed in, so two folders standing over
 * different columns share one run of canvas and are drawn side by side; see
 * `pack`, which is where the argument for that is written down. Folders whose
 * columns do overlap still queue, in the order their leftmost column comes in.
 */
function bandsFor(
  columns: Map<number, { node: NodeView; spot: Spot }[]>,
  data: ViewModel,
  standing: Standing,
): Bands {
  /** How much room each band needs, which is the worst any column needs. */
  const needed = new Map<string, number>();
  /** How many files each band holds, so a folder of one draws no box. */
  const held = new Map<string, Set<string>>();
  /** How far across the drawing each band stands, in columns. */
  const reach = new Map<string, { first: number; last: number }>();

  for (const [column, bucket] of columns) {
    const run = new Map<string, number>();
    for (const { node, spot } of bucket) {
      const key = bandKey(node.path);
      const height = spot.height || node.height;
      run.set(key, (run.get(key) ?? -data.rowGap) + height + data.rowGap);
      const files = held.get(key);
      if (files) files.add(node.path);
      else held.set(key, new Set([node.path]));
      const span = reach.get(key);
      if (span) {
        span.first = Math.min(span.first, column);
        span.last = Math.max(span.last, column);
      } else reach.set(key, { first: column, last: column });
    }
    for (const [key, height] of run) {
      needed.set(key, Math.max(needed.get(key) ?? 0, height));
    }
  }

  /*
   * Sorted by their whole path, which is what makes the boxes nest.
   *
   * `src/media` sorts before `src/media/grid`, and both before `src/mediaOther`
   * — a plain string comparison already puts every band under a folder next to
   * each other, because `/` sorts below every character a folder name starts
   * with. So a folder's descendants are one unbroken run, and the rectangle
   * around them is a rectangle rather than a guess.
   */
  const keys = [...needed.keys()]
    .filter((key) => key !== LOOSE)
    .sort()
    .concat(needed.has(LOOSE) ? [LOOSE] : []);

  /*
   * Which folders are worth a box, at every level rather than only the last.
   *
   * `src/media/grid` living inside `src/media` is a fact about the project, and
   * a drawing that flattened it into two boxes side by side would be saying
   * something untrue about where the code is. So every folder on the way down
   * counts its own files, and one that holds more than one thing gets a box
   * around everything beneath it.
   *
   * More than one *thing*, not more than one file: a folder whose only content
   * is a single sub-folder adds a frame around a frame and says nothing, which
   * is the same objection as a box around a single card.
   */
  const under = new Map<string, Set<string>>();
  for (const key of keys) {
    if (key === LOOSE) continue;
    for (const folder of ancestry(key)) {
      const kin = under.get(folder);
      // What it holds directly: the next segment down, or the band itself.
      const child = key === folder ? key : key.slice(0, key.indexOf("/", folder.length + 1)) || key;
      if (kin) kin.add(child);
      else under.set(folder, new Set([child]));
    }
  }
  /**
   * A band that is nothing but schema, which is a band of things nobody wrote.
   *
   * `folderOf` gives a schema vertex a folder like any other file, because its
   * path is `database/public` and that is a path. It is not a directory: there
   * is no `database` in the checkout, the segment is synthesised by the host so
   * that the vertex has somewhere to be, and treating it as a folder is what
   * gave the schema a band of its own at the root of the drawing.
   */
  const allSchema = (key: string) =>
    key !== LOOSE && [...(held.get(key) ?? [])].every(isSchema);

  /**
   * And a folder that holds nothing else, at any depth beneath it.
   *
   * Worth naming separately from the band because it is the question a box asks
   * rather than the one a band asks. A frame reading `database` drawn inside
   * somebody else's box would be a folder the reader could go and look for and
   * not find, which is a worse thing for a drawing to say than anything the
   * misplacement cost.
   */
  const schemaFolder = (folder: string) =>
    folder !== LOOSE &&
    keys
      .filter((key) => key === folder || key.startsWith(`${folder}/`))
      .every(allSchema);

  const boxedFolder = (folder: string) =>
    folder !== LOOSE &&
    !schemaFolder(folder) &&
    ((under.get(folder)?.size ?? 0) > 1 || (held.get(folder)?.size ?? 0) > 1);

  /*
   * Where the schema goes, which is beside whatever reads it.
   *
   * With the cards grouped by folder the schema card was landing at the very
   * bottom of the drawing, several screens below the code it describes, while
   * ungrouped it was already correct — level with its reader and one column to
   * the right. So the fault was entirely on this side.
   *
   * What did it is the interaction between a band of its own and a box's
   * envelope. The schema sits in a middling column, and the box holding the
   * files that read it reaches a column further right because one of its other
   * subtrees does — a box's span is the union of everything beneath it. Those
   * two ranges therefore touch, so the schema could not stand beside that box
   * and had to go below it; and sorting near-last by its own path, it went below
   * everything. Measured on the change that showed it: eleven hundred and fifty
   * units of canvas where the same drawing without the schema needed eight
   * hundred and eighty, with a hundred and forty-four of blank canvas below the
   * last box before the schema card began.
   *
   * Hanging it inside that box instead is the repair, and it fixes a second
   * thing that was wrong for the same reason. As a root-level sibling the schema
   * was levelled beside whichever folder happened to have room for it, which on
   * that change was a folder with nothing whatever to do with the database — the
   * drawing was putting two unrelated things side by side and inviting a reader
   * to believe the arrangement meant something.
   *
   * What the box then encloses is a card whose title begins `database/`, and
   * that is accepted rather than worked around. There is no `database`
   * directory to be wrong about: the path is synthesised for a vertex nobody
   * wrote, so a box around it is not a claim about where anything lives in the
   * checkout.
   */

  /** Every card that is going to be drawn, which is both ends of a real arrow. */
  const drawn = new Set<string>();
  for (const bucket of columns.values()) {
    for (const { node } of bucket) drawn.add(node.id);
  }

  /**
   * Whether an arrow is one the reader can actually see.
   *
   * The same rule the arrows themselves obey, in `wantedEdges`, because the
   * answer has to be the one on screen: a schema levelled beside a reader whose
   * arrow the reader has switched off is a claim the drawing is not making
   * anywhere else.
   *
   * Most of that rule answers itself here. An arrow at a schema is structural,
   * so the filter about references that did not change never touches it; the
   * infrastructure switch cannot be off, because with it off there is no schema
   * card to place at all; and the part on screen and the stranded cards have
   * already taken their ends off the canvas by the time this is asked, which is
   * what the two membership tests are. What is left and has to be said is the
   * read-file switch, which takes an arrow away while leaving both its ends on
   * the canvas.
   *
   * The one clause that cannot be asked from here is the import switch, because
   * `Standing` does not carry it and the camera builds `Standing`. An arrow into
   * a schema is almost never an import — the database pass re-points a
   * reference at the row it names and keeps its kind — and if every arrow into
   * the schema were hidden the schema is untouched, so it would be stranded and
   * gone from the drawing before this is reached. Worth knowing about rather
   * than worth plumbing a whole reading through for.
   */
  const referring = (edge: EdgeView): boolean =>
    drawn.has(edge.from) &&
    drawn.has(edge.to) &&
    !(
      standing.hideViewed &&
      (standing.viewed.has(edge.fromPath) || standing.viewed.has(edge.toPath))
    );

  /** Every folder all of these are inside, outermost first. */
  const shared = (folders: string[]): string[] => {
    let chain = ancestry(folders[0]!);
    for (const folder of folders.slice(1)) {
      const theirs = new Set(ancestry(folder));
      chain = chain.filter((step) => theirs.has(step));
    }
    return chain;
  };

  /**
   * The box a schema band should hang inside, or nothing to leave it at the root.
   *
   * The deepest box that holds every file pointing at it, so the schema lands as
   * near to its readers as a box can put it. Deepest and not nearest-to-one:
   * three files in three folders read the same schema and the drawing may only
   * put it in one place, and the folder that holds all three is the only answer
   * that is not a choice between them.
   */
  const ownerOf = (key: string): string | undefined => {
    const readers: (string | undefined)[] = [];
    for (const edge of data.edges) {
      if (bandKey(edge.toPath) !== key || !referring(edge)) continue;
      readers.push(folderOf(edge.fromPath));
    }
    // A reader at the top of a project is inside no folder, so no folder holds
    // every reader and there is nothing to hang the band off.
    if (!readers.length || readers.some((folder) => folder === undefined)) {
      return undefined;
    }
    return [...shared(readers as string[])].reverse().find(boxedFolder);
  };

  /*
   * The folders as a tree of slabs, one level of nesting per drawn box.
   *
   * Drawn boxes and not path segments, which is the same distinction the depth
   * of a box is careful about: a folder nobody would draw a frame around is not
   * a level, so the bands beneath it hang off whichever box does get drawn. A
   * folder that is both worth a box and holds files of its own appears twice —
   * once as the box and once as the band of those files, which is the band's
   * own first child — because they are two different runs of canvas and only
   * one of them has a header.
   */
  const boxed = [...new Set(keys.filter((key) => key !== LOOSE).flatMap(ancestry))]
    .filter(boxedFolder)
    .sort();

  const slabs = new Map<string, Slab>();
  const roots: Slab[] = [];
  for (const folder of boxed) {
    slabs.set(folder, {
      key: folder,
      box: true,
      first: Infinity,
      last: -Infinity,
      extent: 0,
      inside: { at: new Map(), height: 0 },
    });
  }

  /** What a slab hangs off, before the rows are worked out. */
  const kin = new Map<string, Slab[]>();
  const hang = (parent: string | undefined, slab: Slab) => {
    if (!parent) {
      roots.push(slab);
      return;
    }
    const brood = kin.get(parent);
    if (brood) brood.push(slab);
    else kin.set(parent, [slab]);
  };

  for (const folder of boxed) {
    const chain = ancestry(folder).filter(boxedFolder);
    hang(chain[chain.length - 2], slabs.get(folder)!);
  }
  const adopted: { key: string; owner: string }[] = [];
  for (const key of keys) {
    const chain = key === LOOSE ? [] : ancestry(key).filter(boxedFolder);
    // A schema goes to the box that reads it, and stays where its own path put
    // it when nothing on the canvas reads it any more.
    const owner = allSchema(key) ? ownerOf(key) : undefined;
    if (owner) adopted.push({ key, owner });
    const span = reach.get(key) ?? { first: 0, last: 0 };
    hang(owner ?? chain[chain.length - 1], {
      key,
      box: false,
      first: span.first,
      last: span.last,
      // The clearance after the last card of a band is part of what the band
      // takes: without it the first card of whatever follows sits against it.
      extent: (needed.get(key) ?? 0) + data.rowGap,
      inside: { at: new Map(), height: 0 },
    });
  }

  /*
   * How tall each slab is and how far it reaches, worked out from the bottom.
   *
   * A box cannot say how much room it wants until the things inside it have
   * been packed, and they cannot be packed until each of them knows how far it
   * reaches — so the answer is built upwards and the positions handed down
   * afterwards. A box's reach is the reach of everything beneath it, which is
   * what lets it be packed against its siblings as one thing.
   *
   * How tall a box is has to be the packing's own answer and not a second
   * arithmetic about the same children, which is the one trap in changing how
   * they are packed. The first attempt at the skyline left this reading the
   * height off the old row grouping, which no longer existed, and every box came
   * out as the sum of everything it held — a change that was meant to take six
   * and a half per cent off the drawing's height put twelve per cent on. The
   * packing decides where each child sits and therefore how much room they came
   * to between them, and nothing else is entitled to an opinion about it.
   */
  const settle = (slab: Slab): Slab => {
    if (!slab.box) return slab;
    const brood = (kin.get(slab.key) ?? []).map((child) => settle(child));
    for (const child of brood) {
      slab.first = Math.min(slab.first, child.first);
      slab.last = Math.max(slab.last, child.last);
    }
    slab.inside = pack(brood);
    // A pad and a header to open it, and a pad to close it. They nest, so three
    // levels of folder put three headers above the first card.
    slab.extent =
      CLUSTER_PAD + CLUSTER_HEAD + slab.inside.height + CLUSTER_FOOT;
    return slab;
  };

  const tops = new Map<string, number>();
  const real: { key: string; top: number; bottom: number; depth: number }[] = [];

  function put(slab: Slab, top: number): void {
    if (!slab.box) {
      tops.set(slab.key, top);
      return;
    }
    real.push({
      key: slab.key,
      top: top + CLUSTER_PAD,
      bottom: top + slab.extent - CLUSTER_FOOT,
      depth: ancestry(slab.key).length,
    });
    lay(slab.inside, top + CLUSTER_PAD + CLUSTER_HEAD);
  }

  /** Each thing where the packing put it, measured down from whatever holds it. */
  function lay(packing: { at: Map<Slab, number> }, from: number): void {
    for (const [slab, offset] of packing.at) put(slab, from + offset);
  }

  lay(pack(roots.map((slab) => settle(slab))), 0);

  return {
    of: (path) => tops.get(bandKey(path)),
    /*
     * Where the band starts, which is all a column needs to know.
     *
     * It used to be the band's place in the alphabet, which stopped being an
     * order the moment two folders could share a run of canvas. The top is an
     * order again, and a true one within a column: two bands sharing a row have
     * column ranges that do not touch, so no column ever holds cards from both
     * and no two cards in a column are ever asked to compare equal.
     */
    rank: (path) => tops.get(bandKey(path)) ?? Number.MAX_SAFE_INTEGER,
    // Outermost first, so whatever draws them draws a parent before its child.
    real: real.sort((a, b) => a.depth - b.depth || a.top - b.top),
    adopted,
  };
}

/**
 * The rectangle each folder's cards ended up occupying.
 *
 * Read off the placement rather than reserved in it. The band decided the top
 * and the height; what is left is how far the folder reaches across the
 * drawing, which is a question about which columns its files landed in — and a
 * box that is measured cannot disagree with the cards it is drawn around.
 *
 * `clear` is how much daylight a border keeps between itself and a card that is
 * not inside it, and it is the drawing's own clearance between two neighbouring
 * cards because there is no other figure a reader could be comparing it against.
 * A border that stops nearer to a foreign card than two cards ever stand to each
 * other reads as the card belonging to the box, which is the one thing a box is
 * drawn to say and the one thing this one is not saying.
 *
 * It is the same figure on the foot and on both sides, so that a card outside a
 * box stands the same distance clear of it whichever side of it the card is on,
 * and it replaces the two units the corridor used to stand off by. Two units was
 * the right thought at a size nobody can see, and it was not a floor that
 * practice cleared comfortably: a box charged for the deepest nesting in the
 * drawing takes every unit of the room worked out below, so two units was the
 * answer exactly, every time a nest stood beside a card it did not hold.
 * Sideways the raise is free — the corridor is invented room taken from whatever
 * gap happens to be there, so leaving more of that gap alone costs no width and
 * only ever makes a box narrower.
 */
function boxesFor(
  bands: Bands,
  placed: Map<string, Placed>,
  clear: number,
): FolderBox[] {
  const boxes: FolderBox[] = [];

  for (const band of bands.real) {
    /*
     * Everything beneath this folder, not only what sits directly in it.
     *
     * A box around `src/media` has to hold `src/media/grid` as well, or the
     * nesting the ordering went to the trouble of producing is drawn as two
     * boxes that happen to be near each other.
     */
    /*
     * And whatever this box, or a box inside it, took in from elsewhere.
     *
     * The step that cannot be skipped. A box's bounds are read off the cards it
     * holds, and an adopted band's path has nothing to do with the box's, so
     * without this the box is measured as though the card were not there and is
     * then drawn straight across it. The corridor below cannot catch it either:
     * it only ever tests cards lying wholly to the left or wholly to the right
     * of a box, and an adopted card in the middle of a box's span is on neither
     * side of it and invisible to the whole test.
     *
     * At or below, because a box has to hold everything its children hold. The
     * band hangs off one box, and every box around that one encloses it too, so
     * the ancestors have to find it as well or a parent is drawn inside its own
     * child.
     */
    const taken = bands.adopted
      .filter(
        (other) =>
          other.owner === band.key || other.owner.startsWith(`${band.key}/`),
      )
      .map((other) => other.key);

    const inside = [...placed.values()].filter(
      (card) =>
        (card.node.path.startsWith(`${band.key}/`) &&
          bandKey(card.node.path).startsWith(band.key)) ||
        taken.includes(bandKey(card.node.path)),
    );
    // Every file in it was filtered away — tests hidden, a part opened, files
    // ticked off. A box around nothing is a box that is lying.
    if (inside.length < 2) continue;

    const left = Math.min(...inside.map((card) => card.x));
    const right = Math.max(...inside.map((card) => card.x + card.width));

    /*
     * The foot the band reserved, rather than the last card inside it.
     *
     * A reader looking at three nested folders saw a generous gap at the top and
     * down both sides and three borders within a few units of each other at the
     * bottom. This is why, and it was predicted by whoever last raised the pad:
     * measured from the last card, a parent and its deepest child end at the
     * same place, because the child holds that card and the parent holds the
     * child. No value of the pad ever separates them — both are drawn exactly
     * one pad below the same card — so the foot is the one edge of a box that
     * never stepped.
     *
     * The reserved foot does step, and by exactly the right amount, because the
     * nesting is what reserved it: every box pays a closing pad, so a parent's
     * reservation ends one pad below its child's and the two borders come out a
     * pad apart. That is the same order as the pad and a header that separates
     * their two bars at the top, so the nest now reads as stepped from either
     * end.
     *
     * Growing a box downwards is the move that historically put a box into a
     * band nobody had set aside for it, which is why the corridor below is
     * sideways only, and it is worth saying what makes this different. The
     * corridor is invented room: it is taken from whatever happens to be beside
     * the box, and down the page there is nothing to take it from because the
     * next band begins where this one's reservation ends. This takes no new room
     * at all. The closing pad is already paid for in `bandsFor` — it is part of
     * the slab's extent and has been since the boxes were first drawn — and
     * nothing is ever placed inside a slab's own span, so a box drawn down to
     * the foot of its own reservation cannot reach anybody else's card.
     *
     * Whichever is lower, because a card can outgrow its band. The heights the
     * reservation was worked out from are estimates until a browser has drawn a
     * card and reported itself, and a card that turned out taller pushes past
     * the room set aside for it — so the last card still has the last word, and
     * a box whose contents have grown is drawn round them as it was before. The
     * step goes when that happens, which is the honest answer: there is no room
     * left to step into.
     *
     * Short of the reservation by a clearance, which is the whole of the repair
     * to what drawing down to it caused. A slab's reservation ends exactly where
     * the next slab begins — that is what a skyline is — so a border drawn at
     * the end of its own reservation is drawn on the line the next thing starts
     * at, and the next thing is very often a bare band. A band pays no pad of
     * its own, so its first card began flush against the border of a box it is
     * not in, with no daylight whatever between the two. A reader cannot tell
     * that from the card being inside the box and touching its edge, which is a
     * box saying something false about where a file lives.
     *
     * It costs no height, and it costs no step either, which is the part worth
     * saying because it is not obvious. Every box's border comes up by the same
     * clearance, so the gap between a box and the box inside it is the same
     * number it was — a uniform shift of two edges does not move the distance
     * between them — and the foot still matches the head exactly.
     *
     * And the clearance has to be the row gap rather than anything larger,
     * which is the one figure here that is forced rather than chosen. The last
     * card in a box is followed by its band's own trailing row gap and then by
     * the closing allowance, so the lower of the two figures below is already a
     * row gap short of the reservation: ask for more than that and a box whose
     * last child is a band would be held at the row gap while a box whose last
     * child is another box came up the full amount, and the two would stop
     * stepping by the same distance at the foot as at the head. Asking for
     * exactly the row gap is the most that can be had with both edges still
     * agreeing.
     */
    const bottom = Math.max(
      band.bottom - clear,
      ...inside.map((card) => card.y + card.height),
    );

    boxes.push({
      path: band.key,
      label: band.key.slice(band.key.lastIndexOf("/") + 1),
      depth: 1,
      x: left,
      y: band.top - CLUSTER_HEAD,
      width: right - left,
      height: bottom - band.top + CLUSTER_HEAD + CLUSTER_FOOT,
      nodes: inside.map((card) => card.node.id),
    });
  }

  /*
   * How many drawn boxes each one sits inside, counted once they are all known.
   *
   * It cannot be worked out while they are being made: whether a folder gets a
   * box at all depends on what survived the filters, so an ancestor may be
   * absent from a drawing its descendant is in.
   */
  for (const box of boxes) {
    box.depth =
      1 +
      boxes.filter((other) => box.path.startsWith(`${other.path}/`)).length;
  }

  /*
   * A corridor between a box and the one it sits inside.
   *
   * Sideways only. Every box is measured from the same cards — a folder and the
   * folder inside it very often share their leftmost file — so inset by a fixed
   * amount they came out with their borders drawn on top of one another, and
   * three nested folders read as one box with a thick edge.
   *
   * Sideways only because down the page the room is already reserved: a band
   * pays a pad and a header for every box that opens at it, so the levels are
   * spaced apart before any card is placed. Growing a box downwards here would
   * push it into a band nobody set aside for it, which is a box over somebody
   * else's cards.
   */
  const deepest = Math.max(1, ...boxes.map((box) => box.depth));
  // Outermost first, because what a box may take depends on what the box it
  // sits inside was allowed, and that has to be settled before it is asked.
  boxes.sort((a, b) => a.depth - b.depth);

  /** Whether two things are standing in the same run of canvas at all. */
  type Span = { x: number; y: number; width: number; height: number };
  const level = (a: Span, b: Span) =>
    a.y < b.y + b.height && b.y < a.y + a.height;
  /** A box and the boxes it holds, which are never in each other's way. */
  const nested = (a: string, b: string) =>
    a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);

  /*
   * How far each box may grow before it reaches something that is not its own.
   *
   * Per box and per side, which is the whole of the repair. This used to be one
   * figure for the entire drawing: half a column gap, on the grounds that two
   * folders sharing a run of canvas are separated by one column gap and each may
   * have half of it. That is true of a box with a neighbour beside it and it is
   * true of nothing else — and it was being charged to every box in the drawing,
   * including the ones standing at the edge of it with open canvas on both sides
   * and nothing whatever to collide with. A nest five deep then had sixty-eight
   * units to share between five levels and drew them ten units apart.
   *
   * What is in a box's way is a card it does not hold, or a box it is neither
   * inside nor holds, and only where the two are level with each other — a
   * folder further down the drawing is not a neighbour however wide it is. A
   * card does not grow, so the gap up to one is the box's to take. Another box
   * is measuring this same gap from its own side at this same moment, so they
   * have half each and meet in the middle, which is the argument the column gap
   * was standing in for all along, now made about the gap that is actually
   * there.
   *
   * A card that belongs to some other box needs no case of its own: that box's
   * own rectangle reaches at least as far as its cards do, so it is the nearer
   * obstacle and the halving is what applies.
   *
   * And never further out than the box this one sits inside was allowed, which
   * is what keeps a child within its parent when the two are given different
   * room. Without it a parent hemmed in by a sibling and a child with clear
   * canvas beneath it would have the child growing out through the parent's
   * own edge.
   */
  const allowed = new Map<string, { left: number; right: number }>();
  for (const box of boxes) {
    let left = Infinity;
    let right = Infinity;

    for (const other of boxes) {
      if (nested(box.path, other.path) || !level(box, other)) continue;
      /*
       * The clearance is between the two borders, not demanded twice over.
       *
       * This used to take half the gap and then subtract a full clearance from
       * that half — but the box on the other side of the gap is doing the very
       * same arithmetic at the same moment, so the clearance came out of the
       * room twice and the two borders ended up two clearances apart. Which is
       * a strange thing for the drawing to believe: a border keeps one row gap
       * from a foreign card, and there is no reason it should keep two from a
       * foreign border. It was invisible for as long as folders could not stand
       * beside each other, because the case never arose; the moment they could,
       * it became the common case and the bill arrived.
       *
       * And it is a large bill at these numbers. A column gap is a hundred and
       * forty and a clearance is fifty-six, so the old reading left each box
       * fourteen units to put a border in, which is less than half the plain
       * edge a box is supposed to have — and a reader saw a frame drawn hard up
       * against its own card, with the file inside it apparently touching the
       * wall, while the empty corridor beyond the frame was four times wider.
       * Taking the clearance out once before halving gives each of them
       * forty-two, which is enough for a plain edge with room to spare, and the
       * two borders still end up a clearance apart in the worst case where both
       * take everything they are allowed.
       */
      const share = (gap: number) => Math.floor((gap - clear) / 2);
      if (other.x + other.width <= box.x) {
        left = Math.min(left, share(box.x - other.x - other.width));
      }
      if (other.x >= box.x + box.width) {
        right = Math.min(right, share(other.x - box.x - box.width));
      }
    }

    for (const card of placed.values()) {
      if (box.nodes.includes(card.node.id) || !level(box, card)) continue;
      if (card.x + card.width <= box.x) {
        left = Math.min(left, box.x - card.x - card.width - clear);
      }
      if (card.x >= box.x + box.width) {
        right = Math.min(right, card.x - box.x - box.width - clear);
      }
    }

    const parent = boxes.find(
      (other) =>
        other.depth === box.depth - 1 && box.path.startsWith(`${other.path}/`),
    );
    const outer = parent
      ? allowed.get(parent.path)!
      : { left: Infinity, right: Infinity };
    allowed.set(box.path, {
      left: Math.max(0, Math.min(left, outer.left)),
      right: Math.max(0, Math.min(right, outer.right)),
    });
  }

  /*
   * Squeezed to fit rather than clipped to fit.
   *
   * Clipping would stop the outermost levels at the same figure and give a box
   * and the box inside it the same border, which is the very fault the corridor
   * is here to prevent. Narrowing the step keeps every level a visibly
   * different distance out, and only nesting deep enough to run out of room
   * ever notices.
   *
   * The room is shared out over the deepest nesting in the drawing rather than
   * over this box's own, which is the conservative of the two and the one that
   * keeps the arithmetic honest: a box's own share is never more than its own
   * room, because it is never asked for more levels than the figure was divided
   * by. What it is asked for is the levels actually drawn inside it, so a box
   * holding no other box sits a plain edge away from its cards however deep the
   * rest of the drawing goes — charged the full step for levels it does not
   * have, an ordinary folder standing on its own would have grown a border two
   * columns wide the moment the step became generous enough to see.
   */
  const reach = (room: number, levels: number) => {
    const edge = Math.min(CLUSTER_EDGE, room);
    const step = Math.min(CLUSTER_STEP, (room - edge) / Math.max(1, deepest - 1));
    return Math.round(edge + step * levels);
  };

  /** Where each box stood before any of this, which the tightening needs. */
  const raw = new Map(
    boxes.map((box) => [box.path, { left: box.x, right: box.x + box.width }]),
  );

  for (const box of boxes) {
    // How far the nesting goes below this box, counting itself.
    const under = boxes.reduce(
      (deep, other) =>
        other.path.startsWith(`${box.path}/`)
          ? Math.max(deep, other.depth)
          : deep,
      box.depth,
    );
    const room = allowed.get(box.path)!;
    /*
     * A corridor, and no more than the room there is for one.
     *
     * The first version paid a full pad per level, so a folder three deep put
     * ninety pixels of nothing down each side of the outermost box — a gap wide
     * enough to read as a column with no cards in it rather than as a border.
     * A box needs enough room that its edge is plainly not its child's edge,
     * which is a step rather than a margin.
     *
     * The two sides are asked separately and routinely answer differently. A
     * nest at the left edge of the drawing has a sibling's cards a column away
     * on one side and the whole empty canvas on the other, and there is no
     * reason for the open side to be charged for the crowded one — a box that
     * had to be symmetrical would be held to the worse of its two neighbours
     * everywhere, which is the drawing-wide figure again in miniature.
     */
    const left = reach(room.left, under - box.depth);
    const right = reach(room.right, under - box.depth);
    box.x -= left;
    box.width += left + right;
  }

  /*
   * And back in again on any side where there was nothing to stand clear of.
   *
   * How many levels a box is charged for is how deep the nesting goes anywhere
   * inside it, which is the only figure that can be worked out without knowing
   * which side each of those levels ends up on — and it is charged to both
   * sides. A folder holding a deep branch on its right and a shallow one on its
   * left was paying four steps on the left to stand clear of a single box that
   * was thirty units out, so the outermost frame opened with eight hundred
   * units of empty canvas down one side and the reader was looking at a border
   * with nothing on the far side of it.
   *
   * The step is only ever there to hold a box off the boxes inside it, so one
   * step beyond the outermost of them is the whole of what it is for. Worked
   * from the inside out, so that a box that has just been brought in lets the
   * box around it come in too. Only ever inwards: a box that was clear of
   * somebody else's cards before this stays clear of them, since nothing here
   * moves an edge further out, and no box crosses a box it holds, since every
   * edge stops a full step short of its children's.
   */
  for (const box of [...boxes].reverse()) {
    const brood = boxes.filter(
      (other) =>
        other.depth === box.depth + 1 && other.path.startsWith(`${box.path}/`),
    );
    if (!brood.length) continue;
    const room = allowed.get(box.path)!;
    const own = raw.get(box.path)!;
    // Never nearer its own cards than a plain edge, whatever it holds.
    const left = Math.max(
      box.x,
      Math.min(
        own.left - Math.min(CLUSTER_EDGE, room.left),
        ...brood.map((other) => other.x - CLUSTER_STEP),
      ),
    );
    const right = Math.min(
      box.x + box.width,
      Math.max(
        own.right + Math.min(CLUSTER_EDGE, room.right),
        ...brood.map((other) => other.x + other.width + CLUSTER_STEP),
      ),
    );
    box.x = left;
    box.width = right - left;
  }

  // Outermost first, so whatever draws them draws a parent before its child.
  return boxes.sort((a, b) => a.depth - b.depth || a.y - b.y);
}

export function place(
  data: ViewModel,
  whole: Arrangement,
  standing: Standing,
): Layout {
  const { inPart, measured } = standing;
  // A part is laid out for itself rather than shown in the space the whole
  // change left for it.
  const arrangement = inPart ? packed(data, whole, inPart) : whole;

  const columns = new Map<number, { node: NodeView; spot: Spot }[]>();
  for (const node of data.nodes) {
    if (inPart && !inPart.has(node.id)) continue;
    // A vertex standing for something outside the change goes when the reader
    // says they do not want it, whatever the arrangement holds. It leaves no
    // hole behind: it was never part of the spacing of this column.
    if (!standing.showInfra && isSchema(node.path)) continue;
    const spot = arrangement.nodes[node.id];
    if (!spot) continue;
    const bucket = columns.get(spot.column);
    if (bucket) bucket.push({ node, spot });
    else columns.set(spot.column, [{ node, spot }]);
  }

  /*
   * Whether a card is going to be on the canvas at all, asked before anything
   * is worked out from where the cards are.
   *
   * A file the change touched stays on the canvas whatever happens to it. It
   * goes quiet when it has been read — dimmed, its box ticked — but it does not
   * leave: the picture is of this change, and a change with its read files
   * removed is a picture of something else. What the switches take away is the
   * untouched files, which are only here because something pointed at them, and
   * which have nothing left to say once that has been read or once the last
   * arrow to them has gone.
   *
   * It used to be asked halfway down the placement loop, by which time the
   * bands had already been settled from a set of columns that still held every
   * one of these cards — and a band is the one thing on this side that is
   * worked out from all the columns at once, so a card nobody would ever see
   * still widened its folder's reach and still reserved a run of canvas for
   * itself. That is how a folder of leaf components ended up queueing for a row
   * of its own behind a folder that, once the drawing was made, stood nowhere
   * near it: an untouched type module in a far-left column, dropped before it
   * was drawn but counted when the rows were packed, made its folder span most
   * of the width of the change and turned a row that three folders could have
   * shared into three rows stacked down the page.
   */
  const shown = (node: NodeView): boolean =>
    !node.untouched ||
    !(
      (standing.hideViewed && standing.viewed.has(node.path)) ||
      standing.stranded.has(node.id)
    );

  const placed = new Map<string, Placed>();
  let tallest = 0;
  let widest = 0;

  /*
   * Grouped by the folder each file lives in, when the reader asks for it.
   *
   * The bands are worked out across every column at once and given the same
   * height in each, which is the only way a folder comes out as one rectangle
   * rather than as a clump per column. It costs height — a column inside a
   * folder's reach with nothing in the band leaves that band's room empty — and
   * buys a box that cannot be drawn over somebody else's card, which is the
   * whole point of drawing one. What it does not cost is a stripe per folder:
   * two folders standing over columns that do not touch share the run.
   *
   * Columns are untouched. A card's x is the arrangement's, and the arrangement
   * is the dependency chain read left to right by call order; clustering is
   * only ever a question about the order of cards *within* a column.
   *
   * Worked out from the cards that are going to be drawn and no others. The
   * loop below still walks the whole bucket, because a card leaving has to
   * close its column up behind it and that is an accumulator down the column
   * rather than a filter — but a band answers a question about every column at
   * once, and answering it from cards that will not be there gives a folder a
   * reach and a height it does not have.
   */
  const bands = standing.clusters
    ? bandsFor(
        new Map(
          [...columns].map(([column, bucket]) => [
            column,
            bucket.filter(({ node }) => shown(node)),
          ]),
        ),
        data,
        standing,
      )
    : undefined;

  for (const bucket of columns.values()) {
    // Band first, then the order the engine settled on. Without the band the
    // monotonic floor below would place whichever card came first and push the
    // bands into each other, which is the one thing the reserved room is for.
    bucket.sort(
      (a, b) =>
        (bands ? bands.rank(a.node.path) - bands.rank(b.node.path) : 0) ||
        a.spot.y - b.spot.y,
    );

    let shift = 0;
    let floor = -Infinity;
    for (const { node, spot } of bucket) {
      const estimate = spot.height || node.height;
      // Its column closes up behind it, so the rest of the drawing does not sit
      // around a hole where a card used to be. Which cards these are is decided
      // above, where the bands can be asked the same question.
      if (!shown(node)) {
        shift -= estimate + data.rowGap;
        continue;
      }

      const height = measured(node.id) ?? estimate;
      /*
       * Inside its band, or wherever the column had it.
       *
       * The floor still applies either way: two cards in one column may not
       * overlap whatever anything else says, and a band whose contents have
       * grown past the room reserved for them pushes down rather than through.
       */
      const band = bands?.of(node.path);
      const y =
        band === undefined
          ? Math.max(spot.y + shift, floor)
          : Math.max(band, floor);
      floor = y + height + data.rowGap;
      shift += height - estimate;

      // The arrangement's width and not the node's. The node carries the width
      // the engine sized it at for the reading the page was built in, and the
      // reader may be in the other one; the card is drawn to fill what it is
      // placed in, so this is the width it will have on screen and the width
      // every arrow leaving it is aimed at.
      const width = spot.width || node.width;
      placed.set(node.id, { node, x: spot.x, y, width, height });
      tallest = Math.max(tallest, y + height);
      widest = Math.max(widest, spot.x + width);
    }
  }

  // Back into the model's own order, so that a filter re-places the cards
  // without also reordering the elements they are drawn as.
  const cards: Placed[] = [];
  for (const node of data.nodes) {
    const card = placed.get(node.id);
    if (card) cards.push(card);
  }

  // Room past the last card on each side. Nothing on the canvas is a drawing
  // with no extent — it is a drawing that has not arrived — so the model's own
  // figures stand in rather than a canvas of two margins.
  const folders = bands ? boxesFor(bands, placed, data.rowGap) : undefined;

  return {
    cards,
    width: cards.length ? Math.round(widest + data.margin) : data.width,
    height: tallest > 0 ? Math.round(tallest + data.margin) : data.height,
    ...(folders ? { folders } : {}),
  };
}
