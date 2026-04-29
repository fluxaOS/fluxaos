# Session Handoff — FLX-9 Dogfooding Unlock

**Date:** 2026-04-28 ~09:07 PDT → 2026-04-28 ~21:53 PDT (~13h elapsed, ~6h active)
**Operator:** Claude (Opus 4.7)
**Branch at start:** `main` at `e692a8f`
**Branch at end:** `main` at `e92f302`
**Session boundary used:** `2026-04-28T09:07:43-07:00`
**Boundary reason:** No newer session-start marker; using latest session-end as fallback boundary.
**Mode:** collaborative (brainstorming + plan-review phases) per the AGENT_BEHAVIOR carve-out shipped mid-session
**PRs merged:** #171, #172, #173, #174, #175 (5 PRs)

---

## Session Scope

User asked the brainstorming skill on the next backlog issue (FLX-9, dogfood fluxaOS on its own development). Pulled the thread and discovered the original ticket framing was answered by code that hadn't shipped yet. Routed through fixing two structural blockers (FLX-82 / FLX-92) before writing the FLX-9 spec, retired the sandbox repo assumption that was the lazy workaround for FLX-82, codified two durable rule changes to AGENT_BEHAVIOR.md (brainstorming carve-out + Linear hygiene), and finally shipped the FLX-9 operating-procedure spec.

