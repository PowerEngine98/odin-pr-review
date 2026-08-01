#!/usr/bin/env bash
#
# Regenerates every example under docs/examples from the TypeScript fixture.
#
# The output is committed, so a reviewer can see what the tool produces without
# running anything, and so an unintended change to the layout or the schema
# shows up as a diff. That only works because the pipeline is deterministic:
# rerunning this script on an unchanged tree must produce no diff at all.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/docs/examples"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

cd "$ROOT"
yarn --silent build

bash fixtures/make-demo-repo-ts.sh "$WORK/demo" >/dev/null
mkdir -p "$OUT"

odin() {
  node "$ROOT/packages/cli/dist/main.js" graph \
    -C "$WORK/demo" -b main -H feature/graph --resolve "$@"
}

odin --format json    -o "$OUT/graph.json"
odin --format svg     -o "$OUT/graph.svg"
odin --format mermaid -o "$OUT/graph.mmd"
odin --format dot     -o "$OUT/graph.dot"
odin --format html    -o "$OUT/graph.html"
odin --summary        -o "$OUT/summary.txt"

# The generated JSON records the repository it came from, which is a temporary
# directory. Blank it so the committed example is stable across machines.
node -e '
const fs = require("fs");
const path = process.argv[1];
const graph = JSON.parse(fs.readFileSync(path, "utf8"));
graph.meta.repo = "<fixture>";
fs.writeFileSync(path, JSON.stringify(graph, null, 2) + "\n");
' "$OUT/graph.json"

echo "examples written to docs/examples"
