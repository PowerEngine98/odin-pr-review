# Odin PR Review

Review a pull request as a graph. Every changed file is a card showing its diff
lines; every call-site reference in the change is an arrow leaving the exact
line that makes the call and landing on the exact line that defines it.

![The change graph](https://raw.githubusercontent.com/PowerEngine98/odin-pr-review/main/docs/interactive.png)

## Commands

| Command | What it does |
| --- | --- |
| **Odin: Review Pull Request as a Graph** | Builds the graph against the configured base branch |
| **Odin: Review Against a Different Base…** | Picks a base branch from the repository |
| **Odin: Export Change Graph as JSON** | Opens the underlying document |

## Reading the graph

Card outlines say what happened to a file: green added, red deleted, blue
renamed, grey dashed for a file that was never touched but is now referenced.
Arrow colour says what happened to the reference — green if the change
introduced it, red if the change removed it.

Click an arrow to follow it. The destination opens beside the graph without
taking focus, so you can trace a change without losing your place. A removed
reference points at code that no longer exists in your working tree; that opens
as a read-only view of the file as it was at the merge base.

⌘/Ctrl-click a filename to open it as a diff against the base.

## How it compares

The diff is taken from the **merge base**, not the tip of the base branch, so
you see what the branch did rather than what landed on `main` in the meantime.

Added and removed lines are resolved against different checkouts, because a
removed line does not exist in your working tree. Reviewing never modifies the
repository: the base is extracted to a temporary directory, never a worktree.

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `odin.baseRef` | `main` | Branch to compare against |
| `odin.includeImports` | `true` | Draw arrows for import statements |
| `odin.includeContext` | `false` | Also resolve references on unchanged lines |

## Limitations

Reference resolution currently covers TypeScript and JavaScript. Files in other
languages appear as cards with their diff, but without arrows.

Large pull requests render every card at once; expect this to get heavy past a
few hundred files.
