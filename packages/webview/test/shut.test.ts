import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  isOpen,
  readShut,
  toggled,
  trailTo,
  writeShut,
} from "../src/app/sidebar/shut.js";

/**
 * Which folders in the tree stay shut.
 *
 * The tree is rebuilt from scratch whenever anything refreshes — the host
 * renders a new document and assigns it — and a folder's open state lived in
 * the component that drew it, so every rebuild threw it away and the whole tree
 * sprang open again. On a change with two hundred files that is a reader
 * scrolling past the same eleven directories they closed a minute ago.
 */
describe("remembering a shut folder", () => {
  it("opens everything when nothing has been shut", () => {
    expect(isOpen(readShut(null), "src")).toBe(true);
  });

  it("shuts one and leaves the rest alone", () => {
    const shut = toggled({}, "src/hooks");
    expect(isOpen(shut, "src/hooks")).toBe(false);
    expect(isOpen(shut, "src")).toBe(true);
  });

  it("opens it again when it is pressed again", () => {
    const shut = toggled(toggled({}, "src"), "src");
    expect(isOpen(shut, "src")).toBe(true);
  });

  it("hands back a new record rather than changing the one it was given", () => {
    // What holds this is reactive state, and a record altered in place is a
    // record nothing is watching.
    const before = {};
    const after = toggled(before, "src");
    expect(before).toEqual({});
    expect(after).not.toBe(before);
  });

  it("survives being written down and read back", () => {
    const shut = toggled(toggled({}, "src/hooks"), "test/fixtures");
    expect(readShut(writeShut(shut))).toEqual(shut);
  });

  it("records what is shut, not what is open", () => {
    /*
     * A directory that appears in the tree for the first time after a rebuild
     * opens, rather than inheriting a state nobody chose for it — which is what
     * storing the open ones would have done to it.
     */
    expect(writeShut({})).toBe("[]");
    expect(writeShut(toggled({}, "src"))).toBe('["src"]');
  });

  it("falls back to an open tree on anything it cannot read", () => {
    for (const held of ["", "not json", "{}", '["ok",7,null]', "null"]) {
      const shut = readShut(held);
      expect(isOpen(shut, "src")).toBe(true);
    }
    // And keeps the part it could read.
    expect(readShut('["ok",7,null]')).toEqual({ ok: true });
  });
});

describe("what a folder is remembered by", () => {
  it("is where it is, not what it is called", () => {
    // `src/hooks` and `test/hooks` are two folders called `hooks`. Shutting one
    // must not shut the other.
    expect(trailTo("src", "hooks")).toBe("src/hooks");
    expect(trailTo("test", "hooks")).toBe("test/hooks");
    expect(trailTo("src", "hooks")).not.toBe(trailTo("test", "hooks"));
  });

  it("names a top-level folder by itself", () => {
    // The root carries no label and draws no row, so everything under it starts
    // its own trail.
    expect(trailTo("", "src")).toBe("src");
  });

  it("is what the tree actually keys on", () => {
    const folder = readFileSync(
      new URL("../src/app/sidebar/Folder.svelte", import.meta.url),
      "utf8",
    );
    expect(folder).toContain("trailTo(trail, folder.label)");
    expect(folder).toContain("trail={path}");
    // And the state comes from the sidebar's memory rather than from the
    // component, which is the whole of the fix.
    expect(folder).toContain("const open = $derived(folderOpen(path))");
    expect(folder).not.toContain("let open = $state(true)");
  });
});
