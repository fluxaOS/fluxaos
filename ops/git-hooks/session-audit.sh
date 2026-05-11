#!/usr/bin/env bash
# session-audit.sh
#
# Shared branch/state classifier for fluxaOS. Reports the snapshot returned by
#
#     git status && git stash list && git branch --list && git branch -r --list
#
# and classifies every local branch, remote branch, worktree, and stash as
# ACTIVE, PROTECTED, or ORPHAN with reasons. Worktree-aware: every branch
# checked out in any worktree is treated as PROTECTED, since fluxaOS uses
# `git worktree` as the default isolation strategy for parallel agents.
#
# This script is a *library* — it's invoked by:
#   - .claude/hooks/session-start-audit.sh (SessionStart, advisory)
#   - ops/git-hooks/post-merge             (auto-prune candidates)
#
# Usage:
#   bash ops/git-hooks/session-audit.sh report   # human banner; non-zero exit
#                                                # only on hard repo errors.
#                                                # Also runs `./flux env audit`
#                                                # as advisory output (FLX-230).
#   bash ops/git-hooks/session-audit.sh prune    # delete branches classified
#                                                # ORPHAN-MERGED (post-merge use)
#   bash ops/git-hooks/session-audit.sh json     # machine-readable output
#
# Classification (per local branch B, excluding `main`):
#   ACTIVE     — B is current HEAD anywhere (any worktree), OR ahead of
#                origin/main by >0 commits (in-flight work)
#   PROTECTED  — B is the head ref of an open PR (gh pr list)
#   ORPHAN     — none of the above. Subdivided:
#                  ORPHAN-MERGED   → fully merged into origin/main, safe to -d
#                  ORPHAN-DANGLING → not merged, no PR, not ahead — needs human
#
# Stashes: ACTIVE if message starts with "<owner>:" or "WIP:" or "PROTECTED:";
#          ORPHAN otherwise (unnamed = no owner = junk).

set -euo pipefail

MODE="${1:-report}"
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$REPO_ROOT" ]; then
  echo "✗ session-audit.sh must run inside a git working tree." >&2
  exit 1
fi
cd "$REPO_ROOT"

# Quietly fetch+prune so origin refs are accurate (skip on prune mode where
# the caller already fetched).
if [ "$MODE" != "prune" ]; then
  git fetch --prune origin --quiet 2>/dev/null || true
fi

# ── Gather state ──────────────────────────────────────────────────────────────

# Branches checked out in any worktree (worktree-awareness).
# `git worktree list --porcelain` emits "branch refs/heads/<name>" lines for
# attached worktrees; detached worktrees produce no branch line.
WORKTREE_BRANCHES="$(git worktree list --porcelain 2>/dev/null \
  | awk '/^branch /{sub("refs/heads/","",$2); print $2}')"

# Open PRs from GitHub. If `gh` isn't authed (or offline), treat as empty
# rather than crashing the whole audit.
OPEN_PR_BRANCHES=""
if command -v gh >/dev/null 2>&1; then
  OPEN_PR_BRANCHES="$(gh pr list --state open --json headRefName \
    --jq '.[].headRefName' 2>/dev/null || true)"
fi

# Local branches (excluding main).
LOCAL_BRANCHES="$(git for-each-ref --format='%(refname:short)' refs/heads/ \
  | grep -vx main || true)"

# Helper: is branch checked out in some worktree?
is_worktree_branch() {
  local b="$1"
  printf '%s\n' "$WORKTREE_BRANCHES" | grep -Fxq "$b"
}

# Helper: does branch back an open PR?
is_open_pr_branch() {
  local b="$1"
  printf '%s\n' "$OPEN_PR_BRANCHES" | grep -Fxq "$b"
}

# Helper: ahead of origin/main by N commits (0 if origin/main missing).
ahead_of_main() {
  local b="$1"
  git rev-list --count "origin/main..$b" 2>/dev/null || echo 0
}

# Helper: fully merged into origin/main?
is_merged_into_main() {
  local b="$1"
  git merge-base --is-ancestor "$b" origin/main 2>/dev/null
}

