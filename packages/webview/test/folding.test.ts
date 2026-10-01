import { describe, expect, it } from "vitest";

import type { FileStatus, FileView, FolderView } from "../src/app/sidebar/model.js";
import { foldedAll, showing, type Folds } from "../src/app/sidebar/reveal.js";
import { foldersIn, reviewableIn } from "../src/app/sidebar/tree.js";

function file(path: string, status: FileStatus = "modified"): FileView {
  return {
    path,
    name: path.slice(path.lastIndexOf("/") + 1),
    status,
    viewed: false,
    additions: "+1",
    deletions: "",
    search: path.toLowerCase(),
    refs: [],
  };
}

function folder(
  label: string,
  files: FileView[],
  folders: FolderView[] = [],
): FolderView {
  return { label, folders, files };
}

/**
 * A tree shaped the way the sidebar really builds them.
 *
 *   backend/src           · Api.kt, Untouched.kt (untouched)
 *     rtc                 · Session.kt
 *   test/rtc              · SessionTests.kt
 *
 * Two folders called `rtc`, deliberately: everything here is keyed by where a
 * folder is rather than by what it is called, and a fixture with one of each
 * name could not tell the difference.
 */
const TREE: FolderView = folder(
  "",
  [],
  [
    folder(
      "backend/src",
      [file("backend/src/Api.kt"), file("backend/src/Untouched.kt", "phantom")],
      [folder("rtc", [file("backend/src/rtc/Session.kt")])],
    ),
    folder("test", [], [folder("rtc", [file("test/rtc/SessionTests.kt")])]),
  ],
);

describe("every folder in the tree", () => {
  it("names each one by where it is rather than by what it is called", () => {
    expect(foldersIn(TREE)).toEqual([
      "backend/src",
      "backend/src/rtc",
      "test",
      "test/rtc",
    ]);
  });

  it("leaves out the root, which draws no row to fold", () => {
    expect(foldersIn(TREE)).not.toContain("");
  });
});

describe("what a folder's box can mark off", () => {
  it("takes the whole subtree rather than the folder's own files", () => {
    expect(reviewableIn(TREE.folders[0]!).map((f) => f.path)).toEqual([
      "backend/src/rtc/Session.kt",
      "backend/src/Api.kt",
    ]);
  });

  it("leaves out untouched files, which cannot be marked at all", () => {
    expect(reviewableIn(TREE).map((f) => f.path)).not.toContain(
      "backend/src/Untouched.kt",
    );
  });
});

describe("the whole tree folded at once", () => {
  const nowhere: Folds = { shut: {}, opened: {}, path: "" };

  it("shuts every folder there is", () => {
    const after = foldedAll(nowhere, TREE, foldersIn(TREE), false);
    for (const path of foldersIn(TREE)) {
      expect(showing(after.shut, after.opened, path)).toBe(false);
    }
  });

  it("opens every folder there is, and writes nothing down", () => {
    const shut = foldedAll(nowhere, TREE, foldersIn(TREE), false);
    const open = foldedAll(shut, TREE, foldersIn(TREE), true);
    expect(open.shut).toEqual({});
    for (const path of foldersIn(TREE)) {
      expect(showing(open.shut, open.opened, path)).toBe(true);
    }
  });

  it("keeps the file the reader is standing on in sight", () => {
    const standing: Folds = { ...nowhere, path: "backend/src/rtc/Session.kt" };
    const after = foldedAll(standing, TREE, foldersIn(TREE), false);

    // Shut as far as storage is concerned — folding the tree is what was asked
    // for — but held open by the reveal, so the row it marks is still drawn.
    expect(after.shut["backend/src"]).toBe(true);
    expect(after.shut["backend/src/rtc"]).toBe(true);
    expect(showing(after.shut, after.opened, "backend/src")).toBe(true);
    expect(showing(after.shut, after.opened, "backend/src/rtc")).toBe(true);

    // And nothing else: the point of collapsing is that the rest goes away.
    expect(showing(after.shut, after.opened, "test")).toBe(false);
    expect(showing(after.shut, after.opened, "test/rtc")).toBe(false);
  });

  it("shuts the lot when the reader is standing nowhere", () => {
    const after = foldedAll(nowhere, TREE, foldersIn(TREE), false);
    expect(after.opened).toEqual({});
  });

  it("holds nothing open for a file this tree has not got", () => {
    const elsewhere: Folds = { ...nowhere, path: "gone/Away.kt" };
    const after = foldedAll(elsewhere, TREE, foldersIn(TREE), false);
    expect(after.opened).toEqual({});
    expect(after.path).toBe("gone/Away.kt");
  });
});
