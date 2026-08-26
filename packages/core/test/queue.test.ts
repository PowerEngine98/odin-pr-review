import { describe, expect, it } from "vitest";

import {
  addressedTo,
  assign,
  ownerOf,
  takerOf,
  type AgentState,
  type Ask,
} from "../src/agents/queue.js";
import { promptFor } from "../src/agents/run.js";

const NAMES = [
  { id: "claude", name: "Claude" },
  { id: "codex", name: "Codex" },
  { id: "gemini", name: "Gemini" },
];

const ask = (id: string, body: string, at: string, addressee?: string): Ask => ({
  id,
  body,
  at,
  ...(addressee ? { addressee } : {}),
});

const busy = (...ids: string[]): Map<string, AgentState> =>
  new Map(ids.map((id) => [id, "working" as AgentState]));

describe("naming an agent in a comment", () => {
  it("finds the one that was named", () => {
    expect(addressedTo("@Codex can you take this?", NAMES)).toBe("codex");
  });

  it("does not care how it was capitalised", () => {
    // Nobody capitalises consistently in a comment, and refusing to match
    // teaches an inconsistency rather than a rule.
    expect(addressedTo("hey @claude, look at this", NAMES)).toBe("claude");
  });

  it("takes the first one named", () => {
    expect(addressedTo("@Gemini and @Codex, together", NAMES)).toBe("gemini");
  });

  it("is not fooled by a longer name that starts the same", () => {
    expect(addressedTo("ask @codex-bot about it", NAMES)).toBeUndefined();
  });

  it("is not fooled by an email address", () => {
    expect(addressedTo("mail ada@claude.example about it", NAMES)).toBeUndefined();
  });

  it("says nobody when nobody was named", () => {
    expect(addressedTo("this needs a test", NAMES)).toBeUndefined();
  });

  it("only matches agents that could actually answer", () => {
    // `@Codex` is an address while Codex is switched on and a word otherwise.
    expect(addressedTo("@Codex please", [{ id: "claude", name: "Claude" }]))
      .toBeUndefined();
  });
});

describe("who takes the next message", () => {
  const order = ["claude", "codex", "gemini"];

  it("gives it to the one at the top", () => {
    expect(takerOf(ask("1", "go", "t1"), order, new Map())).toBe("claude");
  });

  it("passes over one that is already working", () => {
    expect(takerOf(ask("1", "go", "t1"), order, busy("claude"))).toBe("codex");
  });

  it("holds it when everyone is working", () => {
    expect(takerOf(ask("1", "go", "t1"), order, busy(...order))).toBeUndefined();
  });

  it("gives an addressed message to the agent it names", () => {
    // Whatever its priority, and however many agents above it are free: being
    // asked directly is the reader overriding the order.
    const taker = takerOf(ask("1", "@Gemini go", "t1", "gemini"), order, new Map());
    expect(taker).toBe("gemini");
  });

  it("makes an addressed message wait rather than handing it on", () => {
    // An address answered by somebody else would make naming an agent
    // pointless.
    expect(takerOf(ask("1", "@Codex go", "t1", "codex"), order, busy("codex")))
      .toBeUndefined();
  });

  it("gives nothing to an agent that has been switched off", () => {
    expect(takerOf(ask("1", "@Gemini go", "t1", "gemini"), ["claude"], new Map()))
      .toBeUndefined();
  });
});

describe("handing out everything that is waiting", () => {
  const order = ["claude", "codex"];

  it("goes in the order the messages landed", () => {
    const out = assign(
      [ask("2", "second", "t2"), ask("1", "first", "t1")],
      order,
      new Map(),
    );
    expect(out.map((a) => [a.ask.id, a.agent])).toEqual([
      ["1", "claude"],
      ["2", "codex"],
    ]);
  });

  it("never gives one agent two messages at once", () => {
    const out = assign([ask("1", "a", "t1"), ask("2", "b", "t2")], ["claude"], new Map());
    expect(out).toHaveLength(1);
    expect(out[0]?.ask.id).toBe("1");
  });

  it("does not let a blocked message hold up the ones behind it", () => {
    /*
     * An ask addressed to a busy agent would otherwise stop the whole queue
     * while every other agent sat idle. It keeps its place — it is simply not
     * the only thing considered.
     */
    const out = assign(
      [ask("1", "@Codex go", "t1", "codex"), ask("2", "anyone", "t2")],
      order,
      busy("codex"),
    );
    expect(out.map((a) => [a.ask.id, a.agent])).toEqual([["2", "claude"]]);
  });

  it("hands out nothing when nobody is switched on", () => {
    expect(assign([ask("1", "go", "t1")], [], new Map())).toEqual([]);
  });
});

