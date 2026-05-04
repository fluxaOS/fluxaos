---
sidebar_position: 2
title: Skills
---

# Skills

A skill is a named job definition — the *what* of a pipeline stage. At its core, a skill is a prompt template: the exact text sent to an AI driver when that stage runs.

Skills are reusable. The same "research" skill can be used in multiple pipelines. Skills can be scoped globally (available across all projects in your org) or scoped to a specific project.

**Key fields:**

| Field | Purpose |
|-------|---------|
| Name | Display name (e.g., "research", "implement") |
| Prompt template | The prompt text sent to the driver |
| Scope | `global` (org-wide) or `project` (this project only) |
| Description | Human-readable explanation of what the skill does |

The prompt template is plain text. The driver receives it as-is — fluxaOS injects context (issue details, run metadata) via context files in the workspace, not via template variables in the prompt itself.

**Where to configure:** Settings → Skills → New Skill
