import { describe, expect, it } from "vitest";

import { CLOJURE } from "../src/clojure.js";
import { indexFile, type SymbolIndex } from "../src/index-build.js";

const fresh = (): SymbolIndex => ({
  byName: new Map(),
  files: new Map(),
  byScope: new Map(),
});

describe("reading a Clojure file", () => {
  const source = [
    "(ns my-app.orders.service",
    "  (:require [my-app.db :as db]",
    "            [my-app.mail :refer [send-receipt]]",
    "            [clojure.string :as str])",
    "  (:import (java.time Instant)))",
    "",
    "(def retries 3)",
    "",
    "(defn- normalise [order] order)",
    "",
    "(defn place!",
    "  [order]",
    "  (db/insert (normalise order)))",
    "",
    "(defrecord Order [id total])",
  ].join("\n");

  const { facts, declarations } = CLOJURE.read(
    "src/my_app/orders/service.clj",
    source,
  );

  it("takes the namespace from the ns form, not from the path", () => {
    expect(facts.scope).toBe("my-app.orders.service");
  });

  it("reads an ns form that wrapped over several lines", () => {
    expect(facts.aliases["db"]).toBe("my-app.db");
    expect(facts.aliases["str"]).toBe("clojure.string");
    expect(facts.named["send-receipt"]).toBe("my-app.mail");
    expect(facts.modules).toContain("my-app.mail");
  });

  it("finds every def form, dashes and bangs and all", () => {
    expect(declarations.map((d) => `${d.kind} ${d.name}`)).toEqual([
      "variable retries",
      "function normalise",
      "function place!",
      "record Order",
    ]);
  });

  it("points at the name, not at the form", () => {
    const place = declarations.find((d) => d.name === "place!")!;
    expect(place.line).toBe(11);
    expect(place.column).toBe(6);
  });
});

describe("what a Clojure line references", () => {
  const names = (line: string) => CLOJURE.candidates(line).map((c) => c.name);

  it("finds a call in head position", () => {
    expect(names("  (normalise order))")).toEqual(["normalise"]);
  });

  it("keeps the namespace a qualified call names", () => {
    expect(CLOJURE.candidates("  (db/insert order)")[0]).toMatchObject({
      name: "insert",
      receiver: "db",
    });
  });

  it("finds a qualified name passed as a value", () => {
    expect(names("  (map db/row->order rows)")).toContain("row->order");
  });

  it("leaves the language itself alone", () => {
    expect(names("  (let [x (if (empty? xs) 1 2)] x)")).toEqual([]);
  });

  it("reads the requires in an ns form as references to those namespaces", () => {
    expect(CLOJURE.candidates("  (:require [my-app.db :as db]")).toEqual([
      expect.objectContaining({ kind: "import", module: "my-app.db" }),
    ]);
  });

  it("reads a require that continues on its own line", () => {
    expect(CLOJURE.candidates("            [my-app.mail :refer [send-receipt]]"))
      .toEqual([expect.objectContaining({ kind: "import", module: "my-app.mail" })]);
  });
});

describe("where a namespace could live", () => {
  const facts = CLOJURE.read("src/my_app/core.clj", "").facts;

  it("turns dashes into underscores, the way the language does", () => {
    expect(CLOJURE.pathsFor("my-app.orders.service", facts)).toContain(
      "src/my_app/orders/service.clj",
    );
  });

  it("offers cljc and cljs too", () => {
    expect(CLOJURE.pathsFor("my-app.ui", facts)).toContain("src/my_app/ui.cljs");
  });
});

describe("the index over several files", () => {
  it("keys files by the namespace they declare", () => {
    const index = fresh();
    indexFile(index, CLOJURE, "src/my_app/db.clj", "(ns my-app.db)\n(defn insert [x] x)");
    expect(index.byScope.get("my-app.db")).toEqual(["src/my_app/db.clj"]);
    expect(index.byName.get("insert")?.[0]?.scope).toBe("my-app.db");
  });

  it("falls back to the path when a file declares no namespace", () => {
    const index = fresh();
    indexFile(index, CLOJURE, "src/my_app/util.clj", "(defn helper [] nil)");
    expect(index.files.get("src/my_app/util.clj")?.scope).toBe("my-app.util");
  });
});
