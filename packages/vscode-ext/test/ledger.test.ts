import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { git } from "@odin/core";

import { PairingSession } from "../src/pairing.js";

/**
 * The ledger of what has changed in a checkout.
 *
 * Built from what the file watcher saw, because the watcher is the only thing
 * in Odin that sees every change whoever made it. Reading it off the agents'
 * own announcements was the obvious way and the wrong one: only some tools
 * narrate their work, none of them narrate a formatter running on save, and
 * nothing narrates the reader editing a file themselves — so that ledger was
 * quietly missing most of what had happened to the branch, and looked exactly
 * like a ledger that was working.
 *
 * What a narrated tool still adds is the one thing the watcher cannot know:
 * whose change it was.
 */
function memento() {
  const held: Record<string, unknown> = {};
  return {
    get: <T>(key: string, fallback?: T) => (key in held ? (held[key] as T) : fallback),
    update: (key: string, value: unknown) => {
      held[key] = value;
      return Promise.resolve();
    },
    held,
  };
}

const COMMITTED = ["// a file", "", "const total = add(items);", "", "export {};", ""].join(
  "\n",
);

describe("what has changed in this checkout", () => {
  let repo: string;

  beforeAll(async () => {
    repo = mkdtempSync(join(tmpdir(), "odin-ledger-repo-"));
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(repo, "src/one.ts"), COMMITTED);
    await git(["init", "-q"], { cwd: repo });
    await git(["add", "-A"], { cwd: repo });
    await git(
      ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "one"],
      { cwd: repo },
    );
  });

  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  beforeEach(() => writeFileSync(join(repo, "src/one.ts"), COMMITTED));

  function session() {
    const store = memento();
    return {
      store,
      paired: new PairingSession(store as never, "k", repo, () => {}, true),
    };
  }

  it("takes the first change to a file as the step from the last commit", async () => {
    /*
     * Which is what a reviewer means by the question. The first time a file is
     * seen there is no earlier state to compare against, and the honest one to
     * use is what it says at HEAD.
     */
    const { paired } = session();
    writeFileSync(join(repo, "src/one.ts"), COMMITTED.replace("add(", "sum("));
    await paired.observed(["src/one.ts"]);

    const [entry] = paired.ledger();
    expect(entry).toMatchObject({ path: "src/one.ts" });
    expect(entry?.before).toContain("add(items)");
    expect(entry?.after).toContain("sum(items)");
  });

  it("takes every change after that as the step from the one before", async () => {
    const { paired } = session();
    writeFileSync(join(repo, "src/one.ts"), COMMITTED.replace("add(", "sum("));
    await paired.observed(["src/one.ts"]);
    writeFileSync(join(repo, "src/one.ts"), COMMITTED.replace("add(", "total("));
    await paired.observed(["src/one.ts"]);

    expect(paired.ledger()).toHaveLength(2);
    // The second entry is the step, not the whole story since the commit.
    expect(paired.ledger()[1]?.before).toContain("sum(items)");
    expect(paired.ledger()[1]?.after).toContain("total(items)");
  });

  it("lists a change nobody can be blamed for", async () => {
    /*
     * The whole reason this is built from the watcher. A formatter on save, a
     * tool Odin did not start, the reader's own hands — none of them announce
     * anything, and every one of them is a change to the branch under review.
     */
    const { paired } = session();
    writeFileSync(join(repo, "src/one.ts"), `${COMMITTED}// by hand\n`);
    await paired.observed(["src/one.ts"]);

    expect(paired.ledger()).toHaveLength(1);
    expect(paired.ledger()[0]?.agent).toBeUndefined();
  });

  it("says nothing about a file that was touched and did not move", async () => {
    // A save with no edit in it, a formatter that decided against it, an editor
    // writing a file back unchanged. The watcher sees all three.
    const { paired } = session();
    await paired.observed(["src/one.ts"]);
    await paired.observed(["src/one.ts"]);
    expect(paired.ledger()).toEqual([]);
  });

  it("records a file that has just been created", async () => {
    const { paired } = session();
    writeFileSync(join(repo, "src/two.ts"), "export const two = 2;\n");
    await paired.observed(["src/two.ts"]);

    const [entry] = paired.ledger();
    // Nothing was there before, which is what an empty before means and why the
    // entry says the whole file is the change.
    expect(entry).toMatchObject({ path: "src/two.ts", before: "", whole: true });
    rmSync(join(repo, "src/two.ts"), { force: true });
  });

  it("records a file that has been deleted", async () => {
    const { paired } = session();
    rmSync(join(repo, "src/one.ts"), { force: true });
    await paired.observed(["src/one.ts"]);

    expect(paired.ledger()[0]).toMatchObject({ after: "", whole: true });
  });

  it("finds the line the new text landed on", async () => {
    // Which is the whole of pressing a row: without it there is nowhere for the
    // drawing to fly to.
    const { paired } = session();
    writeFileSync(join(repo, "src/one.ts"), COMMITTED.replace("add(", "sum("));
    await paired.observed(["src/one.ts"]);

    expect(paired.ledger()[0]?.line).toBe(1);
    expect(paired.ledger()[0]?.stale).toBe(false);
  });

  it("says an entry is outdated once something has changed it back", async () => {
    /*
     * The entry is still the record of what happened and is worth keeping — but
     * a reviewer reading it has to be able to tell at a glance that the file in
     * front of them does not say this any more.
     */
    const { paired } = session();
    writeFileSync(join(repo, "src/one.ts"), COMMITTED.replace("add(", "sum("));
    await paired.observed(["src/one.ts"]);
    expect(paired.ledger()[0]?.stale).toBe(false);

    writeFileSync(join(repo, "src/one.ts"), "// somebody else got here first\n");
    expect(paired.ledger()[0]?.stale).toBe(true);
    // And it keeps what it said, rather than being emptied along with its claim.
    expect(paired.ledger()[0]?.after).toContain("sum(items)");
  });

  it("survives the window going away", async () => {
    // A reload throws away every process in this window. What happened to the
    // branch is the part of a session somebody comes back wanting to read.
    const { store, paired } = session();
    writeFileSync(join(repo, "src/one.ts"), COMMITTED.replace("add(", "sum("));
    await paired.observed(["src/one.ts"]);

    const again = new PairingSession(store as never, "k", repo, () => {}, true);
    expect(again.ledger()).toHaveLength(1);
  });

  it("keeps one reading's changes out of another's", async () => {
    // Two changes open at once are two readings, and a ledger that mixed them
    // would tell a reviewer their branch had been edited when it had not.
    const { store, paired } = session();
    writeFileSync(join(repo, "src/one.ts"), COMMITTED.replace("add(", "sum("));
    await paired.observed(["src/one.ts"]);

    const other = new PairingSession(store as never, "another-reading", repo, () => {}, true);
    expect(other.ledger()).toEqual([]);
  });
});

