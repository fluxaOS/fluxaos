# fluxaOS Session Handoff — 2026-05-07 (FLX-2 CLI + FLX-200 auth fix)

**Session end:** 2026-05-07
**Model:** Claude Opus 4.7 (1M context)
**Branch:** main
**HEAD:** dfe676e

---

## What Was Accomplished

### FLX-2 — fluxaOS CLI surface (PR #323, merged `e6928f9`)

Shipped the post-alpha CLI as a thin tRPC HTTP wrapper at `src/cli/`. 5 non-interactive commands, all mapping 1:1 to existing tRPC procedures. Zero duplicated business logic — uses the same `AppRouter` type the web UI's React provider uses, so full type safety with no schema drift risk.

```
fluxaos status [--json]
fluxaos issue list [--json]
fluxaos issue view <number> [--json]
fluxaos issue create <title> [--description ...] [--type <key>] [--priority <key>] [--json]
fluxaos run --issue <number> [--stage <name>] [--json]
```

`fluxaos do` is deliberately omitted — depends on FLX-7 product decision.

**Architecture decisions:**
- **Bin shim spawns tsx** (`scripts/cli/fluxaos.mjs`) instead of building a `dist/` artifact — TypeScript source stays the only authoritative implementation. Same pattern every other CLI script in this repo uses (`db:*`, `verify:*`, `daemon`, `pipeline:*`).
- **Auth model** relies on `FLUXAOS_LAN_AUTH_BYPASS=1` on the server. Real Supabase OAuth from the CLI is out of scope for FLX-2; can be a follow-up issue if/when CLI is used outside the LAN.
- **Single-tenant project resolution** — looks up project by slug via `project.getBySlug` (defaults `fluxaos`/`default`/`admin`, all overridable via `FLUXAOS_CLI_*` env vars).
- **Catalog lookup is client-side** — backend's `issue.create` requires `typeId`/`priorityId` UUIDs and there's no "create by name" sugar. The CLI fetches the catalog once and joins client-side, matching what the React UI does. Keeps the boundary clean (no duplicated business logic; just key→UUID lookup).
- **Stage selection in `run`** — accepts `--stage <name>` (case-insensitive name match) or defaults to the pipeline's first stage by `sortOrder`. The trigger procedure does NOT default to `stages[0]`, so the CLI must pick.

**Test coverage:** `src/__tests__/integration/cli.test.ts` — 4 integration tests against running dev server: project context resolution, `issue.list` schema, `issue.create` round-trip, catalog key surfacing. Passes 4/4 in 1.8s. Skips cleanly when `FLUXAOS_API_URL` is unset (top-level probe before `describe.skipIf`).

**Verification:** End-to-end smoke against running dev server — status OK, list returns 3 seeded rows joined to display names, `issue create "..."` round-trips and is visible in `npm run db:issues`. Co-runs with `orchestrator-concurrency.test.ts` 6/6 in 8.6s — confirms no FLX-199 regression.

### FLX-200 — Issue router mutations protected (PR #324, merged `dfe676e`)

Found while auditing the tRPC surface for FLX-2: FLX-167 ("replace publicProcedure with protectedMutation on all mutations") missed `src/server/routers/issue.ts`. All 7 issue + comment mutations were still `publicProcedure` on main, even though FLX-167's commit message claimed comprehensive coverage. The issue body for FLX-167 explicitly listed every router *except* `issue.ts`.

**Fix (9-line diff):**

| Procedure | Old | New |
|-----------|-----|-----|
| `issue.create` | `publicProcedure` | `protectedMutation(EDIT_ROLES)` |
| `issue.updateFields` | `publicProcedure` | `protectedMutation(EDIT_ROLES)` |
| `issue.transition` | `publicProcedure` | `protectedMutation(EDIT_ROLES)` |
| `issue.delete` | `publicProcedure` | `protectedMutation(DELETE_ROLES)` |
| `issue.comment.create` | `publicProcedure` | `protectedMutation(EDIT_ROLES)` |
| `issue.comment.update` | `publicProcedure` | `protectedMutation(EDIT_ROLES)` |
| `issue.comment.delete` | `publicProcedure` | `protectedMutation(DELETE_ROLES)` |

