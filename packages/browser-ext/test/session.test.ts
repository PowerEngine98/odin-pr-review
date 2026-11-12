import { afterEach, describe, expect, it, vi } from "vitest";

import { openSession } from "../src/session.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a session with VS Code", () => {
  it("hands over the diagram renderer VS Code sends, ahead of the page", async () => {
    const lines = [
      { type: "session", id: "s1" },
      { type: "renderer", source: "globalThis.mermaid = {};" },
      { type: "html", html: "<p>page</p>" },
    ].map((one) => `${JSON.stringify(one)}\n`);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              for (const line of lines) controller.enqueue(new TextEncoder().encode(line));
              controller.close();
            },
          }),
        ),
      ),
    );
    const order: string[] = [];
    await new Promise<void>((done) => {
      void openSession(1, "t", { owner: "o", repo: "r", number: 1, base: "main", head: "feat" }, {
        note: () => {},
        graph: () => {},
        html: () => order.push("html"),
        message: () => {},
        renderer: (source) => order.push(`renderer:${source}`),
        ended: () => done(),
      });
    });
    expect(order).toEqual(["renderer:globalThis.mermaid = {};", "html"]);
  });
});

describe("the sandbox and the page", () => {
  it("runs the renderer before writing the page, and the page uses one already there", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const sandbox = readFileSync(join(__dirname, "../src/sandbox.ts"), "utf8");
    expect(sandbox).toMatch(/\(0, eval\)\(event\.data\.renderer\)[\s\S]*document\.write\(event\.data\.odinPage\)/);
    const diagram = readFileSync(join(__dirname, "../../webview/src/app/panels/Diagram.svelte"), "utf8");
    expect(diagram).toMatch(/if \(preloaded\(\)\) \{\s*ready\(\);/);
    const bridge = readFileSync(join(__dirname, "../../vscode-ext/src/bridge.ts"), "utf8");
    expect(bridge).toMatch(/sink\.send\(\{ type: "renderer", source: renderer \}\);[\s\S]{0,300}let detach = current\.attach\(mirror\);/);
  });
});
