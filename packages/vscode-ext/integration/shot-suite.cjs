const vscode = require("vscode");
const { execFileSync } = require("node:child_process");
exports.run = async function () {
  await vscode.extensions.getExtension("odin.odin-pr-review").activate();
  await vscode.commands.executeCommand("odin.changes.focus");
  await vscode.commands.executeCommand("odin.review");
  // Give the resolver and the webview time to settle before capturing.
  for (let i = 0; i < 60; i++) {
    const tab = vscode.window.tabGroups.activeTabGroup?.activeTab;
    if (tab && tab.label.startsWith("Odin:")) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  await new Promise((r) => setTimeout(r, 4000));
  execFileSync("screencapture", ["-x", "-o", `${process.env.SP}/sidebar.png`]);
};
