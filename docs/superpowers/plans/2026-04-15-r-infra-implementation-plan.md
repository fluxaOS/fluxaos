# R-INFRA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decouple fluxaOS from fh-commons and build native TypeScript dev tooling for database inspection and verification testing.

**Architecture:** Two-phase approach. Phase 1 removes all fh-commons artifacts and rewrites hooks/skills to be standalone. Phase 2 creates TS scripts for DB queries and verification tests, following the established `nuke.ts` pattern (dotenv + SupabaseDatabaseProvider). All scripts output to stdout, no interactive mode.

**Tech Stack:** TypeScript, tsx runner, Drizzle ORM, Supabase Cloud (Postgres), existing project schema.

**Spec:** `docs/superpowers/specs/2026-04-15-infra-decoupling-design.md`

---

## Phase 1: fh-commons Decoupling

### Task 1: Unregister from fh-commons ecosystem

**Files:**
- Delete: `flu`
- Delete: `.fhc-config.json`
- Delete: `config/install.json`
- Delete: `config/memory.json`
- Delete: `config/shared.json`

- [ ] **Step 1: Run fhc project delete**

```bash
fhc project delete fluxaos --keep-directory --delete-forgejo --force
```

Expected: removes entry from `/mnt/dev/fh-commons/config/projects.json`, removes symlink `~/.local/bin/flu`, deletes Forgejo repo `jpierce/fluxaos`.

- [ ] **Step 2: Delete fhc config files**

```bash
rm flu .fhc-config.json config/install.json config/memory.json config/shared.json
rmdir config 2>/dev/null || true
```

- [ ] **Step 3: Delete sync manifest**

```bash
rm .claude/.fhc-sync-manifest.json
```

- [ ] **Step 4: Verify flu is gone**

```bash
which flu 2>&1  # Should say "not found"
ls flu 2>&1     # Should say "No such file"
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: unregister from fh-commons ecosystem

Remove flu CLI wrapper, .fhc-config.json, config/ fhc files,
sync manifest. Project deleted from fh-commons registry."
```

---

### Task 2: Delete dead synced files

**Files:**
- Delete: `.forgejo/` (6 files)
- Delete: `tests/browser/__init__.py`, `tests/browser/conftest.py`
- Delete: `.git/hooks/post-commit`, `.git/hooks/post-merge`
- Delete: `.git/hooks/checks/` (6 files)
- Delete: `docs/` fhc docs (23 files)
- Delete: `.claude/` reference docs (9 files)

- [ ] **Step 1: Delete Forgejo issue templates**

```bash
rm -rf .forgejo/
```

- [ ] **Step 2: Delete Python test fixtures**

```bash
rm -f tests/browser/__init__.py tests/browser/conftest.py
rmdir tests/browser 2>/dev/null || true
```

- [ ] **Step 3: Delete dead git hooks and check modules**

```bash
rm -f .git/hooks/post-commit .git/hooks/post-merge
rm -rf .git/hooks/checks/
```

- [ ] **Step 4: Delete fhc-synced docs**

```bash
rm -f docs/TESTING.md docs/agent-start-here.md docs/configuration-schema.md \
  docs/configuration.md docs/database-management.md docs/faq.md \
  docs/forgejo-setup.md docs/git-commands.md docs/issue-tracker.md \
  docs/memory-cli-reference.md docs/memory-system.md docs/pipeline-automation.md \
  docs/pipeline-skill-model.md docs/project-management.md \
  docs/troubleshooting.md docs/version-management.md docs/.DS_Store
rm -rf docs/development/ docs/installation/
```

- [ ] **Step 5: Delete unused .claude reference docs**

