# Odin for GitHub

[Add it from the Chrome Web Store](https://chromewebstore.google.com/detail/odin-pr-review/jghenlmadcfkcmfmnlmegogfjbbeafci) (Chrome, Edge, Brave, Opera).

A browser extension that adds a **Graph** tab to GitHub:

- **Graph**, on a pull request: first in the bar beside Overview and Files
  changed, it draws the pull request as Odin's change graph.
- **Change graph**, on a repository: beside Pull requests, it opens the pull
  request list from Odin's VS Code sidebar.

## How it works

| File | What it does |
| --- | --- |
| `src/content.ts` | Adds the tabs to GitHub's own tab bars (both the current `UnderlineNav` and the older `TabNav`), and opens the Odin view below them. The URL gets `#odin`, so reloading or sharing the link reopens it. |
| `src/viewer.ts` | An extension page, framed into GitHub. It reads the pull request and its diff, or the pull request list, from `api.github.com`. |
| `src/page.ts`, `src/picker.ts` | Build Odin's page and sidebar with `@odin/core`, `@odin/highlight` and `@odin/webview`, the same code the editor uses. |
| `src/sandbox.ts` | Shows the page. Odin's page runs inline scripts, which only a manifest sandbox page may do. The sandbox has no storage of its own, so the page's `localStorage` is relayed to `chrome.storage`. |
| `src/sources.ts`, `src/bridge.ts`, `src/compute/` | Where a graph comes from: GitHub alone, Odin for VS Code over the local bridge, or the repository unpacked into memory (`vfs.ts`, `tar.ts`) with TypeScript running on a virtual `ts.sys` (`system.ts`). |
| `src/session.ts` | The synced reading: a stream of VS Code's pages and messages, and the page's messages sent back. |
| `build.mjs` | Bundles for the browser. Node built-ins are replaced by `src/shims`: the code paths that need git or a disk never run here, and the sha1 that names nodes is computed in JavaScript so ids match the editor's. |

## Build and load

```sh
yarn build                    # from the repository root
yarn package:browser          # dist/odin-pr-review-browser.zip
```

In Chrome, Edge or Brave, open `chrome://extensions`, turn on Developer mode,
choose **Load unpacked** and select `packages/browser-ext/dist/extension`.

## Enable all features

Out of the box the tab draws cards and diffs read straight from GitHub. Arrows
between files need the whole repository, so **Enable all features** (at the top
of the sidebar, or in the graph's settings) offers three modes:

| Mode | What you get | Needs |
| --- | --- | --- |
| **Sync with the VS Code extension** | Everything Odin does in the editor: arrows, AI pairing, guided tours, narration with the Kokoro voice, comments, reviews and checks | [Odin for VS Code](https://marketplace.visualstudio.com/items?itemName=powerengine98.odin-pr-review) running |
| **Compute data in browser** | Arrows, found by Odin's resolvers running in the browser | Nothing else; slower on large repositories |
| **Basic** | Cards and diffs | Nothing else |

Settings a mode cannot offer stay in the graph's settings, switched off, each
saying what it would take to have them.

### Sync with the VS Code extension

The GitHub tab becomes a second screen on Odin for VS Code. VS Code opens the
pull request as an ordinary reading, and the tab shows that same reading: every
page and message the editor's graph receives is streamed to the browser, and
everything you do in the browser goes back to VS Code. Agents, tours and voices
run in the editor, under your own accounts, exactly as they do there; a tour
made in either place plays in both, with its progress.

**Pairing.** The first time, the browser opens
`vscode://powerengine98.odin-pr-review/connect` with a fresh token. VS Code asks
whether to allow it and keeps the token in its secret storage. If the link does
not open VS Code, run **Odin: Connect the Browser Extension** there and paste
the code the panel shows. **Odin: Disconnect the Browser Extension** forgets
it.

**Finding the repository.** VS Code remembers which folders hold which GitHub
repositories, from the folders you open and the ones opened recently.

- One folder matches: VS Code reads the pull request from it and opens it in a
  window of its own.
- More than one matches: VS Code asks which, and remembers the choice.
- None matches: VS Code offers to clone the repository into a folder you
  choose, then opens it.

A pull request is read the way the editor's sidebar reads it: live when its
branch is the one checked out, from `origin/<branch>` otherwise, so tours and
conversations are the same ones the editor keeps.

**Security.** VS Code listens on `127.0.0.1` only (ports 47920–47929). Every
request must carry the paired token, come from this extension's origin, and name
`127.0.0.1` as its host.

### Compute data in browser

The extension downloads the repository at the pull request's head (and at the
merge base, for removed lines) from GitHub, keeps it in memory, and runs Odin's
own resolvers on it, TypeScript compiler included. That code (3.6 MB) loads
only when this mode is chosen.

## Limits

- GitHub refuses to send very large diffs; those pull requests show a message
  instead of a graph.
- Chromium only for now. Firefox does not support manifest sandbox pages.
- When synced, mermaid diagrams in tours are not drawn in the browser yet.
- Public repositories need no sign-in, up to 60 reads an hour. Private
  repositories need a fine-grained read-only token in the options.

## On GitHub, in depth

`packages/browser-ext` puts Odin into GitHub itself, the way Le Git Graph adds a
commits graph. It adds a tab, with a graph icon, in two places:

- **Graph**, on a pull request, first in the bar beside Overview, Commits,
  Checks and Files changed. It draws that pull request as the change graph,
  with the same renderer the editor uses.
- **Change graph**, on the repository, beside Pull requests. It opens the pull request list
  from the editor's sidebar: what is waiting on you first, filters for open,
  merged, closed and author. Choosing a pull request opens its graph.

The extension reads GitHub's API directly and builds the graph in the browser
from the pull request's diff, the same way `odin --patch-file` does. Public
repositories need no sign-in. Private ones, or more than 60 reads an hour, need
a fine-grained token with read-only *Pull requests* and *Contents* access, saved
in the extension's options.

That basic view has no arrows: they need the whole repository. **Enable all
features** offers two ways further:

- **Sync with the VS Code extension** makes the tab a second screen on Odin for
  VS Code: the editor reads the pull request and the browser shows that same
  reading, with arrows, AI pairing, guided tours, Kokoro narration, comments and
  reviews, all run by the editor. VS Code finds the repository among the folders
  it knows, asks when there is more than one, and offers to clone it when there
  is none.
- **Compute data in browser** downloads the repository from GitHub and runs
  Odin's resolvers in the browser, for arrows without the editor.

The sections above explain how pairing, the local bridge and its security work.

Each release attaches `odin-pr-review-browser.zip`. To try it in Chrome, Edge or
Brave: build with `yarn build` (or unzip a release), open `chrome://extensions`,
turn on Developer mode, choose **Load unpacked** and select
`packages/browser-ext/dist/extension`.
