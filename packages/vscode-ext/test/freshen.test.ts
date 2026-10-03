import { describe, expect, it } from "vitest";

import { fromRemote, toFetch } from "../src/freshen.js";

const REMOTES = ["origin", "upstream"];

describe("the branch a ref names on a remote", () => {
  it("reads a tracking ref", () => {
    expect(fromRemote("origin/topic", REMOTES)).toEqual({
      remote: "origin",
      branch: "topic",
    });
  });

  it("keeps the slashes inside a branch name", () => {
    // `origin/feat/since-last-review` is one remote and one branch. Split on
    // the first slash it becomes a request for a branch called `feat`.
    expect(fromRemote("origin/feat/since-last-review", REMOTES)).toEqual({
      remote: "origin",
      branch: "feat/since-last-review",
    });
  });

  it("reads one written out in full", () => {
    expect(fromRemote("refs/remotes/upstream/main", REMOTES)).toEqual({
      remote: "upstream",
      branch: "main",
    });
  });

  it("prefers the longest remote that matches", () => {
    // Unusual and legal. The shorter name would otherwise claim every ref
    // belonging to the longer one.
    expect(fromRemote("origin/mirror/topic", ["origin", "origin/mirror"])).toEqual({
      remote: "origin/mirror",
      branch: "topic",
    });
  });

  it("says nothing about a local branch", () => {
    expect(fromRemote("main", REMOTES)).toBeNull();
    expect(fromRemote("feature/thing", REMOTES)).toBeNull();
  });

  it("says nothing about a remote this repository has not got", () => {
    expect(fromRemote("fork/topic", REMOTES)).toBeNull();
  });

  it("says nothing about a commit", () => {
    // Already here or not; either way there is no branch to ask for, and
    // fetching a bare sha is a different and far slower request.
    expect(fromRemote("3f91a2c", REMOTES)).toBeNull();
    expect(fromRemote("a".repeat(40), REMOTES)).toBeNull();
  });

  it("says nothing about HEAD, or about nothing at all", () => {
    expect(fromRemote("HEAD", REMOTES)).toBeNull();
    expect(fromRemote(undefined, REMOTES)).toBeNull();
    expect(fromRemote("", REMOTES)).toBeNull();
  });

  it("says nothing when the repository has no remotes", () => {
    expect(fromRemote("origin/topic", [])).toBeNull();
  });
});

describe("what to bring up to date before building a reading again", () => {
  it("takes both ends of a reading of the forge's copy", () => {
    expect(toFetch({ baseRef: "origin/main", headRef: "origin/topic" }, REMOTES)).toEqual([
      { remote: "origin", branches: ["topic", "main"] },
    ]);
  });

  it("asks each remote once", () => {
    // A change on a fork, read against the upstream it is aimed at.
    expect(toFetch({ baseRef: "upstream/main", headRef: "origin/topic" }, REMOTES)).toEqual([
      { remote: "origin", branches: ["topic"] },
      { remote: "upstream", branches: ["main"] },
    ]);
  });

  it("does not ask for the same branch twice", () => {
    expect(toFetch({ baseRef: "origin/main", headRef: "origin/main" }, REMOTES)).toEqual([
      { remote: "origin", branches: ["main"] },
    ]);
  });

  it("still takes the base of a live reading, which has no head ref", () => {
    /*
     * A reading of the files on disk has no head on any remote — that is what
     * makes it live. Its base is still somebody else's branch, and a base from
     * before their work landed puts all of it inside this change.
     */
    expect(toFetch({ baseRef: "origin/main" }, REMOTES)).toEqual([
      { remote: "origin", branches: ["main"] },
    ]);
  });

  it("asks for nothing when both ends are this machine's own", () => {
    expect(toFetch({ baseRef: "main", headRef: "topic" }, REMOTES)).toEqual([]);
    expect(toFetch({}, REMOTES)).toEqual([]);
  });
});
