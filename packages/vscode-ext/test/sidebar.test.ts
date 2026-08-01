import { describe, expect, it } from "vitest";

import type { FileNode } from "@odin/core";

import type { ChangeGraph } from "@odin/core";

import { buildTree, progressOf } from "../src/tree-model.js";

function file(path: string): FileNode {
  return {
    id: `n:${path}`,
    path,
    status: "modified",
    language: "kotlin",
    binary: false,
    stats: { additions: 1, deletions: 0 },
    hunks: [],
    symbols: [],
  };
}

/** Folder labels in reading order, with their nesting depth. */
function outline(folder: ReturnType<typeof buildTree>, depth = 0): string[] {
  const out: string[] = [];
  for (const child of folder.folders) {
    out.push(`${"  ".repeat(depth)}${child.label}`);
    out.push(...outline(child, depth + 1));
  }
  for (const f of folder.files) {
    out.push(`${"  ".repeat(depth)}· ${f.path.split("/").pop()}`);
  }
  return out;
}

describe("grouping the change by directory", () => {
  it("joins a chain of directories that hold nothing else", () => {
    // A Java-shaped tree is mostly single-child directories. Six nested rows
    // to reach one file spends the sidebar's width on indentation.
    const tree = buildTree([
      file("backend/src/main/kotlin/com/labura/notifications/dao/NotificationDao.kt"),
    ]);
    expect(outline(tree)).toEqual([
      "backend/src/main/kotlin/com/labura/notifications/dao",
      "  · NotificationDao.kt",
    ]);
  });

  it("stops joining where the tree actually branches", () => {
    const tree = buildTree([
      file("backend/src/main/kotlin/com/labura/notifications/Model.kt"),
      file("backend/src/main/kotlin/com/labura/messaging/Kafka.kt"),
    ]);
    expect(outline(tree)).toEqual([
      "backend/src/main/kotlin/com/labura",
      "  messaging",
      "    · Kafka.kt",
      "  notifications",
      "    · Model.kt",
    ]);
  });

  it("keeps a directory that holds both files and folders", () => {
    const tree = buildTree([
      file("src/App.kt"),
      file("src/dao/Repo.kt"),
    ]);
    expect(outline(tree)).toEqual(["src", "  dao", "    · Repo.kt", "  · App.kt"]);
  });

  it("puts a file at the repository root at the top level", () => {
    const tree = buildTree([file("build.gradle.kts")]);
    expect(outline(tree)).toEqual(["· build.gradle.kts"]);
  });

  it("preserves the order the graph supplied", () => {
    const tree = buildTree([file("src/b.kt"), file("src/a.kt")]);
    expect(outline(tree)).toEqual(["src", "  · b.kt", "  · a.kt"]);
  });
});

function graphOf(nodes: FileNode[], authors?: { name: string; commits: number }[]): ChangeGraph {
  return {
    schemaVersion: "0.1.0",
    meta: {
      baseRef: "main",
      headRef: "feature",
      generator: "test",
      ...(authors ? { authors } : {}),
    },
    nodes,
    edges: [],
  };
}

function withStatus(path: string, status: FileNode["status"], adds = 1, dels = 0): FileNode {
  return { ...file(path), status, stats: { additions: adds, deletions: dels } };
}

describe("progress through a change", () => {
  it("counts only files that can be marked off", () => {
    // An untouched file has no box, so counting it would leave the bar short
    // of full however much was read, and finishing would look impossible.
    const graph = graphOf([
      withStatus("src/a.ts", "modified"),
      withStatus("src/b.ts", "added"),
      withStatus("src/untouched.ts", "phantom", 0, 0),
    ]);
    const p = progressOf(graph, (path) => path === "src/a.ts");
    expect(p.total).toBe(2);
    expect(p.done).toBe(1);
    expect(p.percent).toBe(50);
  });

  it("reports nothing as zero rather than dividing by it", () => {
    expect(progressOf(graphOf([]), () => false).percent).toBe(0);
  });

  it("reaches a hundred when everything is read", () => {
    const graph = graphOf([withStatus("a.ts", "modified"), withStatus("b.ts", "added")]);
    expect(progressOf(graph, () => true).percent).toBe(100);
  });

  it("totals the lines the change touched", () => {
    const graph = graphOf([
      withStatus("a.ts", "modified", 10, 3),
      withStatus("b.ts", "added", 5, 0),
      withStatus("c.ts", "phantom", 99, 99),
    ]);
    const p = progressOf(graph, () => false);
    expect(p.additions).toBe(15);
    expect(p.deletions).toBe(3);
  });

  it("names one or two authors, and counts the rest", () => {
    const one = graphOf([], [{ name: "Ada", commits: 3 }]);
    expect(progressOf(one, () => false).authors).toBe("Ada");

    const two = graphOf([], [
      { name: "Ada", commits: 3 },
      { name: "Grace", commits: 1 },
    ]);
    expect(progressOf(two, () => false).authors).toBe("Ada, Grace");

    const many = graphOf([], [
      { name: "Ada", commits: 5 },
      { name: "Grace", commits: 2 },
      { name: "Alan", commits: 1 },
    ]);
    expect(progressOf(many, () => false).authors).toBe("Ada +2");
    expect(progressOf(many, () => false).authorsFull).toBe(
      "Ada (5), Grace (2), Alan (1)",
    );
  });
});
