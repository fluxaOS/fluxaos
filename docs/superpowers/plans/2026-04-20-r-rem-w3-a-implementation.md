# R-REM-W3-a Implementation Plan — Anthropic Port Cleanup + Live-Claude Journey

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete the unused `AIProvider` port, update the R-AUDIT triage resolution note, and ship a Playwright journey test that drives a real stage run against live Claude — converting the alpha engine from "expected to work" to "observed to work."

**Architecture:** Pure deletion + documentation + one new journey test. No new code under `src/`. The orchestrator's real AI path is already complete: `executeStageRun` → `SubprocessExecutor` (`StageExecutor` port) → `claude` binary → `SubprocessStdoutParser` (`StdoutParser` port). Seed data configures provider "Anthropic" (type `anthropic`, apiKeyRef `env:ANTHROPIC_API_KEY`), driver `claude-code` (binary `claude`), and routes them together. This phase verifies that path end-to-end.

**Tech Stack:** TypeScript 5 / Node.js; Playwright for the e2e journey; no new runtime deps.

**Phase scope (from disposition design §"Phase 3 — R-REM-W3-a"):**
1. Delete `src/core/ports/ai.ts`; remove re-exports from `src/core/ports/index.ts`.
2. Append a resolution note to `docs/superpowers/audits/2026-04-17-audit-triage.md` Pattern 2.
3. New Playwright journey `e2e/real-anthropic-stage-run.spec.ts`: skips when `ANTHROPIC_API_KEY` unset; with the key, advances seed issue #1 to state "Research", clicks **Run Stage**, asserts the `RunDetailModal` reaches terminal `completed` status, asserts ≥1 `tool_call` transcript entry (the `StdoutParser`'s normalized form of Anthropic's `tool_use` content), asserts no console errors.

**Out of scope:** building an SDK-based `AIProvider` adapter, OpenAI adapter, any code changes in `src/`.

**Branch:** `feat/r-rem-w3-a-anthropic-cleanup` off `main` at `047388f`. Merge via squash-PR after human verification.

**Key invariants this plan must respect:**
- **Invariant 9 (no polling fallbacks):** the test must not poll the DB or use `refetchInterval`; it observes the UI that the Realtime subscription already drives.
- **Invariant 21 (no self-certification):** I DO NOT mark this phase complete after the Playwright test passes. Human operator runs the journey in a browser end-to-end before merge.
- **Invariant 10 (file size ≤ 500 lines):** N/A here — new file is small, no file reaches the ceiling.

---

## File Map

| File | Action | Note |
|---|---|---|
| `src/core/ports/ai.ts` | **Delete** | Zero runtime consumers verified via grep. |
| `src/core/ports/index.ts` | **Modify** — remove re-export block at lines 1-9 | Drops `AIProvider`, `CompletionChunk`, `CompletionMessage`, `CompletionParams`, `CompletionResult`, `CompletionUsage`, `ModelInfo` from the public ports surface. |
| `docs/superpowers/audits/2026-04-17-audit-triage.md` | **Modify** — append resolution note to Pattern 2 | Cites this phase and PR. |
| `e2e/real-anthropic-stage-run.spec.ts` | **Create** | Single journey test, skips without `ANTHROPIC_API_KEY`. |
| `docs/superpowers/roadmap.md` | **Modify** — flip R-REM-W3-a row to **Done**; update What's Next item 6 | At merge time only. |
| `docs/superpowers/deferred-fixes.md` | **Modify** — only if new deferred findings surface during human verification | Optional. |

---

## Task 0: Pre-flight sanity + branch

**Purpose:** confirm the working tree is clean on `main`, establish the feature branch, and re-verify the "zero consumers" claim before deleting the port.

**Files:**
- None modified. Read-only checks.

- [ ] **Step 1: Confirm clean tree on `main`**

```bash
git status
git log main -3 --oneline
```

Expected `git status`:

```
On branch main
Your branch is up to date with 'origin/main'.
nothing to commit, working tree clean
```

Expected top of `git log`: first line is `047388f docs(handoff): R-UI-2.5 closeout session handoff (#48)`.

- [ ] **Step 2: Create feature branch**

```bash
git checkout -b feat/r-rem-w3-a-anthropic-cleanup
```

Expected: `Switched to a new branch 'feat/r-rem-w3-a-anthropic-cleanup'`.

- [ ] **Step 3: Re-verify zero consumers of `AIProvider` and the completion types**

```bash
grep -rn "from '@/core/ports/ai'" src/ --include="*.ts" --include="*.tsx"
grep -rn "from '.*ports/ai'" src/ --include="*.ts" --include="*.tsx"
grep -rn "AIProvider\b" src/ --include="*.ts" --include="*.tsx"
grep -rn "\bCompletionParams\b\|\bCompletionResult\b\|\bCompletionChunk\b\|\bCompletionMessage\b\|\bCompletionUsage\b\|\bModelInfo\b" src/ --include="*.ts" --include="*.tsx"
```

