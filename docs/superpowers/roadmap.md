# fluxaOS — Roadmap

Rewriting PAT (Python/FastAPI) as a TypeScript system that actually works. PAT has the right design but broken execution — rules engine doesn't fire, pipeline doesn't flow.

---

## Alpha Scope

**One user, one project, one repo.** The schema already supports multi-tenancy (`orgId`, `userId`, `projectId` foreign keys throughout). Alpha deliberately does not build the UI or flows for multi-anything. Post-alpha layers multi on top of a proven single-tenant loop.

**Alpha definition of done:** fluxaOS can pick up an issue filed in its own UI, run a pipeline against a configured target repo, produce code, open a PR, and advance the issue to an awaiting-review state — end-to-end, driven by a persistent daemon, with no human intervention between "file epic" and "verify PR in browser."

---

## Prior Art

fluxaOS borrows architectural patterns from [Archon](https://github.com/coleam00/Archon) (Cole Medin, MIT-licensed) for the plumbing layer: workspace isolation, worktree lifecycle, cleanup service, forge-adapter structure, headless worker runtime, stage-to-stage artifact handoff. Archon has shipped and tested these patterns at production scale; reinventing them would be wasted effort.

What fluxaOS does NOT borrow: YAML workflows (fluxaOS keeps DB-driven config and web-UI authoring), platform conversation adapters (fluxaOS has its own UI, not GitHub-comment-based conversations), Bun/monorepo packaging.

Pattern catalog with file pointers: [`research/2026-04-22-archon-prior-art.md`](research/2026-04-22-archon-prior-art.md). Attribution policy applies to every phase that borrows.

---

## Phases — Done

| Phase | Status | Plan | Spec |
|-------|--------|------|------|
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

**Current engine state:** The full file-an-issue → get-a-PR loop is wired end-to-end with stage-to-stage data flow. Every pipeline run executes inside a git worktree isolated under `<repo>/.fluxaos-worktrees/` on a namespaced `fluxaos/issue-<n>-<run-id>` branch, AND gets a separate artifacts directory under `<repo>/.fluxaos-artifacts/<runId>/` where stages hand off intermediate findings (Research writes `research-findings.md`, Implement reads it and writes `plan.md`, Review reads the plan, Rework reads review findings). When a pipeline terminates successfully the orchestrator commits the worktree, pushes, opens a PR via the GitHub adapter, records the PR + branch on the issue, and advances the issue to `review`. The cleanup service reaps stale worktrees and artifacts on two independent retention windows; the scheduler refuses to start without all four operator-configured thresholds. Issues can form an epic/child hierarchy via `parent_issue_id`: parents with open children are refused at `pipeline.runs.trigger` with `ISSUE_IS_EPIC`, and closing the last open child auto-closes the parent (propagating up the tree). Loop proven against live GitHub sandbox (`jdpierce21/fluxaos-alpha-e2e-sandbox` PR #1).

---

## Phases — Alpha

Renamed and re-scoped per the 2026-04-22 session. The previous R-REM-W3 "meta-phase with four slices" framing is superseded; the work below replaces it.

| Phase | Status | Scope |
|-------|--------|-------|
| **R-DAEMON — Systemd orchestrator** | **Next** | Wrap the currently-manual orchestrator as a long-running process that polls/listens on the BullMQ queue (already scaffolded). Dispatches stage runs, manages worktrees via R-RUNTIME, handles the deploy bridge. systemd unit file, startup/shutdown discipline, crash recovery. Required for "fluxaOS runs 24/7 without babysitting." |
| **R-SETTINGS-ALPHA — Minimum config surface** | Not started | Two Settings tabs only: **Projects** (set `repoPath` + `repoUrl`, assign default pipeline) and **Pipelines** (view seeded pipeline, see attached skills/drivers). Four other tabs from the old plan — Teams, Users, System, Cron Jobs — drop to post-alpha. Uses the R-UI-1 CRUD factory. |
| **R-MISSION-CONTROL — Operator dashboard** | Not started | One page reading existing orchestrator state: queue depth, in-flight runs, recent terminal states, PR links. No new backend — just a UI over DB state the daemon already writes. |
| **R-SMOKE — End-to-end alpha acceptance test** | Not started | Playwright journey: file an epic with one child issue, wait for the daemon to pick it up, confirm the worker ran in an isolated worktree, confirm a PR was opened, confirm the issue advanced to `review`, confirm the worktree gets cleaned up after the PR closes. This is the alpha acceptance test. |
| **R-POLISH — Cleanup, terminology, ship docs** | Not started | Whatever R-SMOKE surfaces that's broken. Terminology passes. README updates so an operator can stand fluxaOS up from a fresh clone. Attribution to Archon in any spec that lifted patterns. Replaces the old R-REM-W4 and R6 placeholders. Also pick up the deferred schema-meta rehydration (drizzle `meta/` snapshots have drifted since migration 0003; R-RUNTIME migration 0007 was hand-written as a result — rebaseline the snapshots so auto-generate is usable again). |

**Dependency ordering:** R-DAEMON next. R-DAEMON depends on R-RUNTIME + R-ARTIFACTS + R-EPIC (all done). R-SETTINGS-ALPHA and R-MISSION-CONTROL are independent of everything. R-SMOKE depends on everything. R-POLISH is last.

---

## Phases — Post-Alpha

Work deliberately out of scope for alpha, captured here so the boundary is explicit:

- **Multi-user / multi-project / multi-repo UI flows** — schema supports this; UI flows are deferred
- **CLI** (`src/cli/`) — all alpha control is via the web UI; CLI is a post-alpha convenience
- **Remaining Settings tabs** — Teams, Users, System, Cron Jobs
- **Additional forge adapters** — GitLab, Gitea, Forgejo follow the same port pattern as the alpha GitHub adapter; community-contributable
- **IssueProvider** port — retired entirely (same precedent as AIProvider deletion in R-REM-W3-a); fluxaOS's issue model is native and not synced to external trackers
- **OpenAI adapter** — Anthropic is the sole alpha AI provider
- **Just Do It mode** — per R-AUDIT triage
- **Brand service** — per R-AUDIT triage
- **Dogfooding** — fluxaOS managing its own development through its own pipelines. Philosophically attractive but carries bootstrap-fragility risk. Revisit once alpha is stable
- **GitHub Issues adoption for fluxaOS's own dev process** (R7 "open to the world" milestone)
- **OpenClaw preview gate, role-based permissions, version history for skills/drivers, subscription tiers** (DEF-001 through DEF-004)

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