Net: nine Linear issues moved (FLX-91, FLX-12, FLX-14, FLX-1, FLX-6, FLX-4 from prior session burn, plus FLX-82, FLX-92, FLX-9 this session), 12 PRs merged across the day, the dogfood loop verified end-to-end against fluxaOS itself with a real PR opened against `fluxaOS/fluxaos` (PR #170, auto-closed by spec teardown). First time the deploy contract has been mechanically proven self-targeting fluxaOS.

---

## What Shipped

### PR #171 — `fix(orchestrator, deploy): auto-commit worker output + push existing branch commits (FLX-92)`

Merged as `005480c`. **FLX-92 Done.**

Filed during FLX-82 verification. The implement skill's prompt expected the worker subprocess to `git add` + `git commit` its own changes; worker wrote files but didn't commit, review held with "uncommitted work in worktree", deploy never fired. Two-half fix:

- **stage-runner**: new `autoCommitProceedingStage` helper invoked from both `proceed`-verdict paths (no-signal-clean-exit synth + emitted signal). Hold/rework/abort/failed runs deliberately leave the tree dirty for human inspection. Vendor-agnostic commit message (`<stage_name>: stage_run <id_short>`).
- **deploy-bridge**: when its own `commitAll` returns `noChanges`, fall through to push if branch is ahead of base (uses new `branchAheadCount` + `getHeadSha` helpers in `src/adapters/git/worktree.ts`). Pre-FLX-92 `noChanges` meant "nothing to push"; post-FLX-92 it just means "deploy bridge added no new commits beyond what stage-runner already committed."
- Tests: `stage-runner-config.test.ts` gains `gitInitWorkingPath` option + consolidated FLX-92 case (proceed → commit, hold → leave-dirty). 4/4 pass. 15/15 in adjacent integration tests (artifacts-inheritance, orchestrator-e2e) — no regression.

### PR #172 — `chore(e2e): retire sandbox-repo assumption; guard destructive journeys against self-target`

Merged as `ac2867a`. **Sandbox retired.**

User asked why the disposable `fluxaos-alpha-e2e-sandbox` repo existed if fluxaOS isn't a production project. Answer: it was the lazy workaround for FLX-82 (see verification thread below). With FLX-82 + FLX-92 shipped, the sandbox has no remaining structural job.

- `FLUXAOS_TEST_TARGET_REPO` description rewritten in `CLAUDE.md` + `README.md` — drops "disposable sandbox PR target" framing; calls out self-target = dogfood, or any disposable repo, or unset to skip.
- Destructive journey specs (`r-smoke.spec.ts`, `manual-stage-chain.spec.ts`) gain a guard: refuse to run when `path.resolve(FLUXAOS_TARGET_REPO_PATH) === REPO_ROOT`. Both journeys do `git fetch && git reset --hard origin/main && git clean -fdx` against the target — pre-this-PR, an operator who pointed that env at the fluxaOS source root would silently wipe uncommitted work + branches. The guard verified working: `r-smoke` correctly errored with "resolves to the fluxaOS source root. R-SMOKE is destructive and would wipe uncommitted work."
- "sandbox" → "target" in inline comments (generic; no semantic change).

### PR #173 — `chore(agent): carve out brainstorming + plan review from no-questions rule`

Merged as `67caef6`. **AGENT_BEHAVIOR.md scoping fix.**

The original "no questions during a session" rule swept brainstorming into the same lane as execution and contradicted the `superpowers:brainstorming` / `writing-plans` / `plan-review` skills, which all treat operator dialogue as the work product. Surfaced when the brainstorming skill was invoked on FLX-9 — the skill expected questions, the AGENT_BEHAVIOR text said no questions.

Scoped the rule precisely: *"Once a spec or plan is approved, no questions during execution."* New exception #1 names brainstorming, writing-plans, and plan-review explicitly. Confirmed the framing against sibling projects: `fh-commons` keeps the harder line because brainstorming runs delegated there; fluxaOS is single-operator interactive, so the carve-out matches reality.

Updated the contradicting `feedback_agent_behavior_overrides_skills.md` memory to match.

### PR #174 — `docs(spec): FLX-9 dogfooding operating procedure`

Merged as `e92f302`. **FLX-9 Done.**

Codifies the FLX-9 dogfooding operating procedure as a doc. No new code, no new pipelines, no new skills/drivers. The mechanism shipped via FLX-82 + FLX-92 + sandbox retirement, was end-to-end verified by PR #170 round-trip earlier in the session.

Spec covers: setup, operating loop (file fluxaOS native issue → click Run Stage → review the resulting PR → standard `gh pr merge`), trust boundary (no self-merge, hands off CLAUDE.md / AGENT_BEHAVIOR.md / ops/git-hooks/), "When NOT to dogfood" list, risks, success criteria. After review, expanded the Tool / Vendor agnosticism section to cover both engine-code AND operator-procedure agnosticism — configurable surfaces table for Pipeline / Stage→skill / Stage→driver / Driver / Provider / Forge, naming the homelab's current configuration as one valid configuration among others. Out of scope: Linear↔fluxaOS sync, auto-pickup (FLX-7 follow-on), dogfood mode flag (considered, dropped — operator habit, not engine setting).

### PR #175 — `chore(agent): require Linear hygiene at every state transition`

Merged as `f67b36f`. **AGENT_BEHAVIOR.md durable rule.**

User caught me 2026-04-28 after FLX-9's spec PR shipped — the Linear ticket still showed only the original 2026-04-26 import body, no PR links, no status change, stale framing. Codified the "always update Linear" rule as durable project memory:

- Status transitions at every step (Backlog → In Progress → In Review → Done), not batched
- PR links attached via `save_issue` append-only `links:` array
- Description rewritten when framing is stale (preserve original as `## History` section)
- Sibling tickets filed immediately for mid-verification bugs / follow-on work
- Definition of done extended: a merged PR without a Linear status update doesn't count as done

Saved the corresponding `feedback_linear_hygiene.md` memory. Updated FLX-9 in Linear immediately as a self-test (full status, 4 PR links, current framing, original framing preserved).

---

## FLX-82 / FLX-9 Brainstorm Thread

The brainstorm started on FLX-9 (dogfood fluxaOS). Three structural decisions emerged in sequence; each unblocked the next.

**Decision 1: Why does the sandbox exist?** User raised the question directly. Investigation showed it existed because FLX-82 (materializer/hook collision) was filed but never fixed during alpha — the sandbox was the lazy workaround. User said: *"In that event, I want to fix that first I hate being sloppy and lazy."* Pivoted from FLX-9 brainstorming to FLX-82 verification.

**Decision 2: FLX-82 looks Done — verify it.** Discovered FLX-82 was already merged 2026-04-28 02:17 (commit `2f4a900`, PR #143 — the mid-day session that closed the post-alpha wishlist had also closed FLX-82). Tried to verify it works end-to-end self-targeting fluxaOS. First attempt: journey ran but stage_run sat at `pending` because no daemon was running. Spawned daemon, retried: pipeline ran research → implement → review, but **review held with "docs/CONTRIBUTING.md was created but never committed"**. The implement skill's worker had written the file but didn't `git add` + commit. **Real dogfooding signal — only surfaces against a non-trivial real repo. Filed FLX-92.**

**Decision 3: Pick fix for FLX-92.** Three candidates in the ticket. Picked option (2) — engine auto-commits in stage-runner — over (1) prompt update because engine guarantees correct behavior without depending on per-skill prompt discipline, and (3) gate-rule because it's a guard not a fix. Implemented + verified: PR #170 round-trip live against fluxaOS in 2 min. **First mechanical proof of the deploy contract self-targeting fluxaOS.**

After that, FLX-9 wasn't really "design a safe first slice" anymore. The safe slice was already running. FLX-9 spec (PR #174) became operator-procedure documentation.

---

## Mid-Session Plugin Cleanup

Mid-session: when editing `.claude/AGENT_BEHAVIOR.md` for the brainstorming carve-out, Claude Code's harness kept prompting for permission per Edit tool call. Investigation found a plugin `security-guidance` from `claude-plugins-official` with a `PreToolUse` hook on Edit/Write/MultiEdit that hard-fails (exit 2) on a fixed list of security patterns. Plugin wasn't in the user's `enabledPlugins` list but was being auto-loaded from the marketplace cache.

User said: "Please delete that plugin." Removed both copies from `~/.claude/plugins/marketplaces/{claude-code-plugins,claude-plugins-official}/plugins/security-guidance/`, plus added `"security-guidance@claude-plugins-official": false` and `"security-guidance@claude-code-plugins": false` to `~/.claude/settings.json` `enabledPlugins` so a marketplace re-sync can't reintroduce it.

Not load-bearing for fluxaOS but worth recording — the plugin's hook was the source of "permission required" prompts on `.claude/` edits.

---

## Linear Roadmap Shaping

| ID | Title | Pre-session | Post-session |
|----|-------|-------------|--------------|
| FLX-82 | Self-target: materializer/hook collision | Already Done (this morning) | Re-verified live; comment added |
| FLX-92 | Implement skill creates files but doesn't git commit them | Filed 2026-04-28 02:07 (mid-verification) | Done (PR #171) |
| FLX-9 | Post-alpha: Dogfood fluxaOS on its own development | Backlog | Done (PR #174) |

FLX-9's Linear description rewritten to reflect current state (per the new Linear-hygiene rule). Original 2026-04-26 import preserved as `## History`.

---

## Tooling & CI Findings

### `npx tsx -e <code>` doesn't support top-level await (CommonJS output)

When trying to inspect `issue_pull_request` rows mid-verification, `npx tsx -e "...await..."` failed with `Top-level await is currently not supported with the "cjs" output format`. Workaround: write a tiny script file with the work wrapped in `async function main() { ... }`. Captured + cleaned up after.

### `gh issue view` rejects FLX-NNN format

`gh issue view --comments FLX-82` errored with `invalid issue format: "FLX-82"`. Linear identifiers don't work with the GitHub CLI (which expects integers / GitHub URLs). Use the Linear MCP tools (`mcp__plugin_linear_linear__get_issue`) for Linear lookups. Documented behavior in retrospect, but worth reflecting back at next-session — the temptation to mix them up exists.

### Plugin marketplace caches leak hooks

The `security-guidance` plugin was hooking Edit/Write tool calls via PreToolUse despite not being in `enabledPlugins`. Mechanism: marketplace plugins under `~/.claude/plugins/marketplaces/.../plugins/<name>/hooks/hooks.json` get auto-discovered when the marketplace is registered. Disabling via `enabledPlugins: { ...: false }` is the durable fix (survives marketplace re-sync); deleting the marketplace cache directory is the immediate fix.

---

## Verification Matrix

For every shipped PR:

| Check | Status |
|-------|--------|
| `npx tsc --noEmit` | ✅ clean before push |
| `npx biome check` | ✅ clean before push |
| `npm run db:migrate` | n/a (no schema changes this session) |
| Integration tests (vitest) | ✅ stage-runner-config 4/4, artifacts-inheritance + orchestrator-e2e 15/15 (no regression for FLX-92) |
| Live end-to-end self-target | ✅ FLX-92 fix verified via journey r-runtime-deploy against fluxaOS — PR #170 round-trip in 2 min |
| Pre-commit / pre-push hooks | ✅ all PRs cleared the gates including new `claude-md-score` trailer requirement on the sandbox-retirement PR |
| GitHub Actions `check` job | ✅ green pre-merge for all 5 PRs |
| User browser sign-off | ⏳ spec docs only (no UI changes); FLX-92 has live e2e verification |

---

## Current State

- **HEAD:** `main` at `e92f302`, in sync with `origin/main`.
- **Working tree:** clean.
- **Local branches:** `main` only (post-merge hook pruned `flx-92-auto-commit-runner`, `retire-sandbox`, `chore/agent-behavior-brainstorm-carveout`, `chore/agent-behavior-linear-hygiene`, `docs/flx-9-dogfooding-spec`).
- **Remote branches:** `origin/main`, plus `origin/flx-88-linear-mcp-fallback` (pre-existing closed-PR backing branch).
- **Stashes:** none (the AGENT_BEHAVIOR brainstorming-carveout WIP that was stashed mid-session got popped + shipped).
- **Worktrees:** primary only.
- **Dev server:** assumed running on `192.168.54.101:3003`; not load-bearing.

---

## Memories Saved This Session

- `feedback_linear_hygiene.md` (new) — Always update Linear at every state transition. Status, PR links, description-when-framing-changes. Stale Linear is a bug.
- `feedback_agent_behavior_overrides_skills.md` (rewritten) — Old version said AGENT_BEHAVIOR.md no-questions rule beats ALL skill Q&A flows. New version reflects PR #173 carve-out: brainstorming + writing-plans + plan-review run their normal Q&A flow; only post-approval execution is no-questions.
- MEMORY.md index updated — new Linear-hygiene entry, contradicting agent-behavior entry retitled and corrected.

---

## Files Touched

| Area | Files |
|------|-------|
| Engine | `src/core/orchestrator/stage-runner.ts` (autoCommit helper), `src/core/deploy/deploy-bridge.ts` (branch-ahead fall-through), `src/adapters/git/worktree.ts` (`getHeadSha`, `branchAheadCount`) |
| Tests | `src/__tests__/integration/stage-runner-config.test.ts` (gitInitWorkingPath option, FLX-92 cases) |
| Living docs | `CLAUDE.md` (FLUXAOS_TEST_TARGET_REPO description), `README.md` (same) |
| Agent rules | `.claude/AGENT_BEHAVIOR.md` (brainstorming carve-out + Linear-hygiene) |
| Journeys | `e2e/r-smoke.spec.ts` (self-target guard + comment cleanup), `e2e/manual-stage-chain.spec.ts` (self-target guard), `e2e/r-artifacts-chain.spec.ts` (comment cleanup) |
| Specs | `docs/superpowers/specs/2026-04-28-flx-9-dogfooding-design.md` (new) |
| Memory | `feedback_linear_hygiene.md` (new), `feedback_agent_behavior_overrides_skills.md` (rewritten), `MEMORY.md` (index update) |
| Settings | `~/.claude/settings.json` (security-guidance plugin disabled in `enabledPlugins`) |
| `.env.local` | flipped `FLUXAOS_TARGET_REPO_PATH` and `FLUXAOS_TEST_TARGET_REPO` to fluxaOS itself (gitignored, operator-local) |

---

## Suggested Next-Session Prompt

```
fluxaOS dogfooding now unlocked. main at e92f302.
Read docs/superpowers/handoffs/2026-04-28-flx-9-dogfooding-unlock-session-handoff.md
plus docs/superpowers/specs/2026-04-28-flx-9-dogfooding-design.md
plus docs/session-quick-start.md.

Linear queue is thin and design-flavored. Remaining Backlog:
  FLX-2  Add CLI surface under src/cli (Low)
  FLX-5  Confirm external issue-provider strategy (Low)
  FLX-7  Design Just Do It mode (Low — needs product definition)
  FLX-8  Design brand service (Low — needs product definition)
  FLX-10 Evaluate GitHub Issues adoption for public dev (Low)
Bug Backlog: FLX-16 (drizzle-kit TTY rebaseline) needs operator session.

Best next move per FLX-9 success criterion #1: file an actual fluxaOS
native issue, run it through the dogfood loop, merge the PR — proves
the loop is routine, not just mechanism. Pick something modest:
docs/CONTRIBUTING.md is still missing in main; a small README polish;
a missing test against existing code.

If user wants AI-managed work without dogfooding: real GitLab/Gitea/
Forgejo REST adapters (FLX-4 stubs, sibling tickets) are the next
implementation pile.
```
