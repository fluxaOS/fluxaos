---
name: "research"
description: "Unified entry point for research, planning, triage, and issue creation."
---
# Research (Unified Research and Planning)

**Unified entry point for research, planning, triage, and issue creation.**

Assess the situation. Decide what to do. Execute the appropriate workflow.

## State Transitions

| Entry State | Exit State | Condition |
|-------------|------------|-----------|
| `research` | `implement` | Issue with full implementation plan |
| `research` | `implement` | Trivial fix, no branch needed |

See [Issue Lifecycle](docs/issue-lifecycle.md) for the complete state machine.

## Pipeline Overview



```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Researcher │ ──► │ Implementer │ ──► │  Reviewer   │ ──► │   Merger    │
│  (optional) │     │             │     │             │     │             │
└─────────────┘     └─────────────┘     └─────────────┘     └─────────────┘
 research            implement            review               deploy
                           ▲                   │
                           │    ┌──────────┐   │
                           └────│ Reworker │◄──┘ (on changes-requested)
                                └──────────┘
                                 rework
```

## Execution Isolation Policy

> **Pipeline context:** When launched by the manager via `pat pipeline run`, you are already in an isolated tmux session. "Delegated agents" below refers to subagent delegation *within* this session (e.g., for `--parallel` mode), NOT to how the manager launches you. The manager always uses `pat pipeline run` + `pat pipeline wait`.

**Default behavior (required):**
- Run all research execution through delegated agents: single-issue work uses one subagent, multi-issue work uses parallel subagents/agent teams.
- Run delegated execution in a dedicated git worktree (`isolation: "worktree"`).

**Opt-out flag:**
- Pass `--inline` to disable both delegated agents and dedicated worktrees for this run.
- `--inline` means run directly in the current session and current checkout.

**Delegation intent:** Invoking this skill without `--inline` or `--no-subagent` constitutes an explicit request for delegated subagent execution. Session-level rules that restrict subagent usage to "explicit requests" are satisfied by the act of invoking a pipeline stage skill — no additional user confirmation is needed.

## Argument Handling

### Decision Tree
When the research skill is invoked, assess $ARGUMENTS:

1. If contains `--inline` → Inline execution override (disable subagent/agent-team and worktree for this run)
2. If contains `--parallel [N]` → Multi-agent mode (Section A)
3. If contains `--next` → Auto-select mode (Section B)
4. If is a number → Specific issue mode (Section C)
5. If is empty → Queue scan mode (Section D)
6. If is text description → Issue creation mode (Section E)

Unless `--inline` is present, execute all modes via delegated agent(s) in dedicated worktree isolation.

If `--inline` is present, disable subagent/agent-team delegation and dedicated worktree isolation for this run, then continue with the same routing below in the current session.

### Section A: Multi-agent mode

**Spawn multiple agents to research multiple issues simultaneously. Every agent runs in an isolated worktree — this is mandatory.**

#### 1. Determine agent count and select issues

See `references/capabilities-reference.md` — Section A steps 1 and 2 for full filtering and prioritization logic.

#### 2. Spawn agents



For each selected issue, use the **Task tool** with these parameters:

| Parameter | Value |
|-----------|-------|
| `subagent_type` | `"general-purpose"` |
| `isolation` | `"worktree"` |
| `run_in_background` | `true` |

**IMPORTANT:** Spawn ALL agents in a **single message** with multiple Task tool calls. This enables true parallel execution.

**IMPORTANT:** Every agent prompt MUST include the teardown contract. The teardown contract applies to ALL terminal paths — success, failure, and blocked exit. Each agent is responsible for:
1. Removing `state:in-progress` from its issue before exiting
2. Cleaning its own worktree with `git worktree prune` before exiting
3. The lead running one final `git worktree prune` safety sweep after all agents exit, only to catch stragglers

