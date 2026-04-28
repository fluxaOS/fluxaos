# Alpha Verification Matrix

**Status:** Living document. Each row maps to a Linear ticket in the **fluxaOS Alpha** project (workspace `rebos`, team `FLX`). When a row turns green, the ticket closes.

**Visual companion:** the same content rendered with status bars + colors lives at [`assets/2026-04-27-alpha-verification-matrix.html`](assets/2026-04-27-alpha-verification-matrix.html). Open in a browser if you prefer the visual form.

---

## How to read this matrix

Each row has three signals:

- **Code** — does the feature exist in the app?
  - ✅ Done — implemented
  - 🟡 Partial — wired but incomplete
  - 🔴 Missing — no code or wrong behavior
  - ⚪ None — no code at all (Settings tab not built, no UI surface)
- **Spec** — does a Playwright journey verify it end-to-end?
  - ✅ Pass — spec exists, last run green
  - 🟡 Red / Partial — spec exists but red, OR only covers part of the row
  - 🔴 None — no spec exists for this row
- **Notes** — which spec covers it, what's missing, why it's the way it is

**A row is "alpha-ready" only when Code = ✅ AND Spec = ✅.** Anything else is alpha-blocking work.

---

## CRUD — Catalog Entities

DB-driven, even at one entry. fluxaOS reads catalog data from the DB at runtime; "single seeded entry" still has to round-trip through a real CRUD path.

| Capability | Code | Spec | Notes |
|---|---|---|---|
| Project — Create / Edit / Delete | ✅ | ✅ | `e2e/project-crud.spec.ts` (FLX-60). New Project button + RecordEditor onDelete wired in same PR. |
| Team — Create / Edit / Delete | ✅ | ✅ | `e2e/team-crud.spec.ts` (FLX-61). New `/settings/teams` tab + tRPC router + service. |
| Skill — Create | ✅ | ✅ | `e2e/create-a-skill.spec.ts` (FLX-62). |
| Skill — Edit | ✅ | 🟡 | `e2e/edit-a-skill.spec.ts` — currently red (FLX-58: asserts non-existent `deploy` skill). |
| Skill — Delete | ✅ | ✅ | `e2e/delete-an-unreferenced-skill.spec.ts`, `e2e/delete-a-referenced-skill-fails-gracefully.spec.ts`. |
| Driver — Create | ✅ | ✅ | `e2e/create-a-driver.spec.ts` (FLX-62). New Driver form added in same PR (was missing); contextLayout JSON field has a seed-shape default. |
| Driver — Edit | ✅ | ✅ | `e2e/edit-a-driver.spec.ts`. |
| Driver — Toggle enabled | ✅ | ✅ | `e2e/toggle-driver-enabled.spec.ts`. |
| Driver — Delete | ✅ | ✅ | `e2e/delete-an-unreferenced-driver.spec.ts`, `e2e/delete-a-referenced-driver-fails-gracefully.spec.ts` (FLX-63). FK guard added to driver.delete in same PR (mirrors skill.delete pattern). |
| Routing Profile — Create / Edit / Delete | 🟡 | 🔴 | `/settings/routing` tab exists. No spec for any operation. |
| Provider — Create / Edit / Delete | 🟡 | 🔴 | `/settings/providers` tab exists. No spec for any operation. |
| Persona — Create / Edit / Delete | 🟡 | 🔴 | `/settings/personas` tab exists. No spec for any operation. |

---

## Issue CRUD

No orchestrator work — pure form/edit/delete. Lifecycle stage execution is in the next section.

| Capability | Code | Spec | Notes |
|---|---|---|---|
| Issue — Create | ✅ | ✅ | `e2e/issue-crud.spec.ts` — Create test (FLX-67). |
| Issue — Edit fields (title, body, type, priority, assignee) | ✅ | ✅ | `e2e/issue-crud.spec.ts` — Edit test (FLX-67). |
| Issue — Delete | ✅ | ✅ | `e2e/issue-crud.spec.ts` — Delete test (FLX-67). |
| Issue — State dropdown shows ALL states | ✅ | ✅ | `e2e/state-dropdown-free-walk.spec.ts` (FLX-77). Dropdown shows full catalog; tRPC `transition` accepts any state→state. `issue_transition` advisory only. |
| Issue — State walk via dropdown | ✅ | ✅ | `e2e/closed-issue-indicator.spec.ts` (FLX-27). Walks new → implement → review → deploy → complete via dropdown. |

---

## Stage Execution — Manual Path

Operator clicks **Run Stage**. The orchestrator runs the stage matching the issue's current state. State auto-advances on success per gate verdict. Operator can change state at any time and click Run Stage again to run a different stage.

