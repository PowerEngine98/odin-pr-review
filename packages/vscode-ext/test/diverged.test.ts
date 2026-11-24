import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DIVERGED, divergedText, divergenceOf, fixDivergence } from "../src/diverged.js";

Object.assign(process.env, { GIT_AUTHOR_NAME: "a", GIT_AUTHOR_EMAIL: "a@b", GIT_COMMITTER_NAME: "a", GIT_COMMITTER_EMAIL: "a@b" });

function sh(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "a", GIT_AUTHOR_EMAIL: "a@b", GIT_COMMITTER_NAME: "a", GIT_COMMITTER_EMAIL: "a@b" } }).trim();
}

function commit(cwd: string, file: string, text: string, message: string): void {
  writeFileSync(join(cwd, file), text);
  sh(cwd, "add", file);
  sh(cwd, "commit", "-q", "-m", message);
}

function rebasedOnGitHub(sameFiles: boolean) {
  const root = mkdtempSync(join(tmpdir(), "odin-diverged-"));
  const hub = join(root, "hub.git");
  const work = join(root, "work");
  const other = join(root, "other");
  sh(root, "init", "-q", "--bare", "-b", "main", hub);
  sh(root, "clone", "-q", hub, work);
  commit(work, "Order.kt", "class Order\n", "order");
  sh(work, "push", "-q", "origin", "main");
  sh(work, "switch", "-q", "-c", "totals");
  commit(work, "Total.kt", "fun total() = 1\n", "total");
  sh(work, "push", "-q", "-u", "origin", "totals");
  sh(root, "clone", "-q", hub, other);
  sh(other, "switch", "-q", "totals");
  if (sameFiles) {
    sh(other, "commit", "-q", "--amend", "-m", "total, reworded");
  } else {
    commit(other, "Receipt.kt", "class Receipt\n", "receipt");
    sh(other, "reset", "-q", "--soft", "HEAD~2");
    sh(other, "commit", "-q", "-m", "total and receipt");
  }
  sh(other, "push", "-q", "-f", "origin", "totals");
  if (!sameFiles) commit(work, "Tax.kt", "fun tax() = 2\n", "tax");
  return { work, hub };
}

describe("a branch that went separate ways from GitHub's", () => {
  it("is recognised from what the checkout said", () => {
    expect(DIVERGED.test("hint: Diverging branches can't be fast-forwarded\nfatal: Not possible to fast-forward, aborting.")).toBe(true);
  });

  it("rewritten on GitHub with the same files is told as such, and taking GitHub's keeps mine on a backup", async () => {
    const { work } = rebasedOnGitHub(true);
    const facts = await divergenceOf(work, "totals");
    expect(facts).toMatchObject({ branch: "totals", upstream: "origin/totals", ahead: 1, behind: 1, sameFiles: true });
    expect(divergedText(facts!)).toMatch(/rewritten on GitHub/);
    const mine = sh(work, "rev-parse", "totals");
    const backup = await fixDivergence(work, "totals", "theirs");
    expect(sh(work, "rev-parse", "totals")).toBe(sh(work, "rev-parse", "origin/totals"));
    expect(sh(work, "rev-parse", backup!)).toBe(mine);
  });

  it("with different work on each side can put mine on top of GitHub's", async () => {
    const { work } = rebasedOnGitHub(false);
    const facts = await divergenceOf(work, "totals");
    expect(facts).toMatchObject({ ahead: 2, behind: 1, sameFiles: false });
    expect(divergedText(facts!)).toMatch(/2 commits only here, 1 commit only on GitHub/);
    await fixDivergence(work, "totals", "rebase");
    expect(sh(work, "rev-list", "--count", "origin/totals..totals")).toBe("1");
    expect(sh(work, "rev-list", "--count", "totals..origin/totals")).toBe("0");
  });

  it("leaves everything as it was when the two cannot be put one after the other", async () => {
    const { work } = rebasedOnGitHub(false);
    commit(work, "Receipt.kt", "class Receipt(val total: Int)\n", "receipt, differently");
    const before = sh(work, "rev-parse", "totals");
    await expect(fixDivergence(work, "totals", "rebase")).rejects.toThrow(/Nothing was changed/);
    expect(sh(work, "rev-parse", "totals")).toBe(before);
    expect(sh(work, "status", "--porcelain")).toBe("");
  });

  it("can be gone live on as it is", async () => {
    const { work } = rebasedOnGitHub(false);
    sh(work, "switch", "-q", "main");
    const before = sh(work, "rev-parse", "totals");
    expect(await fixDivergence(work, "totals", "mine")).toBeUndefined();
    expect(sh(work, "branch", "--show-current")).toBe("totals");
    expect(sh(work, "rev-parse", "totals")).toBe(before);
  });
});

describe("the go-live dialog, when the branch went separate ways", () => {
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  const dialog = readFileSync(join(__dirname, "../../webview/src/app/tour/GoLiveDiscuss.svelte"), "utf8");
  const panel = readFileSync(join(__dirname, "../src/panel.ts"), "utf8");

  it("says what happened in plain words and offers the ways out as buttons", () => {
    expect(panel).toMatch(/if \(error instanceof Diverged\) \{\s*failed\(error\.message, error\.facts\);/);
    expect(dialog).toMatch(/onclick=\{\(\) => goLiveToDiscuss\("theirs"\)\}/);
    expect(dialog).toMatch(/onclick=\{\(\) => goLiveToDiscuss\("rebase"\)\}/);
    expect(dialog).toMatch(/onclick=\{\(\) => goLiveToDiscuss\("mine"\)\}/);
  });

  it("offers only GitHub's version when the files are the same, since nothing else differs", () => {
    expect(dialog).toMatch(/\{#if !tourPanel\.diverged\.sameFiles\}[\s\S]*goLiveToDiscuss\("mine"\)[\s\S]*goLiveToDiscuss\("rebase"\)[\s\S]*\{\/if\}\s*<button class="go-live-do"[\s\S]*?goLiveToDiscuss\("theirs"\)/);
  });
});
