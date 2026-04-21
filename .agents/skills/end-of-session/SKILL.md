---
name: "end-of-session"
id: "end-of-session"
description: "End-of-context session wrap-up: write a detailed handoff report with UI test results, update the project roadmap, commit/push/PR/merge any pending work, prune merged branches and stale worktrees, checkout main, and hand off a ready-to-paste next-session prompt. Run when context is getting low or a work session is wrapping up."
default_model: "sonnet"
---

# End of Session

Wrap up the current session cleanly: document what was done, ship any pending work, prune the repo, and hand the next agent a ready-to-go start prompt.

## Usage

```
/end-of-session          # Full wrap-up
/end-of-session --dry-run  # Report only, no destructive actions
```

**Arguments:** `$ARGUMENTS`

---

## Step 0: Pre-Flight

Parse arguments:
- **`--dry-run`** → set DRY_RUN=true (report only, skip destructive actions and commits)

Capture session context:
```bash
SESSION_END=$(date -Iseconds)
SESSION_DATE=$(date -Idate)
CURRENT_BRANCH=$(git branch --show-current)
PROJECT_ROOT=$(git rev-parse --show-toplevel)
```

---

## Step 1: Session Handoff Report

Write a detailed, verbose handoff report covering everything that happened this session. This is the artifact the next agent will read to orient themselves.

**Path convention:** `docs/superpowers/handoffs/YYYY-MM-DD-<slug>-session-handoff.md`. The slug is a short kebab-case summary of the session's main theme (e.g. `r-rem-w3-a-live-claude-journey`, `r-ui-2-5-closeout`). Do NOT write a `SESSION_HANDOFF.md` at project root.

### 1a. Gather Session Data

Run in parallel via multiple Bash tool calls:

```bash
# Git activity on the current branch
git log main..HEAD --oneline 2>/dev/null || git log --oneline -20

# Recent merges to main
git log --since="12 hours ago" --oneline --merges main 2>/dev/null

# Diff stats vs main
git diff main...HEAD --stat 2>/dev/null || true

# Current working tree state
git status --short

# Worktree inventory
git worktree list --porcelain

# Branch inventory (local + remote)
git branch -vv
git branch -r | head -20

# PRs
gh pr list --state all --limit 10
```

> **Note on issue tracking:** fluxaOS does NOT use GitHub Issues pre-alpha. Bugs and findings live in `docs/superpowers/deferred-fixes.md` as DEF-NNN entries. GitHub Issues adoption is a planned post-alpha migration. Do not run `gh issue` commands as part of session wrap-up.

### 1b. Write the Report

Produce `docs/superpowers/handoffs/YYYY-MM-DD-<slug>-session-handoff.md` with this structure (match the tone and depth of the existing files in that directory — they are the house style):

```markdown
# <Phase or Theme> — Session Handoff

**Date:** YYYY-MM-DD
**Operator:** <user> (with <model name>)
**Branch base at start:** `main` at `<sha>`
**Branch base at end:** `main` at `<sha>` (or branch name if left in-flight)
**PRs opened this session:** #NN (<title>, merged|open) — include every PR and its disposition

---

## Session Scope

One paragraph: what were we asked to do, and what judgement calls were made?

---

## What Shipped

Break down by PR. For each PR list:
- Files created / modified / deleted with one-line rationale each.
- Any scope expansions or deviations from the original plan and the justification.
- Verification matrix (tsc, vitest, verify, lint, build, each e2e spec result).

---

## Deferred Findings This Session

| ID | Title | File | Notes |
|----|-------|------|-------|
| DEF-NNN | Title | docs/superpowers/deferred-fixes.md | one-line summary |

(or: "None — no new deferred findings this session." — include explicitly so the reader doesn't wonder whether it was forgotten.)

## Open PRs Awaiting Action

| # | Title | State | Notes |
|---|-------|-------|-------|

(List open PRs the next session needs to be aware of.)

---

## Incidents & Root Causes Worth Remembering

Numbered list. Each entry:
- The symptom.
- The root cause (with file:line references).
- What caught it (test? reviewer? human verification?).
- The takeaway for future sessions.

This section is the main reason next-session agents read the handoff. Be verbose. Include quotes from commit messages or diff snippets when they clarify.

---

## Human UI Tests — Completed This Session

**This project IS a webapp (Next.js on :3003).** If code or UI changes shipped this session, document which browser-verification items the human operator ran and their outcomes. Use a checkbox list with test name and result. If this PR was docs-only, state that explicitly and skip.

- [x] Test 1 — <description> — PASS/FAIL with notes
- [x] Test 2 — ...

---

## Verification Matrix (at PR merge)

| Check | Result | Notes |
|---|---|---|
| `npx tsc --noEmit` | clean | 0 errors |
| `npx vitest run` | N/N passing | unchanged from baseline |
| `npm run verify` | 10/10 | fresh seed |
| `npm run lint` | N problems | delta vs baseline |
| `npm run build` | compiles | |
| Each `e2e/<name>.spec.ts` | PASS/SKIP | duration |
| Human browser verification | PASS | per invariant 21 |

---

## Current State

- **HEAD:** `main` at `<sha>` (shipped-PR squash-merge), in sync with `origin/main`.
- **Local branches:** `main` only (or list any preserved feature branches with rationale).
- **Remote branches:** `origin/main` only (confirm with `git branch -r`).
- **Worktrees:** one — `/mnt/dev/fluxaos` on `main` (or list).
- **Working tree:** clean.
- **Stash:** empty (or list entries).
- **Dev server:** note the current background task id and port if still running, plus any env vars it needs (`FLUXAOS_LAN_AUTH_BYPASS`, `.env.local` contents).

---

## Roadmap State

Quote the relevant rows from `docs/superpowers/roadmap.md` showing what changed status this session. Link to the phase plan and spec.

---

## Files Touched This Session

| File | Change | PR |
|---|---|---|
| ... | ... | #NN |

---

## Deferred Findings Captured

DEF-NNN entries appended to `docs/superpowers/deferred-fixes.md` during this session. One-line summary each with the DEF ID, severity, and the file:line that surfaced it. Include everything surfaced during verification that wasn't in scope for this session's PR. Match the existing house style (DEF-001 through DEF-011 are reference examples).

GitHub Issues are NOT used pre-alpha. Do not file findings via `gh issue create` — append to `docs/superpowers/deferred-fixes.md` as DEF-NNN.

---

## Memories Saved This Session

For anything saved to `/home/<user>/.claude/projects/-mnt-dev-fluxaos/memory/`, list the file path and a one-line summary. Do NOT inline the memory contents.

---

## Suggested Next-Session Prompt

See the copy-paste block delivered in the session response (Step 9 below).

---

## End of Handoff
```

