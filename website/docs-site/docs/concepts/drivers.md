---
sidebar_position: 3
title: Drivers
---

# Drivers

A driver is the *how* of a pipeline stage — it describes one AI CLI tool and how fluxaOS invokes it. Where a skill defines what the AI should do, the driver defines which binary runs it, how to pass the prompt, and what output format to expect.

fluxaOS ships with a seeded Claude Code driver (`binary: claude`). You can add drivers for any AI CLI tool by configuring the fields below.

**Key fields:**

| Field | Purpose |
|-------|---------|
| Binary | The CLI command to invoke (e.g., `claude`, `openai`) |
| Prompt transport | How the prompt is delivered: `stdin`, `argv`, or `file` |
| Output format | How to parse output: `stream-json` or `text` |
| Model flag | CLI flag for selecting the model (e.g., `--model`) |
| Env vars | Environment variables to inject at run time (e.g., API keys) |
| Context layout | Which files to write to the workspace before the stage runs |
| Is enabled | Toggle — disabled drivers cannot be selected for new stages |

**Where to configure:** Settings → Drivers → New Driver

For a step-by-step walkthrough, see [Guide 01: First Setup](../guides/first-setup).
