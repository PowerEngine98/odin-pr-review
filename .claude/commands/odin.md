---
description: Render the current branch as a change graph and print the URL to open
---

Render the change under review as a graph and give the user a URL.

$ARGUMENTS may name a branch, a base, a repository path, or nothing at all.

1. Make sure `odin` is available. If it is not, follow the **odin-setup** skill
   rather than guessing at a build.
2. Run `odin graph --summary` first and read it. It is a few lines and it tells
   you what the change is.
3. Run `odin view` (adding `-b`, `-H` or `-C` if the arguments call for it).
4. Reply with the URL and one sentence about the shape of the change — how many
   files, and what the arrows say about where it reaches. Do not narrate the
   picture; they are about to look at it.

If the working tree is dirty and a checkout would be needed, stop and say so.
Do not switch branches on the user's behalf.
