import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { assign, type Ask } from "@odin/core";

const pairing = readFileSync(join(__dirname, "../src/pairing.ts"), "utf8");
const panel = readFileSync(join(__dirname, "../src/panel.ts"), "utf8");
const terminal = readFileSync(join(__dirname, "../../webview/src/app/hud/Terminal.svelte"), "utf8");

describe("a queued message sent now", () => {
  it("is taken before everything that was waiting ahead of it", () => {
    const older: Ask = { id: "1", body: "rename Order", at: "2026-01-01T00:00:01.000Z" };
    const mine: Ask = { id: "2", body: "add a total", at: "2026-01-01T00:00:05.000Z", addressee: "claude" };
    mine.at = new Date(Date.parse(older.at) - 1).toISOString();
    const taken = assign([older, mine], ["claude"], new Map([["claude", "idle"]]));
    expect(taken[0]?.ask.id).toBe("2");
  });

  it("stops what its agent is doing, or types it into the agent's open CLI", () => {
    expect(pairing).toMatch(/ask\.at = new Date\(Date\.parse\(earliest\) - 1\)\.toISOString\(\);\s*if \(this\.state\.get\(target\) === "working"\) this\.stop\(target\);\s*else this\.pump\(\);/);
    expect(pairing).toMatch(/if \(this\.terminal\?\.holds\(target\)\) \{\s*this\.waiting = this\.waiting\.filter\(\(one\) => one !== ask\);\s*this\.handOff\(ask, target\);/);
    expect(panel).toMatch(/if \(agent\) this\.paired\?\.sendNow\(Number\(said\.id\), agent\);/);
    expect(terminal).toMatch(/onclick=\{\(\) => notify\("sendNow", \{ id: ask\.id, agent: id \}\)\}\s*>Send now<\/button>/);
  });

  it("shows all of what was written, and pictures large enough to tell apart", () => {
    expect(terminal).toMatch(/<span class="queued-what">\{saidOf\(ask\.body\)\}<\/span>/);
    expect(terminal).toMatch(/\.queued-what \{[^}]*white-space: pre-wrap;/);
    expect(terminal).toMatch(/\.queued-shot img \{\s*width: 64px;\s*height: 44px;/);
  });
});

describe("a queued message taken back to edit", () => {
  it("leaves the queue and comes back into the box below, text and pictures", () => {
    expect(terminal).toMatch(/onclick=\{\(\) => editQueued\(ask\)\}\s*>Edit<\/button>/);
    expect(terminal).toMatch(/notify\("cancelAsk", \{ id: ask\.id \}\);\s*const said = text\.trim\(\);\s*prompt = prompt\.trim\(\) \?/);
    expect(terminal).toMatch(/back\.push\(\{ id: \+\+nextImage, url, name: nameOf\(path\) \}\);/);
    expect(terminal).toMatch(/pasted = \[\.\.\.pasted, \.\.\.back\];\s*askBox\?\.focus\(\);/);
  });
});

describe("queued messages dragged into a new order", () => {
  it("are taken in the order they were dragged to", () => {
    const asks: Ask[] = [
      { id: "1", body: "rename Order", at: "2026-01-01T00:00:01.000Z" },
      { id: "2", body: "add a total", at: "2026-01-01T00:00:02.000Z" },
      { id: "3", body: "test the receipt", at: "2026-01-01T00:00:03.000Z" },
    ];
    const dragged = ["3", "1", "2"].map((id) => asks.find((one) => one.id === id)!);
    const times = dragged.map((one) => one.at).sort();
    dragged.forEach((one, at) => {
      one.at = times[at]!;
    });
    const order: string[] = [];
    let left = [...asks];
    while (left.length) {
      const [first] = assign(left, ["claude"], new Map([["claude", "idle"]]));
      order.push(first!.ask.id);
      left = left.filter((one) => one !== first!.ask);
    }
    expect(order).toEqual(["3", "1", "2"]);
  });

  it("are listed in the order they will be taken, and reordered by the same times the queue goes by", () => {
    expect(pairing).toMatch(/return \[\.\.\.this\.waiting\]\.sort\(\(a, b\) => a\.at\.localeCompare\(b\.at\)\)\.map/);
    expect(pairing).toMatch(/const times = moved\.map\(\(one\) => one\.at\)\.sort\(\);\s*moved\.forEach\(\(one, at\) => \{\s*one\.at = times\[at\]!;/);
    expect(panel).toMatch(/this\.paired\?\.reorder\(ids\);/);
    expect(terminal).toMatch(/draggable=\{waiting\.length > 1\}/);
    expect(terminal).toMatch(/ondrop=\{\(event\) => \{\s*event\.preventDefault\(\);\s*dropQueued\(ask\.id\);/);
    expect(terminal).toMatch(/notify\("reorderQueue", \{ ids \}\);/);
  });
});
