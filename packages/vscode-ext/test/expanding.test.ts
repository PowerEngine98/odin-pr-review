import { describe, expect, it } from "vitest";

import { ChangeSidebar } from "../src/sidebar.js";
import { ViewedStore } from "../src/viewed.js";
import { forgetRan, ran } from "./vscode-stub.js";

/** The editor's key-value store, as much of it as this uses. */
function memento() {
  const held: Record<string, unknown> = {};
  return {
    keys: () => Object.keys(held),
    get: <T>(key: string, fallback?: T) => (key in held ? (held[key] as T) : fallback),
    update: (key: string, value: unknown) => {
      held[key] = value;
      return Promise.resolve();
    },
  };
}

/**
 * Somewhere for the list to draw, and a way to say what it would have said.
 *
 * The same instrument the other side-list tests use, kept small: nothing here
 * reads the document back, only what the list did with a press.
 */
function view() {
  const heard: ((message: unknown) => void)[] = [];
  return {
    webview: {
      cspSource: "vscode-webview:",
      options: {},
      html: "",
      onDidReceiveMessage: (fn: (message: unknown) => void) => {
        heard.push(fn);
        return { dispose() {} };
      },
      postMessage: () => Promise.resolve(true),
    },
    onDidDispose: () => ({ dispose() {} }),
    /** Something the list would say, said. */
    say: (message: unknown) => {
      for (const fn of heard) fn(message);
    },
  };
}

function listening() {
  const store = new ViewedStore(memento() as never);
  store.open("/work/app", "base", "head");
  const sidebar = new ChangeSidebar(store);
  const panel = view();
  sidebar.resolveWebviewView(panel as never);
  forgetRan();
  return { store, panel };
}

describe("the whole list taken at once", () => {
  it("asks the drawing for its test files when every folder is opened", () => {
    /*
     * The list has no settings of its own, and the drawing hides test files on
     * one. A reader who presses "expand all" and gets a tree with the tests in
     * it beside a picture without them has been given two answers to the one
     * question they asked.
     */
    const { panel } = listening();
    panel.say({ type: "showTests" });
    expect(ran.map((one) => one.id)).toContain("odin.showTests");
  });

  it("says nothing about them when the folders are shut again", () => {
    // Folding the list is housekeeping, not a request to take anything out of
    // the drawing. The reader turned the tests on; only they turn them off.
    const { panel } = listening();
    panel.say({ type: "viewed", paths: ["a.ts"], viewed: true });
    expect(ran.map((one) => one.id)).not.toContain("odin.showTests");
  });
});

describe("a whole folder marked read", () => {
  it("takes every file the press named, in one write", () => {
    /*
     * One message carrying the paths rather than one message per file. The
     * folder box is the only thing that sends more than one, and a store that
     * took the first and dropped the rest would leave a folder looking read in
     * the list and unread everywhere else.
     */
    const { store, panel } = listening();
    panel.say({
      type: "viewed",
      paths: ["backend/src/Api.kt", "backend/src/rtc/Session.kt"],
      viewed: true,
    });
    expect(store.all().sort()).toEqual([
      "backend/src/Api.kt",
      "backend/src/rtc/Session.kt",
    ]);
  });

  it("unmarks every one of them again", () => {
    const { store, panel } = listening();
    const paths = ["one.ts", "two.ts", "three.ts"];
    panel.say({ type: "viewed", paths, viewed: true });
    expect(store.all()).toHaveLength(3);

    panel.say({ type: "viewed", paths, viewed: false });
    expect(store.all()).toEqual([]);
  });
});
