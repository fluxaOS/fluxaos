---
sidebar_position: 4
title: Pipelines
---

# Pipelines

A pipeline is an ordered sequence of stages that processes an issue. Each stage runs a skill (the prompt) using a driver (the CLI tool), then evaluates a gate (the quality check) to decide what to do next.

Pipelines are config-driven. You define them in the UI: create a pipeline, add stages, assign a skill and driver to each stage, and set a gate mode. When you trigger a run, the orchestrator executes the stages in order — pausing at manual gates, routing to rework on failure, and moving the issue through its states as stages complete.

**A stage has:**

| Field | Purpose |
|-------|---------|
| Name | Descriptive label (often matches an issue state: "research", "implement") |
| Skill | What the AI does |
| Driver | Which CLI tool runs it |
| Gate mode | How to validate the output (`auto`, `rules`, `hold`, `manual`, `skip`) |
| Gate rules | Conditions that determine proceed / hold / rework / abort |
| Timeout | Seconds before the stage is force-killed |

**Pipeline types:** The standard pipeline is configured in the UI (database-backed stages). Advanced users can also define pipelines as YAML playbooks — see [Playbook Schema](../reference/playbook-schema) for the format.

**Where to configure:** Settings → Pipeline Settings → New Pipeline

For a step-by-step walkthrough, see [Guide 02: Build a Pipeline](../guides/build-a-pipeline).
