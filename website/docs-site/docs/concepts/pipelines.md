---
sidebar_position: 4
title: Pipelines
---

# Pipelines

A pipeline is an ordered sequence of stages that processes an issue. Each stage runs a skill (the prompt) using a driver (the CLI tool), then evaluates a gate (the quality check) to decide what to do next.

Pipelines are config-driven. Operators define them in the UI/database: create a pipeline, add stages, assign a skill and driver to each stage, and set routing/gate behavior. When you trigger a run, the daemon executes the DB-owned stage graph — pausing at manual gates, routing to rework on failure, routing to deploy on approval, and moving the issue through its configured states as stages complete.

**A stage has:**

| Field | Purpose |
|-------|---------|
| Name | Descriptive label (often matches an issue state: "research", "implement") |
| Skill | What the AI does |
| Driver | Which CLI tool runs it |
| Gate mode | How to validate the output (`auto`, `rules`, `hold`, `manual`, `skip`) |
| Gate rules | Conditions that determine proceed / hold / rework / abort |
| Timeout | Seconds before the stage is force-killed |

**Pipeline source of truth:** Pipelines are database-backed. The orchestrator reads stages and routing from the `pipeline_stage` table (`onPass`, `onFail`, and `fallback`), not from YAML playbook files. The old file-backed path was removed; do not document new operator flows against file-backed pipeline definitions.

**Where to configure:** Settings → Pipeline Settings → New Pipeline

For a step-by-step walkthrough, see [Guide 02: Build a Pipeline](../guides/build-a-pipeline).
