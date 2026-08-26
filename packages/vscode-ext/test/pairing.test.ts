import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PairingSession, PLACEHOLDER, replyIn } from "../src/pairing.js";

/**
 * Pairing, driven against agents that actually run.
 *
 * The queue's rules are tested where they live, as pure functions. What cannot
 * be tested that way is the part that spawns something, waits for it, and turns
 * what it printed into a message in a thread — and that is where a conversation
 * either appears or silently does not.
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

describe("a conversation with the agents on this machine", () => {
  let bin: string;
  let repo: string;
  let path: string | undefined;

  beforeAll(() => {
    bin = mkdtempSync(join(tmpdir(), "odin-pair-bin-"));
    repo = mkdtempSync(join(tmpdir(), "odin-pair-repo-"));

    // Answers with its own name and whatever it was asked, so a reply can be
    // traced back to the agent that wrote it and the prompt it was given.
    const put = (name: string, body: string) => {
      const file = join(bin, name);
      writeFileSync(file, `#!/bin/sh\n${body}\n`);
      chmodSync(file, 0o755);
    };
    // Noise on standard error, the answer on standard output — which is what
    // these tools actually do in their answer-once modes, and the whole basis
    // for telling a message from a log.
    // The prompt is the last argument, not the second: a tool that carries a
    // conversation is invoked with the arguments that name it in between.
    const last = 'for a in "$@"; do p="$a"; done';
    // Its own arguments to the log, which is where a real tool's noise goes and
    // the only place the invocation is visible from outside.
    put("claude", 'if [ "$1" = "--version" ]; then echo "claude 1"; exit 0; fi\n' +
      `${last}\necho "ARGS: $@" >&2\necho "thinking about it" >&2\necho "CLAUDE SAYS: $p"`);
    put("codex", 'if [ "$1" = "--version" ]; then echo "codex 1"; exit 0; fi\n' +
      `${last}\necho "CODEX SAYS: $p"`);

    path = process.env.PATH;
    process.env.PATH = `${bin}:${path ?? ""}`;
  });

  afterAll(() => {
    process.env.PATH = path;
    rmSync(bin, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  const where = {
    path: "src/one.ts",
    line: 12,
    side: "RIGHT" as const,
    author: "marco",
  };

  async function session(order: string[] = ["claude"]) {
    let changes = 0;
    const store = memento();
    const paired = new PairingSession(store as never, "k", repo, () => {
      changes += 1;
    });
    await paired.look();
    paired.setOrder(order);
    return { paired, store, changes: () => changes };
  }

  it("shows the message before anybody has taken it", async () => {
    // A reviewer who writes three messages should see three messages, not
    // watch two vanish until an agent gets to them.
    const { paired } = await session();
    const said = paired.ask({ ...where, body: "add a test" });

    expect(said.local).toBe(true);
    expect(said.task).toBe("queued");
    expect(paired.local()).toHaveLength(1);
    // Generous, and it is the setup rather than the assertion: standing a
    // session up asks six tools on PATH what version they are, and under a
    // loaded machine that alone outruns the default.
  }, 20_000);

  it("gets an answer back into the same thread", async () => {
    const { paired } = await session();
    const said = paired.ask({ ...where, body: "add a test" });

    await until(() => paired.local().length > 1);
    const reply = paired.local().find((c) => c.inReplyTo === said.id);
    expect(reply?.author).toBe("Claude");
    expect(reply?.agent).toBe("claude");
    expect(reply?.body).toContain("CLAUDE SAYS:");
    // The remark it answers is finished, which is what takes the badge off.
    await until(() => paired.local()[0]!.task === "done");
  }, 20_000);

  it("takes a question about the change, with no line under it", async () => {
    /*
     * Architecture, naming, where a thing belongs: real questions about a
     * change that no passage in it is the right place for. They are asked from
     * an agent's own terminal, and they are recorded the same way everything
     * else is — a remark in the conversation, written before the agent sees it.
     * What they lack is a file and a line, so they leave no mark in any margin.
     */
    const { paired } = await session();
    const said = paired.ask({ body: "should these two files be one?", to: "claude", author: "marco" });

    expect(said.local).toBe(true);
    expect(said.path).toBe("");
    expect(said.line).toBe(0);
    expect(said.task).toBe("queued");

    await until(() => paired.local().some((c) => c.inReplyTo === said.id));
    const reply = paired.local().find((c) => c.inReplyTo === said.id);
    expect(reply?.agent).toBe("claude");
    // The prompt says what it is about rather than leaving the agent to assume
    // it is the last thing it looked at. The stub echoes its prompt back.
    expect(reply?.body).toContain("the change as a whole");
  }, 20_000);

  it("sends it to the agent whose terminal it was written in", async () => {
    // The box is the address. Naming somebody else in the text still wins —
    // that is the reader saying so in as many words.
    const { paired } = await session(["claude", "codex"]);
    const said = paired.ask({ body: "where should this live?", to: "codex", author: "marco" });

    await until(() => paired.local().some((c) => c.inReplyTo === said.id));
    expect(paired.local().find((c) => c.inReplyTo === said.id)?.agent).toBe("codex");

    const named = paired.ask({ body: "@Claude what about the naming?", to: "codex", author: "marco" });
    await until(() => paired.local().some((c) => c.inReplyTo === named.id));
    expect(paired.local().find((c) => c.inReplyTo === named.id)?.agent).toBe("claude");
  }, 20_000);

  it("ends a turn when the reader says to", async () => {
    /*
     * Not an error and not the tool failing: an agent three minutes into work
     * the reader has changed their mind about is doing work that is already
     * wrong. The turn ends the way it would if the window had gone — what it
     * printed stays in the log, and the remark it was answering is marked
     * stopped, which is the state that offers to ask again.
     */
    const { paired } = await session();
    const said = paired.ask({ ...where, body: "rewrite the whole thing" });

    await until(() => paired.busy().includes("claude"));
    paired.stop("claude");

    await until(() => paired.local()[0]!.task !== "working", 12_000);
    expect(paired.local()[0]!.task).toBe("failed");
    expect(paired.busy()).not.toContain("claude");
    expect(said.id).toBeLessThan(0);
  }, 20_000);

  it("says nothing when asked to stop an agent that is not running", async () => {
    // Pressing stop on a turn that ended a moment ago is a reasonable thing to
    // do by accident.
    const { paired } = await session();
    expect(() => paired.stop("claude")).not.toThrow();
    expect(() => paired.stop("nobody")).not.toThrow();
  }, 20_000);

  it("hands the message to the agent that was named", async () => {
    // Whatever its priority. Being asked directly is the reader overriding the
    // order, and an address answered by somebody else makes naming pointless.
    const { paired } = await session(["claude", "codex"]);
    const said = paired.ask({ ...where, body: "@Codex please look" });

    await until(() => paired.local().some((c) => c.inReplyTo === said.id));
    expect(paired.local().find((c) => c.inReplyTo === said.id)?.agent).toBe("codex");
  }, 20_000);

  it("tells the agent what has already been said", async () => {
    /*
     * The whole of the team behaviour. An agent that cannot see the thread has
     * no way to stay out of work somebody else claimed, and two of them do the
     * same thing.
     */
    const { paired } = await session(["claude"]);
    const first = paired.ask({ ...where, body: "add a test" });
    await until(() => paired.local().some((c) => c.inReplyTo === first.id));

    paired.ask({ ...where, body: "and the edge case", inReplyTo: first.id });
    await until(() => paired.local().filter((c) => c.author === "Claude").length > 1);

    // The prompt is echoed back by the fake agent, so what it was told is
    // readable in what it said.
    const latest = paired.local().filter((c) => c.author === "Claude").pop();
    expect(latest?.body).toContain("add a test");
    expect(latest?.body).toContain("The thread so far");
  }, 25_000);

  it("says who else is listening", async () => {
    const { paired } = await session(["claude", "codex"]);
    const said = paired.ask({ ...where, body: "anyone" });
    await until(() => paired.local().some((c) => c.inReplyTo === said.id));
    expect(paired.local().find((c) => c.inReplyTo === said.id)?.body).toContain("Codex");
  }, 20_000);

  it("keeps the conversation across a reload", async () => {
    // Worth as much as the notes a reviewer takes while reading. Losing it to
    // a window reload would make the whole thing untrustworthy to rely on.
    const { paired, store } = await session();
    paired.ask({ ...where, body: "remember me" });

    const again = new PairingSession(store as never, "k", repo, () => {});
    expect(again.local().map((c) => c.body)).toContain("remember me");
  }, 20_000);

  it("keeps two readings' conversations apart", async () => {
    const store = memento();
    const one = new PairingSession(store as never, "reading-a", repo, () => {});
    const two = new PairingSession(store as never, "reading-b", repo, () => {});
    one.ask({ ...where, body: "for a" });

    expect(two.local()).toEqual([]);
    const back = new PairingSession(store as never, "reading-b", repo, () => {});
    expect(back.local()).toEqual([]);
  });

  it("waits rather than answering when nobody is switched on", async () => {
    const { paired } = await session([]);
    paired.ask({ ...where, body: "add a test" });

    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(paired.local()).toHaveLength(1);
    expect(paired.local()[0]!.task).toBe("queued");
  }, 20_000);

  it("starts on a message that was waiting when an agent is switched on", async () => {
    // The message was written before anybody could take it. Nothing else will
    // provoke a re-look, so switching one on has to.
    const { paired } = await session([]);
    const said = paired.ask({ ...where, body: "add a test" });
    paired.setOrder(["claude"]);

    await until(() => paired.local().some((c) => c.inReplyTo === said.id));
  }, 20_000);

  it("says so in the thread when a tool fails rather than saying nothing", async () => {
    const broken = join(bin, "gemini");
    writeFileSync(
      broken,
      '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "g"; exit 0; fi\nexit 3\n',
    );
    chmodSync(broken, 0o755);

    const { paired } = await session([]);
    await paired.look();
    paired.setOrder(["gemini"]);
    const said = paired.ask({ ...where, body: "do a thing" });

    await until(() => paired.local().some((c) => c.inReplyTo === said.id));
    expect(paired.local().find((c) => c.inReplyTo === said.id)?.body).toContain("exited 3");
    expect(paired.local()[0]!.task).toBe("failed");
  }, 20_000);

  /*
   * Two agents, one conversation.
   *
   * The reader writes a follow-up. Claude is at the top of the order and free;
   * Codex answered the first message. The follow-up is Codex's, and the whole
   * of Phase 4 is that being true rather than being a suggestion in a prompt.
   */
  it("sends a follow-up to the agent that answered first", async () => {
    const { paired } = await session(["claude", "codex"]);
    const first = paired.ask({ ...where, body: "@Codex add a test" });
    await until(() => paired.local().some((c) => c.inReplyTo === first.id));

    paired.ask({ ...where, body: "and the edge case", inReplyTo: first.id });
    // A reply hangs off the conversation rather than off the message that
    // provoked it — the forge's threads are flat under a root, and these are
    // drawn by the same component. So the second answer is counted, not
    // looked up by what it is a reply to.
    await until(() => paired.local().filter((c) => c.agent).length > 1);

    // Claude was free and higher in the order the whole time.
    const answers = paired.local().filter((c) => c.agent);
    expect(answers.map((c) => c.agent)).toEqual(["codex", "codex"]);
  }, 30_000);

  it("says on the thread who has claimed it", async () => {
    const { paired } = await session(["claude"]);
    const said = paired.ask({ ...where, body: "add a test" });
    await until(() => paired.local().some((c) => c.inReplyTo === said.id));

    expect(paired.owners()[said.id]).toBe("claude");
  }, 20_000);

  it("claims nothing before an agent has answered", async () => {
    const { paired } = await session([]);
    const said = paired.ask({ ...where, body: "add a test" });
    expect(paired.owners()[said.id]).toBeUndefined();
  }, 20_000);

  it("tells the agent the thread is its own", async () => {
    // The fake echoes its prompt, so what it was told is readable in what it
    // said back.
    const { paired } = await session(["claude"]);
    const first = paired.ask({ ...where, body: "add a test" });
    await until(() => paired.local().some((c) => c.inReplyTo === first.id));

    paired.ask({ ...where, body: "carry on", inReplyTo: first.id });
    await until(() => paired.local().filter((c) => c.agent === "claude").length > 1);

    const latest = paired.local().filter((c) => c.agent === "claude").pop();
    expect(latest?.body).toContain("This thread is yours");
  }, 30_000);

  /*
   * Signing the reader's own remarks.
   *
   * A remark appears the instant it is written, which is before anybody has
   * asked the forge who is reading — so the first ones carry a placeholder.
   * Left that way they sit in a thread signed "you" beside everybody else's
   * real name and picture, for ever, because nothing revisits a written
   * comment.
   */
  it("signs what was written before the forge answered", async () => {
    const { paired } = await session([]);
    const mine = paired.ask({ ...where, body: "one", author: PLACEHOLDER });

    expect(paired.identify("marcoacosta", "data:image/png,face")).toBe(true);
    const back = paired.local().find((c) => c.id === mine.id);
    expect(back?.author).toBe("marcoacosta");
    expect(back?.avatarUrl).toBe("data:image/png,face");
  }, 20_000);

  it("leaves an agent's messages signed by the agent", async () => {
    const { paired } = await session(["claude"]);
    const said = paired.ask({ ...where, body: "one", author: PLACEHOLDER });
    await until(() => paired.local().some((c) => c.agent === "claude"));

    paired.identify("marcoacosta", "face");
    expect(paired.local().find((c) => c.agent === "claude")?.author).toBe("Claude");
    expect(paired.local().find((c) => c.id === said.id)?.author).toBe("marcoacosta");
  }, 25_000);

  it("says nothing changed when there was nothing to sign", async () => {
    // A page is only redrawn when it would look different.
    const { paired } = await session([]);
    paired.ask({ ...where, body: "one", author: "marcoacosta" });
    expect(paired.identify("marcoacosta", "face")).toBe(false);
  }, 20_000);

  /*
   * Letting an agent actually do the thing.
   *
   * Every one of these tools stops and asks before writing a file, and there is
   * nobody here to ask: no terminal, standard input closed, the reader looking
   * at a graph. Without the flag an agent comes back having worked out exactly
   * what to do and been refused permission to do it — which reads as the tool
   * being broken rather than as a setting.
   */
  it("lets an agent edit without being asked, by default", async () => {
    /*
     * Asking has nowhere to go here — no terminal, standard input closed, the
     * reader looking at a graph — so an agent left at the tool's default comes
     * back having worked out exactly what to do and been refused permission to
     * do it. That reads as a broken tool rather than as a setting.
     */
    const { paired } = await session(["claude"]);
    paired.ask({ ...where, body: "one" });
    await until(() => paired.local().some((c) => c.agent === "claude"));
    expect(paired.transcript("claude")).toContain("acceptEdits");
  }, 25_000);

  it("goes no further than editing unless the reader says so", async () => {
    // Running arbitrary commands is a separate decision from writing files,
    // and it is not one to make on somebody's behalf.
    const { paired } = await session(["claude"]);
    paired.ask({ ...where, body: "one" });
    await until(() => paired.local().some((c) => c.agent === "claude"));
    expect(paired.transcript("claude")).not.toContain("bypassPermissions");
  }, 25_000);

  it("hands over everything when the reader asks for it", async () => {
    const { paired } = await session(["claude"]);
    paired.setAgency({ claude: "full" });
    paired.ask({ ...where, body: "one" });
    await until(() => paired.local().some((c) => c.agent === "claude"));
    expect(paired.transcript("claude")).toContain("bypassPermissions");
  }, 25_000);

  it("passes nothing at all for the rung that means asking", async () => {
    // The tool's own default. A flag that means "behave normally" is a flag
    // that can be wrong.
    const { paired } = await session(["claude"]);
    paired.setAgency({ claude: "ask" });
    paired.ask({ ...where, body: "one" });
    await until(() => paired.local().some((c) => c.agent === "claude"));
    expect(paired.transcript("claude")).not.toContain("--permission-mode");
  }, 25_000);

  it("offers only the rungs a tool has a word for", async () => {
    // A control offering a level the tool has never heard of is a control that
    // silently does nothing.
    const { paired } = await session([]);
    expect(paired.rungs().claude).toEqual(
      expect.arrayContaining(["ask", "read", "edits", "full"]),
    );
  }, 20_000);

  it("names a conversation and forgets the name again", async () => {
    // Odin's name for it, not the tool's: a tool that lets a session be named
    // takes that name when the session is made and cannot change it after, so
    // a rename that had to reach the tool would work exactly once.
    const { paired } = await session([]);
    paired.rename("claude", "  the migration one  ");
    expect(paired.label("claude")).toBe("the migration one");
    expect(paired.labelled()).toEqual({ claude: "the migration one" });

    paired.rename("claude", "   ");
    expect(paired.label("claude")).toBe("");
  }, 20_000);

  it("keeps a name across a reload", async () => {
    const store = memento();
    const first = new PairingSession(store as never, "k", repo, () => {});
    first.rename("claude", "the migration one");

    const again = new PairingSession(store as never, "k", repo, () => {});
    expect(again.label("claude")).toBe("the migration one");
  }, 20_000);

  /*
   * A conversation the forge has never heard of.
   *
   * These threads carry ids of our own, which are not ids `gh` can be asked
   * about. Sending one produced "Parent comment not found (HTTP 404)" — after
   * the reader had written the reply and pressed the button.
   */
  it("rewrites a remark the reader wrote here", async () => {
    const { paired } = await session([]);
    const mine = paired.ask({ ...where, body: "first go" });

    expect(paired.edit(mine.id, "second go")).toBe(true);
    expect(paired.local().find((c) => c.id === mine.id)?.body).toBe("second go");
  }, 20_000);

  it("refuses to rewrite what an agent said", async () => {
    // The record of what it actually said. Editing that leaves a thread that
    // reads as an audit trail and is not one.
    const { paired } = await session(["claude"]);
    paired.ask({ ...where, body: "one" });
    await until(() => paired.local().some((c) => c.agent === "claude"));

    const said = paired.local().find((c) => c.agent === "claude")!;
    expect(paired.edit(said.id, "something else")).toBe(false);
    expect(paired.local().find((c) => c.id === said.id)?.body).toBe(said.body);
  }, 25_000);

  it("takes a whole conversation away with its root", async () => {
    /*
     * A root removed on its own leaves its replies orphaned: the grouping
     * follows the reply pointers up, so each becomes a thread of its own,
     * scattered across the same line of the same file.
     */
    const { paired } = await session(["claude"]);
    const root = paired.ask({ ...where, body: "one" });
    await until(() => paired.local().some((c) => c.agent === "claude"));

    expect(paired.remove(root.id)).toBe(true);
    expect(paired.local()).toEqual([]);
  }, 25_000);

  it("takes a single reply away without the thread", async () => {
    const { paired } = await session([]);
    const root = paired.ask({ ...where, body: "one" });
    const second = paired.ask({ ...where, body: "two", inReplyTo: root.id });

    expect(paired.remove(second.id)).toBe(true);
    expect(paired.local().map((c) => c.id)).toEqual([root.id]);
  }, 20_000);

  it("says nothing happened when there was nothing to remove", async () => {
    const { paired } = await session([]);
    expect(paired.remove(-999)).toBe(false);
  }, 20_000);

  it("keeps everything printed, for the terminal", async () => {
    const { paired } = await session();
    const said = paired.ask({ ...where, body: "add a test" });
    await until(() => paired.local().some((c) => c.inReplyTo === said.id));

    // The reply is the message; the transcript is the log. Both exist, and the
    // noise on the way past belongs only in the second.
    expect(paired.transcript("claude")).toContain("thinking about it");
    expect(paired.local().find((c) => c.inReplyTo === said.id)?.body)
      .not.toContain("thinking about it");
  }, 20_000);
});

