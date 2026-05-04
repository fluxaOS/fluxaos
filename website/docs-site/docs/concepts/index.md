---
sidebar_position: 1
title: What is fluxaOS?
---

# What is fluxaOS?

fluxaOS is an AI orchestration OS — a config-driven engine that runs pipelines of AI-powered stages against issues (features, bugs, tasks). You describe what you want done; fluxaOS routes each issue through your pipeline, runs the right AI tool at each step, checks the output against your rules, and moves the issue forward automatically.

The key idea: fluxaOS is agnostic. It never knows what a "research" stage does or what "Claude Code" is. It reads your configuration from the database — which skills exist, which drivers run them, how they're wired together — and executes whatever you've configured. You can change the entire pipeline without touching code.

**The core concepts you need:**

- [Skills](./skills) — what to do (a prompt template)
- [Drivers](./drivers) — how to run it (a CLI tool configuration)
- [Pipelines](./pipelines) — the sequence of steps
- [Gates](./gates) — the quality checkpoint after each step
- [Signals](./signals) — how a stage tells the pipeline what happened
- [State vs Status](./state-vs-status) — the two independent fields on every issue

**Ready to use it?** Start with the [First Setup guide](../guides/first-setup).
