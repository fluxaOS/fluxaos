# Architecture Audit Orientation Session Handoff

Date: 2026-05-05 (Pacific)
Operator: Joseph Pierce
Branch at start: `main` (SHA `f1ed86b`)
Branch at end: `main` (SHA `f1ed86b`)

## Session Boundary

Session-start marker: `session-start-2026-05-04T22:32:00-07:00.md`. Latest session-end marker was `session-end-2026-05-04T12:24:37-07:00.md`, which is older — so the start marker was used as the boundary.

## Scope

This was an orientation and triage session, not a build session. The operator came in with a few specific questions about the UAT environment and the skills/playbook architecture, and those questions surfaced a deeper concern: the codebase has drifted from its stated design principles in ways that go beyond the bundled YAML/skills files. The session closed three stale Linear issues, filed one new stub issue (FLX-129) for the skills/playbooks UI redesign, and identified the root cause of why `stk` (Forgejo CLI) kept appearing in fluxaOS sessions. No code was written or merged.

## What Shipped

Nothing merged this session. The previous session's PR #248 (FLX-104 health SHA bake) was already merged before this session started.

## Issues Closed

- **FLX-104** — Done. Git SHA and build time now baked into Docker image at build time; health endpoint returns real SHA. PR #248 shipped last session.
- **FLX-123** — Done. Was filed for dev data leftover from real API calls; resolved by the dev/UAT DB isolation work (separate Supabase projects). No code changes needed.
- **FLX-99** — Closed. Brainstorm issue that was folded into FLX-2 (full TypeScript CLI). No standalone work needed.

## New Issues Filed

- **FLX-129** — Stub: Skills/Playbooks UI Redesign. The current settings UI has a Skills tab and a Personas tab that are cosmetically functional but architecturally broken — the orchestrator reads `.md` files and `.yaml` files baked into the Docker image, not the DB rows that the UI edits. The DB `skill` rows are never read by pipeline runs. Filed as a stub to track the redesign work; blocked on the architectural audit completing first.

## Key Findings This Session

**Bundled files are the primary architectural violation.** `src/core/pipeline/bundled/` contains YAML playbooks and skill `.md` files that are baked into the Docker image and read via `readFileSync` at runtime by the orchestrator (`src/core/orchestrator/event-orchestrator.ts` lines ~257–301). The DB `skill` table rows are edited in the UI but never read during pipeline runs. This is a single-tenant design — every org shares the same baked-in prompts with no customization possible. The direction is to move everything to the DB and delete the bundled directory entirely, seeding from hardcoded strings in `seed.ts`. FLX-129 tracks the UI work that follows.

**The `stk` CLI leak was a session configuration issue, not a code problem.** The `deep-review` skill was being loaded from `/mnt/stacks/.claude/skills/deep-review` — a Forgejo-native skill full of `stk issue` commands — because `/mnt/stacks` was listed as an additional working directory in the Claude Code launch command. Claude Code loads `.claude/skills/` from every working directory in scope. The fix: drop `--add-dir /mnt/stacks/` from the fluxaOS session launch. Correct launch going forward:

```bash
claude --dangerously-skip-permissions --add-dir /mnt/dev/ --remote-control
```

**Architectural drift concern is broader than bundled files.** The bundled files issue prompted the operator to flag concern about other potential drift: hardcoded values, single-tenant assumptions in DB queries, and vendor/tool names in `src/core/`. A full four-domain audit (hardcoded values, multi-tenancy, vendor coupling, architecture drift) is the next priority. The `deep-review` skill cannot be used as-is for fluxaOS because it hardcodes `stk`/Forgejo tooling — audit must be run with direct subagents filing findings to Linear via MCP.

## Current State

- HEAD: `main` at `f1ed86b`
- Working tree: clean
- Stashes: none
- Local branches: `main` only
- Remote branches: `origin/main` only
- No open PRs
- Dev server: not confirmed running (not started this session)
- UAT: deployed at `f1ed86b` (PR #248)

## Linear

- **FLX-104** — marked Done
- **FLX-123** — marked Done
- **FLX-99** — marked Done/closed
- **FLX-129** — filed as stub, state: Backlog

## Memories Saved

None written this session.

## Suggested Next Session

```
Continue from main at f1ed86b. Session was orientation — no code
changed.

Immediate priority: run the four-domain architectural audit WITHOUT
the stk-based deep-review skill. Spawn four direct subagents:
  A — Hardcoded values (paths, magic strings, driver/provider names)
  B — Multi-tenancy violations (unscoped DB queries, shared state)
  C — Vendor/tool coupling in src/core/ (Supabase/BullMQ/Anthropic imports,
      driver binary names, stage name strings)
  D — General architecture drift from CLAUDE.md principles

File findings to Linear "fluxaOS Deferred Fixes" project via MCP.
FLX-129 (skills/playbooks UI redesign) is blocked on this audit.

Launch command going forward (drop stacks):
  claude --dangerously-skip-permissions --add-dir /mnt/dev/ --remote-control
```
