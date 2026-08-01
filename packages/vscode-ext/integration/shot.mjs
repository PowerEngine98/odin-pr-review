import { execFileSync } from "node:child_process";
import { runTests } from "@vscode/test-electron";
const SP = process.env.SP;
await runTests({
  vscodeExecutablePath: "/Applications/Visual Studio Code.app/Contents/MacOS/Electron",
  extensionDevelopmentPath: `${process.env.ROOT}/packages/vscode-ext`,
  extensionTestsPath: `${process.env.ROOT}/packages/vscode-ext/integration/shot-suite.cjs`,
  launchArgs: [`${SP}/icon-demo`, "--disable-workspace-trust", "--disable-extensions",
               "--skip-welcome", "--skip-release-notes", "--no-sandbox"],
});