describe("the message inside a transcript", () => {
  it("takes what was said last", () => {
    expect(replyIn("working…\nchecking\nHere is the change.")).toContain(
      "Here is the change.",
    );
  });

  it("ignores odin's own notes about the turn", () => {
    // Written by us into the log so the terminal explains itself. Not the
    // agent's message, and posting it as one would put words in its mouth.
    expect(replyIn("Done.\n[odin] stopped after 30 minutes\n")).toBe("Done.");
  });

  it("gives nothing back for a tool that printed nothing", () => {
    expect(replyIn("\n\n  \n")).toBe("");
  });

  it("does not put a whole log into a conversation", () => {
    // Bounded, and it says so rather than stopping mid-sentence with nothing
    // to explain why.
    const long = Array.from({ length: 4000 }, (_, i) => `line ${i}`).join("\n");
    const said = replyIn(long);
    expect(said.length).toBeLessThan(2100);
    expect(said).toContain("in the terminal");
  });

  it("keeps a reply that is merely long-ish whole", () => {
    const said = "a".repeat(1990);
    expect(replyIn(said)).toBe(said);
  });
});

/**
 * How often the machine is asked what it has installed.
 *
 * A page is rebuilt whenever the working tree changes, which in a live reading
 * is every time the reader saves a file — and each rebuilt page asks again.
 * Uncached, that is a probe of every known tool on every save, and each probe
 * boots a Node interpreter.
 */
