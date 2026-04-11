# Phase R3.5: Enforcement Infrastructure — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **CRITICAL:** Read CLAUDE.md first. Every invariant applies. This phase installs drift prevention tooling — no product code changes.
>
> **NOTE:** This phase does NOT follow the skill chain it installs. The skill chain becomes active for R4-V and all subsequent phases.

**Goal:** Install the session drift prevention system (Write guard hook, session protocol, phase snapshot scripts, Codex review integration, and adapted pipeline skills) so all future phases have automated enforcement against the rewrite pattern that caused 6 UI regressions.

**Architecture:** Three enforcement layers — a postToolUse hook that blocks Write on existing UI files, CLAUDE.md session protocol rules that scope agents to their phase plan, and Codex cross-model adversarial review as automated reviewer. The fh-commons skill pipeline (implement → review → rework → deploy) is adapted for TypeScript/GitHub with project-local overrides.

**Tech Stack:** fhc CLI (docs-only project type), Claude Code hooks, Codex CLI plugin (codex-companion.mjs), bash scripts, GitHub CLI (gh)

**Spec:** `docs/superpowers/specs/2026-04-11-session-drift-prevention-design.md`

---

## File Map

### New Files

| File | Responsibility |
|------|---------------|
| `.claude/hooks/write-guard.sh` | postToolUse hook: blocks Write on existing src/app/ and src/components/ files |
| `.claude/hooks/phase-snapshot.sh` | Generates .phase-snapshot.json before each phase begins |
| `.claude/hooks/phase-snapshot-check.sh` | Compares current state against .phase-snapshot.json after implementation |
| `.claude/skills/implement/SKILL.md` | Project-local override: TypeScript-adapted implement skill |
| `.claude/skills/review/SKILL.md` | Project-local override: Codex adversarial-review skill |
| `.claude/skills/rework/SKILL.md` | Project-local override: TypeScript-adapted rework skill |
| `.claude/skills/deploy/SKILL.md` | Project-local override: GitHub-adapted deploy skill |

### Modified Files

| File | Changes |
|------|---------|
| `.claude/settings.json` | Add postToolUse hook for write-guard |
| `CLAUDE.md` | Add Session Protocol section, update Current State section |
| `.gitignore` | Add `.phase-snapshot.json` |

### Files Created by fhc (not manually)

fhc sync will create many files in `.claude/` and `.agents/`. The project-local overrides above take precedence over the synced skills.

---

## Task 1: Register fluxaOS in fh-commons

**Files:**
- Created by fhc: `.fhc-config.json`, various `.claude/` files

- [ ] **Step 1: Run fhc project setup**

```bash
cd /mnt/dev/fh-commons && fhc project setup --type docs-only --project-name fluxaos --cli-name flu --description "AI orchestration OS" /mnt/dev/fluxaos
```

Expected: Project registered in fh-commons projects.json, `.fhc-config.json` created in `/mnt/dev/fluxaos/`.

- [ ] **Step 2: Verify registration**

```bash
cd /mnt/dev/fh-commons && fhc project list | grep fluxaos
```

Expected: fluxaos appears in the project list with type `docs-only`.

- [ ] **Step 3: Run initial sync for skills**

```bash
cd /mnt/dev/fh-commons && fhc sync --target skills-claude --verbose
```

Expected: Skills synced to `/mnt/dev/fluxaos/.claude/skills/`. Output shows files copied for fluxaos.

- [ ] **Step 4: Run initial sync for Codex skills**

```bash
cd /mnt/dev/fh-commons && fhc sync --target skills-codex --verbose
```

Expected: Skills synced to `/mnt/dev/fluxaos/.agents/skills/`.

- [ ] **Step 5: Run sync for remaining categories**

```bash
cd /mnt/dev/fh-commons && fhc sync --target reference-docs --verbose
cd /mnt/dev/fh-commons && fhc sync --target hooks --verbose
cd /mnt/dev/fh-commons && fhc sync --target docs --verbose
```

