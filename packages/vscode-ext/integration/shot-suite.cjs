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
  // A full-screen grab takes whatever is in front, which is not necessarily
  // the editor this suite just opened.
  try {
    execFileSync("osascript", ["-e", 'tell application "System Events" to set frontmost of first process whose unix id is ' + process.pid + ' to true']);
  } catch {
    execFileSync("osascript", ["-e", 'tell application "Visual Studio Code" to activate']);
  }
  await new Promise((r) => setTimeout(r, 1500));
  execFileSync("screencapture", ["-x", "-o", `${process.env.SP}/sidebar.png`]);
};