describe("asking the machine what it has", () => {
  let bin: string;
  let repo: string;
  let path: string | undefined;
  let counter: string;

  beforeAll(() => {
    bin = mkdtempSync(join(tmpdir(), "odin-look-bin-"));
    repo = mkdtempSync(join(tmpdir(), "odin-look-repo-"));
    counter = join(repo, "asked");

    const gh = join(bin, "claude");
    // Keeps a tally on disk, so how many times it was actually run is a fact
    // rather than something inferred from timing.
    writeFileSync(
      gh,
      `#!/bin/sh\necho x >> ${counter}\nif [ "$1" = "--version" ]; then echo "claude 1"; exit 0; fi\necho hi\n`,
    );
    chmodSync(gh, 0o755);
    path = process.env.PATH;
    process.env.PATH = `${bin}:${path ?? ""}`;
  });

  afterAll(() => {
    process.env.PATH = path;
    rmSync(bin, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  });

  const asked = () => {
    try {
      return readFileSync(counter, "utf8").trim().split("\n").filter(Boolean).length;
    } catch {
      return 0;
    }
  };

  it("does not probe again for every rebuilt page", async () => {
    const store = memento();
    const first = new PairingSession(store as never, "k", repo, () => {});
    // Forced once, because the answer is remembered for the whole window and
    // another test in this file may already have warmed it — which is the
    // behaviour under test, and would otherwise make this pass for the wrong
    // reason.
    await first.look(true);
    const after = asked();
    expect(after).toBeGreaterThan(0);

    // The page was rebuilt. Three times, as a save-heavy minute would.
    for (let i = 0; i < 3; i++) {
      await new PairingSession(store as never, "k", repo, () => {}).look();
    }
    expect(asked()).toBe(after);
  }, 20_000);

  it("asks again when the reader says the answer has changed", async () => {
    const store = memento();
    const paired = new PairingSession(store as never, "k", repo, () => {});
    await paired.look();
    const before = asked();

    await paired.look(true);
    expect(asked()).toBeGreaterThan(before);
  }, 20_000);
});

/**
 * Carrying a conversation across a window reload.
 *
 * A reload throws away this window and every process in it, but the tools keep
 * their own conversations on disk. So what has to survive is not the
 * conversation but its name: come back tomorrow, reopen the tab, and the next
 * thing said carries on from what the agent already knows about this change.
 */
describe("remembering which conversation an agent is having", () => {
  let bin: string;
  let repo: string;
  let path: string | undefined;
  let log: string;

  beforeAll(() => {
    bin = mkdtempSync(join(tmpdir(), "odin-sess-bin-"));
    repo = mkdtempSync(join(tmpdir(), "odin-sess-repo-"));
    log = join(repo, "argv");

    /*
     * Behaves the way the real one does, which is the whole point of the test.
     * `--session-id` refuses an id it has seen before — measured against the
     * installed CLI, which answers "Session ID … is already in use" — so the
     * two cases really are two sets of arguments and getting it wrong fails
     * outright rather than subtly.
     */
    const file = join(bin, "claude");
    writeFileSync(
      file,
      [
        "#!/bin/sh",
        'if [ "$1" = "--version" ]; then echo "claude 1"; exit 0; fi',
        `echo "$@" >> ${log}`,
        'if [ "$2" = "--session-id" ]; then',
        `  if [ -f ${repo}/seen-$3 ]; then echo "Session ID $3 is already in use." >&2; exit 1; fi`,
        `  touch ${repo}/seen-$3`,
        '  echo "started $3"',
        '  exit 0',
        "fi",
        'if [ "$2" = "--resume" ]; then',
        `  if [ -f ${repo}/seen-$3 ]; then echo "resumed $3"; exit 0; fi`,
        '  echo "No conversation found" >&2',
        "  exit 1",
        "fi",
        'echo "no session"',
      ].join("\n") + "\n",
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

  const where = { path: "a.ts", line: 1, side: "RIGHT" as const, author: "m" };

  async function session(store: ReturnType<typeof memento>) {
    const paired = new PairingSession(store as never, "reading", repo, () => {});
    await paired.look(true);
    paired.setOrder(["claude"]);
    return paired;
  }

  it("starts a conversation under an id of its own", async () => {
    const paired = await session(memento());
    const said = paired.ask({ ...where, body: "one" });
    await until(() => paired.local().some((c) => c.agent === "claude"));

    const id = paired.session("claude");
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(paired.local().find((c) => c.agent === "claude")?.body).toContain(`started ${id}`);
    // Re-read rather than kept: a badge moving is a new object in the list, so
    // the one handed back when the message was written still says "queued".
    expect(paired.local().find((c) => c.id === said.id)?.task).toBe("done");
  }, 25_000);

  it("carries the same conversation on for the next message", async () => {
    const paired = await session(memento());
    paired.ask({ ...where, body: "one" });
    await until(() => paired.local().filter((c) => c.agent === "claude").length === 1);
    const id = paired.session("claude");

    paired.ask({ ...where, body: "two" });
    await until(() => paired.local().filter((c) => c.agent === "claude").length === 2);

    // Not a second `--session-id`, which the tool would refuse.
    expect(paired.local().filter((c) => c.agent === "claude").pop()?.body)
      .toContain(`resumed ${id}`);
  }, 30_000);

  it("picks the conversation back up after a reload", async () => {
    // The window went away and everything in it with it. The id did not.
    const store = memento();
    const before = await session(store);
    before.ask({ ...where, body: "one" });
    await until(() => before.local().some((c) => c.agent === "claude"));
    const id = before.session("claude");

    const after = await session(store);
    expect(after.session("claude")).toBe(id);

    after.ask({ ...where, body: "after the reload" });
    await until(() => after.local().filter((c) => c.agent === "claude").length === 2);
    expect(after.local().filter((c) => c.agent === "claude").pop()?.body)
      .toContain(`resumed ${id}`);
  }, 40_000);

  it("keeps two readings' conversations separate", async () => {
    // An agent that remembered one change while being asked about another is
    // worse than one that remembered nothing.
    const store = memento();
    const one = new PairingSession(store as never, "reading-one", repo, () => {});
    const two = new PairingSession(store as never, "reading-two", repo, () => {});
    await one.look(true);
    await two.look(true);
    one.setOrder(["claude"]);
    two.setOrder(["claude"]);

    one.ask({ ...where, body: "in one" });
    await until(() => one.local().some((c) => c.agent === "claude"));
    two.ask({ ...where, body: "in two" });
    await until(() => two.local().some((c) => c.agent === "claude"));

    expect(one.session("claude")).toBeTruthy();
    expect(two.session("claude")).toBeTruthy();
    expect(one.session("claude")).not.toBe(two.session("claude"));
  }, 40_000);

  it("starts over when the tool has forgotten the conversation", async () => {
    /*
     * The id is ours; the transcript behind it is the tool's, and lives in its
     * directory — cleared by an uninstall, a cleanup, or a new machine.
     * Resuming one that has gone fails and prints nothing, which from the
     * thread is indistinguishable from an agent with nothing to say.
     */
    const store = memento();
    const paired = await session(store);
    // A conversation this machine has never heard of.
    (store as unknown as { held: Record<string, unknown> }).held["odin.pairing"] = {
      reading: { comments: [], next: -1, sessions: { claude: "11111111-2222-3333-4444-555555555555" } },
    };
    const again = await session(store);
    again.ask({ ...where, body: "carry on" });
    await until(() => again.local().some((c) => c.agent === "claude"));

    const said = again.local().find((c) => c.agent === "claude")?.body ?? "";
    expect(said).toContain("started ");
    expect(again.session("claude")).not.toBe("11111111-2222-3333-4444-555555555555");
    // And the reason is in the log rather than nowhere.
    expect(again.transcript("claude")).toContain("could not resume");
  }, 40_000);

  it("forgets the conversations without forgetting the thread", async () => {
    const paired = await session(memento());
    paired.ask({ ...where, body: "one" });
    await until(() => paired.local().some((c) => c.agent === "claude"));

    const remarks = paired.local().length;
    paired.forgetSessions();
    expect(paired.session("claude")).toBeUndefined();
    // The messages are the reader's record. The agent's memory of how it got
    // there is the agent's.
    expect(paired.local()).toHaveLength(remarks);
  }, 25_000);
});

/**
 * A session that prints without limit.
 *
 * An agent working against a large repository can print for minutes, and every
 * byte is held three times over: in the session, in the page, and in the
 * markdown the terminal parses out of it. Nothing else bounds it — a turn ends
 * when the work ends, not when the log becomes inconvenient.
 */
describe("how much of a session is kept", () => {
  it("keeps the end rather than the beginning", async () => {
    const bin = mkdtempSync(join(tmpdir(), "odin-tail-bin-"));
    const repo = mkdtempSync(join(tmpdir(), "odin-tail-repo-"));
    const file = join(bin, "claude");
    writeFileSync(
      file,
      '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "c"; exit 0; fi\n' +
        'echo "FIRST-MARKER"\n' +
        "awk 'BEGIN { for (i = 0; i < 60000; i++) print \"padding line\", i }'\n" +
        'echo "LAST-MARKER"\n',
    );
    chmodSync(file, 0o755);
    const path = process.env.PATH;
    process.env.PATH = `${bin}:${path ?? ""}`;

    try {
      const paired = new PairingSession(memento() as never, "k", repo, () => {});
      await paired.look(true);
      paired.setOrder(["claude"]);
      paired.ask({
        path: "a.ts",
        line: 1,
        side: "RIGHT",
        body: "print a lot",
        author: "m",
      });
      await until(() => paired.local().some((c) => c.agent === "claude"), 30_000);

      const kept = paired.transcript("claude");
      expect(kept.length).toBeLessThan(500_000);
      // The end is what somebody watching is looking at.
      expect(kept).toContain("LAST-MARKER");
      expect(kept).not.toContain("FIRST-MARKER");
      // And it says so rather than simply beginning mid-log.
      expect(kept).toContain("earlier output dropped");
    } finally {
      process.env.PATH = path;
      rmSync(bin, { recursive: true, force: true });
      rmSync(repo, { recursive: true, force: true });
    }
  }, 60_000);
});

/**
 * What survives a window reload.
 *
 * The reader's complaint was that the conversations were gone. They were not —
 * they were on disk, loaded into memory a moment after the page was built, and
 * never sent anywhere. The log genuinely was gone: it was only ever held in
 * memory, so the box that exists to show it said "Nothing yet".
 */
describe("coming back to a conversation after a reload", () => {
  let bin: string;
  let repo: string;
  let path: string | undefined;

  beforeAll(() => {
    bin = mkdtempSync(join(tmpdir(), "odin-back-bin-"));
    repo = mkdtempSync(join(tmpdir(), "odin-back-repo-"));
    const file = join(bin, "claude");
    writeFileSync(
      file,
      '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "c"; exit 0; fi\n' +
        'echo "noise on the way past" >&2\necho "the answer"\n',
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

  const where = { path: "a.ts", line: 1, side: "RIGHT" as const, author: "m" };

  it("brings the remarks and the log back together", async () => {
    const store = memento();
    const before = new PairingSession(store as never, "k", repo, () => {});
    await before.look(true);
    before.setOrder(["claude"]);
    before.ask({ ...where, body: "one" });
    await until(() => before.local().some((c) => c.agent === "claude"), 25_000);

    const after = new PairingSession(store as never, "k", repo, () => {});
    expect(after.local().map((c) => c.body)).toContain("one");
    // The record of how the conversation got here, not merely that it did.
    expect(after.transcript("claude")).toContain("the answer");
    expect(after.transcript("claude")).toContain("noise on the way past");
  }, 40_000);

  it("does not leave a turn saying it is working when nothing is", async () => {
    /*
     * The remarks survive a reload and the processes do not. A message left
     * mid-turn came back still saying it was being worked on — for ever, with
     * nothing running and a terminal with nothing in it, which is the least
     * explicable state this can be in.
     */
    const store = memento();
    const held = (store as unknown as { held: Record<string, unknown> }).held;
    held["odin.pairing"] = {
      k: {
        next: -3,
        comments: [
          { id: -1, path: "a.ts", line: 1, side: "RIGHT", body: "one", author: "m",
            createdAt: "t1", url: "", outdated: false, local: true, task: "working" },
          { id: -2, path: "a.ts", line: 1, side: "RIGHT", body: "two", author: "m",
            createdAt: "t2", url: "", outdated: false, local: true, task: "queued" },
        ],
      },
    };

    const after = new PairingSession(store as never, "k", repo, () => {});
    expect(after.local().map((c) => c.task)).toEqual(["stopped", "stopped"]);
  }, 20_000);

  it("does not leave a button that answers nothing", async () => {
    // The window that would have carried the decision is gone.
    const store = memento();
    const held = (store as unknown as { held: Record<string, unknown> }).held;
    held["odin.pairing"] = {
      k: {
        next: -2,
        comments: [
          { id: -1, path: "a.ts", line: 1, side: "RIGHT", body: "May I?", author: "Claude",
            agent: "claude", createdAt: "t1", url: "", outdated: false, local: true,
            approval: { id: "x", what: "run `rm -rf /`", state: "waiting" } },
        ],
      },
    };

    const after = new PairingSession(store as never, "k", repo, () => {});
    expect(after.local()[0]!.approval?.state).toBe("denied");
    expect(after.pending()).toEqual([]);
  }, 20_000);

  it("does not keep a whole session's output for ever", async () => {
    // Storage is the editor's, shared with everything else that wants to
    // remember something about this workspace.
    const store = memento();
    const paired = new PairingSession(store as never, "k", repo, () => {});
    paired.rename("claude", "x");

    const held = (store as unknown as { held: Record<string, unknown> }).held;
    const kept = (held["odin.pairing"] as Record<string, { logs?: unknown }>).k;
    expect(kept.logs).toBeDefined();
  }, 20_000);
});

/**
 * Who is on a conversation, before the agent has said anything in it.
 *
 * A claim was read off the thread — whoever spoke in it first — which is right
 * once somebody has spoken and answers nothing for the minutes before that.
 * Those minutes are exactly when a reader is watching to see what is happening:
 * the mark in the margin carries the agent's face and its state, and with no
 * owner there was no face, no name in the thread, and nothing on screen tying
 * the work to the tool doing it.
 */
describe("who has a conversation while the first turn is still running", () => {
  let bin: string;
  let repo: string;
  let path: string | undefined;

  beforeAll(() => {
    bin = mkdtempSync(join(tmpdir(), "odin-slow-bin-"));
    repo = mkdtempSync(join(tmpdir(), "odin-slow-repo-"));
    const file = join(bin, "claude");
    // Slow on purpose: the window this is about is the one between being asked
    // and answering, and a tool that answers instantly has no such window.
    writeFileSync(
      file,
      '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "claude 1"; exit 0; fi\n' +
        'sleep 2\nfor a in "$@"; do p="$a"; done\necho "CLAUDE SAYS: $p"\n',
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

  it("names the agent that took it, not the one that has spoken", async () => {
    const store = memento();
    const paired = new PairingSession(store as never, "k", repo, () => {});
    await paired.look();
    paired.setOrder(["claude"]);

    const said = paired.ask({
      path: "src/one.ts",
      line: 12,
      side: "RIGHT" as const,
      author: "marco",
      body: "rename this",
    });

    // Mid-turn: the agent is working and has written nothing into the thread.
    await until(() => paired.busy().includes("claude"));
    expect(paired.local().some((comment) => comment.agent)).toBe(false);
    expect(paired.owners()[said.id]).toBe("claude");

    // And once it has answered, the thread's own account takes over — same
    // answer, arrived at the other way.
    await until(() => paired.local().some((comment) => comment.agent), 12_000);
    expect(paired.owners()[said.id]).toBe("claude");
  }, 30_000);
});
