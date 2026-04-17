# fluxaOS — Invariants

These are not guidelines. These are hard constraints. Every piece of work must satisfy all of them. If your work violates any invariant, it is wrong regardless of whether it "works."

## Two Actors: The Orchestrator and The Workers

There are two types of actors with completely different responsibilities:

### The System Service (systemd daemon) — The Orchestrator

The brain. Runs as a background service on a heartbeat:
- Wakes up on its heartbeat interval
- Checks the database for issues that need work
- Evaluates the rules engine (gates, transitions, routing)
- Assigns work to AI workers via the job queue
- Reads results back from workers
- Updates issue state, status, priority, pipeline stage — all database writes for pipeline progression
- Transitions issues to the next stage based on the rules
- Records events and audit trail entries

The orchestrator is the ONLY actor that manages pipeline state.

### The AI Workers — Pure Executors

AI workers are dumb pipes:
- Receive a task from the queue: a prompt, a skill, a context
- Do the work (write code, research, review, etc.)
- Report what they did by adding a comment to the issue
- That's it. They're done.

AI workers do NOT: know what pipeline stage they're in, know the issue's state/status/priority, poll the database, update issue state/status/priority/type/pipeline stage, delete comments, or make any pipeline or routing decisions.

**Why this matters:** In PAT, AI workers were polling the database every 3-5 minutes, burning through the Anthropic API plan in a single day. The systemd service does the orchestrating. The AI does the work. Clean separation.

**Comment permissions for AI workers:**
- Can add comments (with author attribution)
- Can edit their own comments (with audit trail: who, when, old value, new value)
- Cannot delete comments
- Every add/edit creates an audit trail entry

---

## Agnosticism

1. **No stage name appears in application code.** The words "research," "implement," "review," "deploy," "complete," "rework" must never appear in src/ except in seed data files and test fixtures. The engine references `currentStage`, `nextStage`, `stage.name` — never a literal stage name.

2. **No provider or model name appears in application code.** The words "anthropic," "openai," "claude," "gpt" must never appear in src/ except in adapter registration (src/adapters/) and seed data. The engine references `configuredProvider`, `resolvedModel` — never a literal provider name.

3. **No driver name appears in application code.** The words "claude-code," "aider," "codex" must never appear in src/ except in adapter registration and seed data. (Driver is the entity formerly known as "harness" — renamed in R-UI-1 to avoid industry-terminology collision.)

4. **No hardcoded enums for user-configurable data.** Issue types, states, statuses, priorities, labels, transitions, gate rules, routing rules — all come from database tables. If a value should be configurable by the user, it lives in the database, not in code.

5. **The engine runs identically with any number of stages.** One stage, five stages, fifty stages — zero code changes required. Adding a stage means adding database rows, not touching application code.

6. **Adding a new provider requires zero application code changes.** Only database rows (provider, models, routing rules) and optionally a new adapter file in src/adapters/.

## Architecture

7. **Zero vendor imports in src/core/.** No Supabase, no Drizzle (except `import type` and schema definitions), no BullMQ, no provider SDKs. Core services receive dependencies via injection. The adapter registry is the only resolution path.

8. **All services use dependency injection.** Services are factory functions that receive `Database` as a parameter. No singletons. No direct imports of adapters or connections.

9. **Everything is config-driven.** No fallback defaults. No silent degradation. If a required configuration is missing, the system fails fast with a clear error message naming what's missing. A misconfigured system crashes immediately — it does not silently do the wrong thing.

10. **Max ~500 lines per file.** Split into multiple files when approaching this limit.

11. **DRY strictly enforced.** Use the CRUD factory pattern. No copy-paste between services, routers, or adapters. If you find yourself duplicating logic, extract it.

## Data Integrity

12. **Optimistic concurrency on all mutable entities.** Issues, comments, and any entity that can be edited concurrently must use version fields. Update queries include `WHERE version = $expected`. Zero rows affected means conflict — return 409, not silent overwrite.

