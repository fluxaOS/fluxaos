---
sidebar_position: 1
title: "Guide 1: First Setup"
---

# Guide 1: First Setup

Before you can run a pipeline, you need two things configured: a **driver** (which AI CLI tool to use) and a **skill** (what to ask it to do). This guide walks through both.

## Prerequisites

- fluxaOS is running and you can reach the UI
- The daemon is running (if you see pipeline runs stuck at "Pending", the daemon is down — see [Daemon reference](../reference/daemon))
- You have an org, user, and project already created (these are seeded by default)

## Step 1: Configure a driver

A driver tells fluxaOS how to invoke an AI CLI tool. fluxaOS ships with a seeded "Claude Code" driver. If you want to use it as-is, skip to Step 2.

To create a new driver or review the existing one:

1. Navigate to **Settings → Drivers**
2. Click **New Driver** (or click an existing driver to expand it)
3. Fill in the required fields:
   - **Name**: A display name (e.g., "Claude Code")
   - **Slug**: A unique machine-readable ID (e.g., `claude-code`)
   - **Binary**: The CLI command (e.g., `claude`)
   - **Prompt transport**: How the prompt is delivered — use `stdin` for Claude Code
   - **Output format**: Use `stream-json` for Claude Code
   - **Context layout**: JSON describing which files to write to the workspace. For Claude Code, use:
     ```json
     { "instructionsFile": "CLAUDE.md", "contextFile": "context.md" }
     ```
4. Click **Create** (or **Save** if editing)
5. Make sure **Is Enabled** is checked — disabled drivers can't be used in pipeline stages

For a full field reference, see [Drivers](../concepts/drivers).

## Step 2: Create a skill

A skill is the prompt template that gets sent to the driver. Start simple.

1. Navigate to **Settings → Skills**
2. Click **New Skill**
3. Fill in:
   - **Name**: Something descriptive (e.g., "research")
   - **Scope**: `global` (available across all projects) or `project` (this project only)
   - **Prompt template**: The prompt to send. Example for a research skill:
     ```
     Read the issue carefully. Identify the affected code areas, any relevant context,
     and what a good implementation approach would look like. Write a concise plan.
     Output your result document when done.
     ```
4. Click **Create**

Repeat to create additional skills (e.g., "implement", "review") as needed for your pipeline.

---

**Next:** [Guide 2: Build a Pipeline →](./build-a-pipeline)