Write the file:
```bash
# Write to docs/superpowers/handoffs/YYYY-MM-DD-<slug>-session-handoff.md
```

If DRY_RUN=true, print the report content to stdout instead of writing to disk.

---

## Step 2: Update Project Roadmap

- Read the current roadmap at `docs/superpowers/roadmap.md`.
- If any phase shipped this session, verify its row in the phases table is flipped to `**Done — PR #N**` and the corresponding "What's Next" item is rewritten with the shipped summary (follow the house style in the existing file — verbose, commit-referenced, includes verification matrix numbers).
- If no roadmap change is needed (e.g., docs-only session), skip this step and note that in the handoff.

Do NOT add a "Last Updated" timestamp — the git history is the timestamp.

---

## Step 3: Commit, Push, PR, Merge

> Skip this entire step if DRY_RUN=true.

### 3a. Assess Pending Work

```bash
git status --short
git stash list
git log --oneline main..HEAD 2>/dev/null || true
```

If there are **staged or unstaged changes** beyond the handoff file:

1. Ask the user: "There are uncommitted changes. Should I commit and ship them as part of this wrap-up, or leave them for the next session?"
2. If yes → follow the commit flow below.
3. If no → stash them (`git stash push -m "end-of-session: uncommitted changes $(date +%Y%m%d)"`) and note in the handoff report.

### 3b. Commit the Handoff (and Roadmap if Changed)

The handoff report typically ships as its own small PR to `main` so the squash-merge history of `main` gets one clean "docs(handoff): ..." commit per session.

```bash
# On a short-lived branch (not main — project convention is no direct pushes to main)
HANDOFF_BRANCH="docs/$(date +%Y-%m-%d)-session-handoff"
git checkout -b "$HANDOFF_BRANCH"
git add docs/superpowers/handoffs/*.md docs/superpowers/roadmap.md 2>/dev/null
git commit -m "docs(handoff): YYYY-MM-DD session handoff"
git push -u origin "$HANDOFF_BRANCH"
gh pr create --title "docs(handoff): <slug> session handoff" --body "<short body>"
```

Merge when CI passes:
```bash
gh pr merge <N> --squash --delete-branch
```

### 3c. Any feature work branches still open

If a feature branch exists with unmerged work that the operator intends to keep for the next session, DO NOT delete it. The handoff should name it explicitly.

---

## Step 4: Branch and Worktree Cleanup

> Skip destructive actions if DRY_RUN=true — report only.

### 4a. Identify What to Keep

Build a protected set — branches and worktrees that must NOT be touched:
- The current handoff branch (until its PR is merged).
- Any branch listed in the handoff's "Current State" as preserved.
- Any branch attached to an active worktree.
- Any branch tied to an open PR.

