# Odin for GitHub

A browser extension that adds an **Odin** tab to GitHub:

- **On a pull request**, the tab is first in the bar beside Overview and Files
  changed, and draws the pull request as Odin's change graph.
- **On a repository**, the tab is beside Pull requests and opens the pull
  request list from Odin's VS Code sidebar.

## How it works

| File | What it does |
| --- | --- |
| `src/content.ts` | Adds the tabs to GitHub's own tab bars (both the current `UnderlineNav` and the older `TabNav`), and opens the Odin view below them. The URL gets `#odin`, so reloading or sharing the link reopens it. |
| `src/viewer.ts` | An extension page, framed into GitHub. It reads the pull request and its diff, or the pull request list, from `api.github.com`. |
| `src/page.ts`, `src/picker.ts` | Build Odin's page and sidebar with `@odin/core`, `@odin/highlight` and `@odin/webview`, the same code the editor uses. |
| `src/sandbox.ts` | Shows the page. Odin's page runs inline scripts, which only a manifest sandbox page may do. The sandbox has no storage of its own, so the page's `localStorage` is relayed to `chrome.storage`. |
| `src/sources.ts`, `src/bridge.ts`, `src/compute/` | Where a graph comes from: GitHub alone, Odin for VS Code over the local bridge, or the repository unpacked into memory (`vfs.ts`, `tar.ts`) with TypeScript running on a virtual `ts.sys` (`system.ts`). |
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
of the sidebar, or in the graph's settings) offers two ways to get them:

- **Sync with the VS Code extension.** The browser opens
  `vscode://powerengine98.odin-pr-review/connect` with a fresh token; VS Code
  asks whether to allow it, keeps the token in its secret storage, and serves
  graphs on `127.0.0.1` (ports 47920–47929) for any pull request whose
  repository is open there. Every request must carry the token and come from
  this extension's origin. If the link does not open VS Code, run
  **Odin: Connect the Browser Extension** there and paste the code the panel
  shows.
- **Compute data in browser.** The extension downloads the repository at the
  pull request's head (and merge base, for removed lines) from GitHub, keeps it
  in memory, and runs Odin's own resolvers on it, TypeScript compiler included.
  That code (3.6 MB) loads only when this is chosen.

Settings the browser cannot offer stay in the graph's settings, switched off,
with what it would take to have them.

## Limits

- GitHub refuses to send very large diffs; those pull requests show a message
- Chromium only for now. Firefox does not support manifest sandbox pages.
