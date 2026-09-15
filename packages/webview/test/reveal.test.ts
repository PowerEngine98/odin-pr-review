import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { FileView, FolderView } from "../src/app/sidebar/model.js";
import {
  folded,
  movedTo,
  showing,
  trailToFile,
  type Folds,
} from "../src/app/sidebar/reveal.js";
import { toggled } from "../src/app/sidebar/shut.js";
import { renderSidebar } from "../src/sidebar.js";
import type { SidebarModel } from "../src/sidebar-model.js";

function file(path: string): FileView {
  return {
    path,
    name: path.slice(path.lastIndexOf("/") + 1),
    status: "modified",
    viewed: false,
    additions: "+1",
    deletions: "",
    search: path.toLowerCase(),
    refs: [],
  };
}

function folder(label: string, files: string[], folders: FolderView[] = []): FolderView {
  return { label, folders, files: files.map(file) };
}

/**
 * A tree shaped the way the sidebar really builds them, joined chains and all.
 *
 *   notifications/dao   · NotificationDao.kt
 *     labor             · LaborNotificationDao.kt
 *   messaging           · Kafka.kt
 */
const TREE: FolderView = folder("", [], [
  folder("notifications/dao", ["notifications/dao/NotificationDao.kt"], [
    folder("labor", ["notifications/dao/labor/LaborNotificationDao.kt"]),
  ]),
  folder("messaging", ["messaging/Kafka.kt"]),
]);

/** Everything shut, which is the tree a reader has collapsed by hand. */
const COLLAPSED = {
  "notifications/dao": true,
  "notifications/dao/labor": true,
  messaging: true,
} as const;

const at = (shut: Record<string, true>, path = ""): Folds => ({
  shut: { ...shut },
  opened: {},
  path,
});

/** Which folders the tree is actually showing the insides of. */
function open(folds: Folds): string[] {
  return ["notifications/dao", "notifications/dao/labor", "messaging"].filter(
    (path) => showing(folds.shut, folds.opened, path),
  );
}

/**
 * Finding the folders that stand between the root and a file.
 *
 * The mark on the current row is no use at all if the row is folded away, so the
 * tree opens the way to it. Which folders those are is the whole question, and
 * it is not the question it looks like.
 */
describe("the folders hiding a file", () => {
  it("names the folders the tree draws, not the prefixes of the path", () => {
    /*
     * The tree joins a chain of directories that holds nothing else into one
     * row — a Java-shaped project is mostly those. Slicing the file's own path
     * into prefixes therefore names `notifications`, which is not a folder the
     * tree has: opening it writes into the record under a key nothing reads, and
     * the one folder that is really in the way stays shut. The row would still
     * be hidden, and the reader would be looking at a list with a mark they
     * cannot find.
     */
    expect(trailToFile(TREE, "notifications/dao/labor/LaborNotificationDao.kt")).toEqual([
      "notifications/dao",
      "notifications/dao/labor",
    ]);
  });

  it("stops at the folder the file is actually in", () => {
    // A sibling folder deeper in the tree is not in anybody's way.
    expect(trailToFile(TREE, "notifications/dao/NotificationDao.kt")).toEqual([
      "notifications/dao",
    ]);
  });

  it("names nothing for a file this tree has never heard of", () => {
    /*
     * The panel and the list can be a rebuild apart, so the file the reader is
     * standing on is sometimes not in the tree at all. The honest answer is that
     * no folder is hiding it — anything else opens folders to reveal a row that
     * is not there.
     */
    expect(trailToFile(TREE, "somewhere/else.kt")).toEqual([]);
  });

  it("names nothing for a file lying in the root, which has no row to open", () => {
    const flat = folder("", ["build.gradle.kts"]);
    expect(trailToFile(flat, "build.gradle.kts")).toEqual([]);
  });
});

/**
 * Showing the reader where they are, and then putting the tree back.
 *
 * Opening the way to the current file is the easy half. The half that decides
 * whether the feature is usable is what happens when they move on: a reveal that
 * is never undone leaves a reader who panned across thirty files with thirty
 * directories hanging ajar, none of which they opened, and no way to tell which
 * of their own folds survived.
 */
