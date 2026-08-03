import type { GitOptions } from "./exec.js";
import { run } from "./pullRequest.js";

/** One check the forge ran against the head of the change. */
export interface Check {
  /** What the forge calls the job. */
  name: string;
  /** The workflow it belongs to, when it belongs to one. */
  workflow?: string;
  /**
   * What became of it, in the four states worth telling apart while reviewing:
   * it passed, it failed, it is still running, or it never ran.
   */
  state: "passed" | "failed" | "running" | "skipped";
  /** The forge's page for this run, so the reader can go and look. */
  url?: string;
  /** How long it ran for, in milliseconds, when the forge said. */
  elapsedMs?: number;
}

/** How the checks stand as a whole. */
export interface CheckSummary {
  checks: Check[];
  passed: number;
  failed: number;
  running: number;
  skipped: number;
  /** Checks that reached a verdict, over checks that exist. */
  done: number;
  total: number;
}

/**
 * What the forge made of the head of this branch.
 *
 * Read through `pr view` rather than `pr checks`, which exits non-zero when a
 * check has failed — the one moment the answer matters most, and the moment a
 * best-effort runner would throw it away.
 *
 * Best-effort like everything else that talks to the forge: no `gh`, no
 * network, no pull request, and the caller gets nothing rather than an error.
 */
export async function readChecks(
  branch: string,
  options: GitOptions & { timeoutMs?: number },
): Promise<CheckSummary | undefined> {
  const json = await run(
    ["pr", "view", branch, "--json", "statusCheckRollup"],
    options,
  );
  if (!json) return undefined;

  try {
    const parsed = JSON.parse(json) as { statusCheckRollup?: unknown[] };
    if (!Array.isArray(parsed.statusCheckRollup)) return undefined;
    return parseChecks(parsed.statusCheckRollup);
  } catch {
    return undefined;
  }
}

/**
 * The rollup as the forge returns it, read into checks and counted.
 *
 * Separate from the command that fetches it so the shapes can be exercised
 * without a repository, a network or a login.
 */
export function parseChecks(rollup: readonly unknown[]): CheckSummary {
  return summarise(rollup.map(readOne).filter(isCheck));
}

function isCheck(check: Check | undefined): check is Check {
  return check !== undefined;
}

/**
 * One entry of the rollup, which holds two different shapes.
 *
 * A CheckRun is a job in a workflow and says how it went in two fields — the
 * status while it runs, the conclusion once it stops. A StatusContext is the
 * older kind, posted by anything with a token, and says it in one.
 */
function readOne(entry: unknown): Check | undefined {
  const value = entry as Record<string, unknown>;

  if (value["__typename"] === "StatusContext") {
    const context = typeof value["context"] === "string" ? value["context"] : undefined;
    if (!context) return undefined;
    const state = String(value["state"] ?? "").toUpperCase();
    const check: Check = {
      name: context,
      state:
        state === "SUCCESS" ? "passed"
          : state === "PENDING" ? "running"
            : state === "EXPECTED" ? "skipped"
              : "failed",
    };
    if (typeof value["targetUrl"] === "string") check.url = value["targetUrl"];
    return check;
  }

  const name = typeof value["name"] === "string" ? value["name"] : undefined;
  if (!name) return undefined;

  const status = String(value["status"] ?? "").toUpperCase();
  const conclusion = String(value["conclusion"] ?? "").toUpperCase();

  const check: Check = { name, state: verdict(status, conclusion) };

  // How long it took. A check that passed in eight seconds and one that passed
  // in four minutes are the same verdict and different news.
  const started = Date.parse(String(value["startedAt"] ?? ""));
  const finished = Date.parse(String(value["completedAt"] ?? ""));
  if (!Number.isNaN(started) && !Number.isNaN(finished) && finished >= started) {
    check.elapsedMs = finished - started;
  }
  if (typeof value["workflowName"] === "string" && value["workflowName"]) {
    check.workflow = value["workflowName"];
  }
  if (typeof value["detailsUrl"] === "string") check.url = value["detailsUrl"];
  return check;
}

function verdict(status: string, conclusion: string): Check["state"] {
  if (status !== "COMPLETED") return "running";
  if (conclusion === "SUCCESS") return "passed";
  // Skipped, cancelled and neutral all mean the same thing to a reviewer: it
  // did not run, and nobody is waiting on it.
  if (conclusion === "SKIPPED" || conclusion === "NEUTRAL" || conclusion === "CANCELLED") {
    return "skipped";
  }
  return "failed";
}

function summarise(checks: Check[]): CheckSummary {
  const count = (state: Check["state"]) =>
    checks.filter((c) => c.state === state).length;

  const passed = count("passed");
  const failed = count("failed");
  const running = count("running");
  const skipped = count("skipped");

  return {
    checks,
    passed,
    failed,
    running,
    skipped,
    // What is still to come is what the reader is waiting on, so the tally
    // counts everything that has stopped against everything there is.
    done: passed + failed + skipped,
    total: checks.length,
  };
}
