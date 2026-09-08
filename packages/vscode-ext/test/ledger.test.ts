import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PairingSession } from "../src/pairing.js";

/**
 * The ledger of what the agents wrote, driven against one that actually runs.
 *
 * The parsing is tested where it lives, as a pure function against the shape
 * the tool emits. What cannot be tested that way is the part that matters most
 * here: an edit going past on a stream, being written down with the line it
 * landed on, and later being checked against a file that has moved on. Each of
 * those is a round trip through the file system, and the whole point of the
 * outdated mark is that it is about the file rather than about the record.
 */

/** A memento that forgets nothing, so persistence can be looked at. */
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

/** Waits for something to become true, or gives up saying so. */
async function until(what: () => boolean, ms = 8000): Promise<void> {
  const stop = Date.now() + ms;
  while (Date.now() < stop) {
    if (what()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("gave up waiting");
}

describe("what an agent wrote, kept as a list", () => {
  let bin: string;
  let repo: string;
  let path: string | undefined;

  beforeAll(() => {
    bin = mkdtempSync(join(tmpdir(), "odin-ledger-bin-"));
    repo = mkdtempSync(join(tmpdir(), "odin-ledger-repo-"));
    mkdirSync(join(repo, "src"), { recursive: true });

    /*
     * A file the agent is about to claim it edited, already reading the way the
     * edit leaves it.
     *
     * Which is what actually happens: the tool writes the file and then
     * announces what it did, so by the time the announcement is read the change
     * is on disk. The ledger looks for it there to find the line — and that is
     * the only reason an entry has one.
     */
    writeFileSync(
      join(repo, "src/one.ts"),
      ["// a file", "", "const total = sum(items);", "", "export {};", ""].join("\n"),
    );

    /*
     * Claude's narrated mode, as far as this needs it: one JSON object per
     * line, with a tool call among them and a result at the end.
     */
    const events = [
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "Fixing that." },
            {
              type: "tool_use",
              name: "Edit",
              input: {
                /*
                 * The path as a tool actually reports it, which is not always
                 * the path this process was handed. On macOS `/tmp` and `/var`
                 * are symlinks into `/private`, and a tool that has resolved
                 * its own working directory announces the resolved spelling —
                 * so an entry recorded by a real turn carried the whole of
                 * `/private/var/folders/…` where a card says `src/one.ts`, and
                 * every read of it afterwards looked for a file that is not
                 * anywhere.
                 */
                file_path: `/private${repo}/src/one.ts`,
                old_string: "const total = add(items);",
                new_string: "const total = sum(items);",
              },
            },
          ],
        },
      }),
      JSON.stringify({ type: "result", result: "Renamed it to sum." }),
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

  async function asked() {
    const store = memento();
    const paired = new PairingSession(store as never, "k", repo, () => {});
    await paired.look();
    paired.setOrder(["claude"]);
    paired.ask({
      path: "src/one.ts",
      line: 3,
      side: "RIGHT" as const,
      author: "marco",
      body: "rename add to sum",
    });
    await until(() => paired.ledger().length > 0, 20_000);
    return { paired, store };
  }

  it("writes down the passage an edit replaced, with the file it was in", async () => {
    const { paired } = await asked();
    const [entry] = paired.ledger();

    expect(entry).toMatchObject({
      agent: "claude",
      // Repo-relative, so it can be matched against a card. The tool announced
      // it as an absolute path, which names nothing in the drawing.
      path: "src/one.ts",
      before: "const total = add(items);",
      after: "const total = sum(items);",
    });
  }, 30_000);

  it("finds the line the new text landed on", async () => {
    // Which is the whole of pressing a row: without it there is nowhere for the
    // drawing to fly to.
    const { paired } = await asked();
    expect(paired.ledger()[0]?.line).toBe(3);
  }, 30_000);

  it("says an entry is current while the file still reads that way", async () => {
    const { paired } = await asked();
    expect(paired.ledger()[0]?.stale).toBe(false);
  }, 30_000);

  it("says an entry is outdated once something has changed it back", async () => {
    /*
     * The situation this exists for. An agent edits a passage and then edits it
     * again; or a reviewer undoes it by hand; or the branch is checked out
     * afresh. The entry is still the record of what happened and is worth
     * keeping — but a reviewer reading it has to be able to tell at a glance
     * that the file in front of them does not say this any more.
     */
    const { paired } = await asked();
    expect(paired.ledger()[0]?.stale).toBe(false);

    writeFileSync(join(repo, "src/one.ts"), "// somebody else got here first\n");
    const after = paired.ledger()[0];
    expect(after?.stale).toBe(true);
    // And it keeps what it said, rather than being emptied along with its claim.
    expect(after?.after).toBe("const total = sum(items);");
  }, 30_000);

  it("survives the window going away", async () => {
    // A reload throws away every process in this window. What an agent wrote is
    // the part of a session somebody comes back wanting to read.
    const { store } = await asked();
    const again = new PairingSession(store as never, "k", repo, () => {});
    expect(again.ledger()).toHaveLength(1);
    expect(again.ledger()[0]?.before).toBe("const total = add(items);");
  }, 30_000);

  it("keeps one reading's edits out of another's", async () => {
    // Two changes open at once are two sessions, and a ledger that mixed them
    // would tell a reviewer their branch had been edited when it had not.
    const { store } = await asked();
    const other = new PairingSession(store as never, "another-reading", repo, () => {});
    expect(other.ledger()).toEqual([]);
  }, 30_000);
});
