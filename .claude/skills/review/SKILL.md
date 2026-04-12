id: review
stage: review
description: Pre-deploy verification for fluxaOS phases. Runs snapshot check, invariant verification, and type/test checks. Codex stop-time review gate handles cross-model review automatically.
default_model: sonnet

## body

# Review (fluxaOS — Pre-Deploy Verification)

Verification gate before merging phase work. Runs all automated checks that the implementing agent can perform. The Codex cross-model review is handled separately by the stop-time review gate (enabled via `/codex:setup --enable-review-gate`) — it fires automatically when the implementing session ends, outside of any agent's control.

## Two-Layer Review Architecture

**Layer 1 — This skill (agent-run, same session):**
- Phase snapshot regression check
- Invariant verification (no hardcoded names)
- Type check (tsc --noEmit)
- Integration tests (vitest)
- Diff stats review (flag significant shrinkage)

**Layer 2 — Codex stop-time review gate (automatic, no agent control):**
- Fires when the implementing session stops
- Different model (GPT) reviews Claude's work
- Agent cannot skip, delay, or manipulate this review
- Results appear at the start of the next session

## State Transitions

| Entry State | Exit State | Condition |
|-------------|------------|-----------|
| review | deploy | All Layer 1 checks pass |
| review | rework | Any Layer 1 check fails |

Note: Layer 2 (Codex) may reject work even after Layer 1 passes. The user handles Codex findings in the next session.

## Workflow

### 1. Verify Branch Exists

```bash
git fetch origin
BRANCH=$(git branch --show-current)
if [[ "$BRANCH" == "main" ]]; then
  echo "ERROR: You must be on a feature branch, not main."
  exit 1
fi
echo "Reviewing branch: $BRANCH"
```

### 2. Run Phase Snapshot Check

```bash
bash .claude/hooks/phase-snapshot-check.sh
```

If the check reports regressions (removed files, shrunk files, lost exports), the review FAILS immediately. Enter rework.

### 3. Run Invariant Verification

```bash
# No hardcoded stage names in application code
grep -rn '"research"\|"implement"\|"review"\|"deploy"\|"complete"\|"rework"' src/ \
  --include='*.ts' --include='*.tsx' \
  --exclude-dir=__tests__ --exclude-dir=adapters \
  | grep -v 'seed\|fixture\|\.test\.' || echo "PASS: No hardcoded stage names"

# No hardcoded provider names in application code
grep -rn '"anthropic"\|"openai"\|"claude"\|"gpt"' src/ \
  --include='*.ts' --include='*.tsx' \
  --exclude-dir=adapters \
  | grep -v 'seed\|fixture\|\.test\.' || echo "PASS: No hardcoded provider names"
```

If any hardcoded names found, the review FAILS. Enter rework.

### 4. Run Type Check

```bash
npx tsc --noEmit 2>&1 | head -30
```

If type errors exist, the review FAILS. Enter rework.

### 5. Run Integration Tests

```bash
npx vitest run src/__tests__/integration/ 2>&1 | tail -20
```

If tests fail, the review FAILS. Enter rework.

### 6. Review Diff Stats

```bash
git diff --stat main..HEAD
```

Flag any file that lost significant lines. This is informational — the snapshot check (step 2) is the hard gate.

### 7. Verify Codex Review Gate Is Enabled

```bash
node /home/jpierce/.claude/plugins/cache/openai-codex/codex/1.0.3/scripts/codex-companion.mjs setup --json 2>&1 | python3 -c "import json,sys; d=json.load(sys.stdin); print('Codex review gate:', 'ENABLED' if d.get('reviewGateEnabled') else 'DISABLED')"
```

If the gate is disabled, WARN the user:
> "WARNING: Codex stop-time review gate is not enabled. Run `/codex:setup --enable-review-gate` to enable it. The implementing session's work will not be automatically reviewed by Codex without this gate."

### 8. Verdict

**If ALL checks pass (steps 2-5):**

Tell the user:
> "Layer 1 review PASSED:
> - Phase snapshot: no regressions
> - Invariants: no hardcoded names
> - Type check: zero errors
> - Integration tests: all passing
> - Codex review gate: [ENABLED/DISABLED]
>
> Ready for deploy. Run `/deploy` to merge and verify in browser.
>
> Note: The Codex stop-time review gate will automatically review this work when the session ends. If Codex finds issues, they will surface in the next session."

**If ANY check fails:**

Tell the user:
> "Review FAILED. Issues found:
> [list specific failures from each step]
>
> Run `/rework` to address these issues."

### 9. STOP

Wait for the user to run `/deploy` or `/rework`. Do NOT merge or modify code.
