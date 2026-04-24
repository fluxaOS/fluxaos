# Session Quick-Start

**Read this before doing anything.** These are conventions that every session must follow.

## Deferred Issues

Issues found during verification go to `docs/superpowers/deferred-fixes.md` — NOT Forgejo tickets. The database gets nuked regularly so Forgejo issue state would be lost. Format:

```markdown
## UI: Brief description

**Found:** YYYY-MM-DD during <context>
**Severity:** High/Medium/Low
**Location:** `src/path/to/file.tsx`
**What's needed:** What to fix
```

## Database Access

Use npm scripts to query the app's Supabase database:

- `npm run db:issues` — issues with state/status/priority
- `npm run db:runs` — pipeline runs with stage details and signals
- `npm run db:gates` — gate results with verdicts
- `npm run db:events` — events (all recent, or filtered by `--run <id>` / `--issue <id>`)
- `npm run db:studio` — Drizzle Studio (visual DB browser)

Note: These scripts are being built (R-INFRA-2). Until then, use `npm run db:studio`.

## Dev Server

Headless box. Dev server runs on port **3003** (port 3000 is taken by semaphore). Always start with `npm run dev -- -p 3003`. From other machines: `http://192.168.54.101:3003`. For Playwright runs against the LAN URL: `PLAYWRIGHT_BASE_URL=http://192.168.54.101:3003 npx playwright test`.

## Environment Files

- **`.env`** — checked into git template, holds Supabase URLs/keys (publishable only) and DB connection strings. Required: `DATABASE_URL` (transaction pooler, port 6543), `DIRECT_URL` (direct connection, port 5432, required for migrations), `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
- **`.env.local`** — gitignored, holds secrets like `ANTHROPIC_API_KEY` and `FLUXAOS_LAN_AUTH_BYPASS=1` (skip `/login` from LAN clients during Playwright runs). Next.js auto-loads `.env.local`; Playwright picks it up via `set -a; source .env.local; set +a` before invocation. Never paste these into prompts.

## CLI Tools

Standalone TypeScript project — no `flu` CLI, no `fhc`. Use npm scripts (see Commands table in CLAUDE.md).

## Verification — Long Form

CLAUDE.md says: "UI work requires a passing Playwright journey test in `e2e/`." The reasoning:

The original "no self-certification" rule existed because earlier AI agents shipped UI work that didn't function and claimed it did. The fix isn't "human must look" — it's "AI must produce mechanical proof." Playwright journey tests that simulate a user end-to-end ARE the proof. They click the buttons a user would click, open the modals they'd open, assert the rendered DOM, capture every `pageerror` and unexpected `console.error`. When that test passes, the work is verified.

**Reference implementation:** `e2e/real-anthropic-stage-run.spec.ts`. Patterns to copy:
- `test.skip(!HAS_API_KEY, ...)` so the spec is safe in environments without the key.
- `page.on('pageerror', ...)` and `page.on('console', msg => msg.type() === 'error' && ...)` capture, asserted at end of test.
- `expect.poll(...)` for state-transition waits (no arbitrary `waitForTimeout`).
- Selector strategy: structural (`role`, `aria-label`, `class` patterns) not text-only — text changes; DOM structure usually doesn't.
- A "knownErrorPattern" regex to filter out third-party noise while failing hard on regression-relevant errors.

**When you write a new journey test:** scope it to one user-visible journey, not a multi-page tour. Each spec file should be runnable in isolation, take <2 min, and read like a story (`navigate → act → wait → assert`).

**When the journey test is hard to write:** that's a real signal. Unstable selectors mean the UI lacks `aria-label` discipline; ambiguous assertions mean the spec needs sharper visible state; >5 min runtime usually means the test is testing too much. Surface these — they're architectural smells worth addressing.

## Autonomy — When to Consult, When to Decide

CLAUDE.md's "AI Authority" section is the rule. Long-form rationale:

The user wants this project ~95% AI-managed. Most "should I do X or Y?" questions agents ask are decisions the agent has the context to make and the user doesn't. Default to action.

**Things that genuinely need approval:**
- **Schema migrations.** Postgres migrations are essentially irreversible at scale. One bad migration = backup restore. Show the diff first.
- **New dependencies.** Each adds attack surface, build time, and maintenance burden. Cite why an existing package can't do it.
- **Roadmap changes.** The roadmap is a stated commitment; changing it changes the project's direction.
- **External pushes.** PRs to public repos, posts, anything that leaves a permanent trail outside this machine.

Everything else: pick, document, ship. If something later turns out wrong, the user will say so and you'll save that as a feedback memory. Iterating on actual decisions beats consulting on hypothetical ones.

## Gotchas

- Optimistic concurrency required on all mutable entities (`WHERE version = $expected`)
- Events tables are append-only (immutable audit trail)
- Body HTML rendered at write time, never at read time
- Multi-tenancy: Org → User → Project. URL: `/[org]/[user]/[project]/issues/1`
- No production database — Supabase Cloud is the dev database. Nuke-and-seed freely.
- `appendEvent` is fire-and-forget — concurrent inserts commit out of producer order. Use `pipelineRunService.listEvents()` to read events; it merges stream + lifecycle events back into coherent order. (DEF-017, 2026-04-21.)
- Each pipeline run has two distinct directories. The **worktree** (`<target>/.fluxaos-worktrees/fluxaos__issue-<n>-<run-short>/`) holds the git checkout stages edit — everything committed to the target repo comes from here. The **artifacts dir** (`<target>/.fluxaos-artifacts/<runId>/`) is where stages hand off intermediate findings to each other (Research writes `research-findings.md`, Implement reads it and writes `plan.md`, Review reads the plan, etc.). Artifacts outlive the worktree; cleanup-service reaps them on a separate retention window (`FLUXAOS_CLEANUP_ARTIFACTS_RETENTION_DAYS`). When debugging a run post-hoc, inspect the artifacts dir for what each stage thought it was doing. (R-ARTIFACTS, 2026-04-23.)