Expected: Reference docs, hooks, and shared docs synced to fluxaos.

- [ ] **Step 6: Verify synced files exist**

```bash
ls /mnt/dev/fluxaos/.claude/skills/implement/SKILL.md
ls /mnt/dev/fluxaos/.claude/skills/review/SKILL.md
ls /mnt/dev/fluxaos/.claude/skills/rework/SKILL.md
ls /mnt/dev/fluxaos/.claude/skills/deploy/SKILL.md
ls /mnt/dev/fluxaos/.claude/skills/restore-point/SKILL.md
ls /mnt/dev/fluxaos/.agents/skills/implement/SKILL.md
```

Expected: All files exist.

- [ ] **Step 7: Commit fhc setup**

```bash
cd /mnt/dev/fluxaos
git add .fhc-config.json .claude/ .agents/ .gitignore
git commit -m "chore: register fluxaos in fh-commons as docs-only project"
```

---

## Task 2: Install Write Guard Hook

**Files:**
- Create: `.claude/hooks/write-guard.sh`
- Modify: `.claude/settings.json`

- [ ] **Step 1: Create the hook script**

Create `.claude/hooks/write-guard.sh`:

```bash
#!/usr/bin/env bash
# Write Guard: blocks Write tool on existing UI files.
# Agents must use Edit for surgical changes to existing files.
# Write is only permitted for NEW files under protected paths.
FILE=$(echo "$CC_TOOL_INPUT" | jq -r '.file_path // empty')
if [[ -z "$FILE" ]]; then exit 0; fi

# Protected paths: src/app/, src/components/, src/server/
if [[ "$FILE" == */src/app/* || "$FILE" == */src/components/* || "$FILE" == */src/server/* ]]; then
  if [[ -f "$FILE" ]]; then
    echo "BLOCKED: Write used on existing file: $FILE"
    echo "Use Edit for surgical changes to existing files."
    echo "Write is only permitted for NEW files under src/app/, src/components/, and src/server/."
    echo "If you believe a full rewrite is necessary, explain why to the user first."
    exit 1
  fi
fi
exit 0
```

- [ ] **Step 2: Make the hook executable**

```bash
chmod +x /mnt/dev/fluxaos/.claude/hooks/write-guard.sh
```

- [ ] **Step 3: Update settings.json to register the hook**

The current `.claude/settings.json` contains only the Codex plugin enablement. Add the hook configuration while preserving the existing content:

```json
{
  "enabledPlugins": {
    "codex@openai-codex": true
  },
  "hooks": {
    "postToolUse": [
      {
        "matcher": "Write",
        "command": "bash .claude/hooks/write-guard.sh"
      }
    ]
  }
}
```

- [ ] **Step 4: Test the hook — should ALLOW Write on new file**

Create a test file to verify the hook allows new files:

```bash
# Simulate: Write to a new file (should pass)
echo '{"file_path": "/mnt/dev/fluxaos/src/app/test-new-file.tsx"}' | CC_TOOL_INPUT=$(cat) bash /mnt/dev/fluxaos/.claude/hooks/write-guard.sh
echo "Exit code: $?"
```

Expected: Exit code 0 (allowed).

- [ ] **Step 5: Test the hook — should BLOCK Write on existing file**

```bash
# Find an existing UI file
EXISTING=$(find /mnt/dev/fluxaos/src/app -name '*.tsx' | head -1)
echo "Testing with: $EXISTING"
CC_TOOL_INPUT='{"file_path": "'$EXISTING'"}' bash /mnt/dev/fluxaos/.claude/hooks/write-guard.sh
echo "Exit code: $?"
```

Expected: Exit code 1 (blocked), with "BLOCKED: Write used on existing file" message.

- [ ] **Step 6: Clean up test file and commit**

