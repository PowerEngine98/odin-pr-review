import { describe, expect, it } from "vitest";

import type { FileNode } from "@odin/core";

import { buildTree } from "../src/tree-model.js";

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
