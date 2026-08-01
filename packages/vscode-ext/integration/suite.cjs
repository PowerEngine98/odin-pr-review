/**
 * Runs inside a real extension host.
 *
 * Everything else about the extension can be checked headlessly, but "does the
 * command actually build a graph and open a panel in VS Code" cannot. This is
 * the only place that question gets answered, so it drives the command exactly
 * the way a reviewer would and asserts on what comes back.
 */
const assert = require("node:assert");
const vscode = require("vscode");

/** Fails the run if a condition does not become true in time. */
async function waitFor(label, predicate, timeoutMs = 120_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`timed out waiting for: ${label}`);
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test("the extension is present and activates", async () => {
  const extension = vscode.extensions.getExtension("odin.odin-pr-review");
  assert.ok(extension, "extension odin.odin-pr-review is not installed");
  await extension.activate();
  assert.ok(extension.isActive, "extension did not activate");
});

test("every declared command is registered", async () => {
  const commands = await vscode.commands.getCommands(true);
  for (const id of ["odin.review", "odin.reviewAgainst", "odin.exportGraph"]) {
    assert.ok(commands.includes(id), `command ${id} was never registered`);
  }
});

test("the workspace under test is trusted", () => {
  // Odin declares that it does not support untrusted workspaces, so it would
  // be silently disabled and every other assertion here would be meaningless.
  assert.strictEqual(vscode.workspace.isTrusted, true);
});

test("exporting produces a change graph for the fixture", async () => {
  await vscode.commands.executeCommand("odin.exportGraph");

  let document;
  await waitFor("the exported JSON document to open", () => {
    document = vscode.workspace.textDocuments.find(
      (d) => d.languageId === "json" && d.getText().includes("schemaVersion"),
    );
    return Boolean(document);
  });

  const graph = JSON.parse(document.getText());

  const byPath = Object.fromEntries(graph.nodes.map((n) => [n.path, n.status]));
  assert.strictEqual(byPath["src/addedFile.ts"], "added");
  assert.strictEqual(byPath["src/deletedFile.ts"], "deleted");
  assert.strictEqual(byPath["src/renamedFile.ts"], "renamed");
  assert.strictEqual(byPath["src/logger.ts"], "phantom");

  // The edge that only comes out right if each side is resolved against its
  // own checkout: one call site, two different targets. Scoped to the consumer,
  // since other files also happen to have a call on line 7.
  const consumer = graph.nodes.find((n) => n.path === "src/consumer.ts");
  const consumerEdges = graph.edges.filter(
    (e) => e.from.nodeId === consumer.id && e.from.line === 7,
  );
  const changes = consumerEdges.map((e) => `${e.change}:${e.to.symbolName}`).sort();
  assert.deepStrictEqual(changes, ["added:function3", "removed:function2"]);

  assert.ok(
    graph.edges.every((e) => e.confidence === "resolved"),
    "some edges were guessed rather than resolved",
  );
});

test("reviewing opens the graph panel", async () => {
  await vscode.commands.executeCommand("odin.review");
  await waitFor("the Odin panel to become the active tab", () => {
    const active = vscode.window.tabGroups.activeTabGroup?.activeTab;
    return Boolean(active && active.label.startsWith("Odin:"));
  });

  const label = vscode.window.tabGroups.activeTabGroup.activeTab.label;
  assert.match(label, /main → feature\/graph/,
    "the panel should name the branch under review, not \"HEAD\"");
});

exports.run = async function run() {
  const failures = [];
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`  ok  ${name}`);
    } catch (error) {
      failures.push(`${name}: ${error && error.message}`);
      console.error(`  FAIL  ${name}\n        ${error && error.stack}`);
    }
  }

  console.log(`\n${tests.length - failures.length}/${tests.length} passed`);
  if (failures.length > 0) {
    throw new Error(`${failures.length} integration test(s) failed`);
  }
};
