import { describe, expect, it } from "vitest";

import { ghInstaller, ghManagers } from "../src/git/ghSetup.js";

describe("installing the GitHub CLI", () => {
  it("uses the package manager the machine already has", () => {
    expect(ghInstaller("darwin", (one) => one === "brew")?.command).toBe("brew install gh");
    expect(ghInstaller("win32", (one) => one === "winget")?.command).toBe("winget install --id GitHub.cli -e");
    expect(ghInstaller("linux", (one) => one === "dnf")?.command).toBe("sudo dnf install -y gh");
  });

  it("prefers the first known manager when several are there", () => {
    expect(ghInstaller("linux", () => true)?.manager).toBe("brew");
  });

  it("offers nothing to run when no manager is found, so the page offers the download", () => {
    expect(ghInstaller("darwin", () => false)).toBeUndefined();
    expect(ghInstaller("plan9", () => true)).toBeUndefined();
    expect(ghManagers("plan9")).toEqual([]);
  });
});