**Agent prompt template** (fill in per issue):
```
Research and plan issue #<NUMBER> for the fluxaos project.

You are in an isolated worktree. Do NOT create another worktree.

Follow the research skill workflow:
1. Run: review the issue: <NUMBER>
3. Check for existing design specs:
   - Glob: docs/**/specs/**/* and docs/**/plans/**/*
   - Grep spec content for keywords from the issue title/description
   - If issue references a parent EPIC, read the EPIC description
   - If specs exist, read them and incorporate all design requirements into the plan
   - If issue scope is narrower than spec, either expand scope or justify the deviation in a comment
4. If memory insufficient, research the codebase (Glob, Grep, Read)
5. Create a detailed implementation plan with numbered steps, files to modify, key decisions, tests to write, and acceptance criteria
6. Post the plan as an issue comment
7. Evaluate scope (single issue vs EPIC decomposition)
10. Exit pipeline stage: pat pipeline exit --stage "research" --issue <NUMBER> --start-time $IMPL_START_TIME --result "Implementation plan posted." --model "<model name and version>"

FAILURE PATH: If you cannot complete research for any reason:
- Post a blocker comment explaining what is missing
- Do NOT leave the worktree unclean
```

#### 4. Monitor and report

After all agents have exited, summarize results. Each agent cleans its own worktree before exiting.

---

### Section B: Auto-select mode

**If `$ARGUMENTS` contains `--next`:**

**Automatically find and research the next issue that needs R&D.**

Run this mode through one delegated subagent in a dedicated worktree unless `--inline` is set.

See `references/capabilities-reference.md` for the full procedure for auto-select mode.

---

### Section C: Specific issue mode

**If `$ARGUMENTS` is an issue number:**

Run this mode through one delegated subagent in a dedicated worktree unless `--inline` is set.

Proceed with R&D for that specific issue. Follow the standard workflow in `references/capabilities-reference.md`.

---

### Section D: Queue scan mode

**If `$ARGUMENTS` is empty (no arguments):**

Run this mode through one delegated subagent in a dedicated worktree unless `--inline` is set.

Scan the issue queue, categorize, prioritize, and recommend or proceed with research.

See `references/capabilities-reference.md` for the full procedure for queue scan mode.

---

### Section E: Issue creation mode

**If `$ARGUMENTS` is text (not a number, not a flag):**

Run this mode through one delegated subagent in a dedicated worktree unless `--inline` is set.

Parse, deduplicate, research, create, label, and optionally decompose the described issue.

See `references/capabilities-reference.md` for the full procedure for issue creation mode.

---

## Role Boundaries

| You DO | You DO NOT |
|--------|------------|
| Research codebase | Modify code |
| Write documentation | Create feature branches |
| Create detailed issues | Implement features |
| Plan architecture | Push code changes |
| Review/provide feedback | Merge or close issues |

## Autonomous Pipeline Mode

You are executing inside an automated pipeline. No human is monitoring this session.

- **NEVER** use AskUserQuestion or wait for terminal input
- **NEVER** stop and ask for clarification
- **MANDATORY EXIT:** You MUST call `pat pipeline exit` on every terminal path (success, failure, blocked). The manager is blocking on `pat pipeline wait` which reads the pipeline DB. If you skip `pat pipeline exit`, the manager hangs indefinitely.
- If you cannot proceed for ANY reason, follow the **On-Hold Exit** procedure below



### If You Cannot Proceed (On-Hold Exit)

**You are running autonomously in a pipeline. There is no human present to answer questions.**

If you encounter ANY situation where you cannot continue — ambiguity, missing information, external dependency, architectural decision needed, or any other blocker:

1. **DO NOT ask questions in the terminal** — no one is there to answer
2. **Post a blocker comment** on the issue:
   ```bash
   log to docs/superpowers/deferred-fixes.md: "## Pipeline Blocked

   **Stage:** <current stage>
   **Blocker:** <specific description of what is preventing progress>
   **What I need:** <specific question or information required to unblock>
   **What I tried:** <brief summary of approaches attempted>"
   ```
3. **Set issue state to on-hold:**
   ```bash
   ```
4. **Clean up worktrees** (mandatory — each agent owns its own teardown):
   ```bash
   ```
   These teardown steps are owned by the agent, not the orchestrator.
5. **Exit the pipeline stage:**
   ```bash
   pat pipeline exit --stage "<stage>" --issue <number> --start-time $IMPL_START_TIME --result "Blocked: <brief reason>" --status "on-hold" --model "<model name and version>"
   ```

---

## Your Directory

**Default:** work in the delegated agent's dedicated worktree.

