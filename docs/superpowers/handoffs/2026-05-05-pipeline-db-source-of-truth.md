# Session Handoff — 2026-05-05: DB-First Pipeline Routing

**Branch at end:** `main`
**HEAD:** `d0b0db6`
**Dev server:** running at http://192.168.54.101:3004 (LAN auth bypass active)

---

## What Happened

Complete architectural rip-and-replace of the pipeline execution system. The YAML playbook system was never properly wired end-to-end; this session deleted it entirely and replaced it with DB-driven routing.

### Shipped (PR #254, merged to main)

**Deleted:**
- `src/core/pipeline/playbook.ts`
- `src/core/pipeline/playbook-discovery.ts`
- `src/core/pipeline/playbook-auditor.ts`
- `src/core/pipeline/paperwork-executor.ts`
- `src/core/pipeline/bundled/` — all YAML files and skill .md files
- 8 playbook integration tests

**Schema (migration 0020):**
- Added `on_pass`, `on_fail`, `fallback` to `pipeline_stage`
- Dropped `skill_id`, `playbook_path`, `playbook_scope`

**Orchestrator (`event-orchestrator.ts`):**
- Deleted 560-line playbook execution branch
- DB-driven: loads persona soul → all skills → issue context → `composePrompt()`
- Fail-fast if `stage.personaId` is null
- `applyVerdict` reads `onPass`/`onFail`/`fallback` from DB; sentinels `__complete__` and `__blocked__`

**Prompt composer (`prompt-composer.ts`):**
- Full rewrite: `composePrompt(personaSoul, skills[], issueContext)`
- Persona soul = base system prompt; skills = reference block any agent can use

**Settings UI:**
- Personas tab restored in `layout.tsx`
- `StageEditor.tsx`: persona picker + routing fields (`onPass`/`onFail`/`fallback`), skill picker removed

**Seed data:**
- 5 personas seeded (Research Analyst, Software Engineer ×2, Code Reviewer, Release Engineer)
- All 5 stages have routing values and persona assignments
- Routing: research→implement→review→`__complete__` with rework loop; all fallback = `__blocked__`

**E2e tests (`e2e/pipeline-db-routing.spec.ts`):** 3 tests, all green.

### Linear
- FLX-153 ✅ Done
- FLX-129 ✅ Done
- FLX-154 ✅ Done

### New issues filed
- **FLX-155** (High) — Null/blank routing fields silently complete the pipeline run → should block with error
- **FLX-156** (High) — Typo/deleted stage name in routing throws and leaves pipeline run permanently stuck → should block with error

---

## Infrastructure Fix

The main repo `node_modules` was nearly empty (only 4 packages), causing the dev server to deadlock — it accepted TCP connections but never responded. Fixed by:
1. `npm install` in `/mnt/dev/fluxaos`
2. Created `/mnt/dev/fluxaos/.env` (was missing — old server had vars from shell env only)

The `.env` file now holds all Supabase credentials + `FLUXAOS_LAN_AUTH_BYPASS=1` permanently.

---

## State at Handoff

- `main` is clean, up to date with origin
- No open branches or worktrees
- Dev server running at port 3004 with LAN auth bypass
- FLX-155 and FLX-156 in Backlog — both are straightforward fixes in `applyVerdict()` in `event-orchestrator.ts`

## Natural Next Action

Fix FLX-155 and FLX-156 (both are 2-line changes in `applyVerdict` in `src/core/orchestrator/event-orchestrator.ts`) then run a full end-to-end pipeline to verify the routing works with a real issue.