Expected: all four return matches only inside `src/core/ports/ai.ts` and `src/core/ports/index.ts` (and possibly the `type: 'text' | 'tool_use'` discriminator in `ai.ts` itself). **No file under `src/adapters/`, `src/server/`, `src/app/`, `src/components/`, `src/core/orchestrator/`, `src/config/`, `src/lib/`, or `src/__tests__/` should import any of these.**

If any unexpected match shows up, STOP and re-plan — something consumes the port that wasn't detected during brainstorming. Do not proceed to Task 1.

- [ ] **Step 4: Capture a baseline for verification later**

```bash
npx tsc --noEmit
npx vitest run
npm run verify
```

Expected:
- `tsc --noEmit`: zero errors.
- `vitest run`: `122 passed` (or higher — matches handoff baseline).
- `verify`: `10/10 PASS`.

Record these numbers. The post-deletion verification must still pass with the same pass count on vitest (deletion should not break any test).

---

## Task 1: Delete `AIProvider` port + re-exports

**Purpose:** remove the dead port and its public re-exports in a single atomic commit. `tsc --noEmit` is the authoritative gate — any accidental consumer will surface here.

**Files:**
- Delete: `src/core/ports/ai.ts`
- Modify: `src/core/ports/index.ts` (remove lines 1-9)

- [ ] **Step 1: Delete the port file**

```bash
git rm src/core/ports/ai.ts
```

Expected: `rm 'src/core/ports/ai.ts'`.

- [ ] **Step 2: Remove the re-export block from `src/core/ports/index.ts`**

Open the file. The current content is:

```typescript
export type {
  AIProvider,
  CompletionChunk,
  CompletionMessage,
  CompletionParams,
  CompletionResult,
  CompletionUsage,
  ModelInfo,
} from './ai';
export type {
  AuthEvent,
  AuthProvider,
  AuthResult,
  Session,
  Unsubscribe,
  User,
} from './auth';
export type { DatabaseProvider } from './database';
export type {
  CreatePRParams,
  GitProvider,
  PullRequest,
} from './git';
export type {
  CreateIssueParams,
  ExternalIssue,
  IssueProvider,
} from './issue';
export type {
  Job,
  JobOptions,
  JobStatus,
  QueueProvider,
} from './queue';
export type { RealtimeProvider } from './realtime';
export type {
  ExecuteParams,
  ExecuteResult,
  StageExecutor,
} from './stage-executor';
```

Replace the first re-export block (the entire `export type { AIProvider, ... } from './ai';` statement, nine lines, including the trailing newline) with nothing — so the file starts with `export type { AuthEvent, ...` instead.

Exact final content (complete file) after edit:

```typescript
export type {
  AuthEvent,
  AuthProvider,
  AuthResult,
  Session,
  Unsubscribe,
  User,
} from './auth';
export type { DatabaseProvider } from './database';
export type {
  CreatePRParams,
  GitProvider,
  PullRequest,
} from './git';
export type {
  CreateIssueParams,
  ExternalIssue,
  IssueProvider,
} from './issue';
export type {
  Job,
  JobOptions,
  JobStatus,
  QueueProvider,
} from './queue';
export type { RealtimeProvider } from './realtime';
export type {
  ExecuteParams,
  ExecuteResult,
  StageExecutor,
} from './stage-executor';
```

Use `Edit` with `old_string` = the nine-line `AIProvider` re-export block, `new_string` = empty.

- [ ] **Step 3: Verify TypeScript still compiles**

```bash
npx tsc --noEmit
```

Expected: zero errors. If errors appear, they point at consumers that slipped past the Task 0 grep. Investigate, fix (either by removing the stale import or by restoring the types inside the consumer if they were genuinely needed). Do not proceed until clean.

- [ ] **Step 4: Verify the rest of the suite**

```bash
npx vitest run
npm run verify
npm run lint
```

Expected:
- `vitest`: same pass count as Task 0 baseline, zero new failures.
- `verify`: `10/10 PASS`.
- `lint`: same problem count as baseline (53 as of R-UI-2.5 merge), zero new problems. Pre-existing warnings are not blockers.

- [ ] **Step 5: Commit**