13. **Events are immutable.** The event tables are append-only. No updates. No deletes. They are the audit trail.

14. **Body HTML is rendered at write time.** Markdown bodies are rendered to HTML when created or updated, and the HTML is stored. Never render at read time.

## Testing

15. **No unit tests. Ever.** Zero unit tests in fluxaOS. Do not write them. Do not suggest them. Do not sneak them in alongside other work. This is non-negotiable.

16. **Integration tests hit real Supabase.** These test that the database layer actually works — real Postgres via the transaction pooler. They verify CRUD operations, constraints, and relationships. Not mocks. Not in-memory databases.

17. **The journey test is the real test.** A real user (or Playwright acting as one) does real things in a real browser against a real database. If one step fails, the entire journey fails. The journey test grows incrementally as features land.

18. **Real-time observability is required.** The user must be able to see what a running pipeline stage is actually doing — live output, not a spinner. Supabase Realtime was chosen specifically for this.

19. **CLI must pass the same journey.** Everything the browser can do, the CLI can do. Same operations, same results, same database.

20. **Provider/driver swap must not break the journey.** If you change one configuration value (swap providers or drivers), the entire journey test must still pass.

## Process

21. **No phase is complete without human verification.** An agent saying "this works" or "tests pass" is not verification. The user must see the result in a running browser or confirm via API output. Self-certification is explicitly forbidden.

22. **Architecture deviations are flagged, not decided.** If an implementation choice differs from the spec or these invariants, stop and flag it to the user. Do not make the decision autonomously and move on.

23. **Small phases with checkpoints.** Break work into pieces small enough that drift is caught early. Each checkpoint produces something the user can verify.

24. **No undocumented removals.** Never strip, simplify, or remove existing UI layouts, components, features, or behavior without explicit user approval. "Simplifying" a working page is a regression, not polish.

---

## Verification Script

Run before claiming any work is complete:

```bash
# Invariant 1-3: No hardcoded stage/provider/driver names in application code
grep -rn '"research"\|"implement"\|"review"\|"deploy"\|"complete"\|"rework"' src/ \
  --include='*.ts' --include='*.tsx' \
  --exclude-dir=__tests__ --exclude-dir=adapters \
  | grep -v 'seed\|fixture\|\.test\.' || echo "PASS: No hardcoded stage names"

grep -rn '"anthropic"\|"openai"\|"claude"\|"gpt"' src/ \
  --include='*.ts' --include='*.tsx' \
  --exclude-dir=adapters \
  | grep -v 'seed\|fixture\|\.test\.' || echo "PASS: No hardcoded provider names"

# Invariant 4: No hardcoded enums for configurable data
grep -rn "type IssueState\|type IssuePriority\|type IssueType" src/core/ \
  | grep -v 'import\|\.test\.' && echo "FAIL: Hardcoded issue enums found" \
  || echo "PASS: No hardcoded issue enums"

# Invariant 7: No vendor imports in core
grep -rn "from '@supabase\|from 'bullmq\|from 'ioredis\|from '@anthropic\|from 'openai" src/core/ \
  | grep -v 'import type' && echo "FAIL: Vendor imports in core" \
  || echo "PASS: No vendor imports in core"

# Invariant 10: File length check
find src/ -name '*.ts' -o -name '*.tsx' | while read f; do
  lines=$(wc -l < "$f")
  [ "$lines" -gt 500 ] && echo "WARN: $f has $lines lines (max ~500)"
done || echo "PASS: All files under 500 lines"

# Invariant 15: No unit tests
find src/ -name '*.test.ts' -o -name '*.spec.ts' | while read f; do
  grep -L 'supabase\|DATABASE_URL\|integration' "$f" 2>/dev/null
done | grep . && echo "FAIL: Unit test files found (only integration tests allowed)" \
  || echo "PASS: No unit tests"
```

These checks are necessary but not sufficient. Architectural drift requires human judgment — that's why every phase needs user verification.