```bash
rm -f .claude/README.md .claude/BROWSER_TEST_STANDARDS.md \
  .claude/COMMAND_REFERENCE.md .claude/CONSOLIDATED_REFERENCE.md \
  .claude/DEBUGGING_STRATEGIES.md .claude/GIT_TIPS.md \
  .claude/QUICK_REFERENCE.md .claude/TOOL_REFERENCE.template.md \
  .claude/WORKFLOW_GUIDE.md
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: delete dead fhc-synced files

Remove: .forgejo/ templates, Python test fixtures, dead git hooks,
fhc docs (23 files), unused .claude reference docs (9 files)."
```

---

### Task 3: Delete unused skills

**Files:**
- Delete (from both `.claude/skills/` and `.agents/skills/`): `archive-project/`, `json-canvas/`, `new-issue/`, `new-project/`, `new-stack/`, `obsidian-bases/`, `obsidian-cli/`, `obsidian-markdown/`, `sync-prod/`

- [ ] **Step 1: Delete unused skills from both directories**

```bash
for skill in archive-project json-canvas new-issue new-project new-stack \
  obsidian-bases obsidian-cli obsidian-markdown sync-prod; do
  rm -rf ".claude/skills/$skill" ".agents/skills/$skill"
done
```

- [ ] **Step 2: Verify kept skills still exist**

```bash
for skill in agent-teams check-logs code-audit defuddle deploy dev-status \
  finish housekeeping implement research restore-point review review-session \
  rework start-of-day end-of-day verify-issue verify-webapp; do
  test -f ".claude/skills/$skill/SKILL.md" && echo "OK: $skill" || echo "MISSING: $skill"
done
```