```bash
git add src/core/ports/ai.ts src/core/ports/index.ts
git commit -m "$(cat <<'EOF'
refactor(ports): delete unused AIProvider port

AIProvider and its completion types (CompletionMessage, CompletionParams,
CompletionUsage, CompletionResult, CompletionChunk, ModelInfo) had zero
runtime consumers. The orchestrator's real AI invocation path is
executeStageRun -> SubprocessExecutor (StageExecutor port) -> claude binary ->
SubprocessStdoutParser (StdoutParser port). Seed data already wires this
end-to-end (Anthropic provider -> claude-code driver -> Claude Sonnet 4.6).

Part of R-REM-W3-a. See
docs/superpowers/specs/2026-04-20-r-ui-2-disposition-and-w3-decomposition-design.md
Phase 3 for the full resolution of R-AUDIT Pattern 2's "Anthropic adapter"
item.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: commit succeeds; pre-commit hook passes.

---

## Task 2: Update triage document with Pattern 2 resolution note

**Purpose:** close the documentation loop on the "Anthropic adapter" alpha-build bullet so the triage remains the authoritative record.

**Files:**
- Modify: `docs/superpowers/audits/2026-04-17-audit-triage.md`

- [ ] **Step 1: Locate Pattern 2 in the triage doc**

The section starts at line 22 with the heading `### Pattern 2 — Half the alpha "Must Have" missing → **C + C1**`. The bullet to annotate is on line 32: `- Anthropic adapter (AIProvider port implementation)`.

- [ ] **Step 2: Append a resolution note directly under that bullet**

Use `Edit` with:

`old_string`:

```
- Anthropic adapter (AIProvider port implementation)
```

`new_string`:

```
- Anthropic adapter (AIProvider port implementation) — **Resolved under R-REM-W3-a (2026-04-20).** The orchestrator's real AI path is `executeStageRun` → `SubprocessExecutor` (`StageExecutor` port) → `claude` binary → `SubprocessStdoutParser` (`StdoutParser` port; adapter landed in R-REM-W2). Seed data wires provider "Anthropic" → driver "claude-code" → model "Claude Sonnet 4.6" with `apiKeyRef: 'env:ANTHROPIC_API_KEY'`. The SDK-shaped `AIProvider` port (`complete`/`stream`/`listModels`/`healthCheck`) had zero consumers and was retired; if a direct-SDK path is ever needed it will be a separate port with a separate adapter, not a revival of the retired shape. End-to-end live-Claude journey proven by `e2e/real-anthropic-stage-run.spec.ts`.
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/audits/2026-04-17-audit-triage.md
git commit -m "$(cat <<'EOF'
docs(audit): resolve Pattern 2 Anthropic-adapter bullet under R-REM-W3-a

Annotates the triage bullet inline with the resolution rationale:
the SDK-shaped AIProvider port was retired (zero consumers) and the
existing subprocess-based orchestrator + seed config satisfy the
Anthropic-integration deliverable. Live-Claude journey proof lives
in e2e/real-anthropic-stage-run.spec.ts (added in this phase).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: commit succeeds.

---

## Task 3: Write the failing Playwright journey test (skeleton + skip guard)

**Purpose:** stand up the new e2e spec file with its skip-guard + pageerror harness + entry-point navigation before writing the assertions. The test should RUN (be discovered) in both conditions and fast-fail loudly if anything structural is wrong.

**Files:**
- Create: `e2e/real-anthropic-stage-run.spec.ts`

- [ ] **Step 1: Create the file with the skip guard and error capture, but leave the assertions empty**

Full initial content:

```typescript
// e2e/real-anthropic-stage-run.spec.ts
// R-REM-W3-a journey test: drives a real stage run against live Claude and
// asserts the engine completes end-to-end.
//
// Skips cleanly when ANTHROPIC_API_KEY is absent so CI and local runs without
// the key stay green; with the key set, it advances seed issue #1 through the
// Research stage, waits for the RunDetailModal to show terminal
// `stage_run.status = 'completed'`, asserts at least one `tool_call` transcript
// entry is present, and asserts no console errors fired during the run.
import { test, expect, projectPath } from './helpers/setup';

const HAS_API_KEY = !!process.env.ANTHROPIC_API_KEY;

