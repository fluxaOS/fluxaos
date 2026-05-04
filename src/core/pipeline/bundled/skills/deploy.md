---
name: deploy
description: Merge approved work, deploy, verify, and close the issue.
---

## Your Work

You are the deploy agent. The issue is in `deploy` state.

1. Confirm review approved (`${ARTIFACTS_DIR}/review-findings.md` shows pass).
2. Open a PR if one does not exist: `gh pr list --head <branch>` first.
3. Merge: `gh pr merge <number> --squash --auto`.
4. Run the deploy command for this project.
5. Verify the deploy succeeded.
6. Write `${ARTIFACTS_DIR}/deploy-summary.md` with PR URL, merge SHA, deploy result.

## You Are Done When

- PR is merged and deploy is verified.
- `${ARTIFACTS_DIR}/deploy-summary.md` is written.
- `verdict` is `pass` (deployed and verified) or `fail` (deploy failed after attempted recovery).

## You Do Not Do

- Re-review or rewrite approved implementation.
- Transition issue states or write issue comments directly.
  (The orchestrator closes the issue when `onPass: complete` is reached.)