Expected: all 17 show "OK".

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: delete unused fhc skills (9 removed, 17 kept)"
```

---

### Task 4: Strip fhc headers from kept files

**Files:**
- Modify: all 17 kept skills in `.claude/skills/` and `.agents/skills/`
- Modify: `.claude/commands/*.md` (7 files)
- Modify: `.claude/settings.json`
- Modify: `.claude/hooks/session-start.md`
- Modify: `ARCHITECTURAL_STANDARDS.md`
- Modify: `.claude/E2E_TEST_STANDARDS.md`
- Modify: `.claude/ARCHITECTURAL_STANDARDS.md`

- [ ] **Step 1: Strip "DO NOT EDIT" headers from all kept .claude/skills/**

For each file matching `.claude/skills/*/SKILL.md` and `.claude/skills/*/references/*.md`:
Remove lines containing "DO NOT EDIT", "maintained by fhc sync", or "Source: templates/" at the top of each file.

```bash
find .claude/skills .agents/skills -name "*.md" -exec sed -i '/^<!-- DO NOT EDIT/d; /maintained by fhc sync/d; /Source: templates\//d' {} +
```

- [ ] **Step 2: Strip headers from .claude/commands/**

```bash
find .claude/commands -name "*.md" -exec sed -i '/^<!-- DO NOT EDIT/d; /maintained by fhc sync/d; /Source: templates\//d' {} +
```

- [ ] **Step 3: Strip managed_by from .claude/settings.json**

Remove the `__meta` block from `.claude/settings.json`. The file currently has:
```json
"__meta": {
  "managed_by": "fhc sync",
  "note": "DO NOT EDIT — this file is overwritten by fhc sync..."
}
```

Remove the entire `__meta` key.

- [ ] **Step 4: Strip headers from root ARCHITECTURAL_STANDARDS.md and .claude/ copies**

```bash
sed -i '/^<!-- DO NOT EDIT/d; /maintained by fhc sync/d; /Source: templates\//d' \
  ARCHITECTURAL_STANDARDS.md .claude/ARCHITECTURAL_STANDARDS.md .claude/E2E_TEST_STANDARDS.md
```

- [ ] **Step 5: Strip headers from .claude/hooks/session-start.md**

Remove fhc header lines. Also remove any `flu` command references in the session-start instructions.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: strip fhc headers from all adopted files"
```

---

### Task 5: Replace flu references in skills and commands

**Files:**
- Modify: all `.claude/skills/*/SKILL.md` containing `flu` or `{{CLI}}`
- Modify: all `.agents/skills/*/SKILL.md` containing `flu` or `{{CLI}}`
- Modify: all `.claude/commands/*.md` containing `flu`

- [ ] **Step 1: Find all flu/CLI references**

```bash
grep -rl 'flu \|flu$\|{{CLI}}\|fhc \|fh-commons\|fhc sync' .claude/skills/ .agents/skills/ .claude/commands/ 2>/dev/null
```

Review each match. For each file:
- Replace `{{CLI}}` with the native equivalent or remove the section
- Replace `flu issue` → remove or note "use deferred-fixes.md"
- Replace `flu pr` → `gh pr` or `git push`
- Replace `flu memory` → remove (claude-mem handles this)
- Replace `flu test-gate` → `npm run lint`
- Replace `fhc sync` references → remove
- Remove any fh-commons path references (`/mnt/dev/fh-commons`)

- [ ] **Step 2: Replace references in .claude/commands/**

Same substitution rules as step 1.

- [ ] **Step 3: Verify no flu references remain**

```bash
grep -r 'flu \|flu$\|{{CLI}}\|fhc \|fh-commons' .claude/skills/ .agents/skills/ .claude/commands/ 2>/dev/null
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: replace flu/fhc references with native equivalents"
```

---

### Task 6: Rewrite git hooks standalone

**Files:**
- Create: `.git/hooks/pre-commit` (overwrite)
- Create: `.git/hooks/pre-push` (overwrite)

- [ ] **Step 1: Write standalone pre-commit hook**

Overwrite `.git/hooks/pre-commit` with a standalone version. Keep: branch protection (no direct main commits), lint check, file size check. Remove: all fh-commons sourcing, Python checks, test gate, mock pattern checks.

```bash
#!/bin/bash
# Pre-commit hook for fluxaOS (standalone — no fh-commons dependency)
set -e

ERRORS=0

# ── Branch protection ──
BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" = "main" ]; then
  echo "✗ Direct commits to 'main' branch are not allowed"
  echo ""
  echo "Please create a feature branch:"
  echo "  git checkout -b your-branch-name"
  exit 1
fi

# ── Lint staged TypeScript files ──
STAGED_TS=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(ts|tsx)$' || true)
if [ -n "$STAGED_TS" ]; then
  echo "Running lint..."
  npx eslint $STAGED_TS --quiet 2>/dev/null || {
    echo "✗ ESLint failed"
    ERRORS=$((ERRORS + 1))
  }
fi

# ── File size check (500 lines max) ──
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(ts|tsx)$' || true)
for file in $STAGED_FILES; do
  if [ -f "$file" ]; then
    LINES=$(wc -l < "$file")
    if [ "$LINES" -gt 500 ]; then
      echo "✗ $file exceeds 500 lines ($LINES lines)"
      ERRORS=$((ERRORS + 1))
    fi
  fi
done

# ── Secret detection ──
STAGED_ALL=$(git diff --cached --name-only --diff-filter=ACM || true)
for file in $STAGED_ALL; do
  if echo "$file" | grep -qE '\.env$|\.env\.|\.token$|secrets/'; then
    echo "✗ Potential secret file staged: $file"
    ERRORS=$((ERRORS + 1))
  fi
done

if [ $ERRORS -eq 0 ]; then
  echo "✓ Pre-commit checks passed"
  exit 0
else
  echo ""
  echo "✗ Pre-commit checks failed with $ERRORS error(s)"
  exit 1
fi
```

- [ ] **Step 2: Write standalone pre-push hook**

Overwrite `.git/hooks/pre-push`:

```bash
#!/bin/bash
# Pre-push hook for fluxaOS (standalone — no fh-commons dependency)
set -e

while read local_ref local_sha remote_ref remote_sha; do
  if [[ "$remote_ref" == "refs/heads/main" ]]; then
    echo "✗ Direct pushes to main are blocked."
    echo ""
    echo "Use PR flow instead:"
    echo "  git push -u origin \$(git branch --show-current)"
    echo "  gh pr create"
    exit 1
  fi
done

exit 0
```

- [ ] **Step 3: Make hooks executable**

```bash
chmod +x .git/hooks/pre-commit .git/hooks/pre-push
```

- [ ] **Step 4: Test pre-commit on a feature branch**

```bash
git checkout -b test/hook-verify
echo "// test" >> /tmp/test-hook.ts
git add /tmp/test-hook.ts 2>/dev/null || true
# Just verify the hook runs without sourcing errors:
git commit --allow-empty -m "test: verify standalone hooks" --dry-run
```

Note: git hooks live in `.git/` so they're not committed. They're written directly by this task.

- [ ] **Step 5: Delete post-checkout hook (optional — low value)**

```bash
rm -f .git/hooks/post-checkout
```

- [ ] **Step 6: No commit needed** — hooks are in `.git/` (not tracked).

---

### Task 7: Update settings and gitignore

**Files:**
- Modify: `.claude/settings.local.json`
- Modify: `.gitignore`

- [ ] **Step 1: Remove flu permissions from settings.local.json**

Read `.claude/settings.local.json`. Remove any `Bash(flu *)` permission entries. Keep all other permissions.

- [ ] **Step 2: Clean up .gitignore**

Remove any fhc-specific entries (e.g., `.forgejo_token`). Add `config/` to gitignore if the directory was removed. Verify standard TS/Next.js entries are present.

- [ ] **Step 3: Update session-quick-start.md**

Remove the "fh-commons Integration" section from `docs/session-quick-start.md`. Replace with:

```markdown
## CLI Tools

This is a standalone TypeScript project. No `flu` or `fhc` commands — use npm scripts for everything.
```

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: update settings, gitignore, and docs for standalone project"
```

---

## Phase 2: Native Dev Tooling

### Task 8: Create DB connection helper for scripts

**Files:**
- Create: `src/core/db/scripts/connection.ts`

- [ ] **Step 1: Create the scripts directory**

```bash
mkdir -p src/core/db/scripts
```

- [ ] **Step 2: Write shared connection helper**

Create `src/core/db/scripts/connection.ts`:

```typescript
/**
 * Shared DB connection for CLI scripts.
 * Follows the nuke.ts pattern: dotenv + SupabaseDatabaseProvider.
 */
