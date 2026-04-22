<!-- Manually mirrored from /mnt/dev/fh-commons/templates/reference-docs/AGENT_BEHAVIOR.md.
     fluxaOS is decoupled from fhc sync (not in projects.json), so this file does NOT
     auto-update when the fh-commons template changes. When the template is updated in
     fh-commons, copy it here manually and re-substitute {{PROJECT}} -> fluxaOS. -->
# Agent Behavior for fluxaOS

Cross-project rules for how AI agents work on fluxaOS. Project-specific tech stack, commands, and conventions live in `CLAUDE.md`; this file holds the rules that apply everywhere.

---

## AI Authority

The user wants their projects ~95% AI-managed. Most "should I do X or Y?" questions are decisions the agent has the context to make and the user doesn't. **Default to action.**

**Decide without consulting:**
- Implementation choices (libraries, patterns, file layout, algorithms)
- Design specs and plans for work already on the roadmap
- Bug-fix architecture (pick the option you'd defend in code review and ship it)
- Test strategy within the project's testing rules
- Commit messages, PR titles, branch names, doc structure
- Brainstorming outcomes — pick the recommendation, document the rejected alternatives in the spec

**Require approval first:**
- Schema migrations (irreversible at scale)
- New dependencies (adds attack surface, build time, maintenance burden)
- Roadmap changes (adding/removing/reordering phases)
- Pushes to public-facing services (PRs to the user's own private repos do NOT count)
- Production deploys

When in doubt, pick the option you'd defend in code review and ship it. If the user disagrees they'll say so.

---

## Verification

**Mechanical proof, not human eyeballs.**

The user instituted "no self-certification" because earlier agents shipped work that didn't function and claimed it did. The intent was always "AI must produce mechanical proof," not "human must look." Human verification is the fallback of last resort, not the primary gate.

**Before claiming work done:**
1. Run the project's appropriate journey/integration test that exercises the affected surface end-to-end against real systems (no mocks, no stubs).
2. Capture errors at every boundary (page errors, console errors, exit codes, log lines).
3. If no test covers the surface, **write one** before claiming done. The test locks in the verification permanently.
4. The test passing IS the verification. No human checkpoint replaces it.

**Stack-specific framing** (each project's `CLAUDE.md` should name the concrete pattern):
- Web apps: Playwright journey test in `e2e/` that clicks buttons, opens modals, asserts rendered DOM.
- iOS apps: XCUITest journey through real screens.
- CLI/services: integration test against real downstream (real DB, real API, real subprocess).
- Infrastructure: molecule/integration test that runs the actual playbook/config against a real target.

**`tsc` clean / `vitest` green / `pytest` green / CI green are prerequisites, not completion criteria.**

---

## Definition of Done

Work is not done until ALL of the following are true:

1. **PRs merged.** All PRs touching the work are merged to `main`. Open PRs awaiting review do NOT count as done.
2. **Working tree clean.** No uncommitted changes anywhere.
3. **On `main`, in sync with origin.** `git checkout main && git pull` succeeds with no surprises.
4. **Branches cleaned up.** All merged feature/fix branches deleted locally AND on origin (use `gh pr merge --delete-branch`).
5. **No stale worktrees.** If git worktrees were used, prune them.
6. **`fhc sync` run** if any `templates/**` files in fh-commons were updated as part of the work.

When the work is finished cleanly, report it as: "Done. Merged X, branches cleaned, on main at `<sha>`, working tree clean[, fhc sync run for N templates]."

---

## Don't Volunteer Cost / Time Estimates

The user does not run projects on a budget or stopwatch. Once a direction is approved, **just do the work and report progress.**

- Do not write "this will take ~N minutes" or "estimated cost ~$X."
- Do not include cost-analysis tables, budget sections, or hours-per-task projections in proposals.
- Numbers about progress (3/11 PRs done, 5 files changed) are fine. Numbers about projected effort are not.
- Legitimate exception: if a run is going to be unusually long (multi-hour autonomous, large batch), it's fine to ask "want me to chunk it?" — that's a coordination question, not a cost estimate.

---

## Don't Invent Thresholds the User Didn't Set

When a rule includes a number (budget, retry count, percentage, line limit, timeout), the number must either come from the user explicitly OR be flagged as a guess for the user to confirm.

Never write an unvalidated threshold into `CLAUDE.md`, `AGENT_BEHAVIOR.md`, settings, hooks, or any other durable artifact. Numbers feel authoritative on the page even when they were guesses; future sessions will treat them as requirements.

---

## How to use this file

`CLAUDE.md` should reference this file once at the top:

```markdown
## Agent Behavior
See [.claude/AGENT_BEHAVIOR.md](.claude/AGENT_BEHAVIOR.md) — escalation rules, verification, definition of done.
```

Project-specific rules (tech stack, commands, gotchas, project conventions) stay in `CLAUDE.md`. Cross-project rules go here. When this file changes in fh-commons, `fhc sync` propagates it to every registered project.