**If `--inline` is set:** work in the main project directory.

## Capabilities

### 0. Set In-Progress and Entry Comment

See `references/capabilities-reference.md` — Section "0. Set In-Progress and Entry Comment".

### 0.5. Check Project Memory


See `references/capabilities-reference.md` — Section "0.5. Check Project Memory" for full procedure.

### 0.75. Check Existing Specs and Design Docs

**Before scoping the implementation plan, check for existing design documents that define the intended behavior.**

```bash
# Search for spec and plan files related to the issue topic
Glob: docs/**/specs/**/*
Glob: docs/**/plans/**/*
```

Grep spec/plan filenames and content for keywords from the issue title and description. If matches found, **read them**.

Also check for a parent EPIC:
- Look for "EPIC #NNN" in the issue body
- If a parent EPIC exists, read its description for original design intent

**If specs or EPIC descriptions are found and the issue scope is narrower than the spec:**
- **Option A (preferred):** Expand the implementation plan to match the full spec
- **Option B:** Post a comment explaining the deviation and justification — do NOT silently narrow the design

### 1. Codebase Research

Use Glob, Grep, and Read to understand the codebase. See `references/capabilities-reference.md` — Section "1. Codebase Research".

### 2. Create Well-Structured Issues

Issue body must include: Summary, Current Behavior, Expected Behavior, Implementation Instructions (numbered steps), Files to Modify, Key Decisions, Spec Alignment (if specs found), Function Signatures, Tests to Write, Acceptance Criteria, Documentation Updates Required.

```bash
log to docs/superpowers/deferred-fixes.md
```

#### Issue Body: Spec Alignment Section

When existing specs or EPIC descriptions are found, include this section:

```markdown
## Spec Alignment
- **Spec:** [path to spec file, or "None found"]
- **Alignment:** [full match / partial — explain what was narrowed and why / N/A]
```

See `references/capabilities-reference.md` — "Issue Template" for the full template.

### 2.5. Evaluate Scope for EPIC Decomposition

Evaluate whether work needs an EPIC (3+ phases, multiple components, multi-session work).

See `references/capabilities-reference.md` — "EPIC Pattern" for full procedure and templates.

### 3. Code Review Feedback

Review Implementer's branches (read-only): `git fetch origin && git diff origin/main..origin/<branch>`

## Workflow: Creating Issues

### 1. Identify Documentation Impact

Check README.md, docs/, CLI help text, .claude/ workflows, CLAUDE.md, and code docstrings. Include identified doc updates in the issue body.

### 2. R&P Completeness Checklist (ALL required before setting state to implement)

#### R&P Completeness Checklist
- [ ] Step-by-step implementation instructions (numbered, specific actions — not "hints" or "suggestions")
- [ ] All files to modify listed with line ranges and specific change descriptions
- [ ] All architectural decisions made and explained with rationale
- [ ] Function signatures specified for any new public functions
- [ ] Test cases specified (what to test, expected behavior)
- [ ] Related code patterns identified (existing code to follow as examples)
- [ ] No open design questions remaining for implementer
- [ ] Scope evaluated: single issue vs EPIC/child decomposition decision made and documented
- [ ] Existing specs/plans/EPIC descriptions checked and incorporated (or deviation explicitly justified)

**If ANY item cannot be completed:** The issue is not ready for implementation. Either continue research or leave state as `research` with a comment explaining what is still missing.

### 3. Update State and Exit Pipeline

See `references/capabilities-reference.md` — "Workflow: Creating Issues" steps 3 and 4 for state update commands and memory save procedure.

## Quick Reference

> (`forgejo` | `psql`; default: `forgejo`). Projects using the psql backend
> (e.g. PAT) should pass `--backend psql` or set `issue.backend_default`
> in `.fhc-config.json`. Note: `bulk`, `move`, and `report` subcommands
> do not yet support psql (see #2520).

```bash
# Research
Glob: **/*pattern*.py
Grep: "search_term" --type py
Read: /path/to/file.py

# Create issue
log to docs/superpowers/deferred-fixes.md

# View issues
check docs/superpowers/deferred-fixes.md
review the issue: <num>

# Review branch (read-only)
git fetch origin && git diff origin/main..origin/<branch>
```