describe("revealing the file the reader is on", () => {
  it("opens the folders standing between the root and it", () => {
    // Without this the mark is drawn on a row inside a shut folder, which is a
    // mark nobody can see — and being easy to find was the whole request.
    const folds = movedTo(at(COLLAPSED), TREE, "notifications/dao/labor/LaborNotificationDao.kt");
    expect(open(folds)).toEqual(["notifications/dao", "notifications/dao/labor"]);
  });

  it("shuts exactly those again when the reader moves to another file", () => {
    /*
     * The failure this prevents is the trail: every folder the reader ever
     * passed through left standing open behind them, so a tree they collapsed to
     * see the shape of the change slowly reopens itself as they read.
     */
    let folds = at(COLLAPSED);
    folds = movedTo(folds, TREE, "notifications/dao/labor/LaborNotificationDao.kt");
    folds = movedTo(folds, TREE, "messaging/Kafka.kt");
    expect(open(folds)).toEqual(["messaging"]);
  });

  it("leaves a fully collapsed tree fully collapsed once they are past it", () => {
    // The same rule stated as the thing a reader would notice: navigating
    // through a collapsed tree never leaves random parts of it open.
    let folds = at(COLLAPSED);
    for (const path of [
      "notifications/dao/NotificationDao.kt",
      "notifications/dao/labor/LaborNotificationDao.kt",
      "messaging/Kafka.kt",
    ]) {
      folds = movedTo(folds, TREE, path);
    }
    // Nothing is marked any more, so nothing is held open either.
    folds = movedTo(folds, TREE, "");
    expect(open(folds)).toEqual([]);
    expect(folds.shut).toEqual(COLLAPSED);
  });

  it("leaves a folder the reader opened themselves alone", () => {
    /*
     * The distinction the whole thing turns on. A reader who deliberately opened
     * `notifications/dao` and then walked through a file inside it must not have
     * it shut under them on the way out: a tree that undoes the reader's own
     * actions is a worse fault than the one being fixed, and it is the kind that
     * feels haunted.
     */
    const theirs = { "notifications/dao/labor": true, messaging: true };
    let folds = at(theirs);
    folds = movedTo(folds, TREE, "notifications/dao/NotificationDao.kt");
    folds = movedTo(folds, TREE, "messaging/Kafka.kt");
    expect(open(folds)).toContain("notifications/dao");
  });

  it("changes nothing at all when told the same file twice", () => {
    // The panel says where the reader is whenever the page redraws, and a reveal
    // recomputed from a record it has already changed would shut the way to the
    // reader's own file underneath them.
    const folds = movedTo(at(COLLAPSED), TREE, "messaging/Kafka.kt");
    expect(movedTo(folds, TREE, "messaging/Kafka.kt")).toBe(folds);
  });

  it("hands the record back rather than changing the one it was given", () => {
    // What holds these is reactive state, and a record altered in place is a
    // record nothing is watching — a fault this repository has already had once.
    const before = at(COLLAPSED);
    const after = movedTo(before, TREE, "messaging/Kafka.kt");
    expect(before.opened).toEqual({});
    expect(after).not.toBe(before);
    expect(after.shut).toBe(before.shut);
  });
});

/**
 * What a reveal does when the reader folds something themselves.
 *
 * From that press on the revealed path is theirs. Anything else has the tree
 * either taking back a folder they just opened or slamming the one they are
 * standing in, and both read as the list having a mind of its own.
 */
describe("a reader folding a folder while a reveal is in force", () => {
  it("shuts a revealed folder on the first press rather than opening it again", () => {
    /*
     * A folder standing open because the reveal opened it is still written down
     * as shut. Flipping the record would therefore have opened it — it was
     * already open — and the press would have done nothing at all, twice if they
     * tried again.
     */
    let folds = movedTo(at(COLLAPSED), TREE, "notifications/dao/NotificationDao.kt");
    expect(open(folds)).toEqual(["notifications/dao"]);
    folds = folded(folds, "notifications/dao");
    expect(open(folds)).toEqual([]);
  });

  it("keeps the revealed path open, and writes it down as open", () => {
    /*
     * Merely forgetting the reveal at the first press would shut the path the
     * reader is standing in the instant they touched any folder anywhere — so
     * the file they were looking at leaves the list because they opened
     * something else. The reveal is handed over instead: those folders are the
     * reader's from now on, in the record that gets persisted, and the next
     * change of file leaves them be.
     */
    let folds = movedTo(at(COLLAPSED), TREE, "notifications/dao/labor/LaborNotificationDao.kt");
    folds = folded(folds, "messaging");
    expect(folds.shut["notifications/dao"]).toBeUndefined();
    expect(folds.shut["notifications/dao/labor"]).toBeUndefined();
    expect(open(folds)).toContain("notifications/dao");
    expect(open(folds)).toContain("notifications/dao/labor");

    // And it survives the reader moving on, because it is no longer a reveal.
    folds = movedTo(folds, TREE, "messaging/Kafka.kt");
    expect(open(folds)).toContain("notifications/dao");
  });

  it("still folds a folder that has nothing to do with any reveal", () => {
    // The ordinary case has to keep working: what is open shuts, what is shut
    // opens, and it is written down either way.
    const folds = folded(at({}, "messaging/Kafka.kt"), "messaging");
    expect(folds.shut).toEqual({ messaging: true });
    expect(folded(folds, "messaging").shut).toEqual({});
    // And the reveal's own answer to where the reader is stands, because folding
    // a directory is not moving.
    expect(folds.path).toBe("messaging/Kafka.kt");
  });

  it("hands the record back rather than changing the one it was given", () => {
    const before = at(toggled({}, "messaging"));
    const after = folded(before, "messaging");
    expect(before.shut).toEqual({ messaging: true });
    expect(after.shut).not.toBe(before.shut);
  });
});

/* ------------------------------------------------------- and in the markup */

