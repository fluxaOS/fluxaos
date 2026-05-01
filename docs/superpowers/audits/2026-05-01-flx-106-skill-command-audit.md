# FLX-106 Skill Command Audit

Date: 2026-05-01

## Finding

The first FLX-106 implementation is not sufficient for real workflow use. It
adapted fh-commons skill roles into fluxaOS prompt text, but it did not audit
the command-side responsibilities those skills rely on. The problem is not that
`fhc` command names were removed. The problem is that several `fhc`/`pat`
responsibilities either already exist in flux under a different API and were not
used explicitly, or do not exist yet and were papered over with prompt text.

## Source Skills Audited

- `/mnt/dev/fh-commons/.agents/skills/research`
- `/mnt/dev/fh-commons/.agents/skills/implement`
- `/mnt/dev/fh-commons/.agents/skills/review`
- `/mnt/dev/fh-commons/.agents/skills/rework`
- `/mnt/dev/fh-commons/.agents/skills/deploy`

## Existing Flux Capabilities

These are not missing. The first pass underused or failed to mention them.

| fh-commons responsibility | Flux equivalent already present | Evidence |
| --- | --- | --- |
| Issue list/view/create | `issue.list`, `issue.getByNumber`, `issue.getById`, `issue.create` | `src/server/routers/issue.ts` |
| Issue comments | `issue.comment.list/create/update/delete` | `src/server/routers/issue.ts`, `src/core/services/issue-comment.ts` |
| Issue state transitions | `issue.transition`, `issueService.transition`, `issueService.stateOverride` | `src/server/routers/issue.ts`, `src/core/services/issue.ts` |
| Issue close/reopen service behavior | `issueService.close`, `issueService.reopen` | `src/core/services/issue.ts` |
| Issue status updates | `issueService.updateStatus` | `src/core/services/issue.ts` |
| Parent/child issue hierarchy | `parentIssueId`, `getChildren`, `getParent`, auto-close parent on terminal child | `src/core/db/schema.ts`, `src/core/services/issue.ts` |
| Worktree creation | `IsolationProvider.acquire`, `createWorktreeIsolationProvider` | `src/core/ports/isolation.ts`, `src/adapters/git/worktree-isolation-provider.ts` |
| Worktree release | `IsolationProvider.release`, terminal hook release, cleanup service | `src/core/orchestrator/pipeline-terminal-hook.ts`, `src/core/cleanup/cleanup-service.ts` |
| Per-run artifacts | `artifactsPath`, inherited artifacts by prior run | `src/core/orchestrator/stage-runner-env.ts` |
| Stage exit signal | `flux:signal` parser and `stageRun.skillSignal` | `src/core/orchestrator/signal-parser.ts`, `src/core/orchestrator/stage-runner.ts` |
| Stage events and issue activity | `appendEvent`, `appendIssueEvent`, stage completed/failed events | `src/core/orchestrator/pipeline-run-service.ts`, `src/core/orchestrator/stage-runner.ts` |
| Branch creation naming | `deriveBranchName`, run-scoped `fluxaos/issue-N-RUN` | `src/core/orchestrator/stage-runner-env.ts` |
| Auto-commit worker changes | engine-managed `commitAll` on `proceed` | `src/core/orchestrator/stage-runner.ts` |
| PR creation and DB recording | deploy bridge creates PR, inserts `issue_branch`, `issue_pull_request` | `src/core/deploy/deploy-bridge.ts` |
| Project pipeline/stage CRUD | `pipeline.*`, `pipeline.stages.*` routers | `src/server/routers/pipeline.ts` |
| Manual stage trigger | `pipeline.runs.trigger` creates pending `pipeline_run` + chosen `stage_run` | `src/server/routers/pipeline.ts` |
| Manual held-stage approval | `pipeline.runs.approveStage`, `executeStage` | `src/server/routers/pipeline.ts` |
| Cleanup sweep / PR-close cleanup | `cleanupService.runScheduledSweep`, `onPrClosed`, `removeEnvironment` | `src/core/cleanup/cleanup-service.ts` |

## Present But Not Wired To The Skill Contract

These exist in code, but a headless stage agent cannot reliably invoke them
through the current DB skill prompt/driver contract.

| Need from fh-commons skill | Existing flux piece | Gap |
| --- | --- | --- |
| Post entry/exit comments | `issue.comment.create` exists | Stage agents only emit stdout; no documented/toolable route for writing comments through flux. |
| Move issue to specific next state | `issue.transition` and `stateOverride` exist | `flux:signal` only drives a few hardcoded outcomes (`hold`, `rework`, `abort`, `proceed`); no generic `targetState` on success. |
| Close issue after deploy | `issueService.close` exists | Not exposed in deploy bridge or deploy-stage outcome handling. |
| Reopen / return to research | `issueService.reopen`, `stateOverride` exist | Implement-stage `needs_research` is not a first-class signal outcome. |
| Select next issue by state/priority | `issue.list` exists | No queue-selection runner that maps `--next` behavior to flux-native issues. |
| Read parent/dependency context | parent issue exists | Parent can be read, but dependency/blocker relationships do not exist. |
| Approve/reject review with comments | comments + transition exist | Review signal cannot attach structured findings as comments and transition to deploy/rework in one contract. |
| Record pipeline exit summary | stage/pipeline events exist | No `pat pipeline exit` equivalent that atomically records result, summary, status/state, comment, and run terminal status. |
| Teardown held manual stages | release exists | A manual/held stage can leave a pipeline run non-terminal, delaying deterministic release. |
| PR metadata consumption by review/rework/deploy | `issue_pull_request` rows exist | Skills are not explicitly given PR/branch rows or a flux API to query them. |