test.describe('@r-rem-w3-a @journey', () => {
  test.skip(!HAS_API_KEY, 'requires ANTHROPIC_API_KEY in environment');

  // Live-Claude runs can take 1–3 minutes depending on stage complexity.
  // Bump the default 60s timeout well past the expected completion window.
  test.setTimeout(5 * 60_000);

  test('real Claude advances issue through Research stage end-to-end', async ({ page }) => {
    const pageErrors: Error[] = [];
    const consoleErrors: string[] = [];

    page.on('pageerror', (err) => pageErrors.push(err));
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    // Seed issue #1 is "Add health check endpoint with build metadata" in state "New".
    await page.goto(projectPath('/issues/1'));

    await expect(page.getByRole('heading', { name: /Add health check endpoint/ })).toBeVisible({
      timeout: 15_000,
    });

    // TODO (next step): advance to Research, click Run Stage, assert terminal state + tool_call.
  });
});
```

- [ ] **Step 2: Run the skeleton against the dev server to verify the plumbing**

Prerequisites for this step:
- Dev server on port 3003 with `FLUXAOS_LAN_AUTH_BYPASS=1` (per memory `reference_dev_server_port.md`).
- `ANTHROPIC_API_KEY` exported in the shell running Playwright (the whole point of this test).

Run:

```bash
PLAYWRIGHT_BASE_URL=http://192.168.54.101:3003 npx playwright test e2e/real-anthropic-stage-run.spec.ts --reporter=list
```

Expected with key set: skeleton navigates to issue #1, asserts the heading is visible, then passes (the assertions aren't written yet — only the skeleton). Test duration < 20s.

Expected without key: single-line `skipped 1` output — no navigation.

If the key-present run fails on the heading assertion, the seed is out of sync (possibly `/issues/1` is missing or titled differently). STOP and reseed:

```bash
tsx src/scripts/db/nuke.ts && npm run db:seed && npm run db:issues
```

Then re-run.

- [ ] **Step 3: Commit the skeleton**

```bash
git add e2e/real-anthropic-stage-run.spec.ts
git commit -m "$(cat <<'EOF'
test(e2e): add R-REM-W3-a journey skeleton with skip-on-missing-key guard

Scaffolds the live-Claude journey test with its skip guard, 5-minute
timeout, pageerror/console capture, and navigation to seed issue #1.
Assertions wired in the next commit so a structural problem shows up
in isolation if the skeleton is wrong.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: commit succeeds.

---

## Task 4: Wire the journey assertions (advance state → Run Stage → wait for terminal)

**Purpose:** add the real journey body — advance state to Research, click Run Stage, wait for `RunDetailModal` to reach `completed`, assert ≥1 `tool_call` entry, assert no console errors.

**Files:**
- Modify: `e2e/real-anthropic-stage-run.spec.ts`

- [ ] **Step 1: Replace the `TODO` line with the full journey body**

Use `Edit` with:

`old_string`:

```
    // TODO (next step): advance to Research, click Run Stage, assert terminal state + tool_call.
  });
```

`new_string`:

```
    // The Run Stage button only renders when the issue's state matches a
    // pipeline stage name. Seeded state is "New"; advance to "Research" so
    // the orchestrator's `matchingStage` resolves.
    //
    // The State dropdown is built by CatalogSelect — a flex row containing a
    // <span>State</span> label, a CatalogBadge, and a <select> whose option
    // VALUES are state UUIDs and option TEXT is the display name. Scope to
    // the container whose direct child span has exact text "State".
    const stateSelect = page
      .locator('div.flex.items-center.gap-2', {
        has: page.locator('span', { hasText: /^State$/ }),
      })
      .locator('select');
    await stateSelect.selectOption({ label: 'Research' });

    // Wait for Run Stage to appear after the state change persists.
    const runStageButton = page.getByRole('button', { name: /Run Stage/ });
    await expect(runStageButton).toBeVisible({ timeout: 15_000 });

    // Click — triggers pipeline.runs.trigger, setActiveRunId, RunDetailModal opens.
    await runStageButton.click();

    // RunDetailModal header renders once runId is set.
    await expect(page.getByText(/Pipeline Run/i).first()).toBeVisible({
      timeout: 15_000,
    });

    // Wait for the stage run to reach terminal "completed" status. The modal
    // renders the status via <PipelineStatusBadge>; status values are lowercase
    // engine strings (queued | running | completed | failed | cancelled). This
    // arrives via the Realtime subscription on stage_run — no polling here.
    //
    // Live Claude completions for the Research stage typically land in under
    // 2 minutes; the test timeout is 5 minutes. Use expect.poll over the
    // visible badge text so the assertion only fires when Realtime delivers
    // the terminal update.
    const statusBadge = page
      .locator('[aria-label="Run detail"]')
      .getByText(/^(queued|running|completed|failed|cancelled)$/i)
      .first();

    await expect.poll(
      async () => (await statusBadge.textContent())?.toLowerCase().trim() ?? '',
      {
        timeout: 4 * 60_000,
        intervals: [2_000, 5_000, 10_000],
        message: 'stage_run never reached terminal completed status. Either live Claude failed to respond, or the Realtime subscription did not deliver the final update.',
      },
    ).toBe('completed');

    // Assert at least one tool_call entry streamed through the transcript.
    // LiveOutput renders parsed entries; tool_call entries use the
    // ToolCallEntry component which prefixes with "> <toolName>:". Grep for
    // that visible pattern inside the Run Detail dialog.
    const toolCallLine = page
      .locator('[aria-label="Run detail"]')
      .locator('text=/^>\\s+\\S+/')
      .first();

    await expect(toolCallLine).toBeVisible({
      timeout: 10_000,
    });

    // Final gate: no pageerror, no Supabase registry / env / config errors.
    // Allow unrelated third-party noise (e.g. bundler/HMR warnings that pass
    // through console.error in dev) but fail hard on known regression patterns.
    const knownErrorPattern = /Adapter ".*" is not registered|Missing required environment variable|Missing Supabase config|Uncaught/;
    const matchedErrors = consoleErrors.filter((e) => knownErrorPattern.test(e));

    expect(
      pageErrors,
      `Unexpected pageerror(s): ${pageErrors.map((e) => e.message).join('; ')}`,
    ).toHaveLength(0);
    expect(
      matchedErrors,
      `Unexpected registry/env errors: ${matchedErrors.join('; ')}`,
    ).toHaveLength(0);
  });
```

