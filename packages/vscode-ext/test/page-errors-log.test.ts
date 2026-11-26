import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => ({}));

describe("the page's error log", () => {
  it("leaves out the browser's resize warning, which a live reading raises several times a second", async () => {
    const { harmlessPageError } = await import("../src/panel.js");
    expect(harmlessPageError("ResizeObserver loop completed with undelivered notifications.")).toBe(true);
    expect(harmlessPageError("TypeError: x is undefined")).toBe(false);
  });

  it("keeps only its latest part once it grows past its limit", async () => {
    const { keepPageError, PAGE_ERRORS_MOST, PAGE_ERRORS_KEPT } = await import("../src/panel.js");
    const file = join(mkdtempSync(join(tmpdir(), "odin-errors-")), "page-errors.log");
    writeFileSync(file, "x".repeat(PAGE_ERRORS_MOST + 10));
    await keepPageError(file, "latest");
    expect(statSync(file).size).toBe(PAGE_ERRORS_KEPT + "latest\n\n".length);
    expect(readFileSync(file, "utf8").endsWith("latest\n\n")).toBe(true);
  });
});
