import { describe, expect, it } from "vitest";

import { ghInstaller, ghManagers } from "../src/git/ghSetup.js";

describe("installing the GitHub CLI", () => {
  it("uses the package manager the machine already has", () => {
    expect(ghInstaller("darwin", (one) => one === "brew")?.install).toBe("brew install gh");
    expect(ghInstaller("win32", (one) => one === "winget")?.install).toBe("winget install --id GitHub.cli -e");
    expect(ghInstaller("darwin", (one) => one === "brew")?.upgrade).toBe("brew update && brew upgrade gh");
  });

  it("installs from GitHub's own packages on Linux, never a distribution's older copy", () => {
    expect(ghInstaller("linux", (one) => one === "apt")?.install).toContain("https://cli.github.com/packages stable main");
    expect(ghInstaller("linux", (one) => one === "dnf")?.install).toContain("--repo gh-cli");
    expect(ghManagers("linux")).not.toContain("snap");
    expect(ghManagers("darwin")).not.toContain("port");
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
