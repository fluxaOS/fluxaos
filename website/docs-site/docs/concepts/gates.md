---
sidebar_position: 5
title: Gates
---

# Gates

A gate is a quality checkpoint that runs after a stage completes. It evaluates conditions against the stage's output and produces a verdict that tells the pipeline what to do next.

Gates decouple quality policy from execution. You don't need to change the skill or driver to add a cost cap or a retry limit — you change the gate rules.

**Gate modes:**

| Mode | Behavior |
|------|---------|
| `auto` | Always proceed without evaluating any rules |
| `rules` | Evaluate the ruleset; route based on results |
| `hold` | Always pause and wait for manual approval |
| `manual` | Alias for `hold` |
| `skip` | Bypass this gate entirely; always proceed |

**Gate verdicts:**

| Verdict | Meaning |
|---------|---------|
| `proceed` | Move to the next stage |
| `hold` | Pause the run; wait for human approval, rework, or abort |
| `rework` | Route to the configured rework stage |
| `abort` | Stop the pipeline immediately; mark the run failed |

**Important:** A stage can exit with code 0 (success) and still fail its gate. Gate failure is independent of whether the subprocess ran cleanly. See [Signal Types](../reference/signal-types) for how skills influence gate outcomes.

For rule syntax and field reference, see [Gate Rules](../reference/gate-rules).
