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
| `build.mjs` | Bundles for the browser. Node built-ins are replaced by `src/shims`: the code paths that need git or a disk never run here, and the sha1 that names nodes is computed in JavaScript so ids match the editor's. |

## Build and load

```sh
yarn build                    # from the repository root
yarn package:browser          # dist/odin-pr-review-browser.zip
```

In Chrome, Edge or Brave, open `chrome://extensions`, turn on Developer mode,
choose **Load unpacked** and select `packages/browser-ext/dist/extension`.

## Limits

- No arrows. Resolving references needs the repository checked out.
- GitHub refuses to send very large diffs; those pull requests show a message
- Chromium only for now. Firefox does not support manifest sandbox pages.
