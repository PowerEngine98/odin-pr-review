import { readFileSync } from "node:fs";
import { layoutGraph, type ChangeGraph } from "@odin/core";
import { describe, expect, it } from "vitest";

import { renderHtml } from "../src/html.js";

const main = readFileSync(new URL("../src/app/main.ts", import.meta.url), "utf8");

describe("a frame that comes back after a reload", () => {
  it("knows its reading before the page starts, so a page that fails still says what it held", () => {
    const keeps = main.indexOf("keep({ reading: window.__ODIN__.reading })");
    const starts = main.indexOf("hydrate(App");
    expect(keeps).toBeGreaterThan(-1);
    expect(starts).toBeGreaterThan(keeps);
  });

  it("carries the reading in the page it is drawn with", () => {
    const graph: ChangeGraph = {
      schemaVersion: "0.1.0",
      meta: { baseRef: "main", headRef: "feature", generator: "test" },
      nodes: [],
      edges: [],
    } as unknown as ChangeGraph;
    const html = renderHtml(graph, layoutGraph(graph), { reading: { repo: "/code/shop", number: 7 } });
    expect(html).toContain('"reading":{"repo":"/code/shop","number":7}');
  });
});
