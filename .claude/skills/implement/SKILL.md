id: implement
stage: implement
description: Implementation workflow adapted for fluxaOS (TypeScript/GitHub). Enforces phase scope, Edit-only for existing files, and phase snapshot discipline.
default_model: sonnet

## body

# Implement (fluxaOS — TypeScript/GitHub)

Single entry point for implementation work on fluxaOS phases. Scoped to the current phase plan. Uses Edit only for existing files.

## State Transitions

| Entry State | Exit State | Condition |
|-------------|------------|-----------|
| implement | review | Implementation complete, tsc + vitest pass |
| implement | failed | Type errors, test failures, or blocked |

## MANDATORY: Pre-Implementation Checklist

Before writing ANY code:

1. **Read the phase plan** — the user will provide the path. Your scope is LIMITED to files listed in that plan.
2. **Read CLAUDE.md** — especially the Session Protocol and Invariants sections.
3. **Create a restore point:**
   ```bash
   git tag "restore/$(date +%Y-%m-%d)-$PHASE_NAME"
   ```
4. **Generate phase snapshot:**
   ```bash
   bash .claude/hooks/phase-snapshot.sh
   ```
5. **Verify the approved mockup** (if touching UI): open `planning/mockups/dashboard-mockup.html` and reference it throughout.

## Argument Handling

### If `$ARGUMENTS` is a phase name or plan path:

Read the phase plan and proceed with the workflow below.

### If `$ARGUMENTS` is `--inline`:

Run directly in the current session (no subagent/worktree). This is the default for fluxaOS since we don't use the fhc pipeline orchestrator.

## Workflow

### 1. Read Phase Plan

Read the plan file provided by the user. Extract:
- List of files to create/modify
- Acceptance criteria
- Any specific testing requirements

**If the plan is incomplete or ambiguous:** STOP and ask the user. Do not guess.

### 2. Create Feature Branch

```bash
git checkout -b phase/$PHASE_NAME
```

### 3. Implement

Follow ALL architectural standards from CLAUDE.md:
- No hardcoded stage/provider/harness names in application code
- Zero vendor imports in core/
- Config-driven, fail fast on missing config
- Max ~500 lines per file
- DRY strictly enforced

**CRITICAL — Edit Only:**
- Use `Edit` for ALL changes to existing files
- Use `Write` ONLY for new files that don't exist yet
- The Write guard hook will block Write on existing src/app/, src/components/, src/server/ files
- When fixing type errors: BUILD the missing endpoint, don't DELETE the UI

### 4. Test

```bash
# Type check
npx tsc --noEmit

# Run integration tests (if applicable to this phase)
npx vitest run src/__tests__/integration/
```

All tests must pass. If tests fail, fix the code — do not skip or delete tests.

### 5. Pre-Commit Verification

```bash
# Check for regressions against phase snapshot
bash .claude/hooks/phase-snapshot-check.sh

# Review diff stats — flag any file that shrank significantly
git diff --stat main..HEAD

# Run invariant checks from CLAUDE.md verification protocol
grep -rn '"research"\|"implement"\|"review"\|"deploy"\|"complete"\|"rework"' src/ \
  --include='*.ts' --include='*.tsx' \
  --exclude-dir=__tests__ --exclude-dir=adapters \
  | grep -v 'seed\|fixture\|\.test\.' || echo "PASS: No hardcoded stage names"
```

### 6. Commit and Push

```bash
git add -A
git commit -m "feat: <phase description>"
git push -u origin phase/$PHASE_NAME
```

### 7. Signal Ready for Review

Tell the user:
> "Phase $PHASE_NAME implementation complete on branch `phase/$PHASE_NAME`. Ready for Codex review. Run `/review` to proceed."

### 8. STOP

Wait for the review skill. Do NOT merge, create PRs, or mark the phase complete.