import 'dotenv/config';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('ERROR: DIRECT_URL or DATABASE_URL must be set in .env');
  process.exit(1);
}

const provider = new SupabaseDatabaseProvider(url);
export const db = provider.getConnection();

/** Call at end of script to close the connection cleanly. */
export function close(): Promise<void> {
  return provider.close();
}
```

- [ ] **Step 3: Verify SupabaseDatabaseProvider has a close method**

Check `src/adapters/supabase/database.ts` for a `close()` method. If missing, add one:

```typescript
async close(): Promise<void> {
  await this.client.end();
}
```

This requires storing `client` as a class field. Modify the constructor to save `this.client = client`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add shared DB connection helper for CLI scripts"
```

---

### Task 9: Create db:issues script

**Files:**
- Create: `src/core/db/scripts/issues.ts`
- Modify: `package.json` (add npm script)

- [ ] **Step 1: Write issues.ts**

Create `src/core/db/scripts/issues.ts`:

```typescript
/**
 * List issues with joined state, status, priority, type.
 *
 * Usage: npm run db:issues
 */
import { eq } from 'drizzle-orm';
import { db, close } from './connection.js';
import {
  issue,
  issueState,
  issueStatus,
  issuePriority,
  issueType,
} from '@/core/db/schema';

async function main() {
  const rows = await db
    .select({
      number: issue.number,
      title: issue.title,
      state: issueState.displayName,
      status: issueStatus.displayName,
      priority: issuePriority.displayName,
      type: issueType.displayName,
      isClosed: issue.isClosed,
      author: issue.author,
    })
    .from(issue)
    .leftJoin(issueState, eq(issue.stateId, issueState.id))
    .leftJoin(issueStatus, eq(issue.statusId, issueStatus.id))
    .leftJoin(issuePriority, eq(issue.priorityId, issuePriority.id))
    .leftJoin(issueType, eq(issue.typeId, issueType.id))
    .orderBy(issue.number);

  if (rows.length === 0) {
    console.log('No issues found. Run: npm run db:seed');
    await close();
    process.exit(0);
  }

  // Simple table output
  console.log(
    `${'#'.padStart(4)} ${'Title'.padEnd(50)} ${'State'.padEnd(12)} ${'Status'.padEnd(12)} ${'Priority'.padEnd(10)} ${'Closed'.padEnd(6)}`
  );
  console.log('-'.repeat(100));
  for (const r of rows) {
    console.log(
      `${String(r.number).padStart(4)} ${(r.title ?? '').slice(0, 50).padEnd(50)} ${(r.state ?? '-').padEnd(12)} ${(r.status ?? '-').padEnd(12)} ${(r.priority ?? '-').padEnd(10)} ${r.isClosed ? 'yes' : 'no'}`
    );
  }
  console.log(`\n${rows.length} issue(s)`);

  await close();
  process.exit(0);
}

main().catch((err) => {
  console.error('Query failed:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Add npm script to package.json**

Add to the `"scripts"` section of `package.json`:

```json
"db:issues": "tsx src/core/db/scripts/issues.ts"
```

- [ ] **Step 3: Run and verify**

```bash
npm run db:issues
```

Expected: table showing 2 seeded issues with state, status, priority columns.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add db:issues script for inspecting issues"
```

