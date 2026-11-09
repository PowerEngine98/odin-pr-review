---
name: odin-issues
description: Digest the open GitHub issues of this repository, cluster them by the area of the code they touch, and fix each cluster in one confident pull request that closes all of its issues. Use when asked to work through the issues, triage the /issues tab, fix reported bugs in bulk, or turn issues into PRs.
---

# Issues into a few confident pull requests

One pull request that fixes several things in the same area, each with a test
that proves it, beats ten scattered ones: one review, one release, one place
to look when something regresses. Scattered PRs also collide, because issues
about the same area touch the same files.

Everything goes through `gh`, as whoever is signed in. Check `gh auth status`
first and never sign in on the user's behalf.

## 1. Read every open issue, all the way

```bash
gh issue list --state open --limit 100 --json number,title,labels,author,createdAt,comments
gh issue view <n> --json title,body,labels,comments
```

- Read the body and every comment. The reporter's later comments often narrow
  the bug or say it went away.
- Issues filed from Odin's Support composer end with `Sent from Odin x.y.z`.
  That version tells you whether a fix already shipped since. Compare it
  with `git log --oneline v<that version>..main`.
- **Media is evidence, not decoration.** Attachments are
  `https://github.com/user-attachments/assets/...` links (older issues used
  `odin-attachments/...` branches with `?raw=true` links). Download videos into
  the job's temp folder and look at them:

  ```bash
  curl -sL -o rec.mov "<url>"
  ffmpeg -v error -i rec.mov -vf "fps=1/2,scale=640:-1,tile=3x4" -frames:v 1 sheet.png
  ```

  Then read `sheet.png`. A second sheet with `-ss <seconds>` covers the rest. Note
  what is on screen before and after the action the reporter describes.
- Labels: `bug`, `Suggestion`, `Ask for features`. Bugs come first. Suggestions
  and feature requests join a cluster only when they are small and sit in the
  same area as its bugs.

## 2. Find the cause before grouping

Grouping by symptom puts unrelated fixes in one PR. Group by **cause**.

For each issue, write down in one line:
- the cause, as a file and a mechanism, found by reading the code. A guess
  from the title is not a cause.
- your confidence: **sure** (you can name the line and reproduce or test it),
  **likely** (strong reading of the code, no reproduction), or **unclear**.

Areas, by package:

| Area | Where |
|---|---|
| Graph page (canvas, cards, settings, HUD, tours UI) | `packages/webview/src/app` |
| Editor host (panels, restore, agents, reviews, bridge server) | `packages/vscode-ext/src` |
| GitHub tab (content script, viewer, sync, token page) | `packages/browser-ext` |
| Graph building, git, gh, diff, references | `packages/core/src` |
| Release and store publishing | `.github/workflows`, `scripts` |

## 3. Cluster

- One cluster per area. Split it when it would hold two unrelated causes,
  and merge two clusters when one cause explains issues in both.
- Only **sure** and **likely** issues go into a PR. For an **unclear** issue,
  draft a comment that asks for what is missing: steps, version, a
  recording. Show the draft to the user before posting it.
- Show the user the plan before writing code, as a table: cluster → issues →
  cause → confidence → files. Keep going unless they object; the plan is for
  their information, not a gate.

## 4. Fix, one branch per cluster

```bash
git switch -c fix/<area>-issues-<n>-<m> origin/main
```

- Never push to `main`: a push there publishes a release to every store.
- Every issue gets a test that fails without its fix. Name it for the
  behaviour ("does not bring back another repository's reading"), not for the
  issue number.
- Keep the fix to the cause. If you notice a neighbouring bug, add it only
  when it sits in the same area and you are sure of it. Otherwise list it in the
  PR as a follow-up.
- Follow the repository's rules in the commit history and the user's standing
  preferences (no explanatory comments in code, flexbox over grid, generic
  names in tests).
- `yarn build`, `yarn typecheck` and `npx vitest run` must pass. A test that
  fails once and passes alone is flaky: rerun the suite before calling it
  green.

## 5. One pull request per cluster

```bash
git push -u origin <branch>
gh pr create --base main --title "fix(<area>): <what the reader will notice>" --body-file <file>
```

The body:

```markdown
Fixes #12, fixes #15, fixes #19

## What was wrong
One short paragraph per issue: the symptom the reporter saw, then the cause.

## The fix
What changed, per cause, and why it is the right place to change it.

## Tests
The test that pins each issue.

## Changelog

### Bug fixes

- One bullet per issue, written for someone using Odin, not for a reviewer.

### UI/UX · Quality of life · New features

- Only the groups that apply; delete the rest.

## Not included
Issues looked at and left out, with the reason (unclear, other area,
needs the reporter).
```

- One `Fixes #n` per issue, so merging closes them all.
- The `## Changelog` section is required: a check fails the PR without it,
  and the release reads it for the notes on GitHub, the Marketplace and Open
  VSX. Follow `.github/pull_request_template.md`.
- Do not merge. Merging releases to the Marketplace, Open VSX and the Chrome
  Web Store. Hand the PR links to the user.

## 6. Report

Tell the user:
- each PR with its link and the issues it closes;
- the issues left open and why;
- any comment you drafted for a reporter, unsent.