# ── Classify ──────────────────────────────────────────────────────────────────

# Initialise as empty arrays. Bash's `set -u` (nounset) treats an unset
# array reference as "unbound", so we must seed with at least one slot
# and handle the empty case at read time. The `()` form ensures `${arr[@]}`
# expands to nothing rather than tripping nounset.
ACTIVE_OUT=()
PROTECTED_OUT=()
ORPHAN_MERGED_OUT=()
ORPHAN_DANGLING_OUT=()

while IFS= read -r b; do
  [ -z "$b" ] && continue

  if is_worktree_branch "$b"; then
    ACTIVE_OUT+=("$b|worktree-checkout")
    continue
  fi

  if is_open_pr_branch "$b"; then
    PROTECTED_OUT+=("$b|open-pr")
    continue
  fi

  AHEAD="$(ahead_of_main "$b")"
  if [ "$AHEAD" -gt 0 ]; then
    if is_merged_into_main "$b"; then
      # Edge case: ahead count > 0 but ancestor of main → effectively merged.
      ORPHAN_MERGED_OUT+=("$b|merged-into-main")
    else
      ACTIVE_OUT+=("$b|ahead-of-main-by-$AHEAD")
    fi
    continue
  fi

  if is_merged_into_main "$b"; then
    ORPHAN_MERGED_OUT+=("$b|merged-into-main")
  else
    ORPHAN_DANGLING_OUT+=("$b|not-merged-no-pr-not-ahead")
  fi
done <<< "$LOCAL_BRANCHES"

# Stashes — owner-named or junk?
STASH_ACTIVE=()
STASH_ORPHAN=()
while IFS= read -r line; do
  [ -z "$line" ] && continue
  # `git stash list` format: "stash@{N}: <subject>"
  if printf '%s' "$line" | grep -qE ': (PROTECTED:|WIP:|[A-Za-z0-9_-]+:)'; then
    STASH_ACTIVE+=("$line")
  else
    STASH_ORPHAN+=("$line")
  fi
done < <(git stash list 2>/dev/null)

# ── Emit ──────────────────────────────────────────────────────────────────────

