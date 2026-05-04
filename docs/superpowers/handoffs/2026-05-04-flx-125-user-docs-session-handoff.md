# User Docs + Doc-Drift Session Handoff (FLX-125)

Date: 2026-05-04 (Pacific)
Operator: Joseph Pierce
Branch at start: `main`
Branch at end: `main`
SHA at start: `d5acef0` (prior session end)
SHA at end (origin/main): `b7fb27d`

## Session Boundary

Session-start marker: `session-start-2026-05-04T08:00:00-07:00.md` (newer than latest session-end `session-end-2026-05-04T09:00:00-07:00`). Clean boundary.

## Scope

This session built the entire user-facing documentation system for fluxaOS from scratch — a Docusaurus 3.10.1 site at `website/docs-site/` targeted at `docs.fluxaos.io`, 18 content pages covering the full product lifecycle, and a hybrid doc-drift GitHub Action that hard-gates critical source→doc mappings and soft-nudges via Claude Haiku on everything else. The session also cleared a dense queue of deep-review remediation items that landed before the docs work kicked off.

## What Shipped

The session produced 10 merged PRs. The first 7 (PRs #221–#228) closed out the FLX-113 deep-review remediation queue that was in flight from the prior context; the last 3 are the user-docs work.

**Prior-session carry-over (deep review + parallel execution):**

- **PR #221 — FLX-115**: Centralized all `FLUXAOS_*` env reads into `FluxaosConfig` — replaces scattered `process.env` reads with a single validated config object.
- **PR #220 — FLX-114**: Moved LangGraph adapter files from `src/core/` to `src/adapters/langgraph/` to fix a DI boundary violation.
- **PR #219 — FLX-116**: Routed `stageRun.pid` write through `runService` instead of a direct DB call in the worker.
- **PR #222 — FLX-108**: Replaced the `'complete'` string sentinel with a `TERMINAL_STATE` constant.
- **PR #223 — FLX-111**: Triage implemented as a meta-stage with `meta.targetPipeline` routing — the engine handles triage as a first-class pipeline concept rather than a special-case UI action.
- **PR #224 — FLX-112**: Removed the legacy `flux:signal` code path in favor of the result-document-only signal model.
- **PR #226 — FLX-119**: Fixed three hardcoded values: tRPC provider env var, LangGraph timeout, and cleanup service threshold.
- **PR #227 — FLX-122**: Domain D architecture drift — tRPC router converted to a proper service layer with `GitOpsPort` DI.
- **PR #228 — FLX-120**: Domain B DRY cleanup — `inputId` helper, revision SQL consolidation, version-lock factory, error consistency.
- **PR #229 — FLX-109**: Parallel group execution implemented — `Promise.allSettled` fan-out for `parallel` playbook stage groups, child result aggregation (`all-pass`/`any-pass`/`majority-pass`/`none`), full audit trail per child.

**User docs (FLX-125):**

**PR #230 — `feat: user docs site + doc-drift GitHub Action (FLX-125)`** (merged 2026-05-04T09:47Z)

The whole FLX-125 implementation in a single PR. What's in it:

- `website/docs-site/` — standalone Docusaurus 3.10.1 project with its own `package.json`, separate from the `website/` Next.js marketing site. Vercel project is live and pointed at `docs.fluxaos.io`.
- **Scaffold**: `docusaurus.config.ts` (url `docs.fluxaos.io`, `baseUrl /`, `routeBasePath /`, blog disabled), `sidebars.ts` with numeric-prefix-stripped guide IDs, `tsconfig.json`, `custom.css`, placeholder SVG logo.
- **18 doc pages**: 7 concept pages (index, skills, drivers, pipelines, gates, signals, state-vs-status), 5 guide pages (first-setup through read-the-results), 6 reference pages (env-vars, signal-types, gate-rules, issue-states, playbook-schema, daemon).
- **`.github/doc-drift-map.yml`**: 6 critical source→doc mappings (schema.ts, seed.ts, playbook.ts, env.ts, constants.ts, gates/types.ts).
- **`.github/scripts/doc-drift.mjs`**: ESM script — escape hatch first, then hard gate (exit 1 on violation), then LLM soft nudge (claude-haiku-4-5-20251001, advisory only, never exit 1). Fork-safe `postComment` (catches 403). Markdown fence stripped before JSON.parse.
- **`.github/workflows/doc-drift.yml`**: Triggers on `src/**` PRs to main, concurrency cancel per PR, `npm ci`, randomized heredoc delimiters (`openssl rand -hex 8`), `github.base_ref` routed through `env:` to prevent shell injection, `SKIP_LLM` reads from `vars.*`.

Two post-review hardening fixes landed in `e2576fc` (before merge): `github.base_ref` shell injection pattern eliminated, markdown fence strip added to LLM response parser.

One notable technical detail: Docusaurus strips numeric prefixes from filenames at build time — sidebar items for guides must use `guides/first-setup` not `guides/01-first-setup`. The scaffold was corrected to use stripped IDs. Full `npx docusaurus build` verified clean before merge.

**PR #232 — FLX-124** (version column for optimistic concurrency — separate session, merged same day): Not part of this session's work; coincidental timing.

## Open PRs / Protected Branches

- `origin/flx-88-linear-mcp-fallback` — pre-existing, unrelated, PROTECTED.
- `flx-126-recordeditor-migration` — 1 commit ahead of main, active worktree at `.worktrees/flx-126-recordeditor-migration`, no open PR yet. PROTECTED (ahead of main).

## Remaining Setup

**FLX-127** filed: Add `ANTHROPIC_API_KEY` as a GitHub repo secret to enable the LLM soft nudge layer. Hard gate is live without it. Set `SKIP_LLM=true` as a repo variable to disable the LLM layer per-repo if the secret is added but the feature should be suppressed.

Vercel project for `docs.fluxaos.io` is live (confirmed by operator this session).

## Verification

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` | PASS |
| `npx biome check` | PASS |
| `npx docusaurus build` | PASS — `[SUCCESS] Generated static files in "build"`, no broken links |
| Pre-commit hooks | PASS on all commits |
| Working tree | Clean |
| Remote sync | `main` in sync with `origin/main` at `b7fb27d` |

## Current State

- HEAD: `b7fb27d` on `main`, in sync with `origin/main`
- Working tree: clean
- Worktrees: main + `.worktrees/flx-126-recordeditor-migration` (PROTECTED)
- Open PRs: none
- Protected remote branches: `origin/flx-88-linear-mcp-fallback`
- No stashes

## Roadmap State

- **FLX-109** (parallel group execution): Done
- **FLX-111** (triage meta-stage): Done
- **FLX-112** (flux:signal legacy removal): Done
- **FLX-108** (TERMINAL_STATE constant): Done
- **FLX-114** (LangGraph DI boundary): Done
- **FLX-115** (FluxaosConfig centralization): Done
- **FLX-116** (stageRun.pid routing): Done
- **FLX-119** (hardcoded values): Done
- **FLX-120** (Domain B DRY): Done
- **FLX-122** (Domain D DI): Done
- **FLX-125** (user docs + doc-drift): Done — `docs.fluxaos.io` live

Open:
- **FLX-127**: Add `ANTHROPIC_API_KEY` repo secret (backlog)
- **FLX-124**: Version column for optimistic concurrency (merged separately)
- **FLX-126**: RecordEditor migration (in-flight worktree, no PR yet)
- **FLX-88**: Linear MCP fallback (pre-existing, remote branch protected)

## Files Touched This Session

| Path | Change |
|------|--------|
| `website/docs-site/package.json` | New — Docusaurus 3.10.1 standalone project |
| `website/docs-site/docusaurus.config.ts` | New — site config |
| `website/docs-site/sidebars.ts` | New — sidebar (stripped guide IDs) |
| `website/docs-site/tsconfig.json` | New |
| `website/docs-site/src/css/custom.css` | New |
| `website/docs-site/static/img/logo.svg` | New |
| `website/docs-site/.gitignore` | New |
| `website/docs-site/docs/concepts/*.md` | New — 7 pages |
| `website/docs-site/docs/guides/*.md` | New — 5 pages |
| `website/docs-site/docs/reference/*.md` | New — 6 pages |
| `website/docs-site/docs/index.md` | New — root landing page |
| `.github/doc-drift-map.yml` | New — 6 critical mappings |
| `.github/scripts/doc-drift.mjs` | New — hard gate + LLM nudge script |
| `.github/workflows/doc-drift.yml` | New — Actions workflow |
| `docs/superpowers/plans/2026-05-04-flx-109-parallel-group-execution.md` | New — FLX-109 plan (stray file committed to clean working tree) |

## Memories Saved This Session

None new — no novel patterns emerged beyond what is already in the memory index.

## Suggested Next-Session Prompt

```
Continue fluxaOS from main (SHA b7fb27d). Major work this session:

Shipped: FLX-109 (parallel execution), FLX-108/111/112/114/115/116/119/120/122
(deep-review remediation), FLX-125 (user docs at docs.fluxaos.io — 18 pages + doc-drift Action).

In-flight:
- FLX-126: RecordEditor migration — worktree at .worktrees/flx-126-recordeditor-migration,
  1 commit ahead of main, no PR yet.
- FLX-127 (backlog): Add ANTHROPIC_API_KEY repo secret to enable doc-drift LLM nudge.
  Hard gate works without it.

Protected remote: origin/flx-88-linear-mcp-fallback (unrelated, pre-existing).

Docusaurus build note: sidebar guide IDs use stripped numeric prefixes
(guides/first-setup, not guides/01-first-setup). Docusaurus strips at build time.
```
