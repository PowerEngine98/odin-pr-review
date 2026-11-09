# Odin in VS Code, in depth

The feature tour is in the [extension's README](../packages/vscode-ext/README.md);
this is how each part behaves and why.

## The extension

Install the packaged build and review without leaving the editor:

```sh
code --install-extension dist/odin-pr-review-0.1.0.vsix
```


Before a graph exists, the sidebar lists the repository's open pull requests —
number, title, draft or open, review state, the author's face and how long ago
it last moved — with a filter box above them. What the forge is waiting on
**you** for comes first, under its own heading. Ordering is by activity rather
than by creation, falling back to creation within the same hour so a burst of
comments cannot reshuffle the list under you.

A pull request you have opened before and that has been pushed to since carries
a **new commits** chip: the forge goes on showing the verdict you left on a
commit that is no longer the head, and this is the only thing in the row that
says so. Pressing the chip opens only what was pushed since your last review.

A change can be read three ways, chosen from the clock button beside the
settings in the bar above the graph:

- **All changes** — the whole change, as it will be merged.
- **Since my last review** — only what the author pushed after your newest
  review on the forge, or, if you never left one, after the commit you last
  opened here. A branch rebased or force-pushed past that commit has no such
  point any more, so the whole change is shown and you are told why. Only
  offered for a pull request.
- **Uncommitted only** — only your edits on this machine that are not
  committed yet, new files included. It follows `HEAD`, so committing some of
  the work moves it out of the picture. Only offered for a branch this checkout
  holds.

The tab's title says which one you are reading — `(since abc1234)` or
`(uncommitted)` — so a narrower reading is never mistaken for the whole change.
From the command line, `odin graph --since <ref>` does the same.

Read whole, the files that also moved in the narrower view carry an orange dot:
on the corner of their card, travelling with its title bar as the card scrolls,
and at the end of their row in the sidebar. In a live reading the dot means
*not committed yet*; in a reading of a pull request's commits it means *changed
since your last review*. Inside the card, each line that moved gets an orange
edge on its right, the new side, and its sign and new line number turn orange,
while the left edge keeps its green or red, so work done on top of work can be
told apart from the rest of the branch.

Two more details:

- **Deleted lines.** Where lines were deleted in the narrower view, a thin
  orange line appears under the line just above where they were. The deleted
  lines themselves no longer exist in that reading.
- **On a pull request.** The same edge marks the lines changed since your last
  review.

One limit:

- **Branch lines deleted locally.** A line your commits added that you then
  deleted locally does not appear at all in *All changes*. It only shows as the
  thin line.

Clicking a row checks out its branch and builds the graph; the branch you are on
is marked down its left edge. Checking out refuses outright while the working
tree is dirty, since carrying uncommitted changes onto another branch is not a
decision to make on someone's behalf — and while the graph is being built, the
panel shows the mark, breathing, with the build's own progress under it.


A thread can be answered in place, reacted to with the forge's eight emoji, and
each remark carries its own menu: copy its link or its markdown, quote it into a
reply, and — on your own remarks only, since the forge would refuse anyone
else's — edit or delete it. Deleting asks first, because the forge has no undo
for it either. Everything is read back from the forge afterwards rather than
guessed at locally, so what you see is what is actually there, including
whatever someone else wrote while you were reading.

Comments already on the pull request appear beside the file rather than inside
it: the author's picture in the margin, at the height of the line it is about,
pointing back at it. A remark belongs to a line but is not part of the code, and
threading it through the diff pushes the code around to make room for something
the reader may not want to read yet. Clicking opens the thread under the mark,
with a count on the mark where a thread has more than one remark. Pictures are
inlined into the document, so a page that fetches nothing still shows them, and
an author whose picture could not be fetched gets their initials.

Comments already on the pull request are marked against the lines they belong
to. Clicking a line writes a new one, optionally as a suggestion; they collect
into a pending review rather than being posted one at a time, and go out
together as **Approve**, **Comment** or **Request changes** — behind a
confirmation that names the verdict, since a review is visible to everyone and
cannot be taken back from here.


The composer is pinned under the last line it is about, at that file's own left
edge, the way an inline comment box sits in a diff — a remark belongs to a
passage, and a box that floats where the cursor happened to be makes the reader
hold the connection in their head. It carries the forge's own furniture: Write
and Preview, the markdown buttons, and a primary that says *Start a review*
until there is one and *Add review comment* after. The same box writes a reply
and a review summary — a line comment, an answer and a verdict are one act with
three destinations, and giving two of them a bare textarea taught two habits for
one job. Preview renders headings, lists, task
lists, quotes, tables, rules, strikethrough and fenced code, and escapes
everything first — the text comes from a person and this page draws it, so
nothing typed can become markup by accident. A fenced block is coloured by the
same grammars and theme the cards use, so a Kotlin snippet in a remark looks
like the Kotlin in the file above it; the grammars live with the extension, so a
page opened from disk keeps the plain text instead.

The last button has no equivalent on the forge because it is ours: it opens a
suggestion block already filled with the lines being commented on. A suggestion
has to be the complete replacement for the lines it covers, and retyping them
from memory is how the wrong indentation gets in.

Only lines the forge can see accept a comment. A card also carries source Odin
fetched so that an arrow had somewhere to land, and the forge would refuse a
remark on one of those — after it had been written, which is the worst moment to
find out.

Most remarks are about a passage rather than a line, so a comment can cover
one: drag down the card, or click a line and shift-click another, and the
composer says which lines it is about in the forge's own notation — `R164–R166`
for the head side, `L` for the base. The pick is drawn the way a diff viewer
draws one — the lines washed, an edge down where the code starts, and a handle
at each end — and it survives cancelling the composer, since changing the
wording is not changing your mind about the lines. Escape or a click away
drops it. A comment already made is drawn as a single bracket down the margin
instead of a mark per line, and a suggestion written against a span replaces
the whole block. A suggestion previews as the change it is — the lines it
replaces above the lines it puts there, numbered where they sit in the file and
coloured by the file's own grammar — because a block of green with no idea what
it is replacing is half the story.

Closing a box keeps what is in it. A reviewer who shuts a composer to look at
the code again, or a thread to check another file, has not changed their mind
about the sentence they were half way through; the text comes back when the same
lines, the same thread or the same review is opened again, and only sending it
clears it. Comments already on the pull request keep their
own spans, including the ones the branch has since moved out from under.

Above the graph is the header the pull request has on the forge: its state, its
title and number, who is merging what into where, how much of it you have read,
and the button that sends the review. A reviewer arriving here has just come
from that page or is about to go back to it, and answering "what am I looking
at" in a second shape would mean learning a second shape for nothing. It renders
without a pull request too — a branch compared against another branch still has
an author, a commit count and two ref names. The forge half is asked of the `gh`
command line, so it inherits whatever authentication you already have, and its
absence changes nothing else. `--pr` does the same on the command line.

A filter box sits under the progress bar, and what matched is marked in the
editor's own highlight colour — every occurrence, not just the first, since a
path can carry the same word twice. A file matches on its path, a
reference on the symbol it resolves to and the file and line it lands in — so
searching a function name finds both the files that call it and the calls
themselves, with the matching file's references opened rather than left behind a
twisty. Folders follow their contents; an empty one is not a result.

Odin gets its own activity bar entry. The sidebar lists every changed file with
its status, and expands to show the references leaving it — the graph as a list,
for when a change is too large to take in visually or you just want to scan.
Clicking a file opens its diff; clicking a reference follows it.

Then run **Odin: Review Pull Request as a Graph** from the command palette, or
trigger it from anywhere with a link:

```sh
code --open-url "vscode://powerengine98.odin-pr-review/review?base=main"
```

The extension requires a trusted workspace. It runs git and type-checks your
files to resolve references, which is exactly what workspace trust exists to
gate, so it declares that plainly and stays disabled in Restricted Mode rather
than half-working.

Clicking an arrow opens its destination beside the graph without taking focus,
so you can trace a change without losing your place. A removed reference points
at code that is no longer in your working tree, so it opens as a read-only view
of the merge-base revision, served from git rather than written to disk.
⌘/Ctrl-click a filename to open it as a diff against the base.

| Setting | Default | Meaning |
| --- | --- | --- |
| `odin.baseRef` | `main` | Branch to compare against |
| `odin.includeImports` | `true` | Draw arrows for import statements |
| `odin.includeContext` | `false` | Also resolve references on unchanged lines |

The extension reuses the same compiler-API resolver the command line uses, so
the picture in the editor is the picture `odin graph` produces — which matters,
because the layout is meant to be something you remember.
