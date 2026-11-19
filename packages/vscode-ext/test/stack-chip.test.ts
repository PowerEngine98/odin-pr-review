import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(__dirname, "../..", path), "utf8");

describe("the stack beside a pull request's state", () => {
  it("is asked for by the bar and worked out by VS Code from the forge", () => {
    const stack = read("webview/src/app/chrome/stack.svelte.ts");
    expect(stack).toMatch(/notify\("askStack"\);/);
    const panel = read("vscode-ext/src/panel.ts");
    expect(panel).toMatch(/if \(reply\.type === "askStack"\) \{\s*void this\.sendStack\(\);/);
    expect(panel).toMatch(/pullStack\(\s*\{ number: pull\.number, head: pull\.headRefName, base: pull\.baseRefName \},/);
  });

  it("says where in the stack this one is, as n of m, with the stack icon", () => {
    const chip = read("webview/src/app/chrome/StackChip.svelte");
    expect(chip).toMatch(/\{position\}\/\{view\.pulls\.length\}/);
    expect(read("webview/src/app/chrome/PrBar.svelte")).toMatch(/<StackChip number=\{pull\.number\} \/>/);
  });

  it("lists the stack on hover with the side bar's own rows, top first, down to the base branch", () => {
    const chip = read("webview/src/app/chrome/StackChip.svelte");
    expect(chip).toMatch(/onmouseenter=\{enter\} onmouseleave=\{leave\}/);
    expect(chip).toMatch(/\[\.\.\.view\.pulls\]\.reverse\(\)/);
    expect(chip).toMatch(/<Pull pull=\{row\} \{send\} \/>/);
    expect(chip).toMatch(/<code>\{view\.base\}<\/code>/);
  });

  it("opens a pressed pull request of the stack in view mode", () => {
    const chip = read("webview/src/app/chrome/StackChip.svelte");
    expect(chip).toMatch(/notify\("stackRead", payload\);/);
    const extension = read("vscode-ext/src/extension.ts");
    expect(extension).toMatch(/GraphPanel\.onReadPull = \(number, where, pull\) => \{\s*if \(!known\.has\(number\)\) known\.set\(number, pull\);/);
    expect(extension).toMatch(/: "odin\.readOrigin";/);
  });

  it("uses the side bar's row everywhere by handing it what to send", () => {
    const pull = read("webview/src/app/sidebar/Pull.svelte");
    expect(pull).not.toMatch(/from "\.\/state\.svelte\.js"/);
    expect(read("webview/src/app/sidebar/Picker.svelte").match(/<Pull \{pull\} send=\{notify\} \/>/g)).toHaveLength(3);
  });
});