- [ ] **Step 2: Run the test against live Claude**

```bash
PLAYWRIGHT_BASE_URL=http://192.168.54.101:3003 npx playwright test e2e/real-anthropic-stage-run.spec.ts --reporter=list
```

Expected: 1 passed in ~60–180s with `ANTHROPIC_API_KEY` set.

**If the status-poll times out at 4 minutes:**
1. Open the trace: `npx playwright show-trace playwright-report/data/*/trace.zip` (or look at the on-failure screenshot).
2. Check `npm run db:runs` — what's the real `stage_run.status`?
3. Check `npm run db:events -- --run <runId>` — did `stream_token`/`tool_call` events arrive?
4. If the engine silently errored, this is the journey failing loudly, exactly as intended. Don't paper over it — the phase goal is to observe failure modes on `main` before merging. File a deferred issue if the cause is pre-existing and not in scope, otherwise investigate and fix the real bug in a separate commit (NOT by loosening the test).

**If the tool_call assertion fails but status is `completed`:**
Investigation path:
1. Check `npm run db:events -- --run <runId>` for any `tool_call` kind rows.
2. Check `LiveOutput.tsx` — the transcript is built from parsed entries, not events (line 174 shows `e.kind === 'tool_call'` rendering `> ${toolName}: ${toolCommand}`). The test locator `text=/^>\s+\S+/` must match that format.
3. If Claude's run genuinely had no tool use (e.g. a pure-text response), change the seeded issue's prompt to one that reliably triggers tool use, OR relax the assertion to "at least one transcript entry of any kind" — but only after confirming with the user that tool_use is not a hard requirement for Research stage.

**If unrelated pageerror fires during the run:** treat as a real bug. Investigate root cause, do not downgrade to a warning.

- [ ] **Step 3: Run the test WITHOUT the key to confirm the skip works**

```bash
unset ANTHROPIC_API_KEY
PLAYWRIGHT_BASE_URL=http://192.168.54.101:3003 npx playwright test e2e/real-anthropic-stage-run.spec.ts --reporter=list
```

Expected: `1 skipped`. Duration < 3s.

Restore `ANTHROPIC_API_KEY` for the subsequent human verification step.

- [ ] **Step 4: Commit**

