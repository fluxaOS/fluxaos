# User Docs + Doc-Drift Prevention Design

**Date:** 2026-05-04  
**Status:** Approved  
**Audience:** Internal / early testers (designed to scale to public SaaS docs)

---

## Problem

The `docs/` directory is entirely internal: session handoffs, specs, plans, audits. There is no user-facing documentation. New users — even internal testers — have no structured resource for "how do I set this up and run a pipeline end to end." Installation will change, so the first content priority is **how to use fluxaOS once it's running**.

Additionally, there is no mechanism to detect when code changes without corresponding doc updates (doc drift). As the product evolves, user-facing docs will silently fall behind.

---

## Goals

1. Build a user docs site that starts simple (internal testers) and scales to public SaaS / enterprise without a rewrite.
2. Prevent doc drift via a GitHub Action that combines a deterministic hard gate for critical paths and an LLM soft nudge for everything else.
3. Serve docs at `docs.fluxaos.io` alongside the existing marketing site.

---

## Non-Goals

- Installation / self-hosting docs (install story will change; deferred)
- API reference docs
- Admin / ops docs (these live in `docs/` as internal docs)

---

## Architecture

### Doc Site

**Tooling:** Docusaurus (classic theme)

**Location:** `website/docs-site/` — a self-contained Docusaurus project with its own `package.json`, separate from the Next.js app in `website/`.

**Rationale:** Docusaurus is the OSS standard for docs that need to scale. It provides versioning, i18n, Algolia search, MDX support, and custom themes out of the box. Mintlify is prettier but costs money at scale and introduces vendor lock-in. Plain markdown in `docs/` won't scale (no versioning, no search, no sidebar management).

**Deployment:** Two independent Vercel projects from the same repo:
- `website/` → `fluxaos.io` (existing Next.js marketing site — unchanged)
- `website/docs-site/` → `docs.fluxaos.io` (Docusaurus, `baseUrl: /`, separate Vercel project)

No `vercel.json` in the repo — each project is configured independently in the Vercel dashboard with its root directory set to the appropriate subdirectory. Keeps the two deploys fully decoupled: a docs change never triggers a marketing site rebuild and vice versa.

**Branding:** Logo placeholder only for now. Theme polish is deferred until the content is stable.

---

## Doc Structure

```
website/docs-site/
  docs/
    concepts/
      index.md           # What is fluxaOS? The core mental model
      skills.md          # Prompt templates, global vs project scope
      drivers.md         # Binary, flags, prompt transport, output format
      pipelines.md       # Stages, gate modes, ordering
      gates.md           # Rules, verdicts (proceed/hold/rework/abort)
      signals.md         # How skills communicate outcomes: result docs + flux:signal stdout protocol
      state-vs-status.md # Critical distinction: issue state ≠ issue status

    guides/
      01-first-setup.md        # Create a driver, create a skill
      02-build-a-pipeline.md   # Create pipeline, add stages (skill+driver+gate)
      03-add-an-issue.md       # Create an issue, understand type/state/status
      04-run-a-pipeline.md     # Trigger a run, the daemon, live output
      05-read-the-results.md   # Gate verdicts, cost/tokens, activity feed vs run detail

    reference/
      env-vars.md          # All FLUXAOS_* vars: required/optional, defaults
      signal-types.md      # proceed, hold, rework, abort — when each fires
      gate-rules.md        # Fields, operators, severity levels, failure actions
      issue-states.md      # Full state machine with valid transitions
      playbook-schema.md   # YAML format: sequential, parallel, and loop node types
      daemon.md            # What it is, how to check it, recovery behavior
```

### Content Priorities

The guides section is the highest priority — it tells the full story end-to-end. A user who reads guides 01–05 in order should end up with a working pipeline that has processed a real issue. Each guide links to the next.

Concepts pages are reference material linked from guides — intentionally short (2–3 paragraphs each). `state-vs-status.md` is the most critical concept page; it explains the #1 non-obvious behavior in the system (issue state and issue status are independent fields that mean different things and change at different times).

Reference pages are detailed but not required reading. They're linked from guides at the relevant step.

### Internal Docs Source of Truth

`docs/terminology.md` remains the developer-facing vocabulary reference. The concepts pages are user-facing rewrites of the same facts in plain language — same truth, different register. Do not merge them.

---

## Doc-Drift Prevention

### GitHub Action

File: `.github/workflows/doc-drift.yml`

Triggers on every PR that modifies any file under `src/`. Does not run on doc-only PRs.

Two layers run in the same Action:

### Layer 1 — Hard Gate (Deterministic)

A config file at `.github/doc-drift-map.yml` declares critical path mappings:

```yaml
critical:
  - match: src/core/db/schema.ts
    docs:
      - website/docs-site/docs/reference/env-vars.md
      - website/docs-site/docs/reference/issue-states.md
      - website/docs-site/docs/reference/gate-rules.md
      - website/docs-site/docs/concepts/state-vs-status.md
  - match: src/core/db/seed.ts
    docs:
      - website/docs-site/docs/reference/issue-states.md
      - website/docs-site/docs/reference/gate-rules.md
  - match: src/core/pipeline/playbook.ts
    docs:
      - website/docs-site/docs/reference/playbook-schema.md
  - match: src/config/env.ts
    docs:
      - website/docs-site/docs/reference/env-vars.md
  - match: src/core/constants.ts
    docs:
      - website/docs-site/docs/reference/signal-types.md
      - website/docs-site/docs/reference/gate-rules.md
  - match: src/core/gates/types.ts
    docs:
      - website/docs-site/docs/reference/gate-rules.md
      - website/docs-site/docs/concepts/gates.md
```

**Behavior:** If a mapped source file changed in the PR diff and none of its mapped doc files changed, the Action fails with a specific message:

```
❌ Doc drift detected:
  src/core/db/schema.ts changed but none of its mapped doc pages were updated.
  Expected at least one of:
    - website/docs-site/docs/reference/env-vars.md
    - website/docs-site/docs/reference/issue-states.md
    - website/docs-site/docs/reference/gate-rules.md
    - website/docs-site/docs/concepts/state-vs-status.md
```

The map itself is a tracked file — changes to `doc-drift-map.yml` require a PR, so the map stays honest.

**Escape hatch:** Add the `skip-doc-drift` label to a PR (or include `[skip-doc-drift]` in the PR title) to bypass both layers for pure mechanical refactors where no user-visible behavior changed. This is opt-in and auditable via PR history.

### Layer 2 — LLM Soft Nudge (Everything Else)

After the hard gate (pass or fail), the Action sends the PR diff to Claude via the Anthropic API with a structured prompt:

> "You are reviewing a code diff for a product called fluxaOS. Determine whether any user-visible behavior changed. If yes, identify which user doc pages likely need updating from this list: [page list]. Reply with a JSON object: `{ changed: boolean, pages: string[], reason: string }`."

The response is posted as a PR comment. It is **never blocking** — it informs, it does not fail the PR.

### What This Does Not Cover

- Doc pages that don't exist yet (the gate can only check files that are mapped)
- Changes to the `website/` marketing copy
- Internal docs under `docs/superpowers/`

The map grows as new critical paths are added. The LLM layer covers unmapped paths with a soft signal.

---

## Prior Art

No existing open-source project combines a hard gate with an LLM diff review for doc drift. The closest:

- **mintlify/action** — file-path heuristics only, no LLM, no hard gate
- **github/docs** — CODEOWNERS + label routing, no drift detection
- **vercel/next.js** — CODEOWNERS on `docs/`, no code→doc mapping

The hybrid approach designed here is novel.

---

## Key Non-Obvious Behaviors Docs Must Cover

These were identified during codebase research and are the most likely points of confusion for new users:

1. **State ≠ Status** — Issue state (New/Research/Implement/Review/Rework/Deploy/Complete) is the workflow position. Issue status (Open/Queued/Running/Blocked/Completed) is the operational condition. Both are visible in the UI; both matter.
2. **The daemon is always running** — Users do not start the daemon by clicking "Run." If a pipeline run sits at `pending`, the daemon is down. The UI does not currently surface this clearly.
3. **Gate verdict ≠ stage exit code** — A stage can exit 0 (success) and still fail its gate. Gate failure routes to rework or abort, not the next stage.
4. **Activity feed ≠ run output** — The activity feed on the issue page shows issue-level events (state changes, comments). Stage output is only in the Run Detail Modal.
5. **Playbook has three stage types** — Sequential (default), parallel (aggregates concurrent skills), and loop (iterates a single skill up to `maxIterations`). Loop nodes are different from `maxRetries` in the stage DB config.
6. **flux:signal stdout protocol** — Skills can emit a `flux:signal` JSON line to stdout during execution. Signal-driven jumps (`hold/already_complete`) bypass the normal state transition table and call `stateOverride()` directly. This is distinct from the result document verdict.
7. **Realtime dependency** — Live updates in the UI depend on Supabase Realtime. If disconnected, the modal will not auto-update.

---

## Implementation Scope (Not This Spec)

The implementation plan will cover:

1. Docusaurus scaffold at `website/docs-site/`
2. Vercel subdomain deployment (`docs.fluxaos.io`) — separate Vercel project, no `vercel.json`
3. First-pass content for all 5 guide pages (full lifecycle)
4. Concept pages (7 pages, short)
5. Reference pages (6 pages)
6. `.github/doc-drift-map.yml` config file
7. `.github/workflows/doc-drift.yml` GitHub Action (hard gate + LLM nudge + escape hatch + concurrency block)
8. Linear issue filed for the work
