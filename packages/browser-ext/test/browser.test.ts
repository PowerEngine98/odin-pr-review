import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { PullJson } from "../src/github.js";
import { graphOf, pageOf } from "../src/page.js";
import { ago, changeModel, pickerOf, sidebarPage } from "../src/picker.js";
import { sha1Hex } from "../src/shims/sha1.js";
import { relayedStorage } from "../src/storage.js";

const DIFF = [
  "diff --git a/src/order.ts b/src/order.ts",
  "index 1111111..2222222 100644",
  "--- a/src/order.ts",
  "+++ b/src/order.ts",
  "@@ -1,3 +1,3 @@",
  " export class Order {",
  "-  total() { return 0; }",
  "+  total(total: number) { return total; }",
  " }",
  "",
].join("\n");

const PULL: PullJson = {
  number: 42,
  title: "Orders know their total",
  html_url: "https://github.com/acme/shop/pull/42",
  state: "open",
  draft: false,
  base: { ref: "main", sha: "b".repeat(40) },
  head: { ref: "feature/total", sha: "h".repeat(40) },
  user: { login: "ada", avatar_url: "https://avatars.example/ada" },
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
  requested_reviewers: [{ login: "grace" }],
};

describe("the browser's sha1", () => {
  it("matches Node's, so node ids are the ones the editor gives the same file", () => {
    for (const text of ["", "src/order.ts", "ünïcödé/𝔣𝔦𝔩𝔢.ts", "x".repeat(1000)]) {
      expect(sha1Hex(text)).toBe(createHash("sha1").update(text, "utf8").digest("hex"));
    }
  });
});

describe("a pull request read from GitHub", () => {
  it("becomes a graph that knows which pull request it is", () => {
    const graph = graphOf(PULL, DIFF);
    expect(graph.nodes.map((n) => n.path)).toEqual(["src/order.ts"]);
    expect(graph.meta.pullRequest).toMatchObject({ number: 42, state: "OPEN", url: PULL.html_url });
    expect(graph.meta.headSha).toBe(PULL.head.sha);
  });

  it("becomes Odin's page", async () => {
    const html = await pageOf(PULL, graphOf(PULL, DIFF), { dark: true });
    expect(html).toContain("<title>#42 Orders know their total · Odin</title>");
    expect(html).toContain("window.__ODIN__");
  });

  it("carries the settings it cannot offer, and the way to unlock them", async () => {
    const html = await pageOf(PULL, graphOf(PULL, DIFF), {
      dark: true,
      locked: { imports: "Needs Enable all features" },
      unlock: true,
    });
    expect(html).toContain('"locked":{"imports":"Needs Enable all features"}');
    expect(html).toContain('"unlock":true');
  });
});

describe("the pull requests to choose from", () => {
  it("puts what is waiting on the reader first, like the editor's sidebar", () => {
    const other = { ...PULL, number: 43, requested_reviewers: [] };
    const picker = pickerOf([PULL, other], "grace", { state: "open", author: "" });
    expect(picker.mine.map((p) => p.pr.number)).toEqual([42]);
    expect(picker.everythingElse.map((p) => p.pr.number)).toEqual([43]);
    expect(picker.browser).toBe(true);
    expect(picker.mine[0]!.pr).toMatchObject({ author: "ada", branch: "feature/total", state: "open" });
  });

  it("is drawn by the sidebar itself", () => {
    const html = sidebarPage({ loading: false, picker: pickerOf([PULL], "", { state: "open", author: "" }) }, true);
    expect(html).toContain("Orders know their total");
    expect(html).toContain("--vscode-sideBar-background");
    const markup = html.slice(0, html.indexOf("<script>"));
    expect(markup).toContain("Orders know their total");
    expect(markup).not.toContain("Review This Branch");
  });

  it("lists the change's files the way the editor does, with no checkout to offer", () => {
    const graph = graphOf(PULL, DIFF);
    const model = changeModel(graph, new Set(["src/order.ts"]), pickerOf([], "", { state: "open", author: "" }));
    expect(model.change?.reading).toMatchObject({ number: 42, branch: "feature/total", browser: true });
    const html = sidebarPage(model, false);
    const markup = html.slice(0, html.indexOf("<script>"));
    expect(markup).toContain("order.ts");
    expect(markup).not.toContain("Check out and Enable changes to: feature/total");
  });

  it("says when in the coarsest unit that still says something", () => {
    const now = Date.parse("2026-03-01T00:00:00Z");
    expect(ago("2026-02-28T23:30:00Z", now)).toBe("30m ago");
    expect(ago("2026-02-27T00:00:00Z", now)).toBe("2d ago");
    expect(ago("not a date", now)).toBe("");
  });
});

describe("storage relayed out of the sandbox", () => {
  it("answers from what was saved and reports every change", () => {
    const changes: [string, string | null][] = [];
    const storage = relayedStorage({ seen: "1" }, (key, value) => changes.push([key, value]));
    expect(storage.getItem("seen")).toBe("1");
    storage.setItem("zoom", "2");
    storage.removeItem("seen");
    expect(storage.length).toBe(1);
    expect(storage.key(0)).toBe("zoom");
    expect(changes).toEqual([["zoom", "2"], ["seen", null]]);
  });
});
