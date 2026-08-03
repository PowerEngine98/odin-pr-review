import { describe, expect, it } from "vitest";

import { PYTHON } from "../src/python.js";
import { indexFile, type SymbolIndex } from "../src/index-build.js";

const fresh = (): SymbolIndex => ({
  byName: new Map(),
  files: new Map(),
  byScope: new Map(),
});

describe("reading a Python file", () => {
  const source = [
    "from app.db import session",
    "from .helpers import slugify as slug",
    "import app.mail as mail",
    "",
    "RETRIES = 3",
    "",
    "class OrderService:",
    "    def place(self, order):",
    "        return session.add(order)",
    "",
    "def dispatch(order):",
    "    pass",
  ].join("\n");

  const { facts, declarations } = PYTHON.read("app/orders/service.py", source);

  it("knows which module the file is", () => {
    expect(facts.scope).toBe("app.orders.service");
  });

  it("calls a package by its directory, not by __init__", () => {
    expect(PYTHON.read("app/db/__init__.py", "").facts.scope).toBe("app.db");
  });

  it("records what each name was imported from", () => {
    expect(facts.named["session"]).toBe("app.db");
    // Relative imports climb from the file's own package, not from the file.
    expect(facts.named["slug"]).toBe("app.orders.helpers");
  });

  it("records aliases as the module they stand for", () => {
    expect(facts.aliases["mail"]).toBe("app.mail");
  });

  it("finds classes, functions and module-level names", () => {
    expect(declarations.map((d) => `${d.kind} ${d.name}`)).toEqual([
      "variable RETRIES",
      "class OrderService",
      "function place",
      "function dispatch",
    ]);
  });

  it("attributes a method to the class holding it", () => {
    expect(declarations.find((d) => d.name === "place")?.owner).toBe("OrderService");
  });

  it("leaves locals out: a name bound inside a function is not a declaration", () => {
    const { declarations: inner } = PYTHON.read("a.py", "def f():\n    total = 1\n");
    expect(inner.map((d) => d.name)).toEqual(["f"]);
  });
});

describe("what a Python line references", () => {
  const names = (line: string) => PYTHON.candidates(line).map((c) => c.name);

  it("finds plain calls", () => {
    expect(names("    result = dispatch(order)")).toContain("dispatch");
  });

  it("finds calls through a receiver, and remembers it", () => {
    const [found] = PYTHON.candidates("mail.send(user)");
    expect(found).toMatchObject({ name: "send", receiver: "mail", kind: "call" });
  });

  it("calls a capitalised name an instantiation", () => {
    expect(PYTHON.candidates("s = OrderService()")[0]).toMatchObject({
      name: "OrderService",
      kind: "instantiation",
    });
  });

  it("follows decorators", () => {
    expect(names("@requires_login")).toEqual(["requires_login"]);
    expect(PYTHON.candidates("@app.route('/x')")[0]).toMatchObject({
      name: "route",
      receiver: "app",
    });
  });

  it("leaves the language itself alone", () => {
    expect(names("    if isinstance(x, int) and len(y) > 0:")).toEqual([]);
  });

  it("reads an import as one reference to the module", () => {
    expect(PYTHON.candidates("from app.db import session")).toEqual([
      expect.objectContaining({ kind: "import", module: "app.db" }),
    ]);
  });
});

describe("where a module could live", () => {
  const facts = PYTHON.read("app/orders/service.py", "").facts;

  it("offers the file and the package", () => {
    expect(PYTHON.pathsFor("app.db", facts)).toEqual([
      "app/db.py",
      "app/db/__init__.py",
      "app/db.pyi",
    ]);
  });

  it("resolves a relative import against the importing file", () => {
    expect(PYTHON.pathsFor(".helpers", facts)[0]).toBe("app/orders/helpers.py");
    expect(PYTHON.pathsFor("..mail", facts)[0]).toBe("app/mail.py");
  });
});

describe("the index over several files", () => {
  it("groups declarations by name and files by module", () => {
    const index = fresh();
    indexFile(index, PYTHON, "app/db.py", "def save(x):\n    pass\n");
    indexFile(index, PYTHON, "app/cache.py", "def save(x):\n    pass\n");

    expect(index.byName.get("save")?.map((d) => d.scope)).toEqual([
      "app.db",
      "app.cache",
    ]);
    expect(index.byScope.get("app.db")).toEqual(["app/db.py"]);
  });
});
