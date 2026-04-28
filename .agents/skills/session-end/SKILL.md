---
name: "session-end"
id: "session-end"
description: "Session wrap-up ritual for fluxaOS. Recaps recent work, writes a non-overwriting handoff to docs/superpowers/handoffs/, ships or preserves pending work, cleans the repo via the shared clean-slate contract, writes a session-end marker, and prints a copy/paste next-session prompt. Run at the end of every agent context session."
default_model: "sonnet"
---

# Session End — fluxaOS

Wrap up the current context session: summarize, hand off, clean, verify, mark closed.

fluxaOS is decoupled from fh-commons — there is no `flu` CLI, no Forgejo, no `flu memory` or `flu git finish`. This skill uses plain git, `gh` for GitHub, file-based auto-memory markers, and fluxaOS's handoff convention in `docs/superpowers/handoffs/`.

## Usage

```
/session-end                                  # Full wrap-up
/session-end --dry-run                        # Report only, skip destructive actions
/session-end --since "YYYY-MM-DDTHH:MM"       # Override start timestamp if marker missing
/session-end --since-last-commit-on-main      # Best-effort window from last main commit
```

**Arguments:** `$ARGUMENTS`

---

## Step 0: Parse Arguments

- `--dry-run` → set `DRY_RUN=true` (skip destructive actions and marker writes)
- `--since <iso>` → set `SESSION_START=<iso>` explicitly
- `--since-last-commit-on-main` → set `SESSION_START` from `git log -1 --format=%cI origin/main`

---

## Step 1: Locate Session-Start Marker

If `SESSION_START` is not already set from arguments, look in the auto-memory markers directory:

```
/home/jpierce/.claude/projects/-mnt-dev-fluxaos/memory/session/
```

List entries sorted by name (name carries the ISO timestamp):

```bash
ls -1 /home/jpierce/.claude/projects/-mnt-dev-fluxaos/memory/session/ 2>/dev/null | sort
```

Find the most recent `session-start-*` file and the most recent `session-end-*` file.

- If the latest `session-start-*` is newer than the latest `session-end-*`, set `SESSION_START` to the ISO timestamp from the latest `session-start-*` file name.

- If the latest `session-end-*` is newer than or equal to the latest `session-start-*`, set `SESSION_START` to the ISO timestamp from the latest `session-end-*` file name and set `SESSION_BOUNDARY_REASON="No newer session-start marker; using latest session-end as fallback boundary."`

- If no `session-start-*` file exists but a `session-end-*` file exists, set `SESSION_START` to the ISO timestamp from the latest `session-end-*` file name and set `SESSION_BOUNDARY_REASON="No session-start marker found; using latest session-end as fallback boundary."`

- If no marker files exist and no `--since*` override was given, set `SESSION_START` from `git log -1 --format=%cI origin/main` and set `SESSION_BOUNDARY_REASON="No session markers found; using last origin/main commit as fallback boundary."`

Do not stop just because `/session-start` was missed. A missing or stale start marker changes the boundary reason recorded in the handoff; it does not block session-end.

If the markers directory itself is missing, treat it as "no marker files exist" above.

---

## Step 2: Recap

Pull activity since `SESSION_START`:

```bash
git log --since="$SESSION_START" --oneline
git log --since="$SESSION_START" --merges --pretty='%h %s' origin/main
gh pr list --state merged --search "merged:>=$(echo "$SESSION_START" | cut -c1-10)" --json number,title,mergedAt --jq '.[] | "#\(.number) \(.title) (merged \(.mergedAt))"'
gh pr list --state open --json number,title,headRefName --jq '.[] | "#\(.number) \(.title) [\(.headRefName)]"'
```

Also scan `docs/superpowers/deferred-fixes.md` for entries marked `[RESOLVED <date>]` since `SESSION_START`.

