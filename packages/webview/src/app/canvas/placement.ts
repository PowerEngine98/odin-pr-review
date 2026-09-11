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

import type { Arrangement, NodeView, ViewModel } from "../model.js";
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
 */
const CLUSTER_PAD = 30;

/** Room between a box's own edge and what it holds. */
const CLUSTER_EDGE = 14;

/** And how much further out each enclosing box sits than the one inside it. */
const CLUSTER_STEP = 16;
const CLUSTER_HEAD = 30;

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
  /** For a box, what it holds, packed into rows. Empty for a band. */
  rows: Slab[][];
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
 * cards. That is the whole of the rule: sort by the leftmost column, and drop
 * each slab into the first row whose occupants all end before it begins.
 * Strictly before, and no clearance column demanded — the case this is for is
 * exactly the one where the downstream folder starts in the very next column,
 * and asking for a gap would refuse it. What keeps the two boxes off each
 * other's edges is the corridor in `boxesFor`, which is capped at half a
 * column gap for this reason.
 *
 * Packing slabs rather than bands is what keeps the nesting honest. A parent is
 * packed against its siblings as one thing, with the column range of everything
 * beneath it, so its descendants can never be split across a row that something
 * foreign is also standing in — which would put that foreign card inside the
 * parent's rectangle. Within a parent the same rule runs again on its children,
 * where every card in the row is the parent's own and there is nothing to
 * swallow.
 */
function pack(slabs: Slab[]): Slab[][] {
  const rows: { held: Slab[]; reach: number }[] = [];

  /*
   * Leftmost first, and the odds and ends at the top of a project last.
   *
   * Leftmost first is what makes one pass enough: a row's occupants are added
   * in the order they stand, so the rightmost edge of the row is the last thing
   * put in it and a single running figure answers the question. The loose files
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

  for (const slab of order) {
    const row = rows.find((held) => slab.first > held.reach);
    if (row) {
      row.held.push(slab);
      row.reach = Math.max(row.reach, slab.last);
    } else {
      rows.push({ held: [slab], reach: slab.last });
    }
  }

  return rows.map((row) => row.held);
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
  const boxedFolder = (folder: string) =>
    folder !== LOOSE &&
    ((under.get(folder)?.size ?? 0) > 1 || (held.get(folder)?.size ?? 0) > 1);

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
      rows: [],
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
  for (const key of keys) {
    const chain = key === LOOSE ? [] : ancestry(key).filter(boxedFolder);
    const span = reach.get(key) ?? { first: 0, last: 0 };
    hang(chain[chain.length - 1], {
      key,
      box: false,
      first: span.first,
      last: span.last,
      // The clearance after the last card of a band is part of what the band
      // takes: without it the first card of whatever follows sits against it.
      extent: (needed.get(key) ?? 0) + data.rowGap,
      rows: [],
    });
  }

  /*
   * How tall each slab is and how far it reaches, worked out from the bottom.
   *
   * A box cannot say how much room it wants until its children have been packed
   * into rows, and they cannot be packed until each of them knows how far it
   * reaches — so the answer is built upwards and the positions handed down
   * afterwards. A box's reach is the reach of everything beneath it, which is
   * what lets it be packed against its siblings as one thing.
   */
  const settle = (slab: Slab): Slab => {
    if (!slab.box) return slab;
    const brood = (kin.get(slab.key) ?? []).map((child) => settle(child));
    for (const child of brood) {
      slab.first = Math.min(slab.first, child.first);
      slab.last = Math.max(slab.last, child.last);
    }
    slab.rows = pack(brood);
    const inside = slab.rows.reduce(
      (total, row) => total + Math.max(...row.map((child) => child.extent)),
      0,
    );
    // A pad and a header to open it, and a pad to close it. They nest, so three
    // levels of folder put three headers above the first card.
    slab.extent = CLUSTER_PAD + CLUSTER_HEAD + inside + CLUSTER_PAD;
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
      bottom: top + slab.extent - CLUSTER_PAD,
      depth: ancestry(slab.key).length,
    });
    lay(slab.rows, top + CLUSTER_PAD + CLUSTER_HEAD);
  }

  /** A row is as tall as the tallest thing in it, and they all start level. */
  function lay(rows: Slab[][], from: number): void {
    let at = from;
    for (const row of rows) {
      for (const slab of row) put(slab, at);
      at += Math.max(...row.map((slab) => slab.extent));
    }
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
  };
}

