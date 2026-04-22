---
name: "housekeeping"
id: "housekeeping"
description: "Session cleanup safety-net for fluxaOS. Runs the shared clean-slate cleanup and verifies the repo is clean. Use standalone if you ended a session without running /session-end. The cleanup policy is the same as session-end's cleanup step — this is a thin wrapper, nothing more."
default_model: "sonnet"
---

# Housekeeping — fluxaOS

Session cleanup safety-net. If you meant to wrap a session, use `/session-end` — it does everything this does plus recap, handoff, and marker.

## Usage

```
/housekeeping              # Full cleanup + verification
/housekeeping --dry-run    # Report only, skip destructive actions
```

**Arguments:** `$ARGUMENTS`

---

## Step 0: Parse Arguments

- `--dry-run` → set `DRY_RUN=true`

Print:

```
Running session cleanup. (If you meant to wrap a session, use /session-end.)
```

---

## Step 1: Cleanup (inline session-clean-slate)

### Clean-Slate Contract

- On `main`, up to date with `origin/main`
- Working tree clean
- No stashes unless explicitly protected and named
- No stale unprotected worktrees
- No stale unprotected local or remote branches

### PROTECTED-Work Definitions

A branch, worktree, or stash entry is **PROTECTED** if ANY of these apply:

1. **Current HEAD branch** — active work in progress.
2. **Linked to an open PR** — branch is head of an open PR per `gh pr list --state open --json headRefName,number,title`.
3. **Ahead of `origin/main`** — `git rev-list --count origin/main..<branch>` is > 0.
4. **Conventional in-flight prefix ahead of main** — `spec/*`, `wip/*`, `chore/*`, `feature/*`, `feat/*`, `fix/*`, `docs/*` branches satisfying rule 3.
5. **Backing an active worktree** — any branch in `git worktree list`.

Classify every candidate. Show the classification — nothing gets deleted silently.

### Caller-Contract Variables

- **`DRY_RUN=true`** — describe what *would* be cleaned, execute nothing.

### Cleanup Actions (perform in order)

1. `git fetch --prune origin`.
2. **Worktrees.** `git worktree list`. For each non-main worktree, classify; remove UNPROTECTED with `git worktree remove <path>`.
3. **Merged local branches.** `git for-each-ref --merged=main --format='%(refname:short)' refs/heads/`. Classify each (excluding `main`). Skip PROTECTED. Otherwise `git branch -d <branch>`. Never force (`-D`) unless explicitly authorized.
4. **Merged remote branches.** `git branch -r --merged origin/main --format='%(refname:short)'`. Classify each (excluding `origin/HEAD`, `origin/main`). Skip PROTECTED. Otherwise `git push origin --delete <branch>`.
5. **Stashes.** For every entry in `git stash list`, perform one explicit action: drop, apply, pop, or keep-as-PROTECTED with a named reason. No entry left unresolved.

### Verification — PASS / FAIL

Run once:

```bash
git status && git stash list && git branch && git branch -r && git worktree list
```

- **PASS:** print `✓ Clean slate verified.` plus any PROTECTED items with reasons.
- **FAIL:** print `✗ Clean slate NOT verified — unprotected items remain.` List each unprotected item with a suggested action (merge, close, delete, resolve stash). No other success line is printed.
