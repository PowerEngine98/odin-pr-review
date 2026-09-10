import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * The seam between the ledger and the console it lives in.
 *
 * The arithmetic is tested in core, against the shapes the tools actually
 * emit; the recording and the outdated mark are tested in the extension,
 * against a real file that a real edit moved. What is left is the wiring, and
 * a component cannot be rendered in this suite — so the source is what there is
 * to read, the same way the prop check reads it.
 *
 * Worth reading all the same. Every fault this file guards against is silent:
 * a page that draws a tab which shows nothing, or a list quietly reading the
 * wrong field of a state object that has two things called by nearly the same
 * name.
 */
const TERMINAL = new URL("../src/app/hud/Terminal.svelte", import.meta.url);
const LEDGER = new URL("../src/app/hud/Ledger.svelte", import.meta.url);
const STATE = new URL("../src/app/state.svelte.ts", import.meta.url);

function source(where: URL): string {
  return readFileSync(where, "utf8");
}

describe("the ledger inside an agent's console", () => {
  it("is mounted by the terminal, with the agent it is for", () => {
    const terminal = source(TERMINAL);
    expect(terminal).toContain('import Ledger from "./Ledger.svelte"');
    // The id, not the name. Two consoles can carry the same tool under
    // different conversations, and the entries are keyed on the id.
    expect(terminal).toContain("<Ledger agent={id} />");
  });

  it("opens on the log", () => {
    // Which is what somebody watching a turn wants. The ledger is read
    // afterwards, and opening on it answers a question nobody asked yet.
    expect(source(TERMINAL)).toContain('let tab = $state<"log" | "ledger">("log")');
  });

  it("counts every change on the tab, not this agent's share of them", () => {
    /*
     * The list is built from the file watcher and holds every change to the
     * checkout. A count of one tool's admitted edits above a list of every edit
     * would be two different facts wearing one number — and the smaller one is
     * always the wrong answer to "how much has moved".
     */
    const terminal = source(TERMINAL);
    expect(terminal).toContain("const wrote = $derived(ui.written)");
    expect(terminal).not.toContain("ui.written.filter");
  });
});

describe("which field the ledger reads", () => {
  it("reads the agents' edits, not the rebuild's own deltas", () => {
    /*
     * There are two things in `ui` a reasonable person would call deltas: what
     * moved on each card since the last drawing, and what the agents have
     * written. They were both called `deltas` for about ten minutes, and the
     * object literal simply kept the second one — which would have left the
     * rebuild's marks reading an array and the ledger reading a Map, both
     * silently.
     */
    const state = source(STATE);
    expect(state).toContain("written: [] as LedgerEntry[]");
    expect(state).toContain("deltas: new Map<string, Delta>()");

    const ledger = source(LEDGER);
    expect(ledger).toContain("$derived(ui.written)");
    expect(ledger).not.toMatch(/ui\.deltas\b/);
  });

  it("takes the whole list from the host rather than adding to it", () => {
    // An edit to one file can make an older entry about the same file untrue,
    // so the outdated marks are only right if the list arrives whole.
    expect(source(STATE)).toContain("ui.written = held as LedgerEntry[]");
  });
});

describe("pressing an entry", () => {
  it("goes to the line on the head side", () => {
    // An agent writes the branch, so the line it wrote is a line of the new
    // file. The base side holds what this entry replaced.
    expect(source(LEDGER)).toContain('travel.toLine?.(delta.path, delta.line, "head")');
  });

  it("does nothing when there is no line left to go to", () => {
    // A passage that has since been rewritten has nowhere to fly to. The row
    // says so and is disabled, rather than flying somewhere arbitrary.
    const ledger = source(LEDGER);
    expect(ledger).toContain("if (delta.line === undefined) return;");
    expect(ledger).toContain("disabled={delta.line === undefined}");
  });
});