```bash
rm -f /mnt/dev/fluxaos/src/app/test-new-file.tsx
cd /mnt/dev/fluxaos
git add .claude/hooks/write-guard.sh .claude/settings.json
git commit -m "feat: install Write guard hook — blocks Write on existing UI/router files"
```

---

## Task 3: Create Phase Snapshot Scripts

**Files:**
- Create: `.claude/hooks/phase-snapshot.sh`
- Create: `.claude/hooks/phase-snapshot-check.sh`
- Modify: `.gitignore`

- [ ] **Step 1: Create the snapshot generation script**

Create `.claude/hooks/phase-snapshot.sh`:

```bash
#!/usr/bin/env bash
# Generate a snapshot of current UI file state before a phase begins.
# Run this at the start of /implement. The snapshot is compared after
# implementation to detect unplanned file removals or shrinkage.
set -euo pipefail

SNAPSHOT=".phase-snapshot.json"
TEMP="${SNAPSHOT}.tmp"

echo '{}' > "$SNAPSHOT"

find src/app src/components src/server -name '*.tsx' -o -name '*.ts' 2>/dev/null | sort | while read -r f; do
  LINES=$(wc -l < "$f")
  EXPORTS=$(grep -c "^export " "$f" 2>/dev/null || echo 0)
  jq --arg f "$f" --argjson l "$LINES" --argjson e "$EXPORTS" \
    '. + {($f): {"lines": $l, "exports": $e}}' \
    "$SNAPSHOT" > "$TEMP" && mv "$TEMP" "$SNAPSHOT"
done

COUNT=$(jq 'length' "$SNAPSHOT")
echo "Phase snapshot saved to $SNAPSHOT ($COUNT files captured)"
```

- [ ] **Step 2: Create the snapshot comparison script**

Create `.claude/hooks/phase-snapshot-check.sh`:

```bash
#!/usr/bin/env bash
# Compare current file state against the pre-phase snapshot.
# Run this after /implement, before /review.
# Reports removed files, significantly shrunk files, and lost exports.
set -euo pipefail

SNAPSHOT=".phase-snapshot.json"

if [[ ! -f "$SNAPSHOT" ]]; then
  echo "No phase snapshot found at $SNAPSHOT — skipping check."
  echo "Run .claude/hooks/phase-snapshot.sh before implementing."
  exit 0
fi

ISSUES=0

while IFS= read -r line; do
  FILE=$(echo "$line" | jq -r '.key')
  OLD_LINES=$(echo "$line" | jq -r '.value.lines')
  OLD_EXPORTS=$(echo "$line" | jq -r '.value.exports')

  if [[ ! -f "$FILE" ]]; then
    echo "REMOVED: $FILE (had $OLD_LINES lines, $OLD_EXPORTS exports)"
    ISSUES=$((ISSUES + 1))
    continue
  fi

  NEW_LINES=$(wc -l < "$FILE")
  NEW_EXPORTS=$(grep -c "^export " "$FILE" 2>/dev/null || echo 0)

  if [[ "$OLD_LINES" -gt 0 ]]; then
    LOSS=$(( (OLD_LINES - NEW_LINES) * 100 / OLD_LINES ))
    if [[ "$LOSS" -gt 20 ]]; then
      echo "SHRUNK: $FILE lost ${LOSS}% of lines ($OLD_LINES -> $NEW_LINES)"
      ISSUES=$((ISSUES + 1))
    fi
  fi

  EXPORT_LOSS=$((OLD_EXPORTS - NEW_EXPORTS))
  if [[ "$EXPORT_LOSS" -gt 0 ]]; then
    echo "EXPORTS REMOVED: $FILE lost $EXPORT_LOSS exports ($OLD_EXPORTS -> $NEW_EXPORTS)"
    ISSUES=$((ISSUES + 1))
  fi
done < <(jq -c 'to_entries[]' "$SNAPSHOT")

if [[ "$ISSUES" -gt 0 ]]; then
  echo ""
  echo "WARNING: $ISSUES potential regressions detected. Review each before approving."
  exit 1
else
  echo "Snapshot check passed — no regressions detected."
  exit 0
fi
```