| Capability | Code | Spec | Notes |
|---|---|---|---|
| Manual: research stage | ✅ | ✅ | Covered by FLX-69 full-chain spec (collapsed per FLX-69 shape B); `e2e/real-anthropic-stage-run.spec.ts` provides isolated stage smoke. |
| Manual: implement stage | ✅ | ✅ | Covered by FLX-69 full-chain spec (collapsed per FLX-69 shape B). |
| Manual: review stage | ✅ | ✅ | Covered by FLX-69 full-chain spec (collapsed per FLX-69 shape B). |
| Manual: rework stage | ✅ | 🔴 | Run → state back to review. No spec. Out of scope for alpha bar; tracked separately. |
| Manual: deploy stage | ✅ | ✅ | Covered by FLX-69 full-chain spec + `r-runtime-deploy-journey.spec.ts`. |
| Manual: full chain (research → complete) | ✅ | ✅ | **THE ALPHA BAR — VERIFIED 2026-04-27.** `e2e/manual-stage-chain.spec.ts` (FLX-69) executed live in 2.0m: 3 stage_runs all completed `proceed`, gate verdicts written, PR opened on sandbox, issue walked to Complete via FLX-77 dropdown, Closed badge rendered. Shipped in PR #126 alongside FLX-81 engine fix (no-signal soft-pass). |
| Manual: human override mid-run | ✅ | ✅ | Free-walk dropdown (FLX-77) — operator can change state at any time; validation removed. `e2e/state-dropdown-free-walk.spec.ts`. |

---

## Stage Execution — Daemon-Driven Path

Daemon picks up new `pipeline_run` rows via Realtime, runs every stage autonomously without operator interaction.

| Capability | Code | Spec | Notes |
|---|---|---|---|
| Daemon picks up pending pipeline_run | ✅ | 🟡 | `e2e/r-daemon-autonomous-run.spec.ts` — currently red. |
| Stage chain (research → implement) | ✅ | ✅ | `e2e/r-artifacts-chain.spec.ts` — artifacts handoff verified. |
| Gate evaluation (rules-mode) | ✅ | ✅ | `e2e/gate-results-rule-details.spec.ts` (FLX-20) asserts render shape. |
| Full daemon journey (issue → daemon → all stages → PR → close) | ✅ | 🟡 | `e2e/r-smoke.spec.ts` — happy path only, no edge cases. |
| Crash recovery (daemon restart picks up stale runs) | 🟡 | 🔴 | `recoverOnStartup()` exists. No spec. |

---

## Architecture Invariants

Audits, not journey tests. Each invariant gets a one-shot verification (script or grep) that fails the build / blocks merge if violated.

| Capability | Code | Spec | Notes |
|---|---|---|---|
| Vendor-agnostic core | 🟡 | ✅ | `src/scripts/verify-agnostic-core.ts` (FLX-73) — pre-push Gate 4 + `npm run verify`. 6 documented allowlist hits tracked: FLX-78 (CLAUDE.md fallback), FLX-79 (`'review'` state literal). New leaks fail builds. |
| DB-driven config | 🟡 | 🔴 | No hardcoded fallbacks/defaults bypassing the database. Not audited. |

---

## UI / Polish

| Capability | Code | Spec | Notes |
|---|---|---|---|
| Mission Control empty states | ✅ | ✅ | `e2e/r-mission-control.spec.ts` (non-daemon test). |
| UI label conventions (Title Case + ellipsis) | ✅ | ✅ | `e2e/ui-label-conventions.spec.ts` (FLX-30 / FLX-31). |
| Activity feed Realtime | ✅ | ✅ | `e2e/activity-feed-realtime.spec.ts`. |
| Concurrent edits — version conflict | ✅ | ✅ | `e2e/conflict-on-save.spec.ts`. |
| Epic / child-issue hierarchy | ✅ | ✅ | `e2e/r-epic-hierarchy.spec.ts`. |
| Settings — alpha tab set | ✅ | ✅ | `e2e/r-settings-alpha.spec.ts`. |

---

## Pre-Existing Reds (filed in Linear, not alpha-blocking)

| Spec | Status | Linear |
|---|---|---|
| `e2e/edit-a-skill.spec.ts` | Red | FLX-58 |
| `e2e/run-stage-smoke.spec.ts` | Red | FLX-59 |

---

## Tally

- **21 fully verified** (Code ✅ + Spec ✅): skill delete (×2), driver edit, driver toggle, FLX-27 dropdown walk, r-artifacts-chain, FLX-20 gate render, mission-control empty, ui-label-conventions, activity-feed-realtime, conflict-on-save, r-epic-hierarchy, r-settings-alpha, FLX-67 issue Create / Edit / Delete, FLX-77 free-walk state dropdown / human override mid-run, FLX-73 vendor-agnostic-core audit, FLX-61 Team Create / Edit / Delete, **FLX-69 full chain (THE ALPHA BAR — verified live 2026-04-27)** + 4 collapsed companion stage rows (research / implement / review / deploy covered by the full-chain spec).
- **4 partial** (spec exists but red, partial, or only happy path).
- **13+ rows with no spec at all.**

The verified rows exercise real user-facing behavior end-to-end against a real database. The remaining gap is the alpha backlog — Linear `fluxaOS Alpha` project tracks the rest.

---

## Out of Scope for Alpha

These are post-alpha, NOT verification-matrix rows:

- Multi-user / multi-org / multi-project / multi-repo flows (schema supports; UI deferred)
- Auth + role-based permissions (transition validation override falls under this)
- Subscription tiers / billing
- Public OSS launch (license, README, install path, telemetry)
- CLI surface (`src/cli/`)
- OpenAI adapter (Anthropic only for alpha)
- Additional forge adapters (GitHub only for alpha)
- Brand service, Just Do It mode, OpenClaw preview gate, version history for skills/drivers
- Dogfooding (fluxaOS managing its own development)
- GitHub Issues adoption for fluxaOS's own dev process

These live in the **fluxaOS Post-Alpha Wishlist** Linear project.
