import { describe, expect, it } from "vitest";

import { parseArgs, parseComment } from "../src/args.js";
import { pagePath } from "../src/view.js";

import type { ChangeGraph } from "@odin/core";

describe("choosing a command", () => {
  it("still defaults to building a graph", () => {
    const opts = parseArgs(["--format", "json"]);
    expect(opts.kind).toBe("graph");
  });

  it("gives view the settings that make it worth looking at", () => {
    // A page with no arrows is the thing this tool exists not to be, so view
    // resolves references without being asked.
    const opts = parseArgs(["view"]);
    expect(opts).toMatchObject({
      kind: "graph",
      view: true,
      format: "html",
      resolve: true,
      pullRequest: true,
    });
  });

  it("lets view be told otherwise", () => {
    expect(parseArgs(["view", "--no-pr"])).toMatchObject({ pullRequest: false });
  });

  it("takes a port for --serve, or picks one", () => {
    expect(parseArgs(["view", "--serve"])).toMatchObject({ serve: 0 });
    expect(parseArgs(["view", "--serve", "8080"])).toMatchObject({ serve: 8080 });
    // A following flag is not a port.
    expect(parseArgs(["view", "--serve", "--tests"])).toMatchObject({
      serve: 0,
      tests: true,
    });
  });

  it("rejects a command it does not have", () => {
    expect(parseArgs(["merge"])).toMatchObject({ kind: "error" });
  });
});

describe("the review commands", () => {
  it("reads the verdict off the command name", () => {
    expect(parseArgs(["approve"])).toMatchObject({ kind: "review", event: "APPROVE" });
    expect(parseArgs(["request-changes", "--body", "no"])).toMatchObject({
      event: "REQUEST_CHANGES",
    });
  });

  it("insists on a summary for everything but an approval", () => {
    // The forge insists too, and finding out after the round trip costs the
    // caller a confusing error for a knowable mistake.
    expect(parseArgs(["review", "--event", "comment"])).toMatchObject({ kind: "error" });
    expect(parseArgs(["request-changes"])).toMatchObject({ kind: "error" });
    expect(parseArgs(["approve"])).toMatchObject({ kind: "review" });
  });

  it("needs to be told the verdict when it is not in the name", () => {
    expect(parseArgs(["review", "--body", "hm"])).toMatchObject({ kind: "error" });
  });

  it("collects comments in the order they were given", () => {
    const opts = parseArgs([
      "review", "--event", "comment", "--body", "b",
      "--comment", "a.ts:3:first",
      "--comment", "b.ts:9-12:second",
    ]);
    expect(opts).toMatchObject({
      comments: [
        { path: "a.ts", line: 3, body: "first" },
        { path: "b.ts", line: 12, startLine: 9, body: "second" },
      ],
    });
  });
});

describe("the comment shorthand", () => {
  it("keeps colons that belong to the message", () => {
    // Prose is full of them; a path is not, which is the assumption that makes
    // the shorthand safe.
    expect(parseComment("src/a.ts:12:note: this reads twice")).toEqual({
      path: "src/a.ts",
      line: 12,
      body: "note: this reads twice",
    });
  });

  it("reads a span as start and end", () => {
    expect(parseComment("a.ts:9-12:fold these")).toEqual({
      path: "a.ts",
      line: 12,
      startLine: 9,
      body: "fold these",
    });
  });

  it("treats a span of one line as one line", () => {
    expect(parseComment("a.ts:9-9:here")).toEqual({
      path: "a.ts",
      line: 9,
      body: "here",
    });
  });

  it("refuses a range written backwards", () => {
    expect(parseComment("a.ts:12-9:what")).toContain("ends before it starts");
  });

  it("refuses a comment with nothing in it", () => {
    expect(parseComment("a.ts:12:")).toContain("no message");
    expect(parseComment("a.ts")).toContain("expects path:line:message");
  });
});

describe("where a rendered review is kept", () => {
  const graph = (base: string, head: string) =>
    ({ meta: { baseRef: base, headRef: head } } as ChangeGraph);

  it("names the file after the review, so it reopens at the same address", () => {
    const once = pagePath(graph("main", "feature/x"), "/tmp/some-repo");
    const twice = pagePath(graph("main", "feature/x"), "/tmp/some-repo");
    expect(once).toBe(twice);
    expect(once).toMatch(/some-repo--main--feature-x\.html$/);
  });

  it("keeps two reviews of the same repository apart", () => {
    expect(pagePath(graph("main", "a"), "/tmp/r")).not.toBe(
      pagePath(graph("main", "b"), "/tmp/r"),
    );
  });

  it("does not let a ref name escape into the path", () => {
    const path = pagePath(graph("../../etc", "x"), "/tmp/r");
    expect(path).not.toContain("..");
  });
});
