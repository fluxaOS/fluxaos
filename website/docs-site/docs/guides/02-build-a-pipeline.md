---
sidebar_position: 2
title: "Guide 2: Build a Pipeline"
---

# Guide 2: Build a Pipeline

A pipeline is an ordered sequence of stages. Each stage runs a skill using a driver, then evaluates a gate to decide what happens next. This guide walks through creating a pipeline and adding stages.

## Step 1: Create a pipeline

1. Navigate to **Settings → Pipeline Settings**
2. Click **New Pipeline**
3. Enter:
   - **Name**: e.g., "Standard Dev"
   - **Description**: optional
4. Click **Create**

## Step 2: Add stages

1. On the Pipeline Settings page, find your new pipeline and click **Stages**
2. Click **Add Stage**
3. For each stage, fill in:
   - **Stage Name**: e.g., "research" — this should match the issue state the stage corresponds to
   - **Skill**: select from the skills you created in Guide 1
   - **Driver**: select the driver you configured in Guide 1
   - **Gate Mode**: how to validate output after the stage runs:
     - `auto` — always proceed without evaluating any rules (best for early development)
     - `rules` — evaluate the ruleset; route based on results
     - `hold` — always pause and wait for your manual approval
4. Click **Create**
5. Repeat to add all the stages you need (e.g., research → implement → review → deploy)

The stages run in the order you create them.

## Step 3: Set this pipeline as default

The default pipeline is triggered automatically when you click "Run Stage" on an issue.

1. On the Pipeline Settings page, find your pipeline
2. Click **Set as default**

## Example: a minimal 2-stage pipeline

| Stage | Skill | Driver | Gate mode |
|-------|-------|--------|-----------|
| research | research | Claude Code | auto |
| implement | implement | Claude Code | hold |

The `hold` gate on "implement" means you'll manually approve each implementation before it proceeds. Good for getting started.

## Adding gate rules

Gate rules let you define conditions that must pass before a stage proceeds. For example, to hold if a stage takes longer than 2 hours:

1. Set **Gate Mode** to `rules`
2. Add a rule:
   - Field: `timing.duration_sec`
   - Operator: `less_than`
   - Value: `7200`
   - Severity: `block`
   - On Fail: `hold`
   - Label: "2 hour cap"

For the full list of available fields and operators, see [Gate Rules](../reference/gate-rules).

---

**Next:** [Guide 3: Add an Issue →](./add-an-issue)
