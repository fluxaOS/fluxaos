# fluxaOS — Roadmap

Rewriting PAT (Python/FastAPI) as a TypeScript system that actually works. PAT has the right design but broken execution — rules engine doesn't fire, pipeline doesn't flow.

---

## Status

**Alpha is NOT shipped.** The engine is assembled (code merged, tsc green, biome green, one happy-path Playwright smoke spec passes against a sandbox repo) but **verification coverage is incomplete**. The bar for calling alpha shipped is captured in [`specs/2026-04-27-alpha-verification-matrix.md`](specs/2026-04-27-alpha-verification-matrix.md) — every CRUD entity (project, team, skill, driver, routing profile, provider, persona, issue) has a Playwright journey that passes, plus the manual stage-execution chain (research -> implement -> review -> rework -> deploy -> complete) is verified end-to-end by a journey, plus the daemon-driven path is verified end-to-end, plus vendor-agnostic / DB-driven invariants are audited. Until every row of that matrix is green, alpha is not shipped.

**2026-05-01 dogfood correction:** the project is back in development for the real workflow loop. FLX-106 showed that the first DB-seeded skill pass adapted fh-commons role intent into prompt text but did not correctly map the command-side workflow responsibilities into flux-native capabilities. The current seeded `Standard Dev` flow is not safe for real dogfooding. See [`audits/2026-05-01-flx-106-skill-command-audit.md`](audits/2026-05-01-flx-106-skill-command-audit.md) and [`handoffs/2026-05-01-flx-106-skill-audit-session-handoff.md`](handoffs/2026-05-01-flx-106-skill-audit-session-handoff.md).

Issue tracking lives in **Linear** (workspace `rebos`, team `FLX`). Two active projects: **fluxaOS Alpha** (verification-matrix-driven work toward alpha) and **fluxaOS Post-Alpha Wishlist** (parked items). Day-to-day bugs live at team level (no project assignment). The repo's `docs/superpowers/deferred-fixes.md` is frozen — historical record only.

---

## Alpha Scope

**One user, one project, one repo.** The schema already supports multi-tenancy (`orgId`, `userId`, `projectId` foreign keys throughout). Alpha deliberately does not build the UI or flows for multi-anything. Post-alpha layers multi on top of a proven single-tenant loop.

**Alpha definition of done:** every row in [`specs/2026-04-27-alpha-verification-matrix.md`](specs/2026-04-27-alpha-verification-matrix.md) green — Playwright journey exists for it, last run passing, human signed off in browser. The user files an issue, the orchestrator runs every stage end-to-end (manually click-by-click AND daemon-autonomous), each stage passes its gate, the issue advances state on each success, the deploy stage opens a PR, and the human can override state at any point and re-run any stage independently of what the orchestrator thinks should happen next. Vendor-agnostic core (no anthropic/claude/claude-code literals leaking from `src/core/`), DB-driven config (no hardcoded fallbacks bypassing the database), and manual-path-independent-of-daemon are all audited.

A "code merged" claim does not equal "verified." Self-certification (tsc + biome + CI green) is necessary but not sufficient. The verification matrix is the source of truth for ship readiness.

---

## Prior Art

