# FLX-10 — Evaluate GitHub Issues Adoption for Public Development

**Status:** Design (this doc)
**Linear:** [FLX-10](https://linear.app/rebos/issue/FLX-10)
**Date:** 2026-04-29
**Author:** Claude Sonnet 4.6 (pipeline agent, research stage)

---

## Summary

This document evaluates whether fluxaOS should adopt GitHub Issues as its public-facing issue tracker, and how that would interact with Linear (current source of truth) and the native fluxaOS `issue` table (what the engine reads). The conclusion is: **defer GitHub Issues adoption to a named post-public milestone**, keeping Linear for internal development and the native issue model as the engine's sole input. GitHub Issues are worth adopting only once fluxaOS is publicly open for contributors — and even then, only as a display layer on top of the native model, not as a replacement for Linear or as a direct engine input.

---

## Background and Related Issues

- **FLX-9** (Done) — dogfooding design spec. Established the operating procedure: Linear is the human roadmap; native `issue` table is the engine's input; operators hand-file native issues to dogfood Linear-tracked tasks. See [`docs/superpowers/specs/2026-04-28-flx-9-dogfooding-design.md`](2026-04-28-flx-9-dogfooding-design.md).
- **FLX-5** — "Confirm external issue-provider strategy." The `IssueProvider` port was defined in the original spec (`docs/superpowers/specs/2026-04-07-fluxaos-spec.md`) as the sync layer between the native table and external trackers (GitHub Issues being the first-class example). That port was retired during R-RUNTIME (deleted from `src/core/ports/issue.ts` — zero runtime consumers). FLX-10 is the product decision that `IssueProvider`'s retirement needs: if we decide to build a GitHub Issues sync layer in the future, it would live here; if we decide not to, FLX-5 closes as intentionally-declined.
- **FLX-10** (this doc) — evaluate GitHub Issues adoption for public-facing development.
- **R7** — the roadmap's historical shorthand for the "open to the world" milestone. This doc closes the open question that R7 left unresolved.

---

## 1. What Does GitHub Issues Give Us That Linear Does Not?

In the context of public OSS development:

### Public visibility and contributor discovery
Linear is a private workspace (`rebos` team, invite-only). External contributors cannot see, comment on, or react to issues. GitHub Issues are public by default — they are the first thing an interested contributor checks. A contributor who finds fluxaOS on GitHub and has a bug report or feature idea has no friction-free path to file it today (they would need to DM, open a PR with no backing issue, or post in a discussion). GitHub Issues provide the zero-friction front door that any public project needs.

### Co-located PR/issue cross-linking
When a PR is opened by the dogfood engine (or by a human contributor), GitHub automatically resolves `Fixes #N` and `Closes #N` references in the PR body and commit messages to the linked issue. This is the standard contributor expectation and is invisible when the issue lives in Linear rather than GitHub — a PR opened against `fluxaOS/fluxaos` can only auto-link to a `https://github.com/...` issue URL, not a Linear URL.

### GitHub Projects and triage automation
GitHub's built-in automation (auto-label on open, auto-move to "Triage" board, close-on-merge, stale-issue bots) is directly available. For a small-team open project this reduces triage overhead without requiring Linear's more structured workflow tooling.

### Community trust signals
Issue count, open/closed ratios, and response time are visible metrics that potential contributors and users read to judge project health. An empty GitHub Issues tab signals "not open for contributions" — regardless of how healthy Linear actually is.

---

## 2. What Does GitHub Issues Cost Us Versus Linear?

### Weaker workflow tooling
Linear's cycle/project/priority model is richer than GitHub Issues labels + milestones. For internal roadmap work (phases, milestones, dependency chains), Linear is meaningfully better. GitHub Issues can approximate it via Projects + custom fields but requires more manual upkeep.

### Split issue-of-record
If both Linear and GitHub Issues are active, every work item potentially lives in two systems. "Where is the canonical source of truth?" becomes an unanswered question that creates friction every session. The FLX-9 operating procedure (Linear = roadmap, native table = engine input) is already a two-system model; adding a third creates a three-system model with three sets of IDs, three sync failure modes, and three places to look for context.

### Sync complexity and drift
If GitHub Issues are to be actionable (not just decorative), the engine eventually needs to consume them — which requires either rebuilding the retired `IssueProvider` port or adding a one-way mirror from GitHub → native `issue` table. Neither is free. Any sync introduces the possibility of drift (GitHub issue closed, native issue not updated; native issue state advanced, GitHub issue stale). Drift erodes trust in both systems.

### Contributor expectation mismatch
Once GitHub Issues are open, contributors expect responses. A dormant tracker is worse than no tracker. This is a social cost, not a technical one, but it is real: opening GitHub Issues without the operational capacity to respond creates a negative first impression.

### Three-system confusion
Today: Linear → hand-file native issue → engine runs against native. If GitHub Issues are added as a public intake: GitHub Issues → (sync?) → native issue → engine. This is three systems (GitHub Issues, native `issue` table, Linear) with two potential sync hops. Contributors filing a GitHub issue may not understand that the engine doesn't read it until an operator mirrors it. That gap will confuse contributors ("I filed a GH issue, why hasn't the agent worked on it?").

---

## 3. Interaction with the Native fluxaOS Issue Model

### Engine invariant: the `issue` table is the only input
The fluxaOS engine is agnostic and config-driven. It reads from the native `issue` table via Drizzle ORM; it has no awareness of GitHub, Linear, or any external tracker. This invariant must be preserved regardless of what issue-facing surface is adopted publicly.

### GitHub Issues as a display layer vs. a replacement
Two architectural positions are possible:

**Option A — Display layer (mirror in):**
GitHub Issues remain the public intake surface. An operator or automated job periodically mirrors new GitHub issues into the native `issue` table. The engine picks them up normally. GitHub issue state is updated on pipeline completion via a future GitHub adapter (partially stubs exist in `src/adapters/github/` via `GitProviderFactory` — currently only the PR side is fully implemented; issue-side would be new). This is the "public face + private engine" model.

**Option B — Replacement:**
GitHub Issues replace Linear as the primary roadmap source, and fluxaOS reads GitHub directly. This requires rebuilding the retired `IssueProvider` port and coupling the engine to GitHub. This violates the vendor-agnostic invariant and contradicts R-REM-W3-a's decision to retire the port. Not recommended.

Option A is the only architecturally coherent choice if GitHub Issues are adopted. But even Option A has an implementation cost: the mirror job needs to be built, tested, and operated.

### Does fluxaOS eventually become its own issue tracker?
The original roadmap (V2, 2026-04-07) described dogfooding as the project managing its own issues through fluxaOS itself — not through Linear or GitHub. This was the "close FLX-5 / IssueProvider one way or the other" question.

The current answer, shaped by four weeks of actual development, is:

- **Linear** will stay as long as the team is small and roadmap complexity justifies it. It is not going away in the near term.
- **Native fluxaOS issues** are the engine's input. They already are fluxaOS's "own" tracker in the sense that matters most: the engine reads them. The FLX-9 operating procedure already proves this — operators file a native issue, the engine processes it, the PR ships.
- **The `IssueProvider` port is deliberately dead.** It was retired because zero runtime consumers existed (R-RUNTIME, 2026-04-23). Resurrecting it requires a concrete product need — not just a design possibility.

In the near term, fluxaOS-as-its-own-tracker means: Linear for the human roadmap, native `issue` table for the engine. GitHub Issues would add a third face to this. The "fluxaOS managing its own issues end-to-end" vision is worth pursuing post-public as a showcase of the product — but that requires contributor-visible state, which the current architecture does not expose.

---

## 4. Recommendation

**Defer GitHub Issues adoption to the public-launch milestone.** Keep Linear-only until fluxaOS is ready to accept external contributors.

### Reasoning

1. **The public intake problem doesn't exist yet.** There are no external contributors. Opening GitHub Issues before a public launch creates a management burden (monitoring, responding, triage) with no corresponding benefit.
2. **Three-system complexity is premature.** The FLX-9 operating procedure is two weeks old and has shipped exactly one proof-of-routine run. Adding a third system before the two-system model is stable would be noise, not signal.
3. **FLX-5 can close as intentionally-deferred.** The `IssueProvider` port is retired. The question of external issue sync is real but not urgent. Filing FLX-5 as "decision: defer to public-launch milestone, no code action required" is the right disposition. It does not close permanently — it closes the pre-alpha version of the question.
4. **The architecture is ready for GitHub Issues when the time comes.** The `GitProviderFactory` already routes on host URL. Adding issue-side methods to the GitHub adapter (currently PR-only) is a contained, well-scoped change. The design (Option A, mirror-in) is clear. There is no reason to build it before it is needed.

### What would change if GitHub Issues were adopted (for future reference)

If fluxaOS opens to the public and adopts GitHub Issues:

**Operating procedure changes:**
- Enable GitHub Issues on the `fluxaOS/fluxaos` repository.
- Establish a triage label set (bug, enhancement, question, good-first-issue, wontfix).
- Add a CONTRIBUTING.md section explaining that filing a GitHub issue does not automatically trigger a pipeline run — an operator must mirror the issue to the native table and queue it.
- Determine response-time SLA (even a minimal one, e.g., "triaged within 1 week").

**Technical changes (deferred to public-launch):**
- Extend the GitHub adapter with issue-side methods: create, update-state, comment, close.
- Build a mirror job (operator-triggered or automated) that copies a GitHub issue body + metadata into the native `issue` table and records the GitHub issue number as a reference field.
- On pipeline `complete`, post a summary comment on the linked GitHub issue and close it if resolved.
- Do NOT rebuild `IssueProvider` as a generic port — implement this as a GitHub-specific feature in `src/adapters/github/` per the existing provider pattern.

**What does NOT change:**
- The engine still reads only the native `issue` table. GitHub Issues remain a display layer.
- Linear remains the internal roadmap source for operator-tracked work.
- The dogfood operating procedure (FLX-9) is unchanged — hand-filing native issues continues as the standard path.

### Named milestone

**Public-launch milestone conditions (not today):**
- Repository README describes fluxaOS as open for contributions.
- A CONTRIBUTING.md exists that explains the development workflow.
- At least one "good first issue" is ready for a new contributor.
- The mirror-job design is specced and the GitHub issue-side adapter is built.

Until all four conditions are true, GitHub Issues adoption is premature and this evaluation should not be re-litigated. File the next evaluation as a Linear issue when the public-launch milestone is actively scoped.

---

## Decision Matrix

| Question | Answer |
|----------|--------|
| Adopt GitHub Issues now? | **No** — defer |
| Adopt at public launch? | **Yes, as display layer (Option A)** |
| Replace Linear with GitHub Issues? | **No** |
| Replace native issue table with GitHub Issues? | **No — engine invariant** |
| Rebuild `IssueProvider` port? | **No — retire it, FLX-5 closes as deferred** |
| Does the architecture support GitHub Issues later? | **Yes — GitHub adapter already wired for PRs; issue-side is a contained addition** |

---

## References

- Linear: [FLX-10](https://linear.app/rebos/issue/FLX-10) (this evaluation), [FLX-9](https://linear.app/rebos/issue/FLX-9) (dogfooding design), [FLX-5](https://linear.app/rebos/issue/FLX-5) (external issue-provider strategy — close as deferred)
- Dogfooding operating procedure: [`docs/superpowers/specs/2026-04-28-flx-9-dogfooding-design.md`](2026-04-28-flx-9-dogfooding-design.md)
- `IssueProvider` port retirement: R-RUNTIME spec [`docs/superpowers/specs/2026-04-22-r-runtime-design.md`](2026-04-22-r-runtime-design.md) §7
- Original IssueProvider design: [`docs/superpowers/specs/2026-04-07-fluxaos-spec.md`](2026-04-07-fluxaos-spec.md) (historical; superseded)
- Phase 2 audit finding re: unimplemented ports: [`docs/superpowers/audits/2026-04-17-phase2-full-codebase-audit.md`](../audits/2026-04-17-phase2-full-codebase-audit.md) AUDIT-P2-CQ-CORE-12
- DA review: [`docs/planning/da/2026-04-07-v2-da-review.md`](../../planning/da/2026-04-07-v2-da-review.md) (original recommendation: "if issue system not reliable by end of Phase 2, continue using GitHub Issues directly")
