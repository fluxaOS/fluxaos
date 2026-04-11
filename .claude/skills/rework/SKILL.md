id: rework
stage: rework
description: Address Codex review feedback for fluxaOS phases. Fix issues using Edit only.
default_model: sonnet

## body

# Rework (fluxaOS — Address Review Feedback)

Fix issues identified by Codex adversarial review. Push to the same branch and re-trigger review.

## State Transitions

| Entry State | Exit State | Condition |
|-------------|------------|-----------|
| rework | review | Rework complete, tsc + vitest pass |
| rework | failed | Cannot resolve review feedback |

## Workflow

### 1. Read Review Feedback

Read the Codex review output from the previous `/review` run. Extract each specific issue.

### 2. Stay on Existing Branch

Do NOT create a new branch. The feature branch already exists.

```bash
git checkout phase/$PHASE_NAME
```

### 3. Address Each Issue

For each issue from the Codex review:
1. Make the fix using `Edit` (NEVER `Write` on existing files)
2. Verify the fix addresses the reviewer's concern
3. Check the fix doesn't break adjacent code

### 4. Test

```bash
npx tsc --noEmit
npx vitest run src/__tests__/integration/
```

### 5. Pre-Commit Verification

```bash
bash .claude/hooks/phase-snapshot-check.sh
git diff --stat main..HEAD
```

### 6. Commit and Push

```bash
git add -A
git commit -m "fix: address review feedback for $PHASE_NAME"
git push origin phase/$PHASE_NAME
```

### 7. Signal Ready for Re-Review

Tell the user:
> "Rework complete. Review feedback addressed. Run `/review` to re-review."

### 8. STOP

Wait for `/review`. Do NOT merge.