describe("the order the changes are read in", () => {
  const ledger = readFileSync(
    new URL("../src/app/hud/Ledger.svelte", import.meta.url),
    "utf8",
  );

  it("is the order they happened in", () => {
    /*
     * A ledger is a sequence — this edit, then that one, then the one that
     * undid it. Read newest first that sequence runs backwards, which is a hard
     * way to follow what an afternoon did to a file.
     */
    expect(ledger).not.toContain(".reverse()");
  });

  it("keeps itself at the newest, unless the reader has scrolled away", () => {
    // With the newest at the end, a list that does not follow leaves the entry
    // somebody is waiting for just below the fold; one that follows while they
    // are reading further up cannot be read at all.
    expect(ledger).toContain("pane.scrollTop = pane.scrollHeight");
    expect(ledger).toContain("if (!pane || !following) return;");
  });
});

describe("reading a long ledger", () => {
  const ledger = readFileSync(
    new URL("../src/app/hud/Ledger.svelte", import.meta.url),
    "utf8",
  );

  it("draws a change only while it is somewhere near the view", () => {
    /*
     * A session leaves hundreds of entries, and each one is a diff to compute,
     * a table to build and a round trip to the host for its colours. Doing all
     * of that so the reader can look at six is most of a second of the page
     * doing nothing useful, every time another edit lands.
     */
    expect(ledger).toContain("use:watch={delta.id}");
    expect(ledger).toContain("{#if near.has(delta.id)}");
    // And it stops asking the host to colour what it is not drawing.
    expect(ledger).toContain("if (!near.has(delta.id)) continue;");
  });

  it("keeps the room a change will take while it is away", () => {
    // Otherwise the scrollbar lies and rows jump under the reader as they
    // arrive behind it.
    expect(ledger).toContain('class="entry-room"');
    expect(ledger).toContain("function roomFor(");
  });

  it("lets go of an entry that has left", () => {
    // The point of the exercise: what is off screen is not merely hidden.
    expect(ledger).toMatch(/destroy\(\): void \{[\s\S]{0,200}?eye\.disconnect\(\)/);
  });

  it("keeps the head in view while its own change scrolls past", () => {
    /*
     * Halfway down twenty rows of diff the reader has lost the two things that
     * make it mean anything: which file, and when. Sticky within its own entry,
     * so it leaves with the entry rather than piling up.
     */
    expect(ledger).toMatch(/\.entry-head \{[\s\S]{0,400}?position: sticky/);
    // And the entry cannot clip, or there is no scrollport to stick inside.
    expect(ledger).not.toMatch(/\.entry \{[\s\S]{0,400}?overflow: hidden/);
  });
});

describe("a head held at the top of the panel", () => {
  const ledger = readFileSync(
    new URL("../src/app/hud/Ledger.svelte", import.meta.url),
    "utf8",
  );

  it("has nothing showing above it", () => {
    /*
     * Padding is inside the scrollable area, so rows scrolled up into it stay
     * visible — a sticky head at `top: 0` had six pixels of somebody else's
     * code showing above it. The breathing space belongs to the first entry,
     * which scrolls away with it.
     */
    expect(ledger).toMatch(/\.ledger \{[\s\S]{0,700}?padding: 0 8px 10px/);
    expect(ledger).toContain(".entry:first-child { margin-top: 6px; }");
  });

  it("squares its corners while it is held", () => {
    // A rounded corner says the box begins here. Held against the top with its
    // own code running out from under it, rounding reads as a floating card and
    // leaves slivers of code showing where the curve cuts away.
    expect(ledger).toMatch(/\.entry-head\.held \{[\s\S]{0,120}?border-radius: 0/);
    expect(ledger).toContain("class:held={stuck.has(delta.id)}");
  });

  it("works out that it is held rather than being told", () => {
    /*
     * There is no way to ask an element whether it is stuck: the state exists
     * in the layout and nowhere in the DOM. A hairline is put where the head
     * would sit if it were not, and the head is held exactly when that hairline
     * has gone off the top.
     */
    expect(ledger).toContain("use:pin={delta.id}");
    expect(ledger).toContain("seen.boundingClientRect.top < 0");
  });
});
