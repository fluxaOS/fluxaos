# FLX-106 Skill Audit Session Handoff

Date: 2026-05-01

## Summary

The internal development build exposed a major workflow gap in FLX-106. The
first DB-seeded skill pass was not a usable adaptation of the fh-commons
research -> implement -> review -> rework -> deploy workflow. It translated
role intent into prompt text, but it did not audit the command-side
responsibilities those skills depend on.

The important correction: do not assume a responsibility is missing just because
fh-commons used an `fhc` command for it. Many responsibilities already exist in
fluxaOS under different APIs. The gap is partly missing capability and partly
missing orchestration/skill contract.

Authoritative audit:

- `docs/superpowers/audits/2026-05-01-flx-106-skill-command-audit.md`

Linear:

- `FLX-106` was reopened to In Progress.
- The issue now represents a development gap, not a completed seed-data task.

## What Already Exists In Flux

Do not rebuild these blindly. Map the workflow to them first.

- Issue list/view/create via `issue.list`, `issue.getByNumber`,
  `issue.getById`, `issue.create`.
- Issue comments via `issue.comment.*`.
- Issue transitions via `issue.transition`, `issueService.transition`, and
  `stateOverride`.
- Issue close/reopen behavior in `issueService.close` and
  `issueService.reopen`.
- Parent/child issue hierarchy.
- Worktree acquire/release through the isolation provider.
- Per-run artifacts and artifact inheritance.
- `flux:signal` parsing and stage-run signal storage.
- Stage and issue activity events.
- Branch naming and auto-commit behavior.
- PR creation and DB recording through the deploy bridge.
- Pipeline/stage CRUD.
- Manual stage trigger and held-stage approval.
- Cleanup sweep and PR-close cleanup.

## What Is Present But Not Wired

These are especially important for tomorrow's brainstorming session.

- Stage agents cannot reliably write issue comments through a documented flux
  contract.
- `flux:signal` has no generic target-state success outcome.
- Deploy completion does not close the issue through the deploy-stage outcome.
- Reopen/return-to-research is not a first-class stage outcome.
- Review approve/reject cannot atomically attach findings and transition to
  deploy/rework.
- There is no `pat pipeline exit` equivalent that records result, summary,
  status/state, comment, and terminal run state in one operation.
- PR/branch metadata exists in DB, but review/rework/deploy skills are not
  explicitly given it.

## Actually Missing Capabilities

- General issue dependency/blocker model.
- GitHub PR merge/list implementation in the provider adapter.
- Remote branch deletion / PR cleanup command.
- Production deploy operation as a first-class flux action.
- Version/release tagging.
- App-level log discovery/checking exposed to skills.
- Backup/snapshot preflight.
- Base-branch pre-existing failure verifier.
- Structured review evidence model.
- Skill queue modes such as next, parallel, inline, quick-fix, standalone, and
  pipeline modes.

## Unsafe Current Seed

Do not dogfood the current `Standard Dev` workflow as-is.

- `rework` is seeded as a normal sequential stage, so a passing review can
  proceed to rework.
- `deploy` is manual-gated, which can leave a run non-terminal and interfere
  with cleanup.
- `proceed` means next `sortOrder`, not target issue state.
- The deploy bridge opens PRs at terminal time, but review/deploy need PR
  context before terminal time.
- Held/blocked/manual paths need a deterministic release contract.

## Tomorrow's Brainstorming Target

Decide the product/workflow model before implementing fixes:

1. Stage-per-run issue lifecycle:
   - Each issue state maps to one runnable stage.
   - Stage output declares the next target state.
   - The run completes and cleanup/release happens deterministically.
   - This fits the current UI best.

2. Single conditional pipeline graph:
   - Pipeline needs graph/edge semantics, not `sortOrder`.
   - Review pass routes to deploy.
   - Review fail routes to rework.
   - Rework routes back to review.
   - Deploy bridge becomes stage-aware instead of terminal-hook-only.

The current implementation is neither model cleanly.

## Suggested Next-Session Prompt

Continue fluxaOS from main after the FLX-106 audit handoff. Read:

- `docs/superpowers/handoffs/2026-05-01-flx-106-skill-audit-session-handoff.md`
- `docs/superpowers/audits/2026-05-01-flx-106-skill-command-audit.md`

Run a brainstorming session for the workflow repair. Treat FLX-106 as reopened
development work. The goal is to plan the fixes needed to make the real
research -> implement -> review -> rework -> deploy loop usable in fluxaOS
without assuming old `fhc` command names imply missing capability.
