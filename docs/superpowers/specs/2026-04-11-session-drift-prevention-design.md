# Session Drift Prevention & Revised Roadmap — Design Specification

**Date:** 2026-04-11
**Status:** Draft
**Author:** Joe Pierce + Claude
**Context:** After 6 UI rewrites in 3 days and cumulative feature loss across sessions, this spec defines the enforcement mechanism to prevent session drift, the skill chain for phased work, and the revised roadmap to alpha.

## Problem Statement

Across sessions on April 7-10, the fluxaOS web UI was rewritten from scratch multiple times. Each rewrite dropped features that the previous version had. The root causes (documented in `docs/rca/2026-04-11-ui-regression-rca.md`) are:

1. **Agents use `Write` (full file replacement) instead of `Edit` (surgical changes)** — destroying context and features the rewriter didn't remember
2. **No phase boundary enforcement** — agents touched files from completed phases
3. **Session handoffs don't include enough state** — the next agent couldn't protect what it didn't know existed
4. **"Fix TS errors" by deleting UI** — agents optimized for zero type errors by removing features instead of building missing endpoints
5. **No automated regression protection** — no hooks, no tests, no diff checks

## Design Overview

Three enforcement layers, plus a revised skill chain and roadmap:

```
Layer 1: Write Guard (hook)         — prevents full-file replacement of existing UI files
Layer 2: Session Protocol (CLAUDE.md) — scopes each session to its phase plan
Layer 3: Cross-Model Review (Codex)  — automated review of every phase's work before merge
```

The existing fh-commons skill pipeline (`/implement → /review → /rework → /deploy`) provides the workflow structure. Skills are adapted for fluxaOS with project-local overrides until fh-commons gains a `typescript` project type (tracked as fh-commons EPIC).

---

## Layer 1: Write Guard Hook

A `postToolUse` hook on `Write` that blocks full-file replacement of existing UI files.

### What It Does

When an agent calls `Write` on a file path matching `src/app/**` or `src/components/**`:
- If the file **does not exist**: allow (new files need `Write`)
- If the file **already exists**: block with an error message instructing the agent to use `Edit`

### Implementation

Add to `.claude/settings.json` (synced via fhc):