Group the commits by theme, phase (R-REM-W3, R-UI-*, etc.), or DEF-NNN. Write 2-3 observations about what was built, what's still in flight, and anything notable for next session. Prose in your own words — no fixed template.

---

## Step 3: Write Handoff Document

Location convention: `docs/superpowers/handoffs/YYYY-MM-DD-<topic>-session-handoff.md`. Use the session date (Pacific time) in the filename. `<topic>` is a short slug describing the session's main thread (e.g. `def-017-fix`, `r-rem-w3-github-adapter-brainstorm`, `session-lifecycle-consolidation`).

Never overwrite an existing handoff. If the target filename already exists, append `-2`, then `-3`, and so on before `.md` until the path is unused:

```
docs/superpowers/handoffs/YYYY-MM-DD-<topic>-session-handoff.md
docs/superpowers/handoffs/YYYY-MM-DD-<topic>-session-handoff-2.md
docs/superpowers/handoffs/YYYY-MM-DD-<topic>-session-handoff-3.md
```

Structure matches what actually happened — if nothing shipped, it's a short file. Include only sections that apply:

- Date, operator, branch at start, branch at end (with SHAs)
- Session boundary used, including `SESSION_BOUNDARY_REASON` when set
- Session scope (one paragraph)
- What shipped (PRs merged, with brief per-PR notes)
- Deferred findings captured (any new DEF-NNN entries)
- Open PRs awaiting action
- Incidents & root causes worth remembering (if any)
- Verification matrix (tsc, vitest, verify:seed, lint, journey tests, human browser check)
- Current state (HEAD, branches, worktrees, working tree, dev server port)
- Roadmap state (phase status changes, if any)
- Files touched (bulleted or tabled)
- Memories saved this session
- Suggested next-session prompt

Model writes this in prose following prior handoffs in `docs/superpowers/handoffs/` as style references. Read the most recent 1-2 for tone before writing.

If `DRY_RUN=true`, print the content to stdout instead of writing the file.

---

## Step 4: Ship Pending Work

If `DRY_RUN=true`, skip this step.

Assess pending work:

```bash
git status --short
git stash list
git log --oneline "origin/$(git branch --show-current)..HEAD" 2>/dev/null || \
  git log --oneline main..HEAD 2>/dev/null || true
```

If there are uncommitted changes (excluding the handoff doc) or unpushed commits on feature branches:

```
Pending work detected:
  <summary of dirty files and unpushed branches>

Options:
  (y) ship — commit/push/PR via gh
  (w) wip  — save as WIP commit: git add . && git commit -m "WIP: session-end $(date -I)"
  (n) leave — note in handoff and continue
```

- **y**: commit the handoff doc in its own commit first, then for each feature branch with unpushed commits: push the branch, open a PR with `gh pr create` using a HEREDOC body, report the PR URL. Do not auto-merge — leave that to the user or `/ship` flow.
- **w**: run `git add . && git commit -m "WIP: session-end $(date -I)"`; add the WIP commit SHA to the handoff.
- **n**: add an "Unfinished Work" section to the handoff doc naming branches, files, and next steps.

Do not use `git stash` as the normal preservation path. Stashes are shared mutable repo state and are easy to lose across agent sessions. Use WIP commits or explicitly leave and document the work.

---

## Step 5: Cleanup (inline session-clean-slate)

If the user chose `n` at Step 4, set `PRESERVE_BRANCHES=true` so verification runs without deleting preserved work. Otherwise run full cleanup.

### Clean-Slate Contract

A session ends with the repo in this state:

- On `main`, up to date with `origin/main`
- Working tree clean
- No stashes unless explicitly protected and reported with a reason
- No stale unprotected worktrees
- No stale unprotected local or remote branches

### PROTECTED-Work Definitions

A branch, worktree, or stash entry is **PROTECTED** if ANY of these apply:

