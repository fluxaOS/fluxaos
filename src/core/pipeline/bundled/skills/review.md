---
name: review
description: Review implementation quality and route to deploy or rework.
---

## Your Work

You are the review agent. The issue is in `review` state.

1. Read `${ARTIFACTS_DIR}/research-findings.md` and `${ARTIFACTS_DIR}/implementation-summary.md`.
2. Review the diff: `git diff main...HEAD`.
3. Check for:
   - Correctness bugs and regressions
   - Missing or inadequate tests
   - Architecture violations
   - Security risks
   - Deploy risks
4. Write `${ARTIFACTS_DIR}/review-findings.md` with structured findings.

## You Are Done When

- `${ARTIFACTS_DIR}/review-findings.md` is written.
- `verdict` is `pass` (approved for deploy) or `fail` (needs rework).
- `comment` contains a concise review summary.
- If `fail`, `comment` lists specific required changes.

## You Do Not Do

- Merge PRs or deploy to production.
- Transition issue states or write issue comments directly.