```bash
# Active worktree branches
WORKTREE_BRANCHES=$(git worktree list --porcelain | awk '/^branch /{print $2}' | sed 's|refs/heads/||')

# Branches tied to open PRs
OPEN_PR_BRANCHES=$(gh pr list --state open --json headRefName --jq '.[].headRefName' 2>/dev/null | tr '\n' ' ')

echo "Protected worktree branches: $WORKTREE_BRANCHES"
echo "Protected open-PR branches:  $OPEN_PR_BRANCHES"
```

Merge these into a single protected list used in 4b and 4c.

### 4b. Prune Merged Branches

```bash
# Fetch and prune remote tracking refs
git fetch --prune origin

# Local branches merged into main
PROTECTED="$WORKTREE_BRANCHES $OPEN_PR_BRANCHES main"
git branch --merged main | grep -v '^\*\|main' | while read branch; do
    branch=$(echo "$branch" | xargs)
    # Skip protected branches
    if echo "$PROTECTED" | grep -qw "$branch"; then
        echo "PROTECTED (skipping): $branch"
        continue
    fi
    git branch -d "$branch"
    git push origin --delete "$branch" 2>/dev/null || true
    echo "Deleted: $branch"
done
```

### 4c. Prune Stale Worktrees

```bash
# Prune stale worktree metadata
git worktree prune

# Inventory remaining worktrees
git worktree list
```

For each non-main worktree:
- If it has unpushed commits or uncommitted changes → leave it and note in handoff.
- If it is on a fully-merged branch → `git worktree remove <path>`.
- Never auto-remove a worktree the user is actively using.

---

## Step 5: Checkout Main

```bash
git fetch origin --quiet
git checkout main
git pull origin main --quiet

# Confirm
git branch --show-current   # should show: main
git log --oneline -3
git status
```

---

## Step 6: Log / Dev-Server Check

fluxaOS IS a webapp with a Next.js dev server on port 3003. There is no systemd service for this project.

- If a background dev-server task is still running from this session (check the session's open tasks), either:
  - Leave it running if the operator expects to continue immediately. Note the task id in the handoff under "Current State → Dev server."
  - Stop it with `TaskStop <id>` if this is a true end-of-context wrap.
- Scan the current conversation for any unreported console errors from the dev server. If any suggest a regression in this session's code, append a new DEF-NNN entry to `docs/superpowers/deferred-fixes.md` BEFORE closing the session.

| Finding | Action |
|---------|--------|
| Errors from this session's changes | **Append a new DEF-NNN entry to `docs/superpowers/deferred-fixes.md` before closing** — match the existing house style (severity, location, root cause, what's needed), reference the offending commit/PR |
| Pre-existing errors | Note in handoff only, or file a DEF-NNN tracking entry if the noise is ongoing |
| No errors | Proceed |

---

## Step 7: Auto-memory Digest

This project uses the auto-memory system at `/home/<user>/.claude/projects/-mnt-dev-fluxaos/memory/`. Review the session for:
- **User feedback** (corrections or approvals worth remembering for future sessions — `feedback_*.md`).
- **Project facts** (decisions, deadlines, motivations — `project_*.md`).
- **References** (external systems, dashboards, conventions — `reference_*.md`).

Save each to its own file under `memory/` and add a one-line index entry to `memory/MEMORY.md`. See the auto-memory instructions in CLAUDE.md for the full format.

Per-shipped-PR digest: for each PR merged this session, consider whether any cross-session-worthy facts emerged during the work (a non-obvious root cause, a design decision, a new pattern). If yes, add to memory. If the work was straightforward (a small bug fix, a one-line tweak), skip — memory is for things that help *future* sessions, not a log of every commit.

This project does NOT use `gh memory` CLI — that was an fh-commons vestige and is not installed here.

---

## Step 8: Final State Verification

Run and display verbatim:

```bash
git status
git stash list
git branch
git branch -r
git worktree list
```

Evaluate:
- **PASS** if: working tree clean, stash empty (or intentionally populated and documented), local branches limited to `main` + any documented preserved branches, remote branches limited to `origin/main` + any open-PR branches, worktrees limited to the main project dir + any documented preserved worktrees.
- **FAIL** if any unexpected state remains → do not declare the session closed.

---

## Step 9: Next Session Start Prompt

Print a copy-paste block for the user with:
- The phase or theme the next session should tackle (from the handoff's "Suggested Next-Session Prompt" section).
- Pre-reading: the handoff file path, the roadmap, any relevant design spec.
- A sanity-check block: fresh `npm run verify` (10/10 expected), confirm dev server port (3003).
- The first concrete action recommended for the new session.

Keep it short enough to paste into a new session prompt without overwhelming it. Aim for under 40 lines.

---

## Clean Exit

Print:

```
Session wrapped. Handoff report written to docs/superpowers/handoffs/YYYY-MM-DD-<slug>-session-handoff.md.
Repo cleaned, main checked out. Ready for next session.
```
