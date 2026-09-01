#!/usr/bin/env bash
#
# Puts Odin's Claude skills where Claude can find them from any repository.
#
# The skills live in this checkout, under .claude/skills, which means Claude
# only sees them while it is working *on Odin* — and the whole point of
# odin-graph and odin-review is to read somebody else's change. Copying them
# into the user scope makes them available everywhere, and re-copying them is
# how they stop being the version from three months ago.
#
# It only ever touches directories named odin-*, and only ones that look like a
# skill. Everything else in the destination is somebody else's and is left
# alone.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/.claude/skills"

DEST="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"
DRY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY=1 ;;
    --to) DEST="${2:?--to requires a directory}"; shift ;;
    -h|--help)
      cat <<'USAGE'
odin skills - copy Odin's Claude skills into the user scope

  scripts/skills.sh [--dry-run] [--to <dir>]

  --dry-run   say what would be copied and copy nothing
  --to <dir>  somewhere other than ~/.claude/skills

Set CLAUDE_SKILLS_DIR to change the default destination.
USAGE
      exit 0 ;;
    *) printf 'unknown option %s\n' "$1" >&2; exit 2 ;;
  esac
  shift
done

note() { printf '  %s\n' "$*"; }
fail() { printf '\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

[ -d "$SRC" ] || fail "No skills in $SRC. Run this from a checkout of Odin."

printf '\033[1m%s\033[0m\n' "Odin's skills → $DEST"

[ "$DRY" -eq 1 ] || mkdir -p "$DEST"

copied=0
for skill in "$SRC"/odin-*; do
  [ -f "$skill/SKILL.md" ] || continue
  name="$(basename "$skill")"
  target="$DEST/$name"

  # A version already there is replaced rather than merged: a skill that is
  # half of one release and half of another is worse than either. The guard is
  # what makes that safe — it will only remove something that is itself a skill
  # by that name.
  if [ -e "$target" ]; then
    if [ ! -f "$target/SKILL.md" ]; then
      fail "$target exists and is not a skill. Move it aside; this will not remove it."
    fi
    what="replaced"
  else
    what="installed"
  fi

  if [ "$DRY" -eq 1 ]; then
    note "would be $what: $name"
  else
    rm -rf "$target"
    cp -R "$skill" "$target"
    note "$what: $name"
  fi
  copied=$((copied + 1))
done

[ "$copied" -gt 0 ] || fail "Found no odin-* skills in $SRC."

if [ "$DRY" -eq 1 ]; then
  note "nothing was written"
else
  note "Claude picks these up on its next session in any repository"
fi
