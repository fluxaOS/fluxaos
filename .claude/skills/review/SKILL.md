id: review
stage: review
description: Automated Codex adversarial review for fluxaOS phases. Cross-model review eliminates self-certification.
default_model: sonnet

## body

# Review (fluxaOS — Codex Adversarial Review)

Automated code review using OpenAI Codex. A different model reviews the implementing model's work.

## State Transitions

| Entry State | Exit State | Condition |
|-------------|------------|-----------|
| review | deploy | Codex review passes + snapshot check passes |
| review | rework | Codex review finds issues |

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

If the check reports regressions, the review FAILS immediately. Enter rework.

### 3. Run Codex Adversarial Review

```bash
CODEX_SCRIPT="${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs"
node "$CODEX_SCRIPT" adversarial-review --scope branch --base main
```

Read the Codex output. The adversarial review actively looks for:
- Removed functionality without justification
- Missing error handling
- Security issues
- Logic errors
- Scope creep beyond the phase plan

### 4. Run Invariant Verification

```bash
# From CLAUDE.md verification protocol
grep -rn '"research"\|"implement"\|"review"\|"deploy"\|"complete"\|"rework"' src/ \
  --include='*.ts' --include='*.tsx' \
  --exclude-dir=__tests__ --exclude-dir=adapters \
  | grep -v 'seed\|fixture\|\.test\.' || echo "PASS: No hardcoded stage names"

grep -rn '"anthropic"\|"openai"\|"claude"\|"gpt"' src/ \
  --include='*.ts' --include='*.tsx' \
  --exclude-dir=adapters \
  | grep -v 'seed\|fixture\|\.test\.' || echo "PASS: No hardcoded provider names"
```

### 5. Verdict

**If snapshot check passes AND Codex approves AND invariants pass:**

Tell the user:
> "Review PASSED. Codex adversarial review found no blocking issues. Snapshot check passed. Ready for deploy. Run `/deploy` to merge and verify in browser."

Proceed to deploy state.

**If ANY check fails:**

Tell the user:
> "Review FAILED. Issues found:
> [list specific issues from Codex output and/or snapshot check]
>
> Run `/rework` to address these issues."

Enter rework state.

### 6. STOP

Wait for the user to run `/deploy` or `/rework`. Do NOT merge or modify code.
