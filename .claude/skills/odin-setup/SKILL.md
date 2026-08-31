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
node --version         # needs 20 or newer
yarn --version         # the repo uses yarn 1.x workspaces, not npm
```

If `odin` answers, skip to the **odin-graph** skill. Installing over a working
copy costs the user several minutes for nothing.

## Install

One command, from the repository root:

```bash
./scripts/install.sh
```

It checks the machine — Node's version, yarn (enabled through corepack when it
is missing), the editor's command line tool, `gh` — then installs dependencies,
builds every package, packages the extension, installs it, and links `odin` into
`~/.local/bin`. `The engine "vscode" appears to be invalid` on the way past is
yarn 1 not recognising a field VS Code requires; nothing is wrong.

The user must reload the editor window afterwards. You cannot do it for them,
and until they do they are still running the extension from before the install —
which is the most common reason a change appears not to have worked.

## Reinstalling after a change

```bash
odin update
```

Once `odin` is on PATH this replaces the whole dance, and which copy it works on
depends on where it is run:

- **inside a clone** — that clone, from anywhere in its tree
- **anywhere else** — the copy `odin` was installed from, through its symlink
- **neither** — one is fetched from origin into `~/.local/share/odin/checkout`

Local work wins: a checkout with uncommitted changes, or commits not yet on
main, is built and installed **as it stands** rather than pulled over. Only a
clean checkout that is purely behind is fast-forwarded, and a diverged one is
built as it is rather than merged. Nothing to do builds nothing.

So after editing Odin itself, `odin update` from the checkout is the whole loop.
`--dry-run` says which case it is without doing it; `-C <dir>` names a checkout
you are not standing in.

## Building it by hand

**Use yarn, never npm** — the workspaces are yarn's, and npm will produce a tree
that does not build.

```bash
yarn install
yarn build            # compiles every package, then bundles the extension
yarn test             # the unit suite; expect all green
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

`docs/development.md` is the longer account of both commands.

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
- **`odin update` says it is on another branch** — it will not pull main into a
  branch. Either switch, or `--branch <name>` to follow that one.
- **A change that does not appear** — the window was not reloaded, or the build
  failed and left the last good bundle in place. Never hide build output behind
  `>/dev/null` while checking whether a change took.