function model(here?: string): SidebarModel {
  return {
    loading: false,
    picker: {
      mine: [],
      everythingElse: [],
      asked: { state: "open", author: "" },
      viewer: "",
      reached: true,
    },
    change: {
      tree: TREE,
      totals: { additions: 1, deletions: 0, authors: "someone", authorsFull: "someone" },
      reading: { branch: "feature", local: false },
      ...(here ? { here } : {}),
    },
  };
}

/** The rows the list drew, as the class list of each against its file. */
function rows(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of html.match(/<div class="[^"]*row[^"]*"[^>]*>/g) ?? []) {
    const path = /title="([^"]*)"/.exec(row)?.[1] ?? "";
    out[path] = /class="([^"]*)"/.exec(row)?.[1] ?? "";
  }
  return out;
}

/**
 * The mark as the reader actually sees it, drawn by the same components the
 * browser wakes up and adopts.
 *
 * Rendered rather than reasoned about, because the whole of the point is a row
 * that looks different from the rows around it, and the payload reaching the
 * component is the part that has silently not worked twice already.
 */
describe("the marked row in the rendered list", () => {
  it("marks the row for the file the panel said the reader was on", () => {
    const drawn = rows(renderSidebar(model("messaging/Kafka.kt")));
    expect(drawn["messaging/Kafka.kt"]).toContain("here");
    expect(drawn["notifications/dao/NotificationDao.kt"]).not.toContain("here");
  });

  it("marks exactly one row", () => {
    // Two marks is worse than none: the reader cannot be in two files, so the
    // one they trust is whichever they see first.
    const html = renderSidebar(model("notifications/dao/NotificationDao.kt"));
    const marked = Object.values(rows(html)).filter((cls) => / here|here$/.test(cls));
    expect(marked).toHaveLength(1);
  });

  it("marks nothing when the panel has not said where the reader is", () => {
    /*
     * The list is drawn before any page has been opened on the change, and on a
     * reading the reader has not moved in yet. A mark that defaulted to the
     * first file would be the list asserting something it does not know.
     */
    const marked = Object.values(rows(renderSidebar(model()))).filter((cls) =>
      / here|here$/.test(cls),
    );
    expect(marked).toHaveLength(0);
  });

  it("gives the mark a wash and an edge of its own, not the hover's", () => {
    /*
     * The hover is already a wash — the editor's own grey — so a mark that was
     * only a second wash could be read only by moving the pointer away to check
     * which one was showing. The edge is the part nothing else in this strip
     * has. Both are mixed from one blue that comes from the theme, so the row
     * keeps its contrast in the light theme as well as the dark.
     */
    const html = renderSidebar(model("messaging/Kafka.kt"));
    expect(html).toContain("--here-wash: color-mix(in srgb, var(--here) 16%, transparent)");
    expect(html).toContain("--here-edge: color-mix(in srgb, var(--here) 58%, transparent)");
    // The compiler scopes the selector, so the rule is found by what it opens
    // with rather than by the whole of it.
    const rule = /\.row\.here[^{}]*\{([^}]*)\}/.exec(html)?.[1] ?? "";
    expect(rule).toContain("background:var(--here-wash)");
    expect(rule).toContain("box-shadow:inset 0 0 0 1px var(--here-edge)");
    // A shadow rather than a border, because a border is two pixels the row has
    // to grow by — so every row under it would step down as the reader panned
    // past a file and back up as they left, the whole list twitching per card.
    expect(rule).not.toMatch(/\bborder:/);
  });
});

/**
 * Bringing the marked row into view, which is a decision and not a detail.
 *
 * How a row is scrolled to cannot be driven from here — it needs a mounted
 * component and a strip with a real height, and this suite has neither — so what
 * is pinned instead is the two choices that make the difference between a list
 * that helps and a list that fidgets. A source check is a weak test in general
 * and the right one here, because both choices look like arbitrary arguments
 * from inside the component and are the whole point from outside it.
 */
describe("scrolling the marked row into view", () => {
  const row = readFileSync(
    new URL("../src/app/sidebar/File.svelte", import.meta.url),
    "utf8",
  );

  it("does not move a row that can already be seen", () => {
    /*
     * The reader is panning a canvas while this happens and the current file
     * changes every time a card crosses the middle of it. A list that re-centred
     * itself on each one would be a column of text sliding about in the corner of
     * their eye for the whole gesture. `nearest` leaves a visible row exactly
     * where it is and brings an off-screen one in by the least it can.
     */
    expect(row).toContain('scrollIntoView({ block: "nearest", inline: "nearest" })');
  });

  it("does not animate, which sounds harsher and is gentler", () => {
    // Smooth scrolls queued behind one another carry on moving after the reader
    // has stopped, and overshoot a row that was only ever a line out of view.
    expect(row).not.toContain("behavior:");
    expect(row).not.toContain('"smooth"');
  });

  it("scrolls for the marked row and no other", () => {
    // Every row in the tree runs this effect. One of them is the current file;
    // the rest have to leave the strip alone.
    expect(row).toMatch(/if \(!here\) return;\s*\n\s*row\?\.scrollIntoView/);
  });
});
