id: deploy
stage: deploy
description: Merge approved phase work to main. Human browser verification is MANDATORY.
default_model: sonnet

## body

# Deploy (fluxaOS — Merge and Verify)

Merge reviewed and approved phase work to main. Human verification in running browser is mandatory before marking the phase complete.

## State Transitions

| Entry State | Exit State | Condition |
|-------------|------------|-----------|
| deploy | completed | PR merged, human verified in browser |

## Workflow

### 1. Verify Review Passed

Confirm that `/review` passed (Codex approved, snapshot check passed, invariants passed). If not, redirect to `/rework`.

### 2. Create PR and Merge

```bash
BRANCH=$(git branch --show-current)
gh pr create --title "$PHASE_NAME" --body "## Phase: $PHASE_NAME

## Review
- Codex adversarial review: PASSED
- Phase snapshot check: PASSED
- Invariant verification: PASSED

## Verification
Human browser verification pending after merge."

gh pr merge --squash --delete-branch
git checkout main
git pull origin main
```

### 3. Human Verification (MANDATORY)

Tell the user:
> "Phase $PHASE_NAME merged to main. Please verify in browser:
>
> 1. Run `npm run dev`
> 2. Open http://localhost:3000
> 3. Check the specific features/pages from this phase's plan
> 4. Confirm no regressions from previous phases
>
> Reply 'verified' when confirmed, or describe what's wrong."

**STOP and WAIT for user confirmation.** Do NOT proceed without it. This is invariant #21.

### 4. Clean Up

```bash
# Remove phase snapshot
rm -f .phase-snapshot.json

# Delete restore point tag (optional — user may want to keep it)
echo "Restore point tag 'restore/...' still exists. Delete with: git tag -d restore/..."
```

### 5. Mark Complete

Tell the user:
> "Phase $PHASE_NAME complete and verified. Ready for the next phase."