case "$MODE" in
  prune)
    # Delete only ORPHAN-MERGED branches. Never force; never touch dangling
    # branches (those need human attention).
    for entry in "${ORPHAN_MERGED_OUT[@]:-}"; do
      [ -z "$entry" ] && continue
      branch="${entry%%|*}"
      git branch -d "$branch" 2>/dev/null && \
        echo "  ✓ deleted merged branch: $branch" || true
    done
    ;;

  json)
    # Crude JSON; no jq dependency.
    printf '{\n'
    printf '  "active": ['
    sep=""
    for e in "${ACTIVE_OUT[@]:-}"; do
      [ -z "$e" ] && continue
      printf '%s\n    {"branch":"%s","reason":"%s"}' "$sep" "${e%%|*}" "${e#*|}"
      sep=","
    done
    printf '\n  ],\n  "protected": ['
    sep=""
    for e in "${PROTECTED_OUT[@]:-}"; do
      [ -z "$e" ] && continue
      printf '%s\n    {"branch":"%s","reason":"%s"}' "$sep" "${e%%|*}" "${e#*|}"
      sep=","
    done
    printf '\n  ],\n  "orphan_merged": ['
    sep=""
    for e in "${ORPHAN_MERGED_OUT[@]:-}"; do
      [ -z "$e" ] && continue
      printf '%s\n    {"branch":"%s","reason":"%s"}' "$sep" "${e%%|*}" "${e#*|}"
      sep=","
    done
    printf '\n  ],\n  "orphan_dangling": ['
    sep=""
    for e in "${ORPHAN_DANGLING_OUT[@]:-}"; do
      [ -z "$e" ] && continue
      printf '%s\n    {"branch":"%s","reason":"%s"}' "$sep" "${e%%|*}" "${e#*|}"
      sep=","
    done
    printf '\n  ],\n  "stash_active": ['
    sep=""
    for s in "${STASH_ACTIVE[@]:-}"; do
      [ -z "$s" ] && continue
      esc=$(printf '%s' "$s" | sed 's/\\/\\\\/g; s/"/\\"/g')
      printf '%s\n    "%s"' "$sep" "$esc"
      sep=","
    done
    printf '\n  ],\n  "stash_orphan": ['
    sep=""
    for s in "${STASH_ORPHAN[@]:-}"; do
      [ -z "$s" ] && continue
      esc=$(printf '%s' "$s" | sed 's/\\/\\\\/g; s/"/\\"/g')
      printf '%s\n    "%s"' "$sep" "$esc"
      sep=","
    done
    printf '\n  ],\n  "working_tree_dirty": %s' "$(if [ -n "$(git status --porcelain)" ]; then echo true; else echo false; fi)"
    printf '\n}\n'
    ;;

  report|*)
    has_orphan=0
    if [ ${#ORPHAN_MERGED_OUT[@]} -gt 0 ] || \
       [ ${#ORPHAN_DANGLING_OUT[@]} -gt 0 ] || \
       [ ${#STASH_ORPHAN[@]} -gt 0 ]; then
      has_orphan=1
    fi

    echo "── fluxaOS branch & state audit ───────────────────────────────"
    echo "Working tree: $(git status --porcelain | wc -l) untracked/dirty entries"
    echo "Worktrees: $(git worktree list | wc -l)"
    echo

    if [ ${#ACTIVE_OUT[@]} -gt 0 ]; then
      echo "ACTIVE (in-flight work — keep):"
      for e in "${ACTIVE_OUT[@]}"; do
        echo "  • ${e%%|*}  [${e#*|}]"
      done
      echo
    fi

    if [ ${#PROTECTED_OUT[@]} -gt 0 ]; then
      echo "PROTECTED (open PRs — keep):"
      for e in "${PROTECTED_OUT[@]}"; do
        echo "  • ${e%%|*}  [${e#*|}]"
      done
      echo
    fi

    if [ ${#ORPHAN_MERGED_OUT[@]} -gt 0 ]; then
      echo "ORPHAN — merged (run \`bash ops/git-hooks/session-audit.sh prune\` to remove):"
      for e in "${ORPHAN_MERGED_OUT[@]}"; do
        echo "  ✗ ${e%%|*}  [${e#*|}]"
      done
      echo
    fi

    if [ ${#ORPHAN_DANGLING_OUT[@]} -gt 0 ]; then
      echo "ORPHAN — dangling (no PR, not merged, not ahead — decide manually):"
      for e in "${ORPHAN_DANGLING_OUT[@]}"; do
        echo "  ✗ ${e%%|*}  [${e#*|}]"
      done
      echo "  Action: open a PR, rebase onto main, or \`git branch -D <name>\` if abandoned."
      echo
    fi

    if [ ${#STASH_ORPHAN[@]} -gt 0 ]; then
      echo "ORPHAN — unnamed stashes (no owner: prefix — decide manually):"
      for s in "${STASH_ORPHAN[@]}"; do
        echo "  ✗ $s"
      done
      echo "  Action: \`git stash apply\` & resolve, or \`git stash drop\`. Future stashes should use \`git stash push -m '<owner>: <reason>'\`."
      echo
    fi

    if [ "$has_orphan" -eq 0 ]; then
      echo "✓ No orphans. Snapshot reflects only active work + protected PRs."
    fi
    echo "───────────────────────────────────────────────────────────────"

    # FLX-230: env-file audit as advisory output. Run inline in `report`
    # mode so the SessionStart hook (which invokes `session-audit.sh
    # report`) surfaces env regressions the moment a session begins.
    # Non-blocking: a non-zero rc is reported but never fails the audit.
    # The FLX-123 regression happened because two recovery sessions
    # silently wrote UAT credentials into dev — this guard catches it.
    FLUX_BIN="$REPO_ROOT/flux"
    if [ -x "$FLUX_BIN" ]; then
      echo
      "$FLUX_BIN" env audit || \
        echo "[session-audit] flux env audit reported a mismatch — advisory only, session continues. Fix before running dev/UAT." >&2
    fi
    ;;
esac

exit 0
