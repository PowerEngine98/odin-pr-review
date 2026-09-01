import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * Whether a conversation is finished with, said on every row.
 *
 * A hundred and eighty-five threads with a tick on some of them says nothing
 * about the rest: they could be open, or they could be rows the tick has not
 * been drawn on. So there are two marks and every row wears one — a grey clock
 * while it waits, a green tick once it is settled.
 *
 * The behaviour was measured in a browser: two comments posted to the page, one
 * carrying `resolved`, gave two rows, one `Not resolved` and one `Resolved`,
 * with nothing on window.onerror. What is read here is the part that would go
 * quietly wrong afterwards — a state drawn in one place and not the other, or a
 * button that names a state without offering to change it.
 */
const read = (file: string) =>
  readFileSync(new URL(file, import.meta.url), "utf8");

const list = read("../src/app/panels/Reviewers.svelte");
const panel = read("../src/app/panels/Thread.svelte");

describe("a conversation's state in the list of threads", () => {
  it("draws a mark either way, never a blank", () => {
    expect(list).toMatch(/\{#if thread\.root\.resolved\}[\s\S]*\{:else\}[\s\S]*\{\/if\}/);
    expect(list).toContain('aria-label="Resolved"');
    expect(list).toContain('aria-label="Not resolved"');
  });

  it("says which is which to a reader who cannot see the colour", () => {
    // The two icons differ by shape as well as by colour — a tick and a clock —
    // but the only thing a screen reader gets is the label.
    expect(list).toContain('title="Resolved"');
    expect(list).toContain('title="Not resolved"');
  });

  it("keeps the waiting one quiet", () => {
    /*
     * Grey rather than amber. Most threads on a large review are open, and a
     * column of warnings would make an ordinary review look like a failing one.
     */
    expect(list).toMatch(/\.waiting\s*\{[^}]*var\(--muted\)/);
    expect(list).toMatch(/\.settled\s*\{[^}]*var\(--added\)/);
  });
});

describe("a conversation's state in the thread itself", () => {
  it("is a button, so reading it and changing it are one control", () => {
    expect(panel).toContain('class="thread-state"');
    expect(panel).toContain('notify("resolveThread"');
  });

  it("asks for the opposite of what it is showing", () => {
    // Pressing a tick opens the conversation again; pressing a clock settles
    // it. A button that asked for the state it already showed would do nothing
    // on every second press.
    expect(panel).toContain("resolved: thread.root.resolved !== true");
  });

  it("names the conversation by number, which is how the host keys them", () => {
    // The forge's ids are positive and this machine's are negative; a string of
    // either misses both when the host looks the conversation up.
    expect(panel).toContain("id: Number(thread.root.id)");
  });

  it("says what pressing it will do, not only what is true now", () => {
    expect(panel).toContain("Press to open it again");
    expect(panel).toContain("Press to mark it settled");
  });
});
