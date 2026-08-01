---
name: odin-review
description: Read the review comments on a pull request, and post line comments, suggestions or a verdict through the GitHub CLI. Use when asked to review a PR, leave feedback on specific lines, suggest a change, approve, or request changes.
---

# Reviewing from the command line

Everything here goes through `gh`, so it acts as whoever is authenticated. Check
first — `gh auth status` — and never try to authenticate on the user's behalf.

## The rule that matters

**A review is visible to the whole team and cannot be taken back from here.**

- Never submit without the user having asked for that specific verdict in this
  conversation. "Review this PR" is a request to read it and report, not to
  post anything.
- Never approve unless the user said to approve. Approving is a signature.
- Always `--dry-run` first, show the payload, and wait for a yes.
- One malformed comment fails the **entire** review, taking every other remark
  with it. The dry run is where that gets caught.

## Reading what is already there

```bash
odin comments                          # for the branch you are on
odin comments --number 140             # a particular pull request
odin comments --json                   # for processing
```

Comments print as `path:line`, or `path:start-end` for a span, with the author
and the body indented under it. Ones marked `outdated` were written against code
that has since moved; they show where they were written, which is more use than
dropping them.

Read these before writing anything. Repeating a remark someone already made is
the fastest way to waste a reviewer's afternoon.

## Writing

A review is one verdict carrying any number of line comments — one notification,
not one per remark.

```bash
odin review --event comment --body "a pass over the media flow" \
  --comment "src/dao/LaborDao.kt:180-185:this reads twice: fold it" \
  --comment "src/api/Routes.kt:13:one line here" \
  --dry-run
```

- `path:line:message` for a line, `path:start-end:message` for a passage.
- The message is everything after the second colon, so prose may contain colons.
- Comments land on the head side of the change. For the base side, or for
  bodies with newlines, use a file:

```bash
odin review --event comment --body "..." --comments remarks.json --dry-run
```

```json
[
  { "path": "src/Dao.kt", "line": 185, "startLine": 180, "body": "fold this" },
  { "path": "src/Old.kt", "line": 12, "side": "LEFT", "body": "why was this removed?" }
]
```

`--body` is required for `comment` and `request-changes`; the forge rejects them
without it.

## Suggestions

A suggestion is an ordinary comment whose body is a fenced `suggestion` block.
GitHub turns it into a one-click change, so the code inside must be the complete
replacement for the lines the comment covers — a span replaces the whole span.

````
--comment 'src/App.kt:12-14:```suggestion
val x = compute()
```'
````

Get the indentation right. A suggestion applies literally.

## Verdicts

```bash
odin approve                                  # body optional
odin approve --body "reads well"
odin request-changes --body "the media flow needs another pass"
odin review --event comment --body "notes below"
```

All three accept `--comment` and `--comments`, so the remarks go out attached to
the verdict that justifies them.

## After submitting

Say plainly what went out: the verdict, the pull request number, and how many
line comments. If the command failed, show the error — a failed post that reads
as success leaves the user believing they have said something they have not.

## What this cannot do

Replying inside an existing thread, and resolving threads. Those are not
exposed; do them in the browser and say so rather than approximating them with a
new top-level comment.
