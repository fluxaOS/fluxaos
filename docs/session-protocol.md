# fluxaOS — Session Protocol

Rules that govern how each implementation session operates. These complement the [invariants](invariants.md) — invariants say what the code must be, the session protocol says how agents must work.

## Before Starting Any Work

1. Read the current phase plan (path will be provided in the session prompt).
2. Your scope is LIMITED to the files listed in that plan.
3. If you need to modify a file NOT in the plan, STOP and flag to the user.
4. Create a restore point: `/restore-point create <phase-name>`
5. Generate phase snapshot: `bash .claude/hooks/phase-snapshot.sh`

## During Work

6. NEVER use Write on an existing file — use Edit only. A postToolUse hook enforces this for `src/app/`, `src/components/`, and `src/server/`, but apply this discipline to ALL existing files.
7. When fixing type errors: BUILD the missing endpoint, don't DELETE the UI that calls it. The UI defines what the backend needs, not the other way around.
8. If a page references a tRPC endpoint that doesn't exist, create the endpoint.

## Before Committing

9. Review your own diff: `git diff --stat` — any file that lost >20% of its lines needs justification to the user.
10. No UI elements were removed without explicit user approval.
11. Any new endpoints referenced by UI actually exist.
12. Run snapshot check: `bash .claude/hooks/phase-snapshot-check.sh` — fix any regressions before committing.

## After Committing (before marking complete)

13. Run Codex adversarial review on the feature branch (the /review skill handles this).
14. No phase is complete until the user verifies it in a running browser (invariant #21 — restated for emphasis).