describe("what an agent is told", () => {
  it("names the others, so it knows who else may answer", () => {
    const prompt = promptFor({
      agent: "Claude",
      said: [],
      ask: "add a test",
      others: ["Codex", "Gemini"],
    });
    expect(prompt).toContain("Codex, Gemini");
  });

  it("says so plainly when it is working alone", () => {
    const prompt = promptFor({ agent: "Claude", said: [], ask: "go", others: [] });
    expect(prompt).toContain("you are the only one");
  });

  it("carries the thread, so two agents do not do the same work", () => {
    const prompt = promptFor({
      agent: "Codex",
      place: "src/one.ts:12",
      said: [
        { author: "marco", body: "this needs a test" },
        { author: "Claude", body: "On it" },
      ],
      ask: "and the edge case",
      others: ["Claude"],
    });
    expect(prompt).toContain("Claude: On it");
    expect(prompt).toContain("src/one.ts:12");
    // What makes a claim mean something is no longer an instruction to notice
    // one — that was left to the agent to read out of a transcript and get
    // right. The ordering enforces it, and the prompt states it outright; both
    // are checked under "claiming a conversation".
  });
});

/**
 * Who owns a conversation once one is under way.
 *
 * A follow-up belongs to whoever took the first message: it has the thread in
 * mind, it made whatever changes are on disk, and "and the edge case too" is
 * addressed to it rather than to the room. Handing that to a different agent
 * produces two of them working the same files from different assumptions.
 */
describe("claiming a conversation", () => {
  const order = ["claude", "codex"];

  it("is whoever spoke first", () => {
    expect(
      ownerOf([
        { createdAt: "t1" },
        { agent: "codex", createdAt: "t2" },
        { agent: "claude", createdAt: "t3" },
      ]),
    ).toBe("codex");
  });

  it("is nobody until an agent has spoken", () => {
    expect(ownerOf([{ createdAt: "t1" }, { createdAt: "t2" }])).toBeUndefined();
  });

  it("does not depend on the order the messages arrived in", () => {
    // The list is whatever the store happens to hold. Time is the fact.
    expect(
      ownerOf([
        { agent: "claude", createdAt: "t9" },
        { agent: "codex", createdAt: "t2" },
      ]),
    ).toBe("codex");
  });

  it("sends the follow-up to the agent that claimed it", () => {
    const follow = ask("2", "and the edge case", "t2", undefined);
    follow.owner = "codex";
    // Claude is free and higher in the order. It still does not get this one.
    expect(takerOf(follow, order, new Map())).toBe("codex");
  });

  it("waits for the owner rather than handing the thread on", () => {
    /*
     * The expensive failure. Two agents in one thread, editing the same files,
     * each with a different picture of what has already been done — and the
     * reader finding out from the diff.
     */
    const follow = ask("2", "and the edge case", "t2");
    follow.owner = "codex";
    expect(takerOf(follow, order, busy("codex"))).toBeUndefined();
  });

  it("lets the reader override a claim by naming somebody", () => {
    // The one authority above the agents. Naming Claude in a thread Codex owns
    // means Claude, whatever the ordering would otherwise say.
    const follow = ask("2", "@Claude take this instead", "t2", "claude");
    follow.owner = "codex";
    expect(takerOf(follow, order, new Map())).toBe("claude");
  });

  it("does not hold a thread hostage to an agent that was switched off", () => {
    // The owner cannot answer at all any more. Waiting for it would mean the
    // conversation never moves again, with nothing saying why.
    const follow = ask("2", "carry on", "t2");
    follow.owner = "gemini";
    expect(takerOf(follow, order, new Map())).toBe("claude");
  });

  it("still refuses when the agent that was named is switched off", () => {
    // Different from an owner: naming somebody is a decision about who, and
    // silently substituting another agent overrides the reader rather than the
    // ordering.
    const named = ask("2", "@Gemini go", "t2", "gemini");
    expect(takerOf(named, order, new Map())).toBeUndefined();
  });
});

describe("what an agent is told about a claim", () => {
  it("says the thread is its own when it is", () => {
    const prompt = promptFor({
      agent: "Codex",
      said: [],
      ask: "carry on",
      others: ["Claude"],
      owner: "Codex",
    });
    expect(prompt).toContain("This thread is yours");
  });

  it("warns when it is walking into somebody else's work", () => {
    // Only reachable when the owner was switched off mid-conversation, and the
    // one case where an agent must not simply start.
    const prompt = promptFor({
      agent: "Claude",
      said: [],
      ask: "carry on",
      others: [],
      owner: "Codex",
    });
    expect(prompt).toContain("Codex claimed this thread");
    expect(prompt).toContain("do not redo work");
  });

  it("says nothing about ownership when nobody has claimed it", () => {
    const prompt = promptFor({ agent: "Claude", said: [], ask: "go", others: [] });
    expect(prompt).not.toContain("claimed this thread");
    expect(prompt).not.toContain("This thread is yours");
  });

  it("says they share one working tree", () => {
    // Two agents editing the same checkout is the situation, not a hazard to
    // be avoided — but only if each says what it touched.
    const prompt = promptFor({ agent: "Claude", said: [], ask: "go", others: ["Codex"] });
    expect(prompt).toContain("one working tree");
  });
});
