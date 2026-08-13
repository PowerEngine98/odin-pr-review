import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      // The editor supplies this at runtime and nothing else can. A module with
      // a pure function in it — a page's markup, say — is worth testing on its
      // own, and without this the import alone fails before the function is
      // ever called. The bundle test still loads the real bundle against its
      // own recording stub; this is only for importing source directly.
      vscode: fileURLToPath(
        new URL("./packages/vscode-ext/test/vscode-stub.ts", import.meta.url),
      ),
    },
  },
});
