import { describe, expect, it } from "vitest";

import { parseChecks, readChecks } from "../src/git/checks.js";

function job(overrides: Record<string, unknown> = {}): unknown {
  return {
    __typename: "CheckRun",
    name: "Checks",
    workflowName: "Backend Build",
    status: "COMPLETED",
    conclusion: "SUCCESS",
    detailsUrl: "https://forge.test/runs/1",
    ...overrides,
  };
}

describe("reading what the forge made of the branch", () => {
  it("keeps the job, its workflow and where to go and look", () => {
    const { checks } = parseChecks([job()]);
    expect(checks[0]).toEqual({
      name: "Checks",
      workflow: "Backend Build",
      state: "passed",
      url: "https://forge.test/runs/1",
    });
  });

  it("counts anything still going as something to wait for", () => {
    const summary = parseChecks([
      job({ status: "IN_PROGRESS", conclusion: null }),
      job({ status: "QUEUED", conclusion: null }),
      job(),
    ]);
    expect(summary.running).toBe(2);
    expect(summary.done).toBe(1);
    expect(summary.total).toBe(3);
  });

  it("treats cancelled and skipped alike, because nobody is waiting on either", () => {
    const summary = parseChecks([
      job({ conclusion: "SKIPPED" }),
      job({ conclusion: "CANCELLED" }),
      job({ conclusion: "NEUTRAL" }),
    ]);
    expect(summary.skipped).toBe(3);
    expect(summary.failed).toBe(0);
    // Nothing is running, so nothing is outstanding.
    expect(summary.done).toBe(summary.total);
  });

  it("calls every way of stopping badly a failure", () => {
    const summary = parseChecks([
      job({ conclusion: "FAILURE" }),
      job({ conclusion: "TIMED_OUT" }),
      job({ conclusion: "STARTUP_FAILURE" }),
      job({ conclusion: "ACTION_REQUIRED" }),
    ]);
    expect(summary.failed).toBe(4);
  });

  it("reads the older kind of status, which says it all in one field", () => {
    const { checks } = parseChecks([
      {
        __typename: "StatusContext",
        context: "ci/legacy",
        state: "FAILURE",
        targetUrl: "https://forge.test/legacy",
      },
    ]);
    expect(checks[0]).toEqual({
      name: "ci/legacy",
      state: "failed",
      url: "https://forge.test/legacy",
    });
  });

  it("skips an entry with no name rather than showing a blank row", () => {
    expect(parseChecks([job({ name: null }), {}, job()]).total).toBe(1);
  });

  it("says a branch with no checks has none, not that it has none run", () => {
    const summary = parseChecks([]);
    expect(summary.total).toBe(0);
    expect(summary.done).toBe(0);
  });
});

describe("when the forge cannot be asked", () => {
  it("hands back nothing rather than failing", async () => {
    // A review of the diff is useful without knowing what CI thinks.
    expect(await readChecks("no-such-branch", { cwd: "/", timeoutMs: 2000 }))
      .toBeUndefined();
  });
});
