---
name: odin-setup
description: Install and build Odin PR Review so the `odin` command and the VS Code extension are usable. Use when Odin is not installed yet, when `odin` is not on PATH, when a build is stale after pulling, or when the user asks to set the project up.
---

# Installing Odin

Odin turns a pull request's diff into a graph of files and the calls between
them. It has two faces — a command line and a VS Code extension — built from
one monorepo.

## Check before installing

```bash
odin --help            # already on PATH?
node --version         # needs 18 or newer
yarn --version         # the repo uses yarn 1.x workspaces, not npm
```

If `odin` answers, skip to the **odin-graph** skill. Installing over a working
copy costs the user several minutes for nothing.

## Build

Run from the repository root. **Use yarn, never npm** — the workspaces are
yarn's, and npm will produce a tree that does not build.

```bash
yarn install
yarn build            # compiles every package, then bundles the extension
yarn test             # 177 unit tests; expect all green
```

## Put `odin` on PATH

`packages/cli/dist/main.js` is executable and carries a shebang, so a symlink
into a directory already on PATH is enough:

```bash
ln -sf "$PWD/packages/cli/dist/main.js" ~/.local/bin/odin    # or /usr/local/bin
odin --help
```

`yarn link` will **not** do this — it registers the package for other yarn
projects to depend on; it puts no binary on PATH.

Inside scripts, prefer calling it directly. It needs no global state and cannot
break when someone reinstalls:

```bash
node /absolute/path/to/odin-pr-review/packages/cli/dist/main.js view
```

Record the absolute path once and reuse it rather than rediscovering it.

## The editor extension

```bash
yarn workspace odin-pr-review run package     # writes dist/odin-pr-review-0.1.0.vsix
code --install-extension dist/odin-pr-review-0.1.0.vsix
```

If `code` is not found, it lives at
`/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code` on macOS.
The user must reload the window afterwards; you cannot do it for them.

## What needs `gh`

Pull request titles, existing review comments, and everything under the
**odin-review** skill go through the GitHub CLI. Without it the graph still
builds — it simply knows nothing about the pull request.

```bash
gh auth status        # authenticated?
```

Do not attempt to authenticate on the user's behalf. If `gh auth status` fails,
say so and let them run `gh auth login` themselves.

## When something fails

- **`fatal: Not a valid object name main`** — the branch's base does not exist
  locally. Pass `--base origin/main`, or fetch first.
- **Extension installed but nothing appears** — VS Code opened the folder in
  Restricted Mode. Odin declares that it does not support untrusted workspaces,
  so it stays disabled until the user trusts the folder.
- **`gh: command not found` inside the editor** — GUI applications inherit a
  bare PATH. The extension already augments it; a terminal does not need to.
