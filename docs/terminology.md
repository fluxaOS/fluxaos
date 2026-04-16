# fluxaOS Terminology

Single source of truth for domain vocabulary. When you introduce a new term, add an entry here in the same PR.

## Entries

### driver

- **What it is:** A database row describing one AI CLI tool and how fluxaOS invokes it — binary name, flags, prompt transport, output format, env vars.
- **Table:** `driver`
- **Example:** The seed row `Claude Code` has `binary="claude"`, `modelFlag="--model"`, `promptTransport="stdin"`, `outputFormat="stream-json"`.
- **Formerly known as:** `harness_catalog` / "harness" (pre-R-UI-1).

### skill

- **What it is:** A named job definition with a prompt template. When a pipeline stage runs, the skill's prompt text is what fluxaOS sends to the driver's CLI.
- **Table:** `skill`
- **Example:** `research` skill with prompt "Read the issue, find references to the affected code, output a Markdown plan."

### pipeline

- **What it is:** An ordered sequence of stages that processes an issue.
- **Table:** `pipeline`
- **Example:** `Standard Dev` pipeline with stages research → implement → review → deploy.

### pipeline_stage

- **What it is:** One step in a pipeline. Binds together a skill (what to do) and a driver (how to call the CLI). Optionally specifies a gate.
- **Table:** `pipeline_stage`
- **Example:** Stage #2 of Standard Dev, name "implement", `skill_id` → implement skill, `driver_id` → Claude Code.

### pipeline_run

- **What it is:** One execution of a pipeline against an issue. Parent of multiple stage_runs.
- **Table:** `pipeline_run`
- **Example:** A run of Standard Dev against issue #1 that completed with total cost $0.0842.

### stage_run

- **What it is:** One execution of a single stage inside a pipeline run. Records the skill+driver that ran, exit code, cost, tokens, and signal metadata.
- **Table:** `stage_run`
- **Example:** Research stage run for pipeline_run X, exit code 0, cost $0.02, emitted signal `proceed`.

### issue

- **What it is:** A unit of work in a project — a feature, bug, task. The central artifact pipelines operate on.
- **Table:** `issue`
- **Example:** Issue #1 "Add health check endpoint with build metadata."

### issue_state

- **What it is:** The lifecycle phase of an issue (Research, Implement, Review, Complete, etc.). Catalog-driven, project-scoped.
- **Table:** `issue_state`
- **Example:** Issue #1 is in state `research`.

### issue_status

- **What it is:** The activity status of an issue within its state (Open, Running, Blocked, etc.).
- **Table:** `issue_status`
- **Example:** Issue #1 state=research, status=open.

### gate

- **What it is:** A decision point between stages. Evaluates rules against context to produce a verdict (proceed, hold, rework, abort).
- **Table:** `stage_gate_result`
- **Example:** Research→Implement gate verdict `proceed` on stage_run X.

### routing_profile

- **What it is:** Rules that map (stage, driver) to a provider+model selection at runtime.
- **Table:** `routing_profile` + `routing_rule`
- **Example:** Default profile routes every stage to Anthropic's claude-sonnet-4-6 via the Claude Code driver.

---

## How to add an entry

When a PR introduces a new domain term (new table, new enum value, new concept), append an entry here using the same format:

```
### term_name

- **What it is:** One-sentence plain-English definition.
- **Table/Location:** Where it lives in code/schema.
- **Example:** Concrete instance with values.
- **Formerly known as:** (optional) prior names, for continuity.
```

Reviewers: PRs introducing new terms without a glossary entry should be held.
