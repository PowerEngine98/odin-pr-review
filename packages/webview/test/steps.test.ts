import { describe, expect, it } from "vitest";

import { kindOf, stepOf, tidy } from "../src/app/hud/steps.js";

/**
 * Telling one act in a log from another.
 *
 * A page of a turn is forty lines in one colour, and the three questions
 * somebody watching actually has — is it still reading, has it started writing,
 * is it running something — were answerable only by reading every line of it.
 */
describe("reading a line back as the act it was", () => {
  it("finds the tool and what it was handed", () => {
    const act = stepOf("→ Read(…/media/VideoPreview.tsx)");
    expect(act).toMatchObject({ tool: "Read", kind: "read" });
    expect(act?.rest).toBe("(…/media/VideoPreview.tsx)");
  });

  it("keeps what a tool found, where the tool put it", () => {
    // opencode writes the result on the same line, and it is half of what a
    // search is worth reading for.
    const act = stepOf("→ Grep(mediaCategoryOf) · 0 matches");
    expect(act?.kind).toBe("read");
    expect(act?.rest).toBe("(mediaCategoryOf) · 0 matches");
  });

  it("takes a tool call with nothing in its hands", () => {
    expect(stepOf("→ Task")).toMatchObject({ tool: "Task", kind: "other" });
  });

  it("says nothing about a line that is not an act", () => {
    /*
     * Most of a log is not: it is the agent's reasoning, its prose, a warning,
     * a blank. Every one of those is left exactly as it is.
     */
    expect(stepOf("… I've confirmed MediaCategory is the existing type")).toBeNull();
    expect(stepOf("All backend edits are done.")).toBeNull();
    expect(stepOf("")).toBeNull();
    // A sentence that happens to begin with a capitalised word is prose.
    expect(stepOf("Read the file before changing it.")).toBeNull();
  });
});

describe("which acts are which", () => {
  it("puts looking apart from writing apart from running", () => {
    expect(kindOf("Read")).toBe("read");
    expect(kindOf("Grep")).toBe("read");
    expect(kindOf("Write")).toBe("write");
    expect(kindOf("Edit")).toBe("write");
    expect(kindOf("MultiEdit")).toBe("write");
    expect(kindOf("Bash")).toBe("run");
  });

  it("draws a tool nobody here has heard of plainly", () => {
    /*
     * Rather than guessing from the name. A tool called `Setup` drawn as a
     * write because its name starts with "set" would be a log that lies about
     * what an agent did to somebody's branch, which is worse than a log that
     * declines to say.
     */
    expect(kindOf("Sourcegraph")).toBe("other");
    expect(kindOf("Setup")).toBe("other");
  });
});

describe("saying a path the way a person would", () => {
  it("cuts a checkout path down to the file and its folder", () => {
    /*
     * The line as it actually reads in a worktree. The prefix is the same on
     * every line of the turn, and the old truncation ran from the front — so
     * what was cut was the filename, which is the only part anybody reads these
     * for.
     */
    expect(
      tidy(
        "(/Users/somebody/workspace/thinginc/thinglabs/thing/.claude/worktrees/agent-a45/backend/MediaType.kt)",
      ),
    ).toBe("(…/backend/MediaType.kt)");
  });

  it("leaves a path written relative to the project", () => {
    /*
     * It is already saying what a reader needs — where in the project the file
     * is — and cutting it would throw that away for nothing. The unreadable
     * ones are unreadable because they begin at somebody's home directory.
     */
    expect(tidy("(src/one.ts)")).toBe("(src/one.ts)");
    expect(tidy("(src/app/hud/steps.ts)")).toBe("(src/app/hud/steps.ts)");
    expect(tidy("(frontend/common/src/pages/app/LaborMediaIntro.tsx)")).toBe(
      "(frontend/common/src/pages/app/LaborMediaIntro.tsx)",
    );
  });

  it("leaves a URL alone", () => {
    // Cutting the host off the front of one leaves something that names
    // nothing at all.
    expect(tidy('(curl -s http://localhost:8080/api/media/list)')).toContain(
      "http://localhost:8080/api/media/list",
    );
  });

  it("tidies a command without taking the command apart", () => {
    const said = tidy("(JAVA_HOME=~/.sdkman/candidates/java/21.0.2-open ./gradlew boot)");
    expect(said).toContain("./gradlew boot");
    expect(said).toContain("…/java/21.0.2-open");
  });

  it("fixes the lines already written down", () => {
    /*
     * Which is the whole reason this happens as the line is drawn rather than
     * only as it is written. A log is kept: what an agent printed this
     * afternoon comes back after a reload, and a change to how lines are
     * written leaves every earlier line exactly as unreadable as it was.
     */
    const old = "(/Users/somebody/workspace/thinginc/thinglabs/thing/.claude/worktrees/agent-…)";
    expect(tidy(old)).toBe("(…/worktrees/agent-…)");
  });
});
