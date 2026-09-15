import type { FolderView } from "./model.js";
import { isOpen, trailTo, type Shut } from "./shut.js";

/**
 * Showing the file the reader is on, and putting the tree back afterwards.
 *
 * The list marks the row the reader is standing on in the drawing, and a mark
 * on a row inside a shut folder marks nothing anybody can see — which defeats
 * the whole point of it, since the reason the mark was asked for was to make the
 * file easy to find. So the folders between the root and that file are opened.
 *
 * The part that needs saying is what happens next. Opening them and leaving them
 * open means a reader who panned across thirty files comes back to a tree with
 * thirty directories hanging ajar, none of which they opened, and no way to tell
 * which of their own folds survived. So the reveal is undone when the reader
 * moves on: exactly the folders it opened are shut again, and the tree a reader
 * left fully collapsed is fully collapsed again with only the path to wherever
 * they are now showing.
 *
 * Which turns on one distinction, and it is the whole of this module: a folder
 * the reveal opened is not the same thing as a folder the reader opened. Only
 * the first may be shut again. A reader who deliberately opened
 * `notifications/dao` and then happened to walk through a file inside it must
 * not have it shut under them — a tree that undoes the reader's own actions is a
 * worse fault than the one being fixed, and it is the kind that feels haunted.
 * So the reveal records what it opened and touches nothing else, and the moment
 * the reader folds anything at all the record is handed over to them rather than
 * held against them.
 *
 * Nothing here is reactive and nothing here is stored. The persisted record of
 * what is shut stays the one answer to what the reader has folded; this is a
 * layer read on top of it, so there are not two records of the same fact to
 * disagree with one another and flicker.
 */

/** Folders the reveal opened, by the path each is remembered by. */
export type Opened = Record<string, true>;

/**
 * The folders between the root and a file, outermost first.
 *
 * Walked rather than sliced off the file's own path. The tree joins a chain of
 * directories that holds nothing else into one row — a Java-shaped project is
 * mostly those — so `a/b/c/File.kt` may live in a single folder labelled
 * `a/b/c`, and the prefixes of its path name two folders that do not exist.
 * Opening those would be writing into the record under keys nothing reads, and
 * the one folder that is really in the way would stay shut.
 *
 * Empty when the file is not in this tree, which is not an error: the panel and
 * the list can be a rebuild apart, and the answer to "which folders hide a file
 * that is not here" is honestly none of them.
 */
export function trailToFile(root: FolderView, path: string, trail = ""): string[] {
  const here = root.label === "" ? trail : trailTo(trail, root.label);

  if (root.files.some((file) => file.path === path)) {
    // The root draws no row and can be neither open nor shut, so it is never
    // part of the trail even when the file sits directly in it.
    return here === "" ? [] : [here];
  }

  for (const child of root.folders) {
    const under = trailToFile(child, path, here);
    if (under.length > 0) return here === "" ? under : [here, ...under];
  }

  return [];
}

/**
 * Which of those folders the reveal has to open, and therefore owns.
 *
 * Only the shut ones. A folder that was already open was opened by the reader or
 * was never closed, and either way it is not the reveal's to shut again — which
 * is the difference the rest of this rests on, so it is settled once, here,
 * rather than at each of the places that would otherwise have to remember it.
 */
export function toOpen(shut: Shut, trail: readonly string[]): Opened {
  const out: Opened = {};
  for (const path of trail) if (!isOpen(shut, path)) out[path] = true;
  return out;
}

/**
 * Whether a folder is showing what is under it, the reveal taken into account.
 *
 * The reveal can only ever open: a folder the reader has not shut is open
 * regardless, and there is nothing this layer could usefully say about it.
 */
export function showing(shut: Shut, opened: Opened, path: string): boolean {
  return isOpen(shut, path) || opened[path] === true;
}

/**
 * The reveal handed over to the reader, because the reader has folded something.
 *
 * Every folder the reveal opened is written into the record as genuinely open,
 * and the reveal is left with nothing to undo. Simply forgetting them instead
 * would slam them shut the instant the reader touched any folder anywhere, which
 * is the opposite of what touching a folder means.
 *
 * All of them rather than only the one pressed, and that is deliberate. A reader
 * who opens a sibling of a revealed folder means to be looking around in there;
 * shutting the path they are looking around inside, a pan later, would take the
 * thing they just opened off the screen with it.
 *
 * A new record rather than the one it was given, because what holds these is
 * reactive state and a record altered in place is a record nothing is watching.
 */
export function adopted(shut: Shut, opened: Opened): Shut {
  const next = { ...shut };
  for (const path of Object.keys(opened)) delete next[path];
  return next;
}

/**
 * A folder set open or shut outright, rather than flipped.
 *
 * The flip is not enough once a reveal is in play: a folder the reader can see
 * standing open because the reveal opened it is still recorded as shut, so
 * flipping the record would open it again and the press would do nothing —
 * twice, if they tried again. What the press means is "make it the other of what
 * I can see", so what it can see is worked out first and the record is told.
 */
export function withOpen(shut: Shut, path: string, open: boolean): Shut {
  const next = { ...shut };
  if (open) delete next[path];
  else next[path] = true;
  return next;
}

/**
 * The folds and the reveal together, which is the only useful way to hold them.
 *
 * `shut` is what the reader has folded and is what gets written down; `opened`
 * is what the reveal is holding open on top of that and is written down nowhere.
 * Both are kept in one value so the two moves below can be whole answers rather
 * than a pair of assignments somebody has to remember to make together — a tree
 * that has shut the last reveal but not yet opened the next one is a tree with
 * the reader's file hidden, and it is one line of a component away at all times.
 */
export interface Folds {
  shut: Shut;
  opened: Opened;
  /** The file the reveal is for, so a repeat of the same one changes nothing. */
  path: string;
}

/**
 * The reader has come to rest over another file.
 *
 * Exactly the folders the last reveal opened are shut again, which costs nothing
 * at all: the reveal never wrote into `shut`, so letting go of the record *is*
 * the closing. Then the folders hiding the new file are opened. A tree left
 * fully collapsed comes out of this fully collapsed, with only the path to
 * wherever the reader is now standing showing.
 */
export function movedTo(
  folds: Folds,
  tree: FolderView | undefined,
  path: string,
): Folds {
  if (path === folds.path) return folds;
  if (!path || !tree) return { shut: folds.shut, opened: {}, path };
  return {
    shut: folds.shut,
    opened: toOpen(folds.shut, trailToFile(tree, path)),
    path,
  };
}

/**
 * The reader has folded something themselves.
 *
 * The reveal is handed over to them first and in full, so the path they are
 * standing in stays open and is written down as open, and the next change of
 * file leaves it alone. Then the folder they actually pressed is set to the
 * other of what they could see.
 *
 * Reading the press off what is on screen rather than off the record matters
 * here: a folder standing open because the reveal opened it is still recorded as
 * shut, so a flip of the record would have opened it again and left the press
 * apparently doing nothing.
 */
export function folded(folds: Folds, path: string): Folds {
  const open = showing(folds.shut, folds.opened, path);
  return {
    shut: withOpen(adopted(folds.shut, folds.opened), path, !open),
    opened: {},
    path: folds.path,
  };
}
