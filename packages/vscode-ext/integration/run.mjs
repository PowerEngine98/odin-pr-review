import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { runTests } from "@vscode/test-electron";

/**
 * Launches VS Code against the built extension and runs the suite inside it.
 *
 * Prefers the copy already installed on this machine so a test run does not
 * download an editor. `--disable-workspace-trust` matters: Odin declares that
 * it does not support untrusted workspaces, so without it the extension would
 * be disabled and every assertion would fail for the wrong reason.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const EXTENSION_ROOT = join(HERE, "..");
const REPO_ROOT = join(EXTENSION_ROOT, "..", "..");

const INSTALLED =
  "/Applications/Visual Studio Code.app/Contents/MacOS/Electron";

const workspace = mkdtempSync(join(tmpdir(), "odin-it-"));

try {
  execFileSync(
    "bash",
    [join(REPO_ROOT, "fixtures", "make-demo-repo-ts.sh"), workspace],
    { cwd: REPO_ROOT, stdio: "inherit" },
  );

  await runTests({
    ...(existsSync(INSTALLED) ? { vscodeExecutablePath: INSTALLED } : {}),
    extensionDevelopmentPath: EXTENSION_ROOT,
    extensionTestsPath: join(HERE, "suite.cjs"),
    launchArgs: [
      workspace,
      "--disable-workspace-trust",
      "--disable-extensions",
      "--skip-welcome",
      "--skip-release-notes",
      "--no-sandbox",
    ],
  });

  console.log("integration suite passed");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