/**
 * The rectangle each folder's cards ended up occupying.
 *
 * Read off the placement rather than reserved in it. The band decided the top
 * and the height; what is left is how far the folder reaches across the
 * drawing, which is a question about which columns its files landed in — and a
 * box that is measured cannot disagree with the cards it is drawn around.
 */
function boxesFor(
  bands: Bands,
  placed: Map<string, Placed>,
  data: ViewModel,
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
    const inside = [...placed.values()].filter(
      (card) =>
        card.node.path.startsWith(`${band.key}/`) &&
        bandKey(card.node.path).startsWith(band.key),
    );
    // Every file in it was filtered away — tests hidden, a part opened, files
    // ticked off. A box around nothing is a box that is lying.
    if (inside.length < 2) continue;

    const left = Math.min(...inside.map((card) => card.x));
    const right = Math.max(...inside.map((card) => card.x + card.width));
    const bottom = Math.max(...inside.map((card) => card.y + card.height));

    boxes.push({
      path: band.key,
      label: band.key.slice(band.key.lastIndexOf("/") + 1),
      depth: 1,
      x: left,
      y: band.top - CLUSTER_HEAD,
      width: right - left,
      height: bottom - band.top + CLUSTER_HEAD + CLUSTER_PAD,
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
  /*
   * Never so far out that a box reaches into the lane beside it.
   *
   * Two folders standing over different columns share a run of canvas now, so
   * for the first time there can be somebody else's card immediately to the
   * right of a box at the same height. The corridor is measured outwards from
   * the cards, and the only thing between two neighbouring lanes is one column
   * gap, so two boxes facing each other across it may have half of it each and
   * no more — otherwise a folder four levels deep grows a border straight
   * through the leftmost card of the folder to its right.
   */
  const corridor = Math.max(0, Math.floor(data.columnGap / 2) - 2);
  const edge = Math.min(CLUSTER_EDGE, corridor);
  /*
   * Squeezed to fit rather than clipped to fit.
   *
   * Clipping would stop the outermost levels at the same figure and give a box
   * and the box inside it the same border, which is the very fault the corridor
   * is here to prevent. Narrowing the step keeps every level a visibly
   * different distance out, and only nesting deep enough to run out of room
   * ever notices.
   */
  const step = Math.min(CLUSTER_STEP, (corridor - edge) / Math.max(1, deepest - 1));
  for (const box of boxes) {
    /*
     * A corridor, and no more than a corridor.
     *
     * The first version paid a full pad per level, so a folder three deep put
     * ninety pixels of nothing down each side of the outermost box — a gap wide
     * enough to read as a column with no cards in it rather than as a border.
     * A box needs enough room that its edge is plainly not its child's edge,
     * which is a step rather than a margin.
     */
    const room = Math.round(edge + step * (deepest - box.depth));
    box.x -= room;
    box.width += room * 2;
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
   */
  const bands = standing.clusters ? bandsFor(columns, data) : undefined;

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
      // A file the change touched stays on the canvas whatever happens to it. It
      // goes quiet when it has been read — dimmed, its box ticked — but it does
      // not leave: the picture is of this change, and a change with its read
      // files removed is a picture of something else. What the switch takes away
      // is the untouched files, which are only here because something pointed at
      // them, and which have nothing left to say once that has been read.
      if (standing.hideViewed && node.untouched && standing.viewed.has(node.path)) {
        shift -= estimate + data.rowGap;
        continue;
      }

      // And the same for one nothing points at any more. Its column closes up
      // behind it exactly as above, so the rest of the drawing does not sit
      // around a hole where a card used to be.
      // Untouched, and only untouched. A file the change did touch is part of
      // what was changed whether or not anything still points at it, and the
      // picture is of the change.
      if (node.untouched && standing.stranded.has(node.id)) {
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
  const folders = bands ? boxesFor(bands, placed, data) : undefined;

  return {
    cards,
    width: cards.length ? Math.round(widest + data.margin) : data.width,
    height: tallest > 0 ? Math.round(tallest + data.margin) : data.height,
    ...(folders ? { folders } : {}),
  };
}