---

### Task 10: Create db:runs script

**Files:**
- Create: `src/core/db/scripts/runs.ts`
- Modify: `package.json`

- [ ] **Step 1: Write runs.ts**

Create `src/core/db/scripts/runs.ts`:

```typescript
/**
 * List pipeline runs and stage runs with signals and exit codes.
 *
 * Usage: npm run db:runs
 */
import { eq, desc } from 'drizzle-orm';
import { db, close } from './connection.js';
import { pipelineRun, stageRun } from '@/core/db/schema';

async function main() {
  const pRuns = await db
    .select({
      id: pipelineRun.id,
      status: pipelineRun.status,
      issueId: pipelineRun.issueId,
      startedAt: pipelineRun.startedAt,
      completedAt: pipelineRun.completedAt,
    })
    .from(pipelineRun)
    .orderBy(desc(pipelineRun.createdAt));

  if (pRuns.length === 0) {
    console.log('No pipeline runs found.');
    await close();
    process.exit(0);
  }

  for (const pr of pRuns) {
    const short = pr.id.slice(0, 8);
    console.log(`\nPipeline Run ${short}  status=${pr.status}  started=${pr.startedAt ?? '-'}  completed=${pr.completedAt ?? '-'}`);

    const sRuns = await db
      .select({
        id: stageRun.id,
        status: stageRun.status,
        harness: stageRun.harness,
        exitCode: stageRun.exitCode,
        skillSignal: stageRun.skillSignal,
        skillSignalReason: stageRun.skillSignalReason,
        trigger: stageRun.trigger,
        startedAt: stageRun.startedAt,
        completedAt: stageRun.completedAt,
      })
      .from(stageRun)
      .where(eq(stageRun.pipelineRunId, pr.id))
      .orderBy(stageRun.createdAt);

    for (const sr of sRuns) {
      const sShort = sr.id.slice(0, 8);
      console.log(
        `  Stage ${sShort}  status=${sr.status}  exit=${sr.exitCode ?? '-'}  signal=${sr.skillSignal ?? '-'}  reason=${sr.skillSignalReason ?? '-'}  harness=${sr.harness ?? '-'}  trigger=${sr.trigger}`
      );
    }
  }

  console.log(`\n${pRuns.length} pipeline run(s)`);
  await close();
  process.exit(0);
}

main().catch((err) => {
  console.error('Query failed:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Add npm script**

```json
"db:runs": "tsx src/core/db/scripts/runs.ts"
```

- [ ] **Step 3: Run and verify**

```bash
npm run db:runs
```

Expected: "No pipeline runs found." (fresh seed has no runs).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add db:runs script for inspecting pipeline/stage runs"
```

