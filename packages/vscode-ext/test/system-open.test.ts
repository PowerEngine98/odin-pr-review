import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { systemOpener } from "../src/system-open.js";

describe("opening a file from its card", () => {
  it("hands it to whatever the system opens that kind of file with", () => {
    expect(systemOpener("darwin", "/work/Order.kt")).toEqual({ command: "open", args: ["/work/Order.kt"] });
    expect(systemOpener("win32", "C:\\work\\Order.kt")).toEqual({ command: "cmd", args: ["/c", "start", "", "C:\\work\\Order.kt"] });
    expect(systemOpener("linux", "/work/Order.kt")).toEqual({ command: "xdg-open", args: ["/work/Order.kt"] });
  });

  it("does so only for a live reading, where the file on disk is the one being read, and falls back to the diff otherwise", () => {
    const panel = readFileSync(join(__dirname, "../src/panel.ts"), "utf8");
    const card = readFileSync(join(__dirname, "../../webview/src/app/canvas/Card.svelte"), "utf8");
    expect(card).toMatch(/notify\("open", \{ path: node\.path, system: true \}\);/);
    expect(panel).toMatch(/if \(message\.payload\.system === true && \(await this\.openOnDisk\(message\.payload\.path\)\)\) return;\s*await this\.openDiff\(message\.payload\.path\);/);
    expect(panel).toMatch(/if \(this\.graph\.meta\.worktree !== true \|\| !path\) return false;/);
    expect(panel).toMatch(/if \(!file\.startsWith\(join\(this\.repo, "\/"\)\) \|\| !existsSync\(file\)\) return false;/);
  });
});
