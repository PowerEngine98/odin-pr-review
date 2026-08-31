# Working on Odin

Odin is installed from a checkout rather than from a registry. There is no
published package and no marketplace listing: the extension in your editor was
built from a clone on your machine, and so was the `odin` on your PATH. That
makes the loop shorter than it looks — the copy you are editing and the copy you
are using can be the same one — and it makes "how do I install this" and "how do
I get my change into the editor" the same question.

Two commands answer it.

| | What it is | When |
| --- | --- | --- |
| `./scripts/install.sh` | Build this checkout and install it | The first time, and any time you want the script's own checks |
| `odin update` | Work out which checkout you mean, then do that | Every time after |

`odin update` runs `scripts/install.sh` when it decides something needs
building, so the second is the first with the deciding done for you.

## The first install

From a clone, with nothing else set up:

```sh
git clone https://github.com/PowerEngine98/odin-pr-review
cd odin-pr-review
./scripts/install.sh
```

It checks what is on the machine before it does anything, and every check is
there because it has actually gone wrong for somebody:

- **Node 20 or newer.** The workspace needs it and the failure without it is a
  syntax error in a dependency, which reads as Odin being broken.
- **yarn**, enabled through corepack if it is missing — one line rather than a
  separate install. It must be yarn: the workspaces are yarn's, and npm produces
  a tree that does not build.
- **The editor's command line tool**, which is not on the PATH on macOS by
  default. It looks inside the usual application bundles before giving up, and
  takes Insiders, VSCodium or Cursor if that is what is there.
- **`gh`**, which is not required. Without it the graph still builds; what it
  loses is the pull request's title, its comments, its checks and the list you
  choose from. Its absence is said out loud rather than discovered later as a
  missing feature.

Then it installs dependencies, builds every package, packages the extension,
installs it, and links `packages/cli/dist/main.js` into `~/.local/bin/odin` when
that is somewhere it can write. Set `ODIN_BIN` to link it somewhere else.

One line of noise on the way past is expected:

```
warning odin-pr-review@0.1.0: The engine "vscode" appears to be invalid.
```

VS Code requires `engines.vscode` in the extension's manifest, yarn 1 does not
recognise it, and it says so every time. Nothing is wrong.

Reload the editor window afterwards. An extension is loaded when the window
starts, so the one you were running is still the one you are running until you
do — which is the single most common reason a change appears not to have worked.

## After that: `odin update`

```sh
odin update
```

The interesting part is which copy of Odin it works on, and that is decided by
where you are standing when you run it.

### Where it looks

1. **Inside a clone** — that clone, from anywhere in its tree. It is found by
   walking up for the workspace manifest, not by the directory's name, so a
   clone can be called anything and usually is.
2. **Anywhere else** — the copy the command was installed from, found by
   following `odin` on your PATH back through its symlink. Asking the link where
   it is would answer `~/.local/bin`, which has no repository in it and never
   will.
3. **Neither** — a clone is fetched from origin into
   `~/.local/share/odin/checkout` and used from then on. This is the case where
   Odin arrived as a `.vsix` rather than as a clone; telling that reader to go
   and clone something is telling them to do the one thing the command is for.

`-C <dir>` points it somewhere else without moving.

### What it does there

Local work wins. That is the whole rule, and it is the opposite of what a
self-updater usually does.

| The checkout is | What happens |
| --- | --- |
| Clean and behind `main` | Fast-forward, then build and install |
| Clean and level | Nothing at all |
| Has uncommitted changes | Build and install **as it stands** — no pull |
| Ahead of `main` | Build and install as it stands — no pull |
| Ahead *and* behind | Build and install as it stands; no merge is attempted |
| On another branch | Left alone, and it says so |

The reason for that rule: the usual reason to reinstall is to try the change you
just made. A self-updater that insisted on pulling first would refuse to install
the one thing you wanted to install, and one that pulled *over* your work would
be worse. So `odin update` from a dirty checkout is the development loop —

```sh
# edit something
odin update       # builds what is in front of you, installs it
# reload the editor window
```

— and `odin update` from anywhere else is the "give me the latest" it looks
like.

It never merges. A pull may write a merge commit or stop halfway through a
conflict, and an update is not the place to discover either, so it fast-forwards
or it does not pull. A copy that has diverged is simply built as it is.

Nothing to do means nothing is built: rebuilding an unchanged copy costs a
minute for an answer you already had.

```sh
odin update --dry-run          # say which of those it would be, change nothing
odin update --branch develop   # follow something other than main
odin update -C ~/src/odin      # a checkout you are not standing in
```

Progress goes to standard error, so piping `odin graph` output is unaffected.

## Doing it by hand

`odin update` and the install script are conveniences. Nothing stops you:

```sh
yarn install
yarn build                                  # every package, then the extension bundle
yarn workspace odin-pr-review run package   # dist/odin-pr-review-0.1.0.vsix
code --install-extension dist/odin-pr-review-0.1.0.vsix
```

`yarn link` will **not** put `odin` on your PATH — it registers the package for
other yarn projects to depend on. The symlink is what does that:

```sh
ln -sf "$PWD/packages/cli/dist/main.js" ~/.local/bin/odin
```

Inside scripts, calling the file directly is steadier than relying on the link:

```sh
node /absolute/path/to/odin-pr-review/packages/cli/dist/main.js view
```

## The loop

```sh
yarn test                      # the whole suite
npx vitest run packages/core   # one package
npx vitest run -t "the name"   # one test
yarn typecheck                 # tsc over everything, including the webview
yarn build:libs                # compile the packages without the extension bundle
yarn test:integration          # inside a real VS Code extension host
```

The webview is built by esbuild into a string the extension pastes into a
document, so a change to anything under `packages/webview/src/app` needs
`yarn build` — or `odin update` — before the editor sees it. `ODIN_DEV=1 yarn
build` leaves that bundle unminified, which is worth doing before profiling the
page: the function names in a CPU profile are otherwise a single letter each.

Two things are easy to forget and cost half an hour each time:

- **Build output is hidden by `>/dev/null`.** A failed build leaves the last
  good bundle in place, so the page you are testing is the one from before your
  change and everything you measure is wrong.
- **A stray headless browser holds its debugging port.** If you drive the page
  with Chrome for a measurement and the script dies before it kills the browser,
  the next run connects to the *old* one and reads a stale page. `pkill -f
  "user-data-dir=/tmp/odin-"` before believing a surprising result.

## What is where

| Package | Role |
| --- | --- |
| `@odin/core` | Diff parsing, the graph model, layout, exporters. No editor dependency. |
| `@odin/resolver-ts` | References through the TypeScript compiler API. |
| `@odin/resolver-kotlin` | Kotlin references by symbol index. |
| `@odin/webview` | The interactive page, emitted as one self-contained document. |
| `@odin/highlight` | Colouring, from VS Code's own grammars by way of Shiki. |
| `@odin/cli` | `odin` itself, including `odin update`. |
| `odin-pr-review` | The extension. Bundled to CommonJS, which is how the editor loads one. |

The command lives in `packages/cli/src/update.ts`; what it runs is
`scripts/install.sh`, so an update follows whatever installing means at the time
rather than a second description of it.