fluxaOS borrows architectural patterns from [Archon](https://github.com/coleam00/Archon) (Cole Medin, MIT-licensed) for the plumbing layer: workspace isolation, worktree lifecycle, cleanup service, forge-adapter structure, headless worker runtime, stage-to-stage artifact handoff. Archon has shipped and tested these patterns at production scale; reinventing them would be wasted effort.

What fluxaOS does NOT borrow: YAML workflows (fluxaOS keeps DB-driven config and web-UI authoring), platform conversation adapters (fluxaOS has its own UI, not GitHub-comment-based conversations), Bun/monorepo packaging.

Pattern catalog with file pointers: [`research/2026-04-22-archon-prior-art.md`](research/2026-04-22-archon-prior-art.md). Attribution policy applies to every phase that borrows.

---

## Phases — Code Merged

The table below records phases whose code has been merged to `main`. **Code merged ≠ verified.** Verification status for each capability lives in the [verification matrix](specs/2026-04-27-alpha-verification-matrix.md). A row marked "Done" here means the implementation PR landed; it does not mean a Playwright journey covers it end-to-end or that a human signed off in the browser.

| Phase | Code Merged | Plan | Spec |
|-------|-------------|------|------|
| R1 — Infrastructure + Proof of Life | **Done** | [rebuild-plan](plans/2026-04-09-rebuild-plan.md) | [rebuild-spec](specs/2026-04-09-rebuild-spec.md) |
| R2 — Adapter Registry | **Done** | same | same |
| R3 — Rich Issue Model + CRUD + UI | **Done** | [rich-issue-plan-v2](plans/2026-04-09-rich-issue-model-plan-v2.md) | [rich-issue-design](specs/2026-04-09-rich-issue-model-design.md) |
| R3.5 — Enforcement Infrastructure | **Done** | [enforcement-plan](plans/2026-04-11-enforcement-infrastructure-plan.md) | [drift-prevention-design](specs/2026-04-11-session-drift-prevention-design.md) |
| R4-V — Gate Engine Verification | **Done** | [r4v-plan](plans/2026-04-11-r4v-gate-engine-verification.md) | — |
| R5-V — Pipeline Engine + Manual Execution | **Done — PR #20** | [r5v-plan](plans/2026-04-12-r5v-manual-execution-plan.md), [cleanup-plan](plans/2026-04-13-r5v-architectural-cleanup.md) | [r5v-design](specs/2026-04-12-r5v-manual-execution-design.md), [cleanup-design](specs/2026-04-13-r5v-architectural-cleanup-design.md) |
| R5.5 — Skill-to-Orchestrator IPC | **Done — PR #23, #26, #29** | [r5.5-ipc-plan](plans/2026-04-13-r5.5-ipc-protocol-plan.md) | [r5.5-ipc-design](specs/2026-04-13-r5.5-ipc-protocol-design.md) |
| R-INFRA — fh-commons Decoupling + Dev Tooling | **Done** | [r-infra-plan](plans/2026-04-15-r-infra-implementation-plan.md) | [r-infra-design](specs/2026-04-15-infra-decoupling-design.md) |
| R-UI-1 — Settings CRUD + harness→driver rename | **Done — PR #31** | [r-ui-1-plan](plans/2026-04-16-r-ui-1-implementation.md) | [r-ui-1-design](specs/2026-04-16-r-ui-1-design.md) |
| R-UI-2 — Real-time updates | **Retired — superseded by R-UI-2.5** | [r-ui-2-plan](plans/2026-04-16-r-ui-2-implementation.md) | [r-ui-2-design](specs/2026-04-16-r-ui-2-design.md) |
| R-UI-2.5 — Realtime user-visible remnant | **Done — PR #47** | [r-ui-2-5-plan](plans/2026-04-20-r-ui-2-5-implementation.md) | [disposition-design](specs/2026-04-20-r-ui-2-disposition-and-w3-decomposition-design.md) |
| R-AUDIT — Multi-team audit (P1 + P2) | **Done** | [audit-plan](plans/2026-04-17-r-ui-audit-plan.md) | [audit-design](specs/2026-04-17-r-ui-audit-design.md) |
| R-REM-W1 — Foundation remediation | **Done — PR #37, #38** | [wave-1-plan](plans/2026-04-17-wave-1-foundation-plan.md) | — (triage: [triage](audits/2026-04-17-audit-triage.md)) |
| R-REM-W2 — Architecture remediation | **Done — PR #43** | [w2-plan](plans/2026-04-18-r-rem-w2-implementation.md) | [w2-design](specs/2026-04-18-r-rem-w2-design.md) |
| R-REM-W3-a — Anthropic port cleanup + live-Claude journey | **Done — PR #50** | [r-rem-w3-a-plan](plans/2026-04-20-r-rem-w3-a-implementation.md) | [disposition-design](specs/2026-04-20-r-ui-2-disposition-and-w3-decomposition-design.md) |
| R-RUNTIME — Workspace isolation + forge adapter + deploy bridge | **Done — PR #70, T20 live-validated 2026-04-23** | [r-runtime-plan](plans/2026-04-23-r-runtime-implementation.md) | [r-runtime-design](specs/2026-04-22-r-runtime-design.md) |
| R-ARTIFACTS — Stage-to-stage data flow | **Done — PRs #75-#82 (W1-W8), mechanism T20 live-validated 2026-04-23** | [r-artifacts-plan](plans/2026-04-23-r-artifacts-implementation.md) | [r-artifacts-design](specs/2026-04-23-r-artifacts-design.md) |
| R-EPIC — Epic / child-issue hierarchy | **Done** | [r-epic-plan](plans/2026-04-24-r-epic-implementation.md) | [r-epic-design](specs/2026-04-24-r-epic-design.md) |
| R-DAEMON — Long-running orchestrator daemon | **Done** | [r-daemon-plan](plans/2026-04-24-r-daemon-implementation.md) | [r-daemon-design](specs/2026-04-24-r-daemon-design.md) |
| R-SETTINGS-ALPHA — Minimum config surface | **Done** | [r-settings-alpha-plan](plans/2026-04-24-r-settings-alpha-implementation.md) | [r-settings-alpha-design](specs/2026-04-24-r-settings-alpha-design.md) |
| R-MISSION-CONTROL — Operator dashboard | **Done** | [r-mission-control-plan](plans/2026-04-24-r-mission-control-implementation.md) | [r-mission-control-design](specs/2026-04-24-r-mission-control-design.md) |
| R-SMOKE — End-to-end alpha acceptance test | **Done** | [r-smoke-plan](plans/2026-04-25-r-smoke-implementation.md) | [r-smoke-design](specs/2026-04-25-r-smoke-design.md) |
| R-POLISH-CORE — Engine-correctness polish | **Done** | [r-polish-core-plan](plans/2026-04-25-r-polish-core-implementation.md) | [r-polish-core-design](specs/2026-04-25-r-polish-core-design.md) |
| R-POLISH-DOCS — Cleanup, terminology, ship docs | **Done** | [r-polish-docs-plan](plans/2026-04-25-r-polish-docs-implementation.md) | [r-polish-docs-design](specs/2026-04-25-r-polish-docs-design.md) |

**Current engine state:** code merged for the file-an-issue -> daemon-runs-pipeline -> PR-opened -> state-advances loop. The workflow-contract concerns surfaced in the 2026-05-01 FLX-106 audit (rework as sequential stage, manual-gated deploy leaving runs non-terminal, `proceed` lacking a target state, terminal-hook-only deploy bridge) were resolved through the FLX-106 lineage, then superseded by the DB-owned routing model documented in [`handoffs/2026-05-05-pipeline-db-source-of-truth.md`](handoffs/2026-05-05-pipeline-db-source-of-truth.md). Current truth: pipeline stages, routing, gates, personas/skills, and deploy behavior are database configuration (`pipeline_stage.on_pass`, `pipeline_stage.on_fail`, `pipeline_stage.fallback`, seeded by `npm run db:seed`); stage facts still flow through result docs that the executor ingests into `stage_run.result_doc`. The historical FLX-106 spec remains at [`specs/2026-05-02-pipeline-execution-redesign.md`](specs/2026-05-02-pipeline-execution-redesign.md), but it is not active guidance for file-backed/YAML playbook routing. The orchestrator daemon (`npm run daemon`, `ops/systemd/fluxaos-daemon.service`) subscribes to `pipeline_run` via Realtime and owns execution end-to-end. The Settings surface exposes Pipelines + Projects tabs. Operators have a Mission Control view at `/[project]/mission-control`. The R-SMOKE happy-path Playwright spec passes against `jdpierce21/fluxaos-alpha-e2e-sandbox`.

**What that does NOT mean:** alpha is shipped. The verification matrix (linked in Status above) lists every CRUD entity and lifecycle the alpha bar requires. Most rows have no Playwright journey at all. The handful of green rows in the matrix are real wins; the red and yellow rows are the alpha backlog. Until the matrix is fully green, the engine is *assembled*, not *verified*.

---

## R-AUDIT Results (2026-04-17)

Four-lane specialist audit over two phases. **Phase 1** audited R-UI-1 merge + R-UI-2 in-flight branch (56 files): 28 findings. **Phase 2** swept the other 96 files with 10 parallel specialists: 80 findings. Combined: **111 findings (35 High / 44 Medium / 32 Low).**

User-led triage produced 6 pattern decisions, 2 fork resolutions, ~20+ findings reclassified as false positives under the clarified invariant 7 (Drizzle is core stack, not a pluggable vendor), 3 items deferred post-alpha, ~55-65 actionable items split across remediation waves. All W1 + W2 remediation items shipped in PR #37, #38, #43.

Artifacts (all in `audits/`): Phase 1 report, Phase 2 report, triage decisions (authoritative), plus `.raw/` and `.raw-phase2/` specialist outputs.

---

## RCAs

- [UI Regression](rca/2026-04-11-ui-regression-rca.md) — cumulative feature loss across 6 rewrites; corrective audits not started
- [R5-V Session Failure](rca/2026-04-12-r5v-session-failure-rca.md) — session reverted after building non-working UI without following skill chain

---

## Lessons Learned

1. **Rewrites destroy context; edits preserve it.** Never use Write on existing files.
2. **Reading instructions ≠ following them.** Mechanical enforcement (hooks, snapshots) is required.
3. **Self-certification is worthless.** Every phase needs human verification in a running browser.
4. **The UI defines the backend.** When fixing type errors, build the missing endpoint — don't delete the UI.
5. **Vague plans produce vague work.** "Reference PAT" is not a plan. Component-level specificity required.
6. **Structural verification is necessary but not sufficient.** Types, tests, and code review missed 10 integration bugs that surfaced immediately in browser testing. Journey tests that invoke real external tools are essential.
7. **The orchestrator must not make decisions the skill should make.** Auto-advancing issue state on exit code 0 is wrong — the skill knows whether work is done, blocked, or needs rework. The orchestrator only manages execution lifecycle; the skill owns the outcome.
8. **Skills synced from fh-commons must have resolved partials.** Hand-written stub skills with wrong behavior cause real failures. Always sync via `fhc sync` or manually resolve `{{PARTIAL:...}}` placeholders.
9. **Invariants need prose + script agreement.** Phase 2 audit found invariant 7's prose banned `drizzle-orm` runtime imports in core while the verification script didn't scan for them. A rule you enforce partially is a rule you don't enforce.
10. **Tech stack vs. pluggable integrations is the right boundary.** Lock-in on Drizzle / Next.js / tRPC is fine; the adapter-registry pattern applies to systems you connect to, not to the query layer.
11. **Mechanical enforcement isn't sufficient by itself.** Process discipline needs cultural enforcement (merge-blocking manual-verification checkbox, PR template gates) to survive.
12. **Dead code is worse than missing code.** Half-built scaffolding trains agents to copy the wrong pattern; delete it, rebuild when needed.
13. **Don't reinvent plumbing that's been solved.** When proven prior art exists under a compatible license, borrow the patterns (with attribution) and focus build effort on the product's differentiators. Discovered 2026-04-22 via Archon — fluxaOS now borrows workspace isolation, cleanup, and forge-adapter patterns from a codebase that has already shipped them at scale.
14. **Interactive skills degrade to no-ops in headless runtimes.** A subprocess with `stdin: 'ignore'` and no TTY has no channel to reach a human; any skill that tries to ask a question there either no-ops or times out. This resolves the "what if a brainstorming skill fires in an autonomous pipeline" concern — the runtime itself prevents it, no framework enforcement needed.
15. **Session-prompt language matters.** When a session-end handoff includes "invoke X skill" in the next-session prompt, the next agent treats it as an imperative that competes with AGENT_BEHAVIOR.md's "no questions" rule. Handoffs should describe the work, not name interactive skills to run.
