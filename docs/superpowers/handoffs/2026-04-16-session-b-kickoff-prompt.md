# Session B Kickoff Prompt

**Purpose:** Copy-paste this into a new Claude Code session to resume R-UI-1 exactly where Session A left off.

---

## Paste this as the first message of Session B

```
We're continuing R-UI-1 implementation on fluxaOS. Session A completed Tasks 1-4 of
Phase 0 (the harness→driver rename foundation). Your job is to execute Tasks 5-30.

Read these three files IN THIS ORDER before doing anything:

1. docs/superpowers/handoffs/2026-04-16-r-ui-1-session-a-rename.md
   (the full Session A handoff — what shipped, decisions made, gotchas, state)

2. docs/superpowers/specs/2026-04-16-r-ui-1-design.md
   (the design spec — what we're building)

3. docs/superpowers/plans/2026-04-16-r-ui-1-implementation.md
   (the 31-task implementation plan — Session B starts at Task 5)

Branch: feat/r-ui-1-implementation (should already be checked out — if not, check it out)
Current HEAD: 8213c80 (Session A handoff commit)

BEFORE STARTING TASK 5, verify Session A state is intact:

  git log --oneline -7
  # Top 7 commits should be:
  #   8213c80 docs: Session A handoff
  #   d86f6d8 refactor: rename harnessRouter→driverRouter
  #   901f3fb refactor: add harness_catalog→driver rename migration
  #   c3723dd docs: add DEF-007
  #   29fffef refactor(schema): rename harness→driver
  #   bd2e109 chore: start R-UI-1 Session A
  #   df100bf docs(plan): R-UI-1 DA fixes

  git status --short
  # Expected: empty

  # Verify DB is still renamed (not re-nuked/re-migrated to old schema):
  cat <<'SCRIPT' > /tmp/db-check.ts
  import 'dotenv/config';
  import { SupabaseDatabaseProvider } from './src/adapters/supabase/database';
  async function main() {
    const p = new SupabaseDatabaseProvider(process.env.DATABASE_URL!);
    const db = p.getConnection();
    const r: any = await db.execute(
      `SELECT tablename FROM pg_tables WHERE schemaname='public'
       AND tablename IN ('driver','harness_catalog') ORDER BY tablename`
    );
    console.log(JSON.stringify(r));
    await p.close();
  }
  main();
  SCRIPT
  npx tsx /tmp/db-check.ts
  # Expected: [{"tablename":"driver"}]
  # If it returns harness_catalog, STOP — state is drifted from Session A

DO NOT run npm run db:seed yet. seed.ts still references harnessCatalog and will fail
until Task 5 renames the identifiers in consumer files.

DO NOT run npm run dev yet. Next.js pages still use trpc.harness and will fail.

DO NOT run npx vitest run yet. Tests still reference harness identifiers.

After Task 5 completes (the broad sed sweep), Task 6 validates all of the above.

Use superpowers:subagent-driven-development for execution — fresh subagent per task,
two-stage review (spec compliance + code quality) after each. The plan has full code,
exact commands, and expected output pre-written for every step.

Session B scope: Tasks 5-30 (broad rename sweep + features + journey tests).
Session C scope: Task 31 (verification + re-DA + PR open).

CRITICAL carry-forward items to preserve through the session (pinned in the Session A
handoff's "carry-forward registry" section):

  - Skill rewrites for start-of-day, end-of-day, housekeeping (not R-UI-1 scope)
  - R5.5 tests 4+5 (clean pipeline output, hold/needs_human)
  - 15 pre-existing UI deferred fixes in deferred-fixes.md
  - DEF-001..007 entries (all tracked in deferred-fixes.md)
  - R-UI-2 real-time updates phase (comes after R-UI-1)

Known gotchas (full list in handoff doc):

  - Pre-commit hook exempts src/core/db/schema.ts from the 500-line rule, but only
    in the local .git/hooks/pre-commit. DEF-007 tracks the fix. If you're on a
    different clone, you may need to re-apply the exemption.
  - drizzle-kit generate may fail without an interactive TTY. Task 5 doesn't need
    migrations, so this shouldn't bite.
  - stash@{0} is an unrelated auto-edit to start-of-day/ingest/SKILL.md. Safe to
    drop: git stash drop stash@{0}. The start-of-day skill is slated for a rewrite.

Start with Task 5.
```

---

## Why this kickoff prompt exists separately from the handoff

The handoff (`2026-04-16-r-ui-1-session-a-rename.md`) is the **reference doc** — 471 lines, comprehensive, read once to understand context.

This kickoff prompt is the **invocation** — tight, copy-pasteable, tells the new session what to read, what to check, what not to run, and where to start. If you paste only the handoff filename into a new session, the agent has to figure out the sequence itself; if you paste this kickoff, it knows exactly what to do.