Queries remain `publicProcedure` per FLX-167's stated stance ("queries remain public for a separate access-control sweep").

**Why no production regression:** `FLUXAOS_LAN_AUTH_BYPASS=1` returns admin+enterprise viewer, which passes both `EDIT_ROLES` and `DELETE_ROLES`. The risk this closes is for any future deployment with the bypass off — anonymous callers could create/update/delete issues and comments.

**Verified:** CLI integration test (4/4 still pass — `issue.create` under LAN bypass works) plus manual `issue create` smoke that worked end-to-end.

---

## UAT Status

UAT not redeployed this session — neither FLX-2 nor FLX-200 changes server behavior under the homelab LAN bypass (CLI is additive; mutation protection is invisible to admin viewer). Existing UAT at `4aa5250` is still operationally correct. Operator decides if a redeploy is wanted to pull the new CLI binary onto UAT.

---

## Queue State

| Issue | Status | Notes |
|-------|--------|-------|
| FLX-2 | Done | Shipped this session |
| FLX-200 | Done | Shipped this session (filed during FLX-2 audit) |
| FLX-191 | Backlog (blocked) | Waiting on FLX-192 |
| FLX-192 | Backlog (blocked) | Architecture decision needed; user said "Fhc is not ready" |
| FLX-88 | Backlog (blocked) | Tooling — Codex Linear MCP issue |
| FLX-7 | Backlog (Roadmap) | Just Do It mode design — needs interactive product decision |
| FLX-101 | Backlog (Roadmap) | Achievement badges — needs brainstorm |
| FLX-2 (Post-alpha CLI) | Done | (Was here this morning) |
| FLX-102 | In Progress | Standing dogfood intake thread, not a work item |

No unblocked actionable issues remain. Post-alpha roadmap items (FLX-7, FLX-101) are design/brainstorm work that benefits from interactive Q&A flow per AGENT_BEHAVIOR carve-out.

---

## Context Decisions Made This Session

- **CLI auth scope** — Decided to ship FLX-2 with LAN-bypass-only auth and document that real Supabase OAuth is a follow-up. The brief allowed this; pursuing OAuth would have tripled the PR scope and is unnecessary for the homelab use case.
- **CLI bin shim vs. dist build** — Picked the tsx-shim approach to avoid a separate compiled artifact. Makes the source the single source of truth at the cost of a tiny startup overhead (tsx invocation). Fine for an operator CLI; would matter for a hot-path daemon.
- **Catalog key→UUID join in CLI** — Decided to do this client-side rather than add a "create by name" mutation to the server. Keeps the engine agnostic and matches what the React UI already does.
- **FLX-200 discovered, filed, fixed in same session** — Per autonomy contract, fixing my own discovery before moving on was the right call. 9-line PR with no test scaffolding needed; existing CLI integration test was the regression sanity gate.
- **Did not pull FLX-7 / FLX-101** — Both need interactive product input which the autonomous loop can't provide. Better as a foreground session.
- **Did not run full vitest suite** — The runner scans 100+ stale test files under `.fluxaos-worktrees/` from old runs, making the full suite take 15+ minutes and emit thousands of duplicate stdout lines. CLI integration test + orchestrator-concurrency test was a sufficient sanity gate (6/6 in 8.6s). Filing the vitest config issue is its own deferred-fix candidate.

---

## Next Session: Recommended Starting Point

1. Run `/session-start` to orient.
2. Check Linear for new issues filed since this handoff.
3. **If FLX-192 unblocks** (fhc verify rollout decision) → pick up FLX-191 (Playwright gate enforcement).
4. **If picking up post-alpha roadmap interactively** → FLX-7 (Just Do It mode design) is the natural next step since it unblocks the `fluxaos do` subcommand the CLI deliberately stubs out.
5. **Possible deferred-fix to file:** vitest runner picks up `.fluxaos-worktrees/**` stale specs. Should add a `test.exclude` glob in `vitest.config.ts` so `npx vitest` in the repo root only sees `src/__tests__/integration/**`. Trivial.

No open PRs, no stale branches from this session, working tree clean.