```json
{
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

`.claude/hooks/write-guard.sh`:
```bash
#!/usr/bin/env bash
FILE=$(echo "$CC_TOOL_INPUT" | jq -r '.file_path // empty')
if [[ -z "$FILE" ]]; then exit 0; fi
if [[ "$FILE" == */src/app/* || "$FILE" == */src/components/* ]]; then
  if [[ -f "$FILE" ]]; then
    echo "BLOCKED: Write used on existing UI file: $FILE"
    echo "Use Edit for surgical changes to existing files."
    echo "Write is only permitted for NEW files under src/app/ and src/components/."
    echo "If you must replace the entire file, explain why to the user first."
    exit 1
  fi
fi
exit 0
```

### Properties

- **Zero tokens**: file-existence check only, no AI evaluation
- **Zero maintenance**: no manifest to update
- **Targeted**: only fires on `Write` to existing files under `src/app/` and `src/components/`
- **Not a hard lock**: agents can still use `Edit` freely, and can `Write` new files

### Extension: Router Protection

Optionally extend to `src/server/**` to prevent router rewrites:

```bash
if [[ "$FILE" == */src/app/* || "$FILE" == */src/components/* || "$FILE" == */src/server/* ]]; then
```

---

## Layer 2: Session Protocol

Additions to CLAUDE.md that constrain agent behavior per session.

### CLAUDE.md Additions

Add a new section `## Session Protocol` after the existing invariants:

```markdown
## Session Protocol

### Before Starting Any Work

1. Read the current phase plan (path will be provided in the session prompt)
2. Your scope is LIMITED to the files listed in that plan
3. If you need to modify a file NOT in the plan, STOP and flag to the user
4. Create a restore point: `/restore-point create <phase-name>`

### During Work

5. NEVER use Write on an existing file — use Edit only (the Write guard hook will block this, but don't rely on it)
6. When fixing type errors: BUILD the missing endpoint, don't DELETE the UI that calls it
7. The UI defines what the backend needs, not the other way around
8. If a page references a tRPC endpoint that doesn't exist, create the endpoint

### Before Committing

9. Review your own diff: `git diff --stat` — any file that lost >20% of its lines needs justification
10. No UI elements were removed without explicit user approval
11. Any new endpoints referenced by UI actually exist
```

### Dynamic Phase Snapshot

Each phase implementation starts by capturing a snapshot of the current state. This is NOT a static manifest — it's generated fresh each phase and validated by the reviewer.

**Pre-implement script** (`.claude/hooks/phase-snapshot.sh`):
```bash
#!/usr/bin/env bash
# Generate snapshot of current UI state before implementation begins
SNAPSHOT=".phase-snapshot.json"
echo '{"generated":"'$(date -Iseconds)'","files":{}}' > "$SNAPSHOT"

# Capture file stats for all UI files
find src/app src/components -name '*.tsx' -o -name '*.ts' 2>/dev/null | while read f; do
  LINES=$(wc -l < "$f")
  EXPORTS=$(grep -c "^export " "$f" 2>/dev/null || echo 0)
  jq --arg f "$f" --arg l "$LINES" --arg e "$EXPORTS" \
    '.files[$f] = {"lines": ($l|tonumber), "exports": ($e|tonumber)}' \
    "$SNAPSHOT" > "${SNAPSHOT}.tmp" && mv "${SNAPSHOT}.tmp" "$SNAPSHOT"
done
echo "Phase snapshot saved to $SNAPSHOT"
```

**Post-implement diff check** (part of review):
```bash
#!/usr/bin/env bash
# Compare current state against pre-phase snapshot
SNAPSHOT=".phase-snapshot.json"
if [[ ! -f "$SNAPSHOT" ]]; then echo "No snapshot found — skip"; exit 0; fi

ISSUES=0
jq -r '.files | to_entries[] | "\(.key) \(.value.lines) \(.value.exports)"' "$SNAPSHOT" | while read FILE OLD_LINES OLD_EXPORTS; do
  if [[ ! -f "$FILE" ]]; then
    echo "REMOVED: $FILE (had $OLD_LINES lines, $OLD_EXPORTS exports)"
    ISSUES=$((ISSUES + 1))
    continue
  fi
  NEW_LINES=$(wc -l < "$FILE")
  NEW_EXPORTS=$(grep -c "^export " "$FILE" 2>/dev/null || echo 0)
  LOSS=$(( (OLD_LINES - NEW_LINES) * 100 / OLD_LINES ))
  if [[ $LOSS -gt 20 ]]; then
    echo "SHRUNK: $FILE lost ${LOSS}% of lines ($OLD_LINES → $NEW_LINES)"
    ISSUES=$((ISSUES + 1))
  fi
  EXPORT_LOSS=$((OLD_EXPORTS - NEW_EXPORTS))
  if [[ $EXPORT_LOSS -gt 0 ]]; then
    echo "EXPORTS REMOVED: $FILE lost $EXPORT_LOSS exports ($OLD_EXPORTS → $NEW_EXPORTS)"
    ISSUES=$((ISSUES + 1))
  fi
done

if [[ $ISSUES -gt 0 ]]; then
  echo ""
  echo "⚠ $ISSUES potential regressions detected. Review each before approving."
fi
```

---

## Layer 3: Cross-Model Review (Codex)

Automated code review using OpenAI Codex via the codex-companion plugin. A different model reviews the implementing model's work, eliminating self-certification bias.

### How It Works

After `/implement` commits to a feature branch, the review phase invokes Codex:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/codex-companion.mjs" adversarial-review \
  --scope branch \
  --base main
```

The `adversarial-review` mode actively looks for problems — exactly what's needed for drift detection.

### What the Reviewer Checks

The review skill instructs Codex to verify:

1. **No unplanned file removals** — diff against `.phase-snapshot.json`
2. **No UI element removals** — any removed JSX/component in the diff needs justification
3. **All referenced endpoints exist** — any tRPC call in UI has a corresponding router
4. **Scope compliance** — changes are limited to files listed in the phase plan
5. **Plan compliance** — acceptance criteria from the phase plan are met
6. **Invariant compliance** — no hardcoded stage/provider/harness names in application code

### Automation Flow

```
/implement completes
  → commits to feature branch
  → runs phase-snapshot diff check
  → invokes Codex adversarial-review automatically
  
Codex review returns verdict:
  → APPROVE: proceed to /deploy (human verification)
  → REJECT: enter /rework cycle with specific feedback
```

---

## Skill Chain for fluxaOS

### Setup

1. Register fluxaOS in fh-commons: `fhc project setup --type docs-only /mnt/dev/fluxaos`
2. Sync: `fhc sync --target skills-claude && fhc sync --target skills-codex`
3. Create project-local skill overrides for the 4 pipeline skills (TypeScript-adapted)

The `docs-only` type syncs:
- `.claude/skills/` — Claude skills
- `.agents/skills/` — Codex skills
- `.claude/commands/`, `.claude/hooks/`, `.claude/settings.json`
- `docs/`, `config/`, reference docs, git hooks, `.gitignore` managed section

Excluded: `pyproject` (Python), `tests-browser` (Playwright fixtures — fluxaOS has its own)

### Project-Local Skill Overrides

Until fh-commons gains a `typescript` project type (tracked as fh-commons EPIC), fluxaOS uses project-local overrides for:

- `/implement` — TypeScript testing (tsc + vitest), no ruff/pytest, no `{{CLI}} git finish`, includes phase-snapshot creation and Write-guard awareness
- `/review` — Codex adversarial-review invocation, phase-snapshot diff check, no Forgejo-specific commands
- `/rework` — TypeScript testing, checkout existing branch pattern preserved
- `/deploy` — `gh pr create/merge` instead of `{{CLI}} pr`, no service restart, human browser verification

Project-local skills in `.claude/skills/` take precedence over fhc-synced ones. When fh-commons ships the `typescript` project type, these overrides are deleted.

### Phase Execution Flow

```
Human approves phase plan
  ↓
/restore-point create <phase-name>
  ↓
/implement <phase> --inline
  ├── Pre-flight: generate .phase-snapshot.json
  ├── Read phase plan, scope to listed files only
  ├── Implement using Edit (Write blocked on existing files by hook)
  ├── Run tsc + vitest
  ├── Commit to feature branch
  └── Post-flight: diff against snapshot, report any shrinkage/removals
  ↓
/review (Codex adversarial-review, automated)
  ├── Diff feature branch vs main
  ├── Check snapshot for unplanned removals
  ├── Check all referenced endpoints exist
  ├── Check scope compliance against phase plan
  └── Verdict: approve → /deploy, or reject → /rework
  ↓
/rework (if rejected — Claude addresses Codex feedback)
  ├── Read Codex review feedback
  ├── Fix issues using Edit only
  ├── Re-run tsc + vitest
  └── Push to same branch → back to /review
  ↓
/deploy
  ├── Merge feature branch to main
  ├── Human verifies in running browser (MANDATORY — invariant #21)
  └── Clean up: delete branch, remove .phase-snapshot.json
```

---

## Revised Roadmap

### Current State (as of 2026-04-11)

| Phase | Status | Notes |
|-------|--------|-------|
| R1: Infrastructure | **Complete, verified** | Supabase connected, auth working |
| R2: Adapter Registry | **Complete, verified** | Ports & adapters functional at runtime |
| R3: Core Services + tRPC | **Complete, verified** | Rich issue model, 23 integration tests |
| R4: Gate Engine | **Committed, NOT verified** | Code exists but user hasn't verified in browser |
| R5: Pipeline Engine | **Committed, NOT verified** | Code exists but user hasn't verified in browser |
| UI | **Drifted from mockup** | Multiple rewrites, features lost and partially restored |

### Remaining Phases

#### Phase R3.5: Enforcement Infrastructure (NEW — do first)

**Goal:** Install the drift prevention system before any more product work.

**Scope:**
- Register fluxaOS in fhc as `docs-only`
- Run fhc sync to get skills, hooks, settings, reference docs
- Create project-local skill overrides for implement/review/rework/deploy
- Install Write guard hook
- Add Session Protocol to CLAUDE.md
- Create phase-snapshot scripts
- Verify Codex plugin works (`codex-companion.mjs review`)

**Exit criteria:** `/implement --inline` runs the pre-flight checklist, Write guard blocks `Write` on existing UI files, Codex review runs against a test branch.

#### Phase R4-V: Gate Engine Verification

**Goal:** Verify the committed R4 gate engine code actually works.

**Scope:**
- Read the committed R4 code, understand what exists
- Test gate rule evaluation in UI (configure rules, trigger evaluation, see verdicts)
- If broken: fix using Edit only, scoped to gate engine files
- If working: document what's verified

**Exit criteria:** User configures gate rules in Settings → Stages, triggers evaluation, sees correct verdict in browser.

#### Phase R5-V: Pipeline Engine Verification

**Goal:** Verify the committed R5 pipeline engine code actually works.

**Scope:**
- Read the committed R5 code, understand what exists
- Test pipeline execution end-to-end (trigger run, watch stages, see output, see gates evaluate)
- If broken: fix using Edit only, scoped to pipeline engine files
- If working: document what's verified

**Exit criteria:** User triggers a pipeline from UI → watches live execution → sees output stream → sees cost tracked → sees gates evaluate.

#### Phase R-UI: Mockup Reconciliation

**Goal:** Bring the UI into alignment with the approved mockup design.

**Scope:**
- Full audit: current UI vs `planning/mockups/dashboard-mockup.html` — produce gap list
- User reviews and approves gap list before any code changes
- Implement missing mockup elements using Edit only:
  - Provider model counts ("3 models", "2 models") — never implemented
  - Any other mockup details not present in current UI
- Verify no features were lost during reconciliation

**Exit criteria:** Every element in the approved mockup exists in the running UI. User verifies in browser.

#### Phase R6: Polish + Ship

**Goal:** Production-ready alpha release.

**Scope:** (unchanged from original plan)
- CLI wired to real tRPC endpoints
- Playwright E2E journey test
- KPI dashboard
- Docker Compose hardened
- README, CONTRIBUTING, GitHub release v0.1.0-alpha

**Exit criteria:** Fresh clone → `docker compose up` → follow README → working fluxaOS in 15 minutes.

### Phase Execution Order

```
R3.5 (enforcement infra) ← DO THIS FIRST
  ↓
R4-V (verify gate engine)
  ↓
R5-V (verify pipeline engine)
  ↓
R-UI (mockup reconciliation)
  ↓
R6 (polish + ship)
```

Every phase after R3.5 uses the full skill chain: `/implement → /review (Codex) → /deploy`.

---

## What This Prevents

| Past Failure | How This Spec Prevents It |
|---|---|
| Agent rewrites entire UI file from scratch | Write guard hook blocks `Write` on existing UI files |
| Agent removes features to fix TS errors | Session Protocol rule: build the endpoint, don't delete the UI |
| Agent touches files from completed phases | Session Protocol: scope limited to phase plan file list |
| Agent self-certifies work as complete | Codex cross-model review — different model checks the work |
| Session handoff loses UI state | Phase snapshot captures state before each phase, diff validates after |
| No one catches regressions until user checks | Automated snapshot diff + Codex review catch removals before merge |
| "Zero TS errors" as success metric | Review checks for feature completeness, not just type safety |

---

## Known Limitations

1. **Write guard is advisory, not absolute.** An agent could technically work around it by writing to a different path and renaming. This is a guardrail, not a jail.
2. **Phase snapshot only catches line count and export count.** It won't catch semantic regressions (e.g., a button that exists but is disabled). Playwright journey tests (R6) are the full solution.
3. **Codex review quality depends on the prompt.** The review skill must include explicit instructions about what to check. A vague "review this code" won't catch drift.
4. **Project-local skill overrides will drift from fh-commons templates.** This is temporary — the fh-commons TypeScript EPIC will eliminate the overrides.
5. **The `{{CLI}}` commands in synced skills won't work for fluxaOS.** Only the project-local overrides are functional. The synced versions are inert templates until fh-commons adapts them.

---

## Appendix: fh-commons TypeScript EPIC

Filed as a Forgejo issue on fh-commons. Adds `typescript` as a first-class project type with language-conditional partials. When shipped, fluxaOS deletes its project-local skill overrides and gets canonical TypeScript skills via `fhc sync`.
