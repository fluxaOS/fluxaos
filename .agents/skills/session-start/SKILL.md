---
name: "session-start"
id: "session-start"
description: "Session orientation ritual for fluxaOS. Verifies the repo is in a clean-enough state to start work (flagging, not cleaning), then orients the agent to current work: 72h git activity, open PRs, recent handoffs, in-flight specs/plans, deferred fixes. Writes a session-start marker to project auto-memory. Run at the start of every agent context session."
default_model: "sonnet"
---

# Session Start — fluxaOS

Start every agent context session from a clean slate, then orient to current work.

fluxaOS is decoupled from fh-commons — there is no `flu` CLI, no Forgejo, no `flu memory` command. This skill uses plain git, `gh` for GitHub, file-based auto-memory, and fluxaOS's handoff convention in `docs/superpowers/handoffs/`.

## Usage

```
/session-start                  # Verify + orient + write marker
```

**Arguments:** `$ARGUMENTS`

---

## Step 1: Clean-Slate Check (verify-only)

Set `DRY_RUN=true` and `PRESERVE_BRANCHES=true` so this step only reports — no cleanup, no deletions — at session start.

### Clean-Slate Contract

A session starts with the repo in this state:

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

Classify each non-main branch, worktree, and stash entry as PROTECTED (with the reason) or UNPROTECTED.

### Verification (verify-only at session-start)

Run once:

```bash
git fetch --prune origin
git status && git stash list && git branch && git branch -r && git worktree list
```

Evaluate against the contract. Classify every candidate. Do NOT delete anything at session-start.

- **PASS:** print `✓ Clean slate verified.` plus any PROTECTED items with reasons.
- **FAIL:** list the unprotected items and ask:

```
Repo has unprotected items from prior work. Options:
  (s) start anyway — items remain as session flags
  (c) clean up first — invoke /housekeeping, then continue
  (a) abort

Default on empty input: s
```

- **s** (or empty): continue. Include the flag list in the ready summary.
- **c**: invoke the `housekeeping` skill, then continue.
- **a**: stop. Do not write a session-start marker.

---

## Step 2: Orient

Gather current work context. Prose summary, no fixed template.

```bash
git log --since="72 hours ago" --oneline
gh pr list --state open --json number,title,headRefName --jq '.[] | "#\(.number) \(.title) [\(.headRefName)]"'
ls -t docs/superpowers/handoffs/ 2>/dev/null | head -3
ls docs/superpowers/specs/ docs/superpowers/plans/ 2>/dev/null | tail -10
```

Check what's in flight:

- **Roadmap:** `docs/superpowers/roadmap.md` — look at "What's Next" section.
- **Deferred fixes:** `docs/superpowers/deferred-fixes.md` — grep for open DEF-NNN entries (not `[RESOLVED]`).
- **Recent handoffs:** read the most recent handoff in `docs/superpowers/handoffs/` to catch session-to-session context.
- **Auto-memory:** most recent entries in `/home/jpierce/.claude/projects/-mnt-dev-fluxaos/memory/` — the `MEMORY.md` index is auto-inlined at session start, scan it for any entry that looks relevant to the next-action item.

Write a brief orientation summary: what's in flight (specs/plans/active branches), what's blocked or awaiting review, what looks like the natural next action per the roadmap. Keep it short — a handful of lines, not a report.

---

## Step 3: Write Session-Start Marker

fluxaOS has no memory CLI. Markers live as files in the auto-memory directory:

```
/home/jpierce/.claude/projects/-mnt-dev-fluxaos/memory/session/
```

Write one marker file per session:

```
/home/jpierce/.claude/projects/-mnt-dev-fluxaos/memory/session/session-start-<ISO8601>.md
```

Contents:

```markdown
---
name: "session-start <ISO8601>"
description: "Session start marker for fluxaOS at <ISO8601>"
type: "project"
---

# Session Start

Started: <ISO8601 with offset>
Branch at start: <current branch>
Origin main at start: <short SHA>

## Orientation (from Step 2)

<paste or summarize the orientation summary>
```

The file name's timestamp is the source of truth — `session-end` will parse it to find this marker. Use ISO-8601 with offset (e.g. `2026-04-22T01:47:00-07:00`) so timezone math is unambiguous. Create the `session/` directory if missing.

If the filesystem write fails, print a one-line warning and continue — do not block session start. Orientation is the point; the marker is bookkeeping.

---

## Step 4: Ready Summary

One line:

```
Session oriented. <N PRs open>, repo <clean|N flags: reasons>, <N plans in flight>, next likely action: <inferred from roadmap/deferred-fixes>.
```

If Step 1 had FAIL flags and the user chose `s`, list the flag reasons in place of "clean".