---

### Task 11: Create db:gates script

**Files:**
- Create: `src/core/db/scripts/gates.ts`
- Modify: `package.json`

- [ ] **Step 1: Write gates.ts**

Create `src/core/db/scripts/gates.ts`:

```typescript
/**
 * List gate results with verdicts and reasons.
 *
 * Usage: npm run db:gates
 */
import { desc } from 'drizzle-orm';
import { db, close } from './connection.js';
import { stageGateResult } from '@/core/db/schema';

async function main() {
  const rows = await db
    .select({
      id: stageGateResult.id,
      stageRunId: stageGateResult.stageRunId,
      verdict: stageGateResult.verdict,
      passed: stageGateResult.passed,
      reason: stageGateResult.reason,
      createdAt: stageGateResult.createdAt,
    })
    .from(stageGateResult)
    .orderBy(desc(stageGateResult.createdAt));

  if (rows.length === 0) {
    console.log('No gate results found.');
    await close();
    process.exit(0);
  }

  console.log(
    `${'ID'.padEnd(10)} ${'Stage Run'.padEnd(10)} ${'Verdict'.padEnd(10)} ${'Passed'.padEnd(8)} ${'Reason'.padEnd(40)}`
  );
  console.log('-'.repeat(80));
  for (const r of rows) {
    console.log(
      `${r.id.slice(0, 8).padEnd(10)} ${r.stageRunId.slice(0, 8).padEnd(10)} ${r.verdict.padEnd(10)} ${String(r.passed).padEnd(8)} ${(r.reason ?? '-').slice(0, 40)}`
    );
  }

  console.log(`\n${rows.length} gate result(s)`);
  await close();
  process.exit(0);
}

main().catch((err) => {
  console.error('Query failed:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Add npm script**

```json
"db:gates": "tsx src/core/db/scripts/gates.ts"
```

- [ ] **Step 3: Run and verify**

```bash
npm run db:gates
```

Expected: "No gate results found." (fresh seed).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add db:gates script for inspecting gate results"
```

---

### Task 12: Create db:events script

**Files:**
- Create: `src/core/db/scripts/events.ts`
- Modify: `package.json`

- [ ] **Step 1: Write events.ts**

Create `src/core/db/scripts/events.ts`:

```typescript
/**
 * List events for a stage run, or issue events for an issue.
 *
 * Usage:
 *   npm run db:events                    # list all recent events
 *   npm run db:events -- --run <id>      # events for a stage run
 *   npm run db:events -- --issue <id>    # events for an issue
 */
import { eq, desc } from 'drizzle-orm';
import { db, close } from './connection.js';
import { event, issueEvent } from '@/core/db/schema';

function parseArgs(): { runId?: string; issueId?: string } {
  const args = process.argv.slice(2);
  const result: { runId?: string; issueId?: string } = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--run' && args[i + 1]) result.runId = args[++i];
    if (args[i] === '--issue' && args[i + 1]) result.issueId = args[++i];
  }
  return result;
}

async function main() {
  const { runId, issueId } = parseArgs();

  if (issueId) {
    const rows = await db
      .select()
      .from(issueEvent)
      .where(eq(issueEvent.issueId, issueId))
      .orderBy(desc(issueEvent.timestamp));

    console.log(`Issue events for ${issueId.slice(0, 8)}:\n`);
    for (const r of rows) {
      console.log(`  ${r.timestamp?.toISOString() ?? '-'}  ${r.type}  actor=${r.actor}  ${JSON.stringify(r.payload)}`);
    }
    console.log(`\n${rows.length} event(s)`);
  } else {
    const query = runId
      ? db.select().from(event).where(eq(event.stageRunId, runId)).orderBy(desc(event.timestamp))
      : db.select().from(event).orderBy(desc(event.timestamp)).limit(50);

    const rows = await query;

    const label = runId ? `Stage run ${runId.slice(0, 8)}` : 'Recent';
    console.log(`${label} events:\n`);
    for (const r of rows) {
      const payload = JSON.stringify(r.payload).slice(0, 80);
      console.log(`  ${r.timestamp?.toISOString() ?? '-'}  ${r.type.padEnd(20)}  ${payload}`);
    }
    console.log(`\n${rows.length} event(s)`);
  }

  await close();
  process.exit(0);
}

main().catch((err) => {
  console.error('Query failed:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Add npm script**

```json
"db:events": "tsx src/core/db/scripts/events.ts"
```

- [ ] **Step 3: Run and verify**

```bash
npm run db:events
```

Expected: "Recent events:" with 0 events (fresh seed).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add db:events script for inspecting run and issue events"
```

---

### Task 13: Create verification test suite

**Files:**
- Create: `tests/verify/seed-check.ts`
- Create: `tests/verify/run-all.ts`
- Modify: `package.json`

- [ ] **Step 1: Create verify directory**

```bash
mkdir -p tests/verify
```

- [ ] **Step 2: Write seed-check.ts**

Create `tests/verify/seed-check.ts`:

```typescript
/**
 * Verify seed data is correct after nuke+seed.
 *
 * Usage: npm run verify:seed
 */
import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { SupabaseDatabaseProvider } from '@/adapters/supabase/database';
import {
  issue,
  issueState,
  issueStatus,
  pipelineStage,
  skill,
  harnessCatalog,
} from '@/core/db/schema';

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('ERROR: DATABASE_URL must be set');
  process.exit(1);
}

const provider = new SupabaseDatabaseProvider(url);
const db = provider.getConnection();

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  PASS  ${label}`);
    passed++;
  } else {
    console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

async function main() {
  console.log('Seed verification:\n');

  // Issues
  const issues = await db
    .select({
      number: issue.number,
      title: issue.title,
      state: issueState.key,
      status: issueStatus.key,
      isClosed: issue.isClosed,
    })
    .from(issue)
    .leftJoin(issueState, eq(issue.stateId, issueState.id))
    .leftJoin(issueStatus, eq(issue.statusId, issueStatus.id))
    .orderBy(issue.number);

  assert('2 issues exist', issues.length === 2, `got ${issues.length}`);

  if (issues.length >= 1) {
    assert('Issue #1 title', issues[0].title.includes('health check'), issues[0].title);
    assert('Issue #1 state = research', issues[0].state === 'research', issues[0].state ?? '?');
    assert('Issue #1 status = open', issues[0].status === 'open', issues[0].status ?? '?');
    assert('Issue #1 not closed', issues[0].isClosed === false);
  }

  if (issues.length >= 2) {
    assert('Issue #2 title', issues[1].title.includes('/api/health'), issues[1].title);
    assert('Issue #2 state = research', issues[1].state === 'research', issues[1].state ?? '?');
    assert('Issue #2 status = open', issues[1].status === 'open', issues[1].status ?? '?');
    assert('Issue #2 not closed', issues[1].isClosed === false);
  }

  // Pipeline stages
  const stages = await db.select().from(pipelineStage);
  assert('4 pipeline stages', stages.length === 4, `got ${stages.length}`);

  // Skills
  const skills = await db.select().from(skill);
  assert('5 skills seeded', skills.length === 5, `got ${skills.length}`);

  // Harness
  const harnesses = await db.select().from(harnessCatalog);
  assert('1 harness (Claude Code)', harnesses.length === 1, `got ${harnesses.length}`);

  // Summary
  console.log(`\n${passed} passed, ${failed} failed`);
  await provider.close();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
```

- [ ] **Step 3: Write run-all.ts**

Create `tests/verify/run-all.ts`:

```typescript
/**
 * Run all verification scripts.
 *
 * Usage: npm run verify
 */
import { execSync } from 'child_process';

const scripts = [
  { name: 'seed-check', cmd: 'npx tsx tests/verify/seed-check.ts' },
];

let allPassed = true;

for (const s of scripts) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${s.name}`);
  console.log(`${'='.repeat(60)}\n`);
  try {
    execSync(s.cmd, { stdio: 'inherit' });
  } catch {
    allPassed = false;
  }
}

console.log(`\n${'='.repeat(60)}`);
console.log(allPassed ? '  ALL VERIFICATIONS PASSED' : '  SOME VERIFICATIONS FAILED');
console.log(`${'='.repeat(60)}\n`);

process.exit(allPassed ? 0 : 1);
```

- [ ] **Step 4: Add npm scripts**

```json
"verify": "tsx tests/verify/run-all.ts",
"verify:seed": "tsx tests/verify/seed-check.ts"
```

- [ ] **Step 5: Run seed verification**

```bash
npm run verify:seed
```

Expected: all assertions PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add seed verification test suite"
```

---

### Task 14: Update CLAUDE.md commands table and docs

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/session-quick-start.md`
- Modify: `docs/superpowers/roadmap.md`

- [ ] **Step 1: Add new scripts to CLAUDE.md commands table**

Add to the commands table:

```markdown
| `npm run db:issues` | List issues with state/status |
| `npm run db:runs` | List pipeline and stage runs |
| `npm run db:gates` | List gate results |
| `npm run db:events` | List events (all, or by run/issue) |
| `npm run verify` | Run all verification checks |
| `npm run verify:seed` | Verify seed data is correct |
```

- [ ] **Step 2: Update session-quick-start.md database section**

Replace the "Database Access" section with:

```markdown
## Database Access

**`flu db` does not exist.** This is a standalone project. Use npm scripts:

- `npm run db:issues` — issues with state/status/priority
- `npm run db:runs` — pipeline runs with stage details and signals
- `npm run db:gates` — gate results with verdicts
- `npm run db:events` — events (all recent, or filtered by `--run <id>` / `--issue <id>`)
- `npm run db:studio` — Drizzle Studio (visual DB browser)
```

- [ ] **Step 3: Update roadmap to mark R-INFRA as done**

Mark R-INFRA-1 and R-INFRA-2 as complete in `docs/superpowers/roadmap.md`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs: update CLAUDE.md and session-quick-start with new tooling"
```

---

## Summary

| Task | Phase | What |
|------|-------|------|
| 1 | INFRA-1 | Unregister from fh-commons |
| 2 | INFRA-1 | Delete dead synced files |
| 3 | INFRA-1 | Delete unused skills |
| 4 | INFRA-1 | Strip fhc headers |
| 5 | INFRA-1 | Replace flu references |
| 6 | INFRA-1 | Rewrite git hooks |
| 7 | INFRA-1 | Update settings/gitignore |
| 8 | INFRA-2 | DB connection helper |
| 9 | INFRA-2 | db:issues script |
| 10 | INFRA-2 | db:runs script |
| 11 | INFRA-2 | db:gates script |
| 12 | INFRA-2 | db:events script |
| 13 | INFRA-2 | Verification test suite |
| 14 | INFRA-2 | Update docs |

14 tasks. Tasks 1-7 are decoupling (can be done in one focused session). Tasks 8-14 are tooling (each is small and independent after Task 8).