## Missing Flux Capabilities

These are actual missing capabilities, not merely renamed `fhc` commands.

1. **Issue dependency/blocker model**
   - fh-commons uses `fhc issue dependencies`, blocker comments, and blocker
     links.
   - flux has parent/child epics, but no general issue dependency/blocker table
     or service. Prior audit docs show `issue_dependency` was removed as dead
     schema.

2. **GitHub PR merge/list implementation**
   - `GitProvider` declares `getPullRequest`, `listPullRequests`, and
     `mergePullRequest`.
   - GitHub adapter still throws `NotImplementedError` for those methods.
   - Deploy skill cannot safely merge by using the existing provider today.

3. **Remote branch deletion / PR cleanup command**
   - Cleanup service can remove local isolation environments.
   - There is no flux-native command/service for deleting remote branches after
     merge or pruning merged PR branches equivalent to `fhc pr clean`.

4. **Production deploy operation as a first-class flux action**
   - Homelab deploy exists as `/mnt/stacks/docker/fluxaos/build.sh`.
   - Flux does not model deploy commands, deploy targets, log checks, rollback
     markers, or post-deploy verification as DB-backed actions.

5. **Version/release tagging**
   - fh-commons deploy can call `fhc release tag --push`.
   - flux has no release/version tagging service. For current internal build
     this may be intentionally out of scope, but it must be explicit.

6. **Log discovery/checking**
   - fh-commons uses `fhc logs list` and mandatory log checks.
   - flux currently has health checks and Docker logs available operationally,
     but no app-level log discovery/check service exposed to skills.

7. **Backup/snapshot preflight**
   - fh-commons implement checks Kopia backups for DB/infra changes.
   - flux has no equivalent backup preflight capability.

8. **Base-branch pre-existing failure verifier**
   - fh-commons can verify failures against base branch and file follow-up
     issues.
   - flux has issue create, but no orchestrated base-branch verification mode.

9. **Review evidence model**
   - fh-commons expects "Ready for Review" comments with branch, PR, tests,
     functional verification, and pre-existing issue sections.
   - flux has comments and artifacts, but no structured review-evidence schema
     or validation gate.

10. **Skill queue modes**
    - fh-commons supports `--next`, `--parallel`, `--inline`, quick-fix,
      standalone, and pipeline modes.
    - flux has manual stage trigger and daemon execution, but no DB skill
      argument/mode router equivalent.

## Broken Or Unsafe In Current FLX-106 Seed

1. **Rework is seeded as a normal sequential stage**
   - Current order: `research -> implement -> review -> rework -> deploy`.
   - Event orchestrator advances `proceed` to the next `sortOrder` stage.
   - Therefore a passing review proceeds to rework, which is wrong. Rework must
     be conditional on review/rework verdict, not a normal next stage.

2. **Deploy is seeded as `gateMode: manual`**
   - Manual gate causes launch to stop with pending stage_run.
   - A pending/held stage means the pipeline run may never become terminal.
   - Terminal hook owns deploy bridge and env release, so this can delay or
     prevent deterministic cleanup.

3. **`proceed` has no state target**
   - Skills need to say "research complete -> implement", "review approved ->
     deploy", "rework complete -> review", "deploy complete -> complete".
   - Current signal handling treats `proceed` as "next stage by sort order",
     not "transition issue state to X and finish this invocation".

4. **Deploy bridge semantics conflict with five-stage chain**
   - Bridge is an end-of-pipeline PR opener.
   - If all five stages are one pipeline run, PR creation happens after deploy,
     but review/deploy need the PR before they run.
   - If each stage is a separate run, the seed should not imply a linear
     five-stage autonomous chain.

5. **Held/blocked paths do not guarantee release**
   - `hold/needs_human` marks issue blocked/status, but the run can remain
     non-terminal in some held/manual paths.
   - Worktree release is terminal-hook-owned, so the contract needs an explicit
     terminal/held cleanup behavior.

## Required Design Decision

Flux needs to choose one of these workflow models before skills are rewritten:

1. **Stage-per-run issue lifecycle**
   - Each issue state maps to one runnable stage.
   - A stage emits a structured outcome with target issue state.
   - The run completes and releases/bridges deterministically.
   - This most closely matches the current UI "run a stage" behavior.

2. **Single pipeline run with conditional graph**
   - Pipeline needs graph/edge semantics, not just `sortOrder`.
   - Review pass routes to deploy; review fail routes to rework; rework routes
     back to review.
   - Deploy bridge must move from "terminal hook only" into a stage-aware PR
     lifecycle.

The current FLX-106 seed is neither model cleanly.

## Immediate Remediation

1. Disable or repair the seeded Standard Dev workflow before relying on it for
   dogfooding.
2. Replace prompt-only lifecycle instructions with a flux-native outcome
   contract that can express:
   - target state
   - comment body
   - blocked reason
   - issue creation requests
   - PR/branch references
   - close issue
3. Implement or expose the missing capabilities listed above in small,
   separately tested issues.
4. Re-seed skills only after the engine contract is explicit.
