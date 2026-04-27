# Deferred Fixes — Frozen

This file is **frozen as of 2026-04-26**. It used to track deferred issues inline in this repo. That tracking has moved to **Linear** to prevent two-places-to-update drift.

## Where deferred issues live now

- **Linear team:** `FLX` (workspace `rebos`)
- **Bugs / deferred fixes / tech debt:** team backlog, no project assignment
- **Active alpha-blocking work:** **fluxaOS Alpha** project (verification-matrix-driven)
- **Parked features for later:** **fluxaOS Post-Alpha Wishlist** project

## Where to file a new deferred finding

Use the Linear MCP from any agent session: `mcp__plugin_linear_linear__save_issue` with `team: "FLX"`. No project assignment for routine bugs — they live at team level. If the bug blocks alpha verification, assign it to the **fluxaOS Alpha** project.

## Historical record

The pre-freeze contents of this file are preserved in git history. To read them: `git log --follow docs/superpowers/deferred-fixes.md` then `git show <commit>:docs/superpowers/deferred-fixes.md`. Most resolved entries have been imported into Linear and closed there with provenance.

## Why this changed

Two reasons:
1. **Single source of truth.** Issues tracked in two places never stay in sync — one drifts, the other rots.
2. **Discoverability.** Linear has search, filters, and project views; a flat markdown file does not.

The boundary going forward: Linear holds **work items** (bugs, features, tasks). The repo holds **specs, plans, handoffs, RCAs, lessons learned, and the verification matrix** — content that benefits from PR-review and git-versioning.
