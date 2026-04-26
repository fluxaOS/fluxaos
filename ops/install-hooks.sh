#!/usr/bin/env bash
# install-hooks.sh
#
# Idempotent installer that points the current git worktree at the tracked
# hooks directory (`ops/git-hooks/`). Run once after cloning, and once per
# `git worktree add` (or any time `core.hooksPath` is wiped). Safe to re-run.
#
# Why this exists: `.git/hooks/` is per-clone and not shared with worktrees,
# so hooks installed only there silently disappear when an agent works in a
# `git worktree`. fluxaOS uses worktrees as the default isolation strategy
# for parallel agents (see CLAUDE.md → "Worktrees & Hooks"), so the hooks
# must live in the tree and be enabled per worktree via `core.hooksPath`.

set -euo pipefail

# Resolve the repo's top-level directory so the script works whether invoked
# from the project root, a worktree, a subdirectory, or by an agent that
# `cd`s into something deeper. This also makes the script safe to symlink.
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$REPO_ROOT" ]; then
  echo "✗ install-hooks.sh must run inside a git working tree." >&2
  exit 1
fi

HOOKS_REL="ops/git-hooks"
HOOKS_ABS="${REPO_ROOT}/${HOOKS_REL}"

if [ ! -d "$HOOKS_ABS" ]; then
  echo "✗ Tracked hooks directory missing: $HOOKS_ABS" >&2
  echo "  Did the repo lose ops/git-hooks/? Restore from git history." >&2
  exit 1
fi

# Ensure every hook script is executable. Worktree clones preserve the +x
# bit from git, but a defensive chmod costs nothing and recovers from a
# manual edit that dropped the bit.
chmod +x "$HOOKS_ABS"/* 2>/dev/null || true

# Point this worktree's git config at the tracked hooks dir. `core.hooksPath`
# is a per-clone (and per-worktree, when configured locally) setting, so
# every fresh worktree must run this script once.
CURRENT="$(git config --get core.hooksPath 2>/dev/null || true)"
if [ "$CURRENT" = "$HOOKS_REL" ]; then
  echo "✓ core.hooksPath already set to $HOOKS_REL — nothing to do."
else
  git config core.hooksPath "$HOOKS_REL"
  echo "✓ Set core.hooksPath = $HOOKS_REL"
fi

# Echo back which hooks are now active so the operator (or agent) can see
# what the worktree is enforcing.
echo
echo "Active hooks:"
for hook in "$HOOKS_ABS"/*; do
  [ -f "$hook" ] || continue
  printf "  %s\n" "$(basename "$hook")"
done