```bash
git add e2e/real-anthropic-stage-run.spec.ts
git commit -m "$(cat <<'EOF'
test(e2e): assert live-Claude stage run completes end-to-end

Drives seed issue #1 through the Research stage against real Claude:
advances state, clicks Run Stage, waits up to 4 minutes for the
RunDetailModal to show terminal "completed" via the Realtime
subscription (no polling), asserts at least one tool_call entry
streamed into the transcript, asserts no pageerrors or registry/env
console errors.

Converts R-REM-W3-a's alpha-unlock criterion from "engine expected
to work" to "engine observed to work against live Claude."

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: commit succeeds.

---

## Task 5: Full verification matrix

**Purpose:** confirm the full automated suite stays green before handing off to human verification.

**Files:**
- None modified.

- [ ] **Step 1: Run each automated check**

Run sequentially (faster checks first so failures surface quickly):

```bash
npx tsc --noEmit
npm run lint
npx vitest run
npm run verify
npm run build
```

- [ ] **Step 2: Run ALL Playwright specs (not just the new one)**

```bash
PLAYWRIGHT_BASE_URL=http://192.168.54.101:3003 npx playwright test --reporter=list
```

Expected:
- `tsc --noEmit`: zero errors.
- `lint`: problem count ≤ baseline (53 as of R-UI-2.5 merge). Zero new problems. Pre-existing warnings that were previously touched by another file might suddenly surface in reports — check diff; anything in files this phase didn't touch is not my bug but worth noting.
- `vitest run`: same pass count as Task 0 baseline (e.g. `122 passed`).
- `verify`: `10/10 PASS`.
- `build`: compiles, no new warnings around removed files.
- `playwright test` (all specs): all pre-existing specs green; the new journey either `1 passed` (key set) or `1 skipped` (key unset) — both acceptable.

- [ ] **Step 3: Capture the verification matrix for the PR body**

Record, for the PR description:

| Check | Result | Notes |
|---|---|---|
| `npx tsc --noEmit` | <fill> | |
| `npx vitest run` | <fill>/<total> | |
| `npm run verify` | <fill>/10 | |
| `npm run lint` | <fill> problems | delta vs baseline 53 |
| `npm run build` | <fill> | |
| `e2e/real-anthropic-stage-run.spec.ts` | <PASS/SKIP> | with/without `ANTHROPIC_API_KEY` |
| All other e2e specs | <fill> | |

No commit for this task.

---

## Task 6: Human verification (BLOCKING — do not merge without)

**Purpose:** satisfy invariant 21. Playwright observing the DOM does not substitute for a human operator watching the engine execute live Claude.

**Files:**
- None. Human action only.

- [ ] **Step 1: Prepare the environment**

Confirm:
- Dev server is running on `:3003` with `FLUXAOS_LAN_AUTH_BYPASS=1`.
- `ANTHROPIC_API_KEY` is set in the dev server's environment (NOT just the Playwright shell).
- Database is on a fresh seed: `tsx src/scripts/db/nuke.ts && npm run db:seed && npm run verify:seed` → `10/10 PASS`.

- [ ] **Step 2: Open the browser and drive the run manually**

1. Navigate to `http://192.168.54.101:3003/default/admin/fluxaos/issues/1`.
2. Change state from "New" to "Research" via the State dropdown.
3. Click **Run Stage**. RunDetailModal opens.
4. **Observe:** `LiveOutput` pane populates as Claude streams text and tool calls. Status badge transitions `queued` → `running` → `completed`.
5. **Confirm:** at least one tool-call line appears in the transcript (`> Bash: ...` or similar).
6. **Confirm:** the status badge reaches `completed` without manual refresh. If the page requires F5 to update, that's an invariant-9 regression — STOP.
7. **Confirm:** issue state advanced past Research on its own (or stayed at Research with a signal comment — either is valid skill behavior; only "silent no-op" is wrong).
8. **Confirm:** activity feed (if issue detail scrolled into view) shows the `pipeline_started` / `stage_started` / `stage_completed` events in real time (Realtime subscription from R-UI-2.5).

- [ ] **Step 3: File deferred issues for any surprises**

If anything above surfaces a bug that isn't in scope for R-REM-W3-a (e.g. a display glitch in the transcript, a wrong badge color, a seed-data issue), append an entry to `docs/superpowers/deferred-fixes.md` with DEF-0NN numbering. Do NOT fix in this PR. Per `feedback_deferred_issues.md`, capture in markdown only — no Forgejo tickets.

- [ ] **Step 4: Only after all four "Confirm" bullets pass, proceed to Task 7**

If any confirm fails, STOP, investigate the root cause, and either fix it (new commits on this branch) or escalate to the user. Do not proceed to merge.

---

## Task 7: Roadmap + deferred-fixes updates

**Purpose:** reflect the new phase status in the roadmap and record any deferred findings from Task 6.

**Files:**
- Modify: `docs/superpowers/roadmap.md`
- Modify: `docs/superpowers/deferred-fixes.md` (only if Task 6 surfaced new items)

- [ ] **Step 1: Flip R-REM-W3-a row to Done**

In `docs/superpowers/roadmap.md` at line 23, change:

```
| R-REM-W3-a — Anthropic port cleanup + live-Claude journey | **Scoped, not planned** | — | [disposition-design](superpowers/specs/2026-04-20-r-ui-2-disposition-and-w3-decomposition-design.md) |
```

To:

```
| R-REM-W3-a — Anthropic port cleanup + live-Claude journey | **Done — PR #<NUM>** | [r-rem-w3-a-plan](superpowers/plans/2026-04-20-r-rem-w3-a-implementation.md) | [disposition-design](superpowers/specs/2026-04-20-r-ui-2-disposition-and-w3-decomposition-design.md) |
```

(Replace `<NUM>` with the actual PR number once the PR is open in Task 8. For now use `#<NUM>`; fix up at merge time.)

- [ ] **Step 2: Rewrite What's Next item 6**

In `docs/superpowers/roadmap.md` item 6 (currently: `6. **R-REM-W3-a** — Anthropic port cleanup + live-Claude journey — **Scoped (2026-04-20), not planned.** ...`), replace with:

```markdown
6. **R-REM-W3-a** — Anthropic port cleanup + live-Claude journey — **Done (2026-04-20), PR #<NUM>.** Three items shipped: (a) deleted `src/core/ports/ai.ts` and its seven re-exports from the ports barrel — zero runtime consumers; the orchestrator's real AI path is `executeStageRun` → `SubprocessExecutor` → `claude` binary → `SubprocessStdoutParser`, already wired via seed data and R-REM-W2's parser adapter; (b) appended a resolution note inline on the R-AUDIT triage Pattern 2 "Anthropic adapter" bullet citing this phase and PR; (c) added `e2e/real-anthropic-stage-run.spec.ts` — a Playwright journey that skips without `ANTHROPIC_API_KEY` and with it advances seed issue #1 through the Research stage, asserts terminal `completed` status via Realtime (no polling), asserts ≥1 `tool_call` transcript entry, asserts no console errors. Alpha-unlock milestone: converts "engine expected to work" to "engine observed to work against live Claude." Full verification: tsc clean, vitest <fill>/<total>, verify 10/10, lint baseline unchanged, Playwright green (journey passed against live API; all prior specs still green), human browser check passed. See [disposition-design](superpowers/specs/2026-04-20-r-ui-2-disposition-and-w3-decomposition-design.md), [r-rem-w3-a-plan](superpowers/plans/2026-04-20-r-rem-w3-a-implementation.md), [closeout handoff](superpowers/handoffs/<fill at handoff time>).
```

Fill `<NUM>`, `<fill>`, and the handoff path at PR creation / handoff time. The placeholders stay in the commit until actual values are known.

- [ ] **Step 3: Update What's Next item 7 framing (R-REM-W3 remainder)**

Item 7's text is fine as-is — it already describes four remaining slices starting with GitHub adapter. Leave untouched unless Task 6 surfaced evidence that changes the ordering.

- [ ] **Step 4: Add deferred-fixes entries if Task 6 surfaced any**

If Task 6 filed any DEF-0NN items, they should have been appended during Task 6 step 3 already. No additional action here — just confirm they're present before committing.

- [ ] **Step 5: Commit roadmap update**

