import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// @ts-expect-error a plain script, without types
import { changelogOf, fromSubject, isWritten, notesOf, pullOf, withEntry } from "../../../scripts/release-notes.mjs";

const TEMPLATE = readFileSync(new URL("../../../.github/pull_request_template.md", import.meta.url), "utf8");

const filled = (sections: Record<string, string[]>) =>
  `## What changed\n\nStuff.\n\n## Changelog\n\n${Object.entries(sections)
    .map(([name, list]) => `### ${name}\n\n${list.map((one) => `- ${one}`).join("\n")}`)
    .join("\n\n")}\n\n## Tests\n\n- not a changelog bullet\n`;

describe("the changelog a pull request carries", () => {
  it("is not written while the template is left as it came", () => {
    expect(isWritten(TEMPLATE)).toBe(false);
    expect(isWritten("")).toBe(false);
    expect(isWritten("## Changelog\n\n### Bug fixes\n\n- None\n")).toBe(false);
  });

  it("is read section by section, and stops at the next part of the description", () => {
    const found = changelogOf(filled({ "New features": ["Tours can be exported"], "Bug fixes": ["Orders total again"] }));
    expect(found.get("New features")).toEqual(["Tours can be exported"]);
    expect(found.get("Bug fixes")).toEqual(["Orders total again"]);
    expect([...found.values()].flat()).not.toContain("not a changelog bullet");
  });

  it("knows the groups by their usual spellings", () => {
    const found = changelogOf("## Changelog\n### UI / UX\n- Wider modal\n### QoL improvements\n- Faster open\n### Fixes\n- No crash");
    expect(found.get("UI/UX")).toEqual(["Wider modal"]);
    expect(found.get("Quality of life")).toEqual(["Faster open"]);
    expect(found.get("Bug fixes")).toEqual(["No crash"]);
  });
});

describe("the notes a release publishes", () => {
  it("finds the pull request behind a squash or a merge", () => {
    expect(pullOf("fix(layout): leaves sit beside targets (#9)")).toBe(9);
    expect(pullOf("Merge pull request #12 from someone/branch")).toBe(12);
    expect(pullOf("fix: direct push")).toBeUndefined();
  });

  it("reads a commit without a pull request from its prefix, and leaves housekeeping out", () => {
    expect(fromSubject("feat(tour): diagrams in frames")).toEqual({ section: "New features", text: "Diagrams in frames" });
    expect(fromSubject("fix: totals round once")).toEqual({ section: "Bug fixes", text: "Totals round once" });
    expect(fromSubject("chore(release): v1.2.3 [skip ci]")).toBeUndefined();
    expect(fromSubject("docs: readme")).toBeUndefined();
  });

  it("gathers every pull request's changelog and the loose commits into one list per group", () => {
    const bodies = new Map([[9, filled({ "Bug fixes": ["Migrations sit beside their schema"] })]]);
    const notes = notesOf(
      ["fix(layout): leaves sit beside targets (#9)", "feat: a setup wizard", "chore: tidy", "fix(layout): follow-up (#9)"],
      bodies,
    );
    expect(notes).toBe("### New features\n\n- A setup wizard\n\n### Bug fixes\n\n- Migrations sit beside their schema");
  });

  it("still says something when nothing user-facing changed", () => {
    expect(notesOf(["chore: tidy"], new Map())).toBe("- Maintenance release.");
  });

  it("puts the new version on top of the changelog", () => {
    const next = withEntry("# Changelog\n\n## 1.0.0 — 2026-01-01\n\n- Old\n", "1.1.0", "2026-02-02", "### Bug fixes\n\n- New");
    expect(next).toBe("# Changelog\n\n## 1.1.0 — 2026-02-02\n\n### Bug fixes\n\n- New\n\n## 1.0.0 — 2026-01-01\n\n- Old\n");
  });
});