1. **Current HEAD branch** — active work in progress.
2. **Linked to an open PR** — branch is the head of an open pull request per `gh pr list --state open --json headRefName,number,title`.
3. **Ahead of `origin/main`** — `git rev-list --count origin/main..<branch>` is > 0.
4. **Conventional in-flight prefix ahead of main** — `spec/*`, `wip/*`, `chore/*`, `feature/*`, `feat/*`, `fix/*`, `docs/*` branches satisfying rule 3.
5. **Backing an active worktree** — any branch listed by `git worktree list`.

Classify each non-main branch, worktree, and stash entry as PROTECTED (with the reason) or UNPROTECTED. Always show the classification — nothing gets deleted silently.

### Caller-Contract Variables

- **`DRY_RUN=true`** — describe what *would* be cleaned, execute nothing.
- **`PRESERVE_BRANCHES=true`** — skip local and remote branch deletion. Worktree cleanup and stash resolution still run.

### Cleanup Actions (prose — perform in order)

1. **Fetch + prune.** `git fetch --prune origin`.
2. **Worktrees.** List with `git worktree list`. For each non-main worktree, classify; remove UNPROTECTED ones with `git worktree remove <path>` (add `--force` only if the working tree is clean). In dry-run, list intended actions.
3. **Merged local branches.** `git for-each-ref --merged=main --format='%(refname:short)' refs/heads/`. For each (excluding `main`), classify. Skip PROTECTED; skip all if `PRESERVE_BRANCHES=true`. Otherwise `git branch -d <branch>`. Never use `-D` (force) unless the user explicitly authorized it.
4. **Merged remote branches.** `git branch -r --merged origin/main --format='%(refname:short)'`. For each (excluding `origin/HEAD` and `origin/main`), classify the short name. Skip PROTECTED; skip all if `PRESERVE_BRANCHES=true`. Otherwise `git push origin --delete <branch>`.
5. **Stashes.** For every entry in `git stash list`, perform one explicit action: drop, apply, pop, or keep-as-PROTECTED with a named reason. No entry left unresolved. In dry-run, list intended actions.

### Verification — PASS / FAIL

Run once:

```bash
git status && git stash list && git branch && git branch -r && git worktree list
```

Evaluate against the contract. **PASS:** print `✓ Clean slate verified.` plus PROTECTED items with reasons.

**FAIL:** print `✗ Clean slate NOT verified — unprotected items remain.` Print each unprotected item with a suggested action. **Stop.** Do not proceed to Step 6 or 7. No marker, no success line. The user resolves and re-runs `/session-end` (or runs `/housekeeping`).

---

## Step 6: Write Session-End Marker

If `DRY_RUN=true`, skip this step.

Write a marker file:

```
/home/jpierce/.claude/projects/-mnt-dev-fluxaos/memory/session/session-end-<ISO8601>.md
```

Contents:

```markdown
---
name: "session-end <ISO8601>"
description: "Session end marker for fluxaOS at <ISO8601>"
type: "project"
---

# Session End

Ended: <ISO8601 with offset>
Handoff: <relative path to docs/superpowers/handoffs/...md>
Branch at end: <current branch>
Origin main at end: <short SHA>
Clean slate: verified
```

ISO-8601 with offset (`2026-04-22T03:15:00-07:00`). If the filesystem write fails, stop and report — the marker is the close signal; do not print the success line without it.

---

## Step 7: Next-Session Prompt

Skip silently if nothing durable was produced this session (no commits, no specs, no plans, no deferred fixes resolved, no planning artifacts).

Otherwise, print a copy/paste block **under 150 words**, fenced, naming:

- The active branch (likely `main` post-cleanup)
- Any in-flight spec/plan paths
- The next concrete action per the roadmap's "What's Next" section
- Any relevant DEF-NNN entries still open

Use your judgment on wording; the goal is that the next session can resume without re-deriving context.

---

## Step 8: Final Success Line

Only printed if all prior steps succeeded:

```
Session closed. Handoff written, repo clean, marker saved.
```