- [ ] **Step 3: Make both scripts executable**

```bash
chmod +x /mnt/dev/fluxaos/.claude/hooks/phase-snapshot.sh
chmod +x /mnt/dev/fluxaos/.claude/hooks/phase-snapshot-check.sh
```

- [ ] **Step 4: Add .phase-snapshot.json to .gitignore**

Add to `.gitignore`:

```
# Phase snapshot (generated per-phase, not committed)
.phase-snapshot.json
```

- [ ] **Step 5: Test snapshot generation**

```bash
cd /mnt/dev/fluxaos
bash .claude/hooks/phase-snapshot.sh
cat .phase-snapshot.json | jq 'length'
```

Expected: Outputs a count of captured files (should be >0 since src/app/ has files).

- [ ] **Step 6: Test snapshot check — should pass with no changes**

```bash
cd /mnt/dev/fluxaos
bash .claude/hooks/phase-snapshot-check.sh
echo "Exit code: $?"
```

Expected: "Snapshot check passed — no regressions detected." Exit code 0.

- [ ] **Step 7: Commit**

```bash
cd /mnt/dev/fluxaos
git add .claude/hooks/phase-snapshot.sh .claude/hooks/phase-snapshot-check.sh .gitignore
git commit -m "feat: phase snapshot scripts — capture and compare UI state per phase"
```

---

## Task 4: Add Session Protocol to CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add Session Protocol section after invariants**

