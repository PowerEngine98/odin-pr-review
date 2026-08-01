---
name: odin-graph
description: Render a pull request or branch as a change graph and get a local URL, or emit JSON/SVG/Mermaid/DOT for further processing. Use when asked to visualise a diff, see what a change touches, understand a PR's shape, or produce a reviewable picture of a branch.
---

# Rendering a change graph

Every changed file is a card showing its diff; every call site that crosses
files is an arrow. Files that nothing changed but something references appear
as dashed phantoms. The layout is deterministic — the same change always draws
the same picture, so a reader's memory of it stays worth something.

If `odin` is not installed, use the **odin-setup** skill first.

## The one command worth remembering

```bash
odin view                       # in the repository, on the branch under review
```

It prints a `file://` URL and nothing else. Open it, or hand it to the user.
`view` resolves references and looks up the pull request without being asked,
because a graph without arrows is not what anyone came for.

The file name comes from the repository and the branch pair, so re-running
replaces the same file and the URL stays stable. That is deliberate: a URL you
can send twice is worth more than a fresh temp name each run.

For a caller that cannot open `file://` — a browser in a container, a preview
pane:

```bash
odin view --serve 8791          # prints http://127.0.0.1:8791/ and stays up
odin view --serve               # any free port
```

Bound to loopback only. It serves one unpublished review; it is not for sharing.

## Choosing what goes in

```bash
odin view -b origin/main                  # name the base explicitly
odin view -H feature/thing                # a branch you are not standing on
odin view -C /path/to/repo                # another repository
odin view --tests                         # test files, hidden by default
odin view --imports                       # import arrows, off by default
odin view -- src/api                      # limit to pathspecs
```

The base is detected from the pull request or the default branch. Diffs are
taken against the **merge base**, not the branch tip, so unrelated commits on
the base do not appear as part of the change.

`--tests` and `--imports` matter less than they look: the page carries both
arrangements and has checkboxes for them. Set them only when producing a
non-interactive format.

## Other formats

`view` always writes HTML. For anything else use `graph`, which streams to
stdout:

```bash
odin graph --summary                      # a text digest — read this first
odin graph -f json -o graph.json          # the full change graph
odin graph -f json -r                     # with resolved edges
odin graph -f svg -o graph.svg            # static picture, no JavaScript
odin graph -f mermaid                     # paste into markdown
odin graph -f dot | dot -Tpng -o g.png
```

**`--summary` is the cheapest way to understand a change.** Read it before
rendering anything: it names the files, the counts, and the references, in a
few lines. Do not pipe a JSON graph into your own context to answer "what does
this PR touch" — the summary already answers it.

`graph -f json` is the intermediate representation. Everything else is derived
from it, so a graph captured once can be re-rendered without touching git.

## Reading a graph without a repository

```bash
odin graph -p change.patch -f summary     # a bare .patch file
```

Reference resolution needs a repository and will refuse here, which is correct:
resolving against the wrong tree would invent arrows.

## What to tell the user

Give them the URL and one sentence about the shape of the change. Do not
describe the picture at length — they are about to look at it.
