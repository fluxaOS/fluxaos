# FLX-233 — Remove stash from agent workflows

**Status:** approved (auto-mode brainstorm 2026-05-18)
**Linear:** [FLX-233](https://linear.app/rebos/issue/FLX-233/parallel-worktrees-share-git-stash-namespace-collisions-during-multi)

## Problem

`git stash` operates on the repository (shared `.git` dir), not the worktree.
With N parallel-worktree agents, every `git stash push`/`pop` operates on a
single repo-wide stack — any agent can pop any other agent's stash.

The existing convention in CLAUDE.md (require `<owner>:` prefix, audit flags
unowned) catches drift but does not prevent interference: agent B can pop
agent A's correctly-labelled stash and silently mix WIP.

## Decision

Stop using `git stash` from agent workflows. Use temp commits instead.

Stash is fundamentally the wrong primitive for parallel-worktree work — it has
no namespacing layer in git ≤ 2.43. Temp commits are addressable by SHA, scoped
to the agent's own branch, and survive across worktrees without collision.

## Recipes (replace the three legitimate stash use cases)

### Pull while dirty

```
# old
git stash push -m "agent: pre-pull"
git pull --rebase origin main
git stash pop

# new
git commit -am "wip: pre-pull"
git pull --rebase origin main
git reset --soft HEAD~1
```

### Inspect main mid-edit

```
# old
git stash push -m "agent: inspect"
git checkout main
... look ...
git checkout -
git stash pop

# new (option A — diff in place)
git diff main..HEAD -- <path>

# new (option B — second worktree on main)
git worktree add /tmp/inspect-main main
... look in /tmp/inspect-main ...
git worktree remove /tmp/inspect-main
```

### Recoverable abandon

```
# old
git stash push -m "agent: PROTECTED: abandoned approach"
... start over ...

# new
git commit -am "wip: abandoned approach, may revisit"
git checkout main
# branch still exists with the WIP commit on its tip; pick or drop later
```

## Changes

1. **CLAUDE.md** — under `## Worktrees & Hooks`, replace the "Stash convention"
   stanza with a "No stash in agent workflows" rule. Inline the three recipes
   (~12 lines, compact enough).

2. **`.claude/AGENT_BEHAVIOR.md`** — add a one-paragraph rule next to Linear
   hygiene / Definition of done: agents never `git stash`; use temp commits;
   see CLAUDE.md.

3. **`ops/git-hooks/session-audit.sh`** — change stash classification to two
   buckets:
   - `STASH_PROTECTED` — entries whose subject begins with `PROTECTED:`.
     Silent. Explicit human escape hatch.
   - `STASH_ADVISORY` — every other stash entry (owned or unowned). Shown
     under an `ADVISORY` section in the report banner with text "agent
     should not be using git stash; see CLAUDE.md `## Worktrees & Hooks`".
   - Emitted in the JSON output as `stash_protected` and `stash_advisory`.
   - `prune` mode never touches stashes (unchanged).

4. **`ops/git-hooks/pre-push`** — keep existing blocking behavior but rename
   the counted bucket. Currently it counts `stash_orphan` (unowned-prefix
   stashes) toward `problems`. Switch the JSON key it reads to
   `stash_advisory` (the same set under the new naming) so the hook still
   blocks pushes when an unlabelled or old-`<owner>:`-style stash is present,
   but stashes prefixed `PROTECTED:` (human escape hatch) still pass.
   Net behavior: a push with a stash labelled `WIP: foo` now fails where it
   previously passed — the old `<owner>:` / `WIP:` convention is retired.
   `PROTECTED:` continues to pass.

## Why not the alternatives

- **`flux stash` wrapper** — adds tooling that endorses the pattern we're
  removing. New surface to maintain, no benefit over temp commits.
- **Block-on-push (any stash fails the push)** — too coercive. Legitimate
  human-at-keyboard stashes exist; `PROTECTED:` was designed for them.
- **Agent-id stash messages + audit refusing `pop` on mismatch** — possible
  but requires wrapping `git stash pop` or adding a pre-pop hook (git has
  none). Higher complexity than just not using stash.
- **Per-worktree stash via git** — not available in git 2.43.0.

## Acceptance

- CLAUDE.md and AGENT_BEHAVIOR.md state the rule and link to the recipes.
- `bash ops/git-hooks/session-audit.sh report` flags any non-`PROTECTED:`
  stash as an advisory.
- Each recipe verified end-to-end against the current repo in a scratch
  worktree before merging.

## Out of scope

- A `flux stash` helper.
- Pre-push hook changes.
- Other shared-state surfaces (`.git/index.lock`, branch refs).
