import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { KNOWN_AGENTS } from "@odin/core";

import { cliArgs } from "../src/cli.js";

const claude = KNOWN_AGENTS.find((one) => one.id === "claude")!;

describe("Odin's own tools, tour_read and tour_update among them", () => {
  it("can be handed to Claude without making Odin its permission prompt", () => {
    expect(claude.serves?.("/tmp/odin/mcp.json")).toEqual(["--mcp-config", "/tmp/odin/mcp.json"]);
    expect(claude.asks?.("/tmp/odin/mcp.json")).toContain("--permission-prompt-tool");
  });

  it("reach an agent on every rung, Full included, and the CLI as well", () => {
    const pairing = readFileSync(join(__dirname, "../src/pairing.ts"), "utf8");
    const cli = readFileSync(join(__dirname, "../src/cli.ts"), "utf8");
    const panel = readFileSync(join(__dirname, "../src/panel.ts"), "utf8");
    expect(pairing).toMatch(/const asking = this\.toolsFor\(agentId, this\.agencyOf\(agentId\) !== "full"\);/);
    expect(pairing).toMatch(/if \(asks && kind\.asks\) return kind\.asks\(this\.configFor\(kind\)\);\s*return kind\.serves \? kind\.serves\(this\.configFor\(kind\)\) : \[\];/);
    expect(cli).toMatch(/const args = \[\s*\.\.\.cliArgs\(kind, conversation, started\),\s*\.\.\.\(this\.host\.tools\?\.\(agent\) \?\? \[\]\),/);
    expect(panel).toMatch(/tools: \(agent\) => this\.pairing\(\)\.toolsFor\(agent\),/);
  });

  it("leave the conversation arguments as they were", () => {
    expect(cliArgs(claude, "abc")).toEqual(["--resume", "abc"]);
  });
});
