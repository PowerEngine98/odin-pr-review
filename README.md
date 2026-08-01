# Odin PR Review

``He saw over all worlds and every man's activity and understood everything he saw.``

A new way of reviewing PRs by using graph visualization that match human intuition.

A pull request is a graph, not a list. Odin turns the diff between a branch and
its base into a change graph: every file is a vertex, every call-site reference
in the change is a directed edge, and the colour of an edge tells you whether
the change added that relationship or took it away.

## Quick start

```sh
yarn install
yarn build

# Human-readable overview
node packages/cli/dist/main.js graph --base main --resolve --summary

# The change graph as JSON
node packages/cli/dist/main.js graph --base main --resolve --out graph.json

# Other formats
node packages/cli/dist/main.js graph --base main --resolve --format mermaid
node packages/cli/dist/main.js graph --base main --resolve --format dot | dot -Tsvg > graph.svg
```

Try it against the built-in fixture, which reproduces the design sketch:

```sh
fixtures/make-demo-repo-ts.sh /tmp/odin-demo
node packages/cli/dist/main.js graph -C /tmp/odin-demo -b main -H feature/graph --resolve --summary
```

## How it works

The diff is taken from the **merge base**, not the tip of the base branch, so
the graph shows what the branch did rather than what happened on main in the
meantime.

Added and removed lines are resolved separately, against different checkouts.
A removed line does not exist in the working tree, so resolving it there would
be guesswork; instead the merge base is extracted into a temporary directory
with `git archive` and resolved against that. Reviewing a pull request never
mutates the repository being reviewed.

Edge colour comes from the line the call site sits on: a reference written on an
added line is an added reference, one written on a deleted line is a removed
reference. Targets that were never touched by the diff join the graph as
**phantom** vertices, drawn dimmed, so you can see what a change now depends on.

## Layout is deterministic on purpose

The same pull request must always produce the same picture. Node ids derive from
the file path, every collection has a canonical order, JSON keys have fixed
precedence, and the generation timestamp is opt-in. Identical inputs produce
byte-identical output. Anything else would move nodes around between runs and
destroy the spatial memory the tool exists to build.

## Packages

| Package | Role |
| --- | --- |
| `@odin/core` | Diff parsing, graph model, validation, exporters. No editor dependency. |
| `@odin/resolver-ts` | Reference resolution through the TypeScript compiler API. |
| `@odin/cli` | `odin graph` — build and render a change graph from the terminal. |

Reference resolution sits behind an interface, so the same graph can be produced
headlessly by the compiler API or inside the editor by a language server.

## Status

- [x] Change-graph model and reproducible JSON schema
- [x] Unified-diff parser (added, modified, deleted, renamed, binary)
- [x] Reference resolution for TypeScript and JavaScript, both sides of the diff
- [x] Phantom vertices for referenced-but-untouched files
- [x] Mermaid and Graphviz export
- [ ] Deterministic layout engine with line-level edge anchors
- [ ] Graph renderer: diff lines in cards, arrows between call site and definition
- [ ] VS Code extension: click an edge to jump to its destination
- [ ] Layout pinning so a file keeps its place across pushes

### Known gaps

- In a monorepo where packages import each other through built type
  declarations, cross-package edges are dropped: the definition resolves into a
  `.d.ts`, which the domain filter treats as third-party. Following declaration
  maps back to source would recover them.
- Only TypeScript and JavaScript resolve today. Other languages produce vertices
  but no edges until the editor-backed resolver lands.