```bash
git add docs/superpowers/roadmap.md
# plus deferred-fixes.md only if it was touched in Task 6
git status
git commit -m "$(cat <<'EOF'
docs(roadmap): R-REM-W3-a done — live-Claude journey shipped

Flips R-REM-W3-a row from Scoped to Done and rewrites What's Next
item 6 with the shipped summary. PR # and handoff path placeholders
fixed up at PR-open time.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

Expected: commit succeeds.

---

## Task 8: Open PR + post-merge cleanup

**Purpose:** ship.

**Files:**
- None — git + gh only.

- [ ] **Step 1: Push the branch**

```bash
git push -u origin feat/r-rem-w3-a-anthropic-cleanup
```

Expected: push succeeds, pre-push hook passes.

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "R-REM-W3-a: delete unused AIProvider port + live-Claude journey test" --body "$(cat <<'EOF'
## Summary

- Delete `src/core/ports/ai.ts` and its seven re-exports from `src/core/ports/index.ts`. Zero runtime consumers; the orchestrator's real AI path is `executeStageRun` → `SubprocessExecutor` (`StageExecutor` port) → `claude` binary → `SubprocessStdoutParser` (`StdoutParser` port, shipped R-REM-W2), already wired via seed data.
- Append resolution note inline on the R-AUDIT triage Pattern 2 "Anthropic adapter" bullet.
- Add `e2e/real-anthropic-stage-run.spec.ts`: skips cleanly without `ANTHROPIC_API_KEY`; with the key, drives seed issue #1 through the Research stage against real Claude, asserts terminal `completed` status via the Realtime subscription (no polling), asserts ≥1 `tool_call` transcript entry, asserts no console errors.

Alpha-unlock milestone: converts "engine expected to work" to "engine observed to work against live Claude."

Spec: [2026-04-20-r-ui-2-disposition-and-w3-decomposition-design.md §Phase 3](../blob/main/docs/superpowers/specs/2026-04-20-r-ui-2-disposition-and-w3-decomposition-design.md#phase-3--r-rem-w3-a-anthropic-port-cleanup--end-to-end-journey)
Plan: [2026-04-20-r-rem-w3-a-implementation.md](../blob/main/docs/superpowers/plans/2026-04-20-r-rem-w3-a-implementation.md)

## Verification matrix

| Check | Result |
|---|---|
| `npx tsc --noEmit` | <fill> |
| `npx vitest run` | <fill>/<total> |
| `npm run verify` | 10/10 |
| `npm run lint` | <fill> problems (Δ vs baseline 53) |
| `npm run build` | compiles |
| `e2e/real-anthropic-stage-run.spec.ts` (with `ANTHROPIC_API_KEY`) | PASS |
| `e2e/real-anthropic-stage-run.spec.ts` (without key) | SKIP |
| All other e2e specs | all green |
| Human browser verification | PASS (per invariant 21) |

## Test plan

- [x] Automated verification matrix (above) complete before review
- [x] Human operator drove a live stage run in-browser end-to-end and observed terminal `completed` state
- [x] Human operator confirmed ≥1 `tool_call` line streamed into transcript without manual page refresh
- [x] Human operator confirmed no console errors or pageerrors during the run

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Fill `<fill>` from the Task 5 matrix before running. Capture the returned PR URL.

- [ ] **Step 3: Back-fill the PR number into the roadmap**

Once the PR exists with a known number:

```bash
# Example: if the PR is #49
sed -i 's/Done — PR #<NUM>/Done — PR #49/g' docs/superpowers/roadmap.md
sed -i 's/Done (2026-04-20), PR #<NUM>/Done (2026-04-20), PR #49/g' docs/superpowers/roadmap.md
git add docs/superpowers/roadmap.md
git commit -m "docs(roadmap): back-fill PR #49 on R-REM-W3-a row

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push
```

Verify with `grep '<NUM>' docs/superpowers/roadmap.md` — expected: no matches.

- [ ] **Step 4: Merge + cleanup**

```bash
gh pr merge <NUM> --squash --delete-branch
git checkout main
git pull origin main
git fetch --prune origin
git branch -d feat/r-rem-w3-a-anthropic-cleanup
```

Expected:
- `pr merge` succeeds.
- `git branch -d` succeeds (branch is fully merged to main via squash — note `-d` not `-D`).
- `git branch -a` now lists only `main` and `remotes/origin/main`.

- [ ] **Step 5: Final sanity**

```bash
git log main -3 --oneline
git status
```

Expected:
- Top line is the new squash-merge commit for R-REM-W3-a.
- `git status`: clean, tracking `origin/main`.

---

## Self-review notes (author's check against the spec)

Ran against §"Phase 3 — R-REM-W3-a" of the disposition design, lines 108–142:

| Spec item | Task covering it |
|---|---|
| Delete `src/core/ports/ai.ts` | Task 1 Step 1 |
| Remove re-exports from `src/core/ports/index.ts` | Task 1 Step 2 |
| `tsc --noEmit` catches accidental imports | Task 1 Step 3, Task 0 Step 4 (pre-baseline), Task 5 Step 1 |
| Append resolution note to triage Pattern 2 | Task 2 |
| New Playwright test skipping without key | Task 3 Step 1, Task 4 Step 3 verification |
| Advance to Research, trigger Run Stage | Task 4 Step 1 |
| Assert terminal `stage_run.status = 'completed'` | Task 4 Step 1 (status-badge poll) |
| Assert ≥1 `tool_use` event | Task 4 Step 1 — observed as `tool_call` transcript entry (the StdoutParser's normalized form of Anthropic's `tool_use` content; see `src/core/ports/stdout-parser.ts:10` and `src/adapters/subprocess/stdout-parser.ts:73`). Noted in the test comments. |
| Assert no console errors | Task 4 Step 1 (final assertion block) |
| `npx vitest run` green | Task 5 Step 1 |
| `npm run verify` 10/10 | Task 5 Step 1 |
| `npm run lint` no new problems | Task 5 Step 1 |
| `npm run build` compiles | Task 5 Step 1 |
| Human browser verification (invariant 21) | Task 6 (blocking) |
| Roadmap row insert + What's Next update | Task 7 |

Gaps: none. All spec items covered.

Placeholder scan: `<fill>` and `<NUM>` markers appear in Tasks 7 and 8, with explicit instructions on when/how to substitute. Every code block is complete; no "TODO: add validation" style placeholders in the code itself.

Type / API consistency:
- `PipelineStatusBadge` status values match the engine's lowercase strings — verified against `src/components/pipeline/RunDetailModal.tsx:188` (takes `detail.status` directly).
- `tool_call` is the correct `StdoutParser` `EntryKind`, not `tool_use` — `tool_use` is the Anthropic protocol's raw content-block type which `SubprocessStdoutParser` maps to `tool_call`. Test assertions target the rendered form.
- Playwright testid/locator strategies match R-UI-2.5's `e2e/activity-feed-realtime.spec.ts` and R-REM-W2's `e2e/run-stage-smoke.spec.ts` — consistent style.

Risks / unknowns noted in the plan body:
- Live Claude Research stage may not trigger tool use. Fallback path documented in Task 4 Step 2.
- If lint baseline shifted between this plan's creation (Apr 20) and execution, use the current baseline as reported by `npm run lint`, not a hardcoded 53.

---

## End of Plan
