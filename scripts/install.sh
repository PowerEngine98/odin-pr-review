#!/usr/bin/env bash
#
# Builds Odin and installs it into VS Code, on macOS and Linux.
#
# Everything it does can be done by hand — install, build, package, install the
# extension — and this exists because "by hand" is four commands, two of which
# fail in ways that are hard to read if a tool is missing. Every check here is
# for something that has actually gone wrong for somebody.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

say()  { printf '\033[1m%s\033[0m\n' "$*"; }
note() { printf '  %s\n' "$*"; }
fail() { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

# ------------------------------------------------------------------ the tools

need() {
  command -v "$1" >/dev/null 2>&1 || fail "Odin needs $1. $2"
}

say "Checking what is here"

need node "Install Node 20 or newer: https://nodejs.org"
node_major="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$node_major" -lt 20 ]; then
  fail "Odin needs Node 20 or newer; this is $(node -v)."
fi
note "node $(node -v)"

need git "Install git and run this from a clone of the repository."

if ! command -v yarn >/dev/null 2>&1; then
  # Yarn ships with Node through corepack, so this is usually one line rather
  # than a separate install.
  if command -v corepack >/dev/null 2>&1; then
    note "yarn is missing; enabling it through corepack"
    corepack enable >/dev/null 2>&1 || true
  fi
fi
need yarn "Install it with: corepack enable, or npm install --global yarn"
note "yarn $(yarn -v)"

# The editor's command line tool is not on the PATH by default on macOS, and
# lives inside the application bundle. Look there before giving up, and take
# whichever build the reader actually has.
find_code() {
  for candidate in code code-insiders codium cursor; do
    if command -v "$candidate" >/dev/null 2>&1; then
      echo "$candidate"
      return 0
    fi
  done
  for bundle in \
    "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" \
    "/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/bin/code" \
    "$HOME/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" \
    "/usr/share/code/bin/code" \
    "/snap/bin/code"; do
    if [ -x "$bundle" ]; then
      echo "$bundle"
      return 0
    fi
  done
  return 1
}

CODE="$(find_code || true)"
if [ -n "$CODE" ]; then
  note "editor $("$CODE" --version 2>/dev/null | head -1 || echo "found at $CODE")"
else
  note "no VS Code command line found — the extension will be built, not installed"
fi

if command -v gh >/dev/null 2>&1; then
  note "gh $(gh --version | head -1 | awk '{print $3}')"
else
  note "gh is missing — titles, comments, checks and the pull request list need it"
  note "  https://cli.github.com  then: gh auth login"
fi

# ------------------------------------------------------------------ the build

say "Installing dependencies"
yarn install

say "Building"
yarn build

say "Packaging the extension"
# vsce writes where it is told and does not create the directory on the way, and
# a fresh clone has no dist/ — it is ignored, so nobody has one until something
# builds into it.
mkdir -p "$ROOT/dist"
yarn --cwd packages/vscode-ext package

VSIX="$ROOT/dist/odin-pr-review-0.1.0.vsix"
[ -f "$VSIX" ] || fail "The package did not appear at $VSIX."

# --------------------------------------------------------------- the install

if [ -n "$CODE" ]; then
  say "Installing into the editor"
  "$CODE" --install-extension "$VSIX" --force
else
  say "Built, but not installed"
  note "Install it by hand: code --install-extension $VSIX"
  note "On macOS, the command line tool is added from VS Code with"
  note "  Shell Command: Install 'code' command in PATH"
fi

# The command line tool is useful on its own, and is one symlink away.
say "The command line"
BIN="${ODIN_BIN:-$HOME/.local/bin}"
# A machine that has never installed anything by hand has no ~/.local/bin, and
# refusing to make the standard place for user binaries is a strange thing to
# refuse.
mkdir -p "$BIN" 2>/dev/null || true
if [ -d "$BIN" ] && [ -w "$BIN" ]; then
  ln -sf "$ROOT/packages/cli/dist/main.js" "$BIN/odin"
  note "linked $BIN/odin"
  case ":$PATH:" in
    *":$BIN:"*) ;;
    *) note "$BIN is not on your PATH; add it to use 'odin' from anywhere" ;;
  esac
else
  note "no writable $BIN, so nothing was linked"
  note "run it by path: node $ROOT/packages/cli/dist/main.js view"
fi

say "Done"
note "Open a repository in VS Code and run: Odin: Review"
note "Or from a checkout: odin view"
