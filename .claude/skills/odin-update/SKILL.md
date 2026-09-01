---
name: odin-update
description: Update an installed Odin to the latest main — or to whatever is in a local checkout — and refresh the odin-setup, odin-graph and odin-review skills from it. Use when the user asks to update Odin, when a change to Odin itself needs installing, when the extension looks older than the source, or when these skills are stale.
---

# Updating Odin, and these skills with it

Odin is installed from a checkout rather than from a registry, so an update is
"pull, build, put it back in the editor". `odin update` is that, in one command,
and it decides which copy it means by where it is run.

If `odin` is not on PATH at all, this is a first install: use the **odin-setup**
skill instead.

## The command

```bash
odin update --dry-run           # which copy, what state, what it would do
odin update                     # do it
```

Always look at `--dry-run` first when the user has not said which copy they
mean. It prints the checkout, how it stands against main, and the one thing it
would do — and it is the difference between installing what someone is working
on and installing what is on the server.

### Which copy it works on

- **Run inside a clone** — that clone, from anywhere in its tree.
- **Run anywhere else** — the copy `odin` was installed from, followed through
  the symlink on PATH.
- **Neither** — one is cloned from origin into `~/.local/share/odin/checkout`
  and used from then on. This is the machine that got a `.vsix` and no source.

`-C <dir>` names a checkout you are not standing in. `--branch <name>` follows
something other than main.

### What it does there

**Local work wins.** A checkout with uncommitted changes, or with commits main
has not got, is built and installed *as it stands* — never pulled over, never
merged. Only a clean checkout that is purely behind is fast-forwarded, and by
`merge --ff-only`, so an update never starts a conflict on someone's behalf. A
checkout with nothing local and nothing to pull builds nothing and says so.

Then it runs `scripts/install.sh`: dependencies, build, package the extension,
install it, relink `odin`. A minute or two, mostly the build.

**The user must reload the VS Code window afterwards.** You cannot do it for
them, and until they do they are running the extension from before the update —
by far the most common reason a change appears not to have worked.

## Refreshing these skills

The skills live inside the checkout, under `.claude/skills`, so Claude only sees
them while working on Odin itself. Copy them into the user scope and they work
in every repository — which is where **odin-graph** and **odin-review** are
actually for.

```bash
ODIN_ROOT="$(node -p "require('path').resolve(require('fs').realpathSync(process.argv[1]), '../../../..')" "$(command -v odin)")"
bash "$ODIN_ROOT/scripts/skills.sh" --dry-run
bash "$ODIN_ROOT/scripts/skills.sh"
```

That resolves the symlink on PATH back to the checkout `odin` was built from,
which is the same copy `odin update` just built. Run it **after** the update,
never before, or you copy the previous version of the skills.

It writes to `~/.claude/skills` (`--to <dir>` or `CLAUDE_SKILLS_DIR` for
somewhere else), replacing each `odin-*` skill wholesale and touching nothing
else in there. It refuses to remove anything that is not itself a skill.

Claude reads skills at session start, so the user needs a new session before the
refreshed ones apply. Say so rather than letting them wonder.

## The whole loop, after editing Odin

```bash
odin update                                  # from inside the checkout
bash scripts/skills.sh                       # only if the skills changed
# reload the editor window
```

## When something fails

- **`is not a git checkout`** — Odin was copied onto the machine rather than
  cloned. Run it from outside any repository and it fetches one.
- **It says the checkout is on another branch** — it will not pull main into a
  feature branch. Switch branches, or `--branch <name>` to follow that one.
- **The build fails** — the last good bundle stays installed, so the editor
  keeps working and the change simply is not there. Read the output; never hide
  it behind `>/dev/null`.
- **`The engine "vscode" appears to be invalid`** — yarn 1 not recognising a
  field VS Code requires. Harmless, and it is not the failure.
- **A change still missing after a successful update** — the window was not
  reloaded. Ask before hunting further.

`docs/development.md` is the longer account of all of this.
