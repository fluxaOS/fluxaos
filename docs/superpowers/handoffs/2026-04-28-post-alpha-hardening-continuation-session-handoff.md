# Session Handoff — Post-Alpha Hardening Continuation

**Date:** 2026-04-28 03:49 PDT → 2026-04-28 session close  
**Operator:** Codex  
**Branch at start:** `main` at `14a3eec`  
**Branch at end before handoff:** `main` at `12493da`  
**Mode:** autonomous non-interactive execution, then tooling investigation  
**PRs merged:** #149, #150, #151  

---

## Session Scope

Continued from the prior post-alpha hardening handoff. The first half closed the next three bounded Linear tickets from the suggested queue. The second half investigated the broken Codex Linear natural-language `_research` endpoint, separated upstream connector failure from fluxaOS runtime behavior, and captured the larger non-MCP CLI direction in fh-commons.

The Vercel private-org Hobby-plan failure remained ignorable. GitHub `check` passed before each merge.

---

## What Shipped

### PR #149 — `fix(ui): expose issue run history`

Merged as `52d2d38`. **FLX-21 Done.** The issue detail page now exposes prior runs instead of only the newest run context. Added `e2e/run-history-details.spec.ts` for the history/detail journey.

### PR #150 — `fix(ui): tick run detail duration`

Merged as `393a2e0`. **FLX-26 Done.** The run detail modal duration now updates live while a run is active. Added `e2e/run-detail-duration.spec.ts`.

### PR #151 — `fix(issues): support multi-label input`

Merged as `12493da`. **FLX-42 Done.** The issue labels editor now supports entering multiple labels in one pass. Added `e2e/issue-label-tags.spec.ts`.

---

## Tooling Investigation

### Linear MCP `_research` is broken in this Codex app surface

Calling `mcp__codex_apps__linear_mcp_server._research` failed with:

```text
MCP error -32602: Tool research not found
```

The failure is not fluxaOS runtime code. The bundled Linear plugin cache only contains metadata and skill text, not the MCP implementation. Other structured Linear MCP tools work, including `_list_issues`, `_list_projects`, `_search`, `_fetch`, `_save_issue`, `_save_comment`, `_list_issue_statuses`, and `_list_issue_labels`.

Public web/GitHub search found no exact match for this specific `_research` failure. Related public signals exist for Codex MCP reliability/discovery issues:

- `openai/codex#3759` — Linear MCP not working after authorization.
- `openai/codex#14242` — Codex mishandling tool-only MCP servers.

Linear's official docs recommend direct remote MCP setup with `codex mcp add linear --url https://mcp.linear.app/mcp`, but local `codex mcp list` currently reports no direct MCP servers configured. This session used the bundled Linear app connector, not the official direct remote MCP config.

### Captured follow-up work

- **FLX-88** created and moved to In Progress: tracks the broken Codex Linear `_research` endpoint.
- **fh-commons #3095** filed: "Add Linear API support to fhc CLI" so future agents can use an fhc-owned, non-MCP Linear API/SDK path.
- Added a comment to fh-commons #3095 to evaluate `HKUDS/CLI-Anything` as a spike/generator, but not as an unreviewed runtime dependency.

A docs-only mitigation PR was opened as #152, then closed after review because documenting around the defect was not an adequate fix. No repo change from #152 landed on `main`.

---

## Linear State

Moved to Done this session:

- FLX-21 — previous run details visible after newer runs
- FLX-26 — run detail modal duration updates live
- FLX-42 — issue label input supports multiple labels

Still active:

- FLX-88 — Linear natural-language `_research` endpoint unavailable in Codex

Structured Linear listing shows the remaining Bug Backlog items as:

- FLX-16 — Drizzle schema/migration drift requires interactive prompts
- FLX-47 — verbose hook/init entries swamp transcript
- FLX-38 — structured JSON editor for jsonb driver fields

---

## Verification Matrix

| Check | Result |
|---|---|
| GitHub PR `check` for #149 | Passed |
| GitHub PR `check` for #150 | Passed |
| GitHub PR `check` for #151 | Passed |
| Vercel | Failed for known private-org Hobby-plan limitation; ignored |
| `git diff --check` for closed #152 mitigation branch | Passed before PR close |
| Structured Linear MCP `_list_issues` / `_fetch` | Worked |
| Linear MCP `_research` | Failed with `Tool research not found` |

---

## Current State Before Session-End Cleanup

- HEAD: `12493da` on `main`
- Working tree: clean before writing this handoff
- Stashes: none observed
- Dev server: not running for current work
- Open PRs: none
- Closed unmerged PR: #152, intentionally closed

---

## Suggested Next Session

The next bounded product ticket is likely **FLX-38** if the user wants to continue fluxaOS hardening, but it needs a product/design decision for the JSON editor approach. Smaller backlog options are **FLX-16** and **FLX-47**. Tooling-wise, **FLX-88** remains open until the Linear connector issue is resolved or a direct MCP / fhc CLI path is validated.

Copy/paste prompt:

```text
Continue fluxaOS from main at 12493da. Read docs/session-quick-start.md and docs/superpowers/handoffs/2026-04-28-post-alpha-hardening-continuation-session-handoff.md. Completed this session: FLX-21, FLX-26, FLX-42. Linear MCP `_research` is broken and tracked as FLX-88; structured Linear MCP tools still work. fh-commons #3095 tracks adding non-MCP Linear API support to fhc. Next product options: FLX-38, FLX-16, or FLX-47.
```
