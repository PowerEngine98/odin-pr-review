import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(__dirname, "../..", path), "utf8");

describe("the Odin log, for the reader and for a report", () => {
  it("is kept in memory as it is written, the last two thousand lines", () => {
    const log = read("vscode-ext/src/log.ts");
    expect(log).toMatch(/const KEPT = 2000;/);
    expect(log).toMatch(/lines\.push\(stamped\);/);
    expect(log).toMatch(/export function logText\(last = KEPT\): string/);
  });

  it("is handed to the page both as written and anonymized with every name Odin knows", () => {
    const panel = read("vscode-ext/src/panel.ts");
    expect(panel).toMatch(/if \(reply\.type === "odinLog"\) \{\s*void this\.panel\.webview\.postMessage\(\{ type: "odinLog", raw: logText\(\), clean: GraphPanel\.cleanLog\(\) \}\);/);
    expect(panel).toMatch(/return anonymize\(logText\(last\), GraphPanel\.secrets\?\.\(\) \?\? \{\}\);/);
    const extension = read("vscode-ext/src/extension.ts");
    expect(extension).toMatch(/GraphPanel\.secrets = \(\) => secretsKnown\(\);/);
    expect(extension).toMatch(/function secretsKnown\(\): Secrets \{[\s\S]*?home: homedir\(\),[\s\S]*?repos:[\s\S]*?names:[\s\S]*?titles:[\s\S]*?branches:[\s\S]*?logins:/);
  });

  it("goes with a report, anonymized and folded away, only when the reader leaves it ticked", () => {
    const panel = read("vscode-ext/src/panel.ts");
    expect(panel).toMatch(/const logged = payload\.attachLog \? GraphPanel\.cleanLog\(400\)\.slice\(-40_000\) : "";/);
    expect(panel).toMatch(/<details><summary>Odin log \(anonymized\)<\/summary>/);
    const modal = read("webview/src/app/support/SupportModal.svelte");
    expect(modal).toMatch(/let attachLog = \$state\(true\);/);
    expect(modal).toMatch(/notify\("supportIssue", \{ kind, title: title\.trim\(\), body: body\.trim\(\), attachLog,/);
    expect(modal).toMatch(/onclick=\{\(\) => openLog\(true\)\}>See what is sent<\/button>/);
  });

  it("opens from Settings in a modal that scrolls, switches between anonymized and actual, and copies", () => {
    const settings = read("webview/src/app/chrome/Settings.svelte");
    expect(settings).toMatch(/openLog\(\);[\s\S]*?<span class="settings-support-name">Odin log<\/span>/);
    const modal = read("webview/src/app/support/LogModal.svelte");
    expect(modal).toMatch(/const shown = \$derived\(odinLog\.clean \? odinLog\.anonymized : odinLog\.raw\);/);
    expect(modal).toMatch(/notify\("copyText", \{\s*text: shown,/);
    expect(modal).toMatch(/\.log-body \{[\s\S]*?overflow: auto;/);
    const app = read("webview/src/app/App.svelte");
    expect(app).toMatch(/\{#if odinLog\.open\}\s*<LogModal \/>\s*\{\/if\}/);
  });
});