describe("who a change is put down to", () => {
  let bin: string;
  let repo: string;
  let path: string | undefined;

  beforeAll(async () => {
    bin = mkdtempSync(join(tmpdir(), "odin-blame-bin-"));
    repo = mkdtempSync(join(tmpdir(), "odin-blame-repo-"));
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(repo, "src/one.ts"), COMMITTED);
    await git(["init", "-q"], { cwd: repo });
    await git(["add", "-A"], { cwd: repo });
    await git(
      ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "one"],
      { cwd: repo },
    );

    /*
     * A tool that narrates: it announces the edit it is making, and makes it.
     *
     * That announcement is the only thing anywhere that can say whose change a
     * file's change was, which is why the stream is still read at all.
     */
    const events = [
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              name: "Edit",
              input: {
                file_path: `${repo}/src/one.ts`,
                old_string: "const total = add(items);",
                new_string: "const total = sum(items);",
              },
            },
          ],
        },
      }),
      JSON.stringify({ type: "result", result: "Renamed it." }),
    ];
    const file = join(bin, "claude");
    writeFileSync(
      file,
      [
        "#!/bin/sh",
        'if [ "$1" = "--version" ]; then echo "claude 1"; exit 0; fi',
        ...events.map((one) => `cat <<'ODIN'\n${one}\nODIN`),
      ].join("\n"),
    );
    chmodSync(file, 0o755);

    path = process.env.PATH;
    process.env.PATH = `${bin}:${path ?? ""}`;
  });

  afterAll(() => {
    process.env.PATH = path;
    rmSync(bin, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  it("is the agent that said it was writing that file", async () => {
    const paired = new PairingSession(memento() as never, "k", repo, () => {}, true);
    await paired.look();
    paired.setOrder(["claude"]);
    paired.ask({
      path: "src/one.ts",
      line: 3,
      side: "RIGHT",
      author: "marco",
      body: "rename add to sum",
    });

    // The announcement, which is what the claim is made of.
    const stop = Date.now() + 20_000;
    while (Date.now() < stop && !paired.transcript("claude").includes("Edit(")) {
      await new Promise((r) => setTimeout(r, 25));
    }

    writeFileSync(join(repo, "src/one.ts"), COMMITTED.replace("add(", "sum("));
    await paired.observed(["src/one.ts"]);

    expect(paired.ledger()[0]?.agent).toBe("claude");
  }, 30_000);
});
