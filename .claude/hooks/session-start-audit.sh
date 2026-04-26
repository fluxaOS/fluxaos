#!/usr/bin/env bash
# session-start-audit.sh
#
# Claude Code SessionStart hook. Prints a one-shot branch & state audit so
# the agent and the user immediately see whether the four-command snapshot
# (`git status && git stash list && git branch --list && git branch -r --list`)
# contains anything other than ACTIVE work.
#
# Non-blocking. The actual classification logic lives in
# `ops/git-hooks/session-audit.sh` (worktree-aware). This script is the thin
# Claude-Code-side wrapper that locates the project root and invokes it.
#
# Why two scripts: `ops/git-hooks/` is for git event hooks (post-merge,
# pre-commit, etc.); `.claude/hooks/` is for Claude Code event hooks
# (SessionStart, PostToolUse). The audit is shared, the wrappers differ.

set -euo pipefail

# Locate fluxaOS root from this hook's path so it works under any worktree.
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HOOK_DIR/../.." && pwd)"

# If we're not inside a git tree (e.g., the user opened a session in a
# detached folder), bail silently.
if ! git -C "$REPO_ROOT" rev-parse --show-toplevel >/dev/null 2>&1; then
  exit 0
fi

AUDIT="$REPO_ROOT/ops/git-hooks/session-audit.sh"
if [ ! -x "$AUDIT" ]; then
  echo "[session-start-audit] ops/git-hooks/session-audit.sh missing or not executable — run \`bash ops/install-hooks.sh\` to repair." >&2
  exit 0
fi

# Run from REPO_ROOT so audit's git commands resolve correctly even when the
# user opened the session in a sub-directory.
cd "$REPO_ROOT"
bash "$AUDIT" report

exit 0