Insert the following after the `## Verification Protocol` section (after the closing ``` of the verification code block) and before `## Reference Architecture`:

```markdown
---

## Session Protocol

Rules that govern how each implementation session operates. These complement the invariants — invariants say what the code must be, the session protocol says how agents must work.

### Before Starting Any Work

1. Read the current phase plan (path will be provided in the session prompt).
2. Your scope is LIMITED to the files listed in that plan.
3. If you need to modify a file NOT in the plan, STOP and flag to the user.
4. Create a restore point: `/restore-point create <phase-name>`
5. Generate phase snapshot: `bash .claude/hooks/phase-snapshot.sh`

### During Work

6. NEVER use Write on an existing file — use Edit only. A postToolUse hook enforces this for `src/app/`, `src/components/`, and `src/server/`, but apply this discipline to ALL existing files.
7. When fixing type errors: BUILD the missing endpoint, don't DELETE the UI that calls it. The UI defines what the backend needs, not the other way around.
8. If a page references a tRPC endpoint that doesn't exist, create the endpoint.

### Before Committing

9. Review your own diff: `git diff --stat` — any file that lost >20% of its lines needs justification to the user.
10. No UI elements were removed without explicit user approval.
11. Any new endpoints referenced by UI actually exist.
12. Run snapshot check: `bash .claude/hooks/phase-snapshot-check.sh` — fix any regressions before committing.

### After Committing (before marking complete)

13. Run Codex adversarial review on the feature branch (the /review skill handles this).
14. No phase is complete until the user verifies it in a running browser (invariant #21 — restated here for emphasis).
```

- [ ] **Step 2: Update the Current State section**

Replace the existing `## Current State` section with:

```markdown
## Current State

Phases R1-R3 complete and verified (rich issue model, 23 integration tests, catalog-driven UI). R4 (gate engine) and R5 (pipeline engine) are committed but NOT verified by user in browser. The UI has drifted from the approved mockup at `planning/mockups/dashboard-mockup.html` due to multiple rewrites — see `docs/rca/2026-04-11-ui-regression-rca.md` for the full root cause analysis.

Phase R3.5 (enforcement infrastructure) installs drift prevention tooling. All subsequent phases use the skill chain: `/implement → /review (Codex) → /rework → /deploy`.

**Remaining phases:** R3.5 → R4-V (verify gate engine) → R5-V (verify pipeline engine) → R-UI (mockup reconciliation) → R6 (polish + ship). See `docs/superpowers/specs/2026-04-11-session-drift-prevention-design.md` for the full revised roadmap.
```

- [ ] **Step 3: Commit**

```bash
cd /mnt/dev/fluxaos
git add CLAUDE.md
git commit -m "docs: add Session Protocol and update Current State in CLAUDE.md"
```

---

## Task 5: Create Project-Local Implement Skill

**Files:**
- Create: `.claude/skills/implement/SKILL.md` (overrides fhc-synced version)

- [ ] **Step 1: Create the implement skill override**

This skill replaces the fhc-synced implement skill with a TypeScript/GitHub-adapted version. It preserves the workflow structure but replaces Python-specific tooling with TypeScript equivalents and removes fhc CLI dependencies.

Create `.claude/skills/implement/SKILL.md`:

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
cd /mnt/dev/fluxaos
git add .claude/skills/implement/SKILL.md
git commit -m "feat: project-local implement skill — TypeScript/GitHub adapted"
```

---

## Task 6: Create Project-Local Review Skill

**Files:**
- Create: `.claude/skills/review/SKILL.md` (overrides fhc-synced version)

- [ ] **Step 1: Create the review skill override**

Create `.claude/skills/review/SKILL.md`:

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
cd /mnt/dev/fluxaos
git add .claude/skills/review/SKILL.md
git commit -m "feat: project-local review skill — Codex adversarial review"
```

---

## Task 7: Create Project-Local Rework Skill

**Files:**
- Create: `.claude/skills/rework/SKILL.md` (overrides fhc-synced version)

- [ ] **Step 1: Create the rework skill override**

Create `.claude/skills/rework/SKILL.md`:

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
cd /mnt/dev/fluxaos
git add .claude/skills/rework/SKILL.md
git commit -m "feat: project-local rework skill — address Codex review feedback"
```

---

## Task 8: Create Project-Local Deploy Skill

**Files:**
- Create: `.claude/skills/deploy/SKILL.md` (overrides fhc-synced version)

- [ ] **Step 1: Create the deploy skill override**

Create `.claude/skills/deploy/SKILL.md`:

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
cd /mnt/dev/fluxaos
git add .claude/skills/deploy/SKILL.md
git commit -m "feat: project-local deploy skill — merge with mandatory browser verification"
```

---

## Task 9: Verify Codex Integration

**Files:** None created — verification only.

- [ ] **Step 1: Verify Codex is authenticated**

```bash
cd /mnt/dev/fluxaos
node /home/jpierce/.claude/plugins/cache/openai-codex/codex/1.0.3/scripts/codex-companion.mjs setup --json 2>&1 | jq '.ready'
```

Expected: `true`

- [ ] **Step 2: Create a test branch with a small change**

```bash
cd /mnt/dev/fluxaos
git checkout -b test/codex-review-verification
echo "// test file for codex review verification" > src/app/test-codex-verify.ts
git add src/app/test-codex-verify.ts
git commit -m "test: verify codex adversarial review"
```

- [ ] **Step 3: Run Codex adversarial review against the test branch**

```bash
cd /mnt/dev/fluxaos
node /home/jpierce/.claude/plugins/cache/openai-codex/codex/1.0.3/scripts/codex-companion.mjs adversarial-review --scope branch --base main
```

Expected: Codex returns a review with a verdict. The content doesn't matter — we're verifying the integration works.

- [ ] **Step 4: Clean up test branch**

```bash
cd /mnt/dev/fluxaos
git checkout main
git branch -D test/codex-review-verification
```

- [ ] **Step 5: Verify the full skill chain invocation works**

In Claude Code, test that the skills are discoverable:

```
/implement --help
/review --help
/deploy --help
/rework --help
/restore-point --help
```

Expected: Each skill loads and displays its description. The project-local overrides should take precedence for implement/review/rework/deploy.

---

## Task 10: Final Verification and Summary Commit

**Files:** None created — verification only.

- [ ] **Step 1: Verify all enforcement layers are in place**

```bash
cd /mnt/dev/fluxaos

echo "=== Write Guard Hook ==="
test -x .claude/hooks/write-guard.sh && echo "PASS: write-guard.sh exists and is executable" || echo "FAIL"
grep -q "write-guard" .claude/settings.json && echo "PASS: hook registered in settings.json" || echo "FAIL"

echo ""
echo "=== Phase Snapshot Scripts ==="
test -x .claude/hooks/phase-snapshot.sh && echo "PASS: phase-snapshot.sh exists and is executable" || echo "FAIL"
test -x .claude/hooks/phase-snapshot-check.sh && echo "PASS: phase-snapshot-check.sh exists and is executable" || echo "FAIL"

echo ""
echo "=== Project-Local Skills ==="
test -f .claude/skills/implement/SKILL.md && echo "PASS: implement skill override" || echo "FAIL"
test -f .claude/skills/review/SKILL.md && echo "PASS: review skill override" || echo "FAIL"
test -f .claude/skills/rework/SKILL.md && echo "PASS: rework skill override" || echo "FAIL"
test -f .claude/skills/deploy/SKILL.md && echo "PASS: deploy skill override" || echo "FAIL"

echo ""
echo "=== CLAUDE.md Session Protocol ==="
grep -q "Session Protocol" CLAUDE.md && echo "PASS: Session Protocol section exists" || echo "FAIL"

echo ""
echo "=== Codex Integration ==="
node /home/jpierce/.claude/plugins/cache/openai-codex/codex/1.0.3/scripts/codex-companion.mjs setup --json 2>&1 | jq -r 'if .ready then "PASS: Codex ready" else "FAIL: Codex not ready" end'

echo ""
echo "=== .gitignore ==="
grep -q "phase-snapshot" .gitignore && echo "PASS: .phase-snapshot.json in .gitignore" || echo "FAIL"
```

Expected: All PASS.

- [ ] **Step 2: Run the full enforcement flow end-to-end (dry run)**

```bash
cd /mnt/dev/fluxaos

# 1. Generate snapshot
bash .claude/hooks/phase-snapshot.sh

# 2. Verify snapshot check passes (no changes yet)
bash .claude/hooks/phase-snapshot-check.sh

# 3. Verify write guard blocks existing file
EXISTING=$(find src/app -name '*.tsx' | head -1)
CC_TOOL_INPUT='{"file_path": "'$EXISTING'"}' bash .claude/hooks/write-guard.sh 2>&1 || echo "(blocked as expected)"

# 4. Clean up snapshot
rm -f .phase-snapshot.json
```

Expected: Snapshot generates, check passes, write guard blocks.

- [ ] **Step 3: Verify git state is clean**

```bash
cd /mnt/dev/fluxaos
git status
git log --oneline -5
```

Expected: Clean working tree. Recent commits show the enforcement infrastructure additions.

---

## Exit Criteria

All of the following must be true:

1. fluxaOS is registered in fh-commons as `docs-only` project
2. Skills synced to `.claude/skills/` and `.agents/skills/`
3. Write guard hook installed and blocks Write on existing UI/router files
4. Phase snapshot scripts generate and compare correctly
5. CLAUDE.md has Session Protocol section with updated Current State
6. Project-local skill overrides exist for implement/review/rework/deploy
7. Codex adversarial review runs successfully against a test branch
8. `.phase-snapshot.json` is in `.gitignore`

**After this phase:** All subsequent phases (R4-V, R5-V, R-UI, R6) use the full skill chain: `/implement → /review (Codex) → /rework → /deploy`.
