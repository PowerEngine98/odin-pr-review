import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import type { LineProbe } from "@odin/core";

import { ClojureResolver, PythonResolver } from "../src/index.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function workspace(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "odin-lang-"));
  dirs.push(root);
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, contents);
  }
  return root;
}

const probe = (path: string, line: number): LineProbe => ({
  path, side: "head", line, changeKind: "add",
});

describe("PythonResolver", () => {
  const PROJECT = {
    "app/db.py": ["def save(order):", "    return order", ""].join("\n"),
    "app/cache.py": ["def save(key):", "    return key", ""].join("\n"),
    "app/mail.py": ["def send(to):", "    return to", ""].join("\n"),
    "app/orders.py": [
      "from app.db import save",              // 1
      "import app.mail as mail",              // 2
      "",
      "def place(order):",                    // 4
      "    save(order)",                      // 5
      "    mail.send(order.email)",           // 6
      "    return order",
    ].join("\n"),
  };

  it("follows an imported name to the file it was imported from", async () => {
    const resolver = new PythonResolver({ roots: { head: workspace(PROJECT) } });
    const [result] = await resolver.resolve([probe("app/orders.py", 5)]);

    expect(result!.targets[0]).toMatchObject({
      path: "app/db.py",
      line: 1,
      symbolName: "save",
      symbolKind: "function",
      kind: "call",
      confidence: "heuristic",
      resolver: "python",
      fromSymbolName: "place",
    });
  });

  it("follows a call through an alias to the module it stands for", async () => {
    const resolver = new PythonResolver({ roots: { head: workspace(PROJECT) } });
    const [result] = await resolver.resolve([probe("app/orders.py", 6)]);

    expect(result!.targets).toEqual([
      expect.objectContaining({ path: "app/mail.py", symbolName: "send" }),
    ]);
  });

  it("draws an edge for the import statement itself", async () => {
    const resolver = new PythonResolver({ roots: { head: workspace(PROJECT) } });
    const [result] = await resolver.resolve([probe("app/orders.py", 1)]);

    expect(result!.targets[0]).toMatchObject({
      path: "app/db.py",
      kind: "import",
      line: 1,
    });
  });

  it("says nothing when it cannot tell which file was meant", async () => {
    // Two modules declare `save`, and this file imports neither of them.
    const root = workspace({
      ...PROJECT,
      "app/other.py": ["def run(order):", "    save(order)", ""].join("\n"),
    });
    const resolver = new PythonResolver({ roots: { head: root } });
    const results = await resolver.resolve([probe("app/other.py", 2)]);

    expect(results).toEqual([]);
  });

  it("leaves import edges out when asked to", async () => {
    const resolver = new PythonResolver({
      roots: { head: workspace(PROJECT) },
      includeImports: false,
    });
    expect(await resolver.resolve([probe("app/orders.py", 1)])).toEqual([]);
  });
});

describe("ClojureResolver", () => {
  const PROJECT = {
    "src/my_app/db.clj": [
      "(ns my-app.db)",
      "",
      "(defn insert! [order] order)",
    ].join("\n"),
    "src/my_app/mail.clj": [
      "(ns my-app.mail)",
      "",
      "(defn send-receipt [order] order)",
    ].join("\n"),
    "src/my_app/orders.clj": [
      "(ns my-app.orders",                          // 1
      "  (:require [my-app.db :as db]",             // 2
      "            [my-app.mail :refer [send-receipt]]))", // 3
      "",
      "(defn place!",                               // 5
      "  [order]",
      "  (db/insert! order)",                       // 7
      "  (send-receipt order))",                    // 8
    ].join("\n"),
  };

  it("follows a qualified call to the namespace's file", async () => {
    const resolver = new ClojureResolver({ roots: { head: workspace(PROJECT) } });
    const [result] = await resolver.resolve([probe("src/my_app/orders.clj", 7)]);

    expect(result!.targets[0]).toMatchObject({
      path: "src/my_app/db.clj",
      line: 3,
      symbolName: "insert!",
      symbolKind: "function",
      kind: "call",
      confidence: "heuristic",
      resolver: "clojure",
      fromSymbolName: "place!",
    });
  });

  it("follows a referred name to the namespace it was referred from", async () => {
    const resolver = new ClojureResolver({ roots: { head: workspace(PROJECT) } });
    const [result] = await resolver.resolve([probe("src/my_app/orders.clj", 8)]);

    expect(result!.targets).toEqual([
      expect.objectContaining({
        path: "src/my_app/mail.clj",
        symbolName: "send-receipt",
      }),
    ]);
  });

  it("draws an edge for each required namespace", async () => {
    const resolver = new ClojureResolver({ roots: { head: workspace(PROJECT) } });
    const [result] = await resolver.resolve([probe("src/my_app/orders.clj", 2)]);

    expect(result!.targets[0]).toMatchObject({
      path: "src/my_app/db.clj",
      kind: "import",
    });
  });

  it("says nothing about a name two namespaces both define", async () => {
    const root = workspace({
      "src/my_app/a.clj": "(ns my-app.a)\n(defn run [] nil)",
      "src/my_app/b.clj": "(ns my-app.b)\n(defn run [] nil)",
      "src/my_app/c.clj": "(ns my-app.c)\n(defn go [] (run))",
    });
    const resolver = new ClojureResolver({ roots: { head: root } });

    expect(await resolver.resolve([probe("src/my_app/c.clj", 2)])).toEqual([]);
  });

  it("has nothing to say about the base side when there is no base checkout", async () => {
    const resolver = new ClojureResolver({ roots: { head: workspace(PROJECT) } });
    const removed: LineProbe = {
      path: "src/my_app/orders.clj", side: "base", line: 7, changeKind: "del",
    };
    expect(await resolver.resolve([removed])).toEqual([]);
  });
});
