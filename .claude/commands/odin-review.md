---
description: Read a pull request's review comments, and draft feedback for the user to approve before it is sent
---

Review the pull request for the current branch, or the one named in
$ARGUMENTS.

1. `gh auth status` — if it fails, say so and stop. Do not authenticate for them.
2. `odin comments` — read what has already been said. Do not repeat it.
3. `odin graph --summary`, and `odin view` if the change is large enough that a
   picture helps.
4. Read the diff and form the remarks.
5. Build the review with `--dry-run`, show the payload, and **wait for the user
   to confirm**.

Never send without an explicit yes in this conversation, and never approve
unless the user asked for an approval specifically. A review is visible to the
whole team and cannot be taken back from here.

The full command surface, the comment syntax and the suggestion format are in
the **odin-review** skill.
