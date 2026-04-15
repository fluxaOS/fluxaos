---
model: opus
---
# Agent Teams — Multi-Agent Orchestration

Coordinate multiple Claude Code instances working as a team. One session (the lead) creates the team, assigns tasks, and synthesizes results. Teammates work independently in their own context windows and communicate directly with each other via a shared mailbox.

## Prerequisites

Agent teams require:
- Claude Code v2.1.32+
- The `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` environment variable set to `1` in settings.json or shell

Before spawning a team, verify the feature is enabled:

```bash
# Check settings.json for the env var
grep -r "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS" ~/.claude/settings.json 2>/dev/null
```

If not enabled, tell the user to add it to their settings.json:
```json
{
  "env": {
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  }
}
```

## When to Use Agent Teams vs Subagents

| Use Agent Teams when... | Use Subagents when... |
|---|---|
| Teammates need to discuss and challenge each other | Workers just report results back |
| Multi-perspective exploration (UX, architecture, security) | Focused single-purpose tasks |
| Competing hypotheses that benefit from debate | Independent research that doesn't need cross-talk |
| Cross-layer coordination (frontend, backend, tests) | Quick parallel lookups |

Agent teams use significantly more tokens than subagents. Only use them when inter-agent communication adds real value.

## How to Orchestrate a Team

### Step 1: Design Roles with Clear Scope

Every teammate needs:
- **A distinct perspective** — what lens they apply (UX, architecture, security, devil's advocate)
- **Clear boundaries** — what they own and don't own
- **Enough context** — teammates don't inherit the lead's conversation history, so include task-specific details in the spawn prompt

Bad role design:
```
"Research the system" (too vague, overlapping scope)
```

Good role design:
```
"Analyze the authentication flow from a security perspective.
Focus on token handling, session management, and input validation.
The app uses JWT tokens stored in httpOnly cookies.
Challenge any assumptions the architecture teammate makes about trust boundaries."
```

### Step 2: Spawn the Team

Tell Claude to create the team with specific roles. Be explicit about:
- Number of teammates (3-5 is the sweet spot)
- Each teammate's role and perspective
- How they should interact (challenge each other, share findings, etc.)
- What the final deliverable looks like

Example prompt structure:
```
Create an agent team to [explore/investigate/design] [topic]. Spawn [N] teammates:
- One focused on [perspective A] — [specific scope and focus areas]
- One focused on [perspective B] — [specific scope and focus areas]
- One acting as [perspective C] — [specific scope and responsibilities]

Have them discuss and challenge each other's findings via messaging.
When they're done, synthesize their findings into [deliverable format].
```

### Step 3: Size Tasks Appropriately

Create 5-6 tasks per teammate. Tasks should be:
- **Self-contained** — each produces a clear deliverable
- **Non-overlapping** — no two teammates edit the same files
- **Right-sized** — not so small that coordination overhead dominates, not so large that teammates work too long without check-ins

### Step 4: Let Teammates Coordinate

The lead creates tasks and teammates self-claim them. Teammates communicate directly with each other — they don't need to route everything through the lead.

Key coordination patterns:
- **Challenge pattern**: teammates explicitly try to find flaws in each other's proposals
- **Build-on pattern**: one teammate's output becomes input for another
- **Converge pattern**: independent exploration followed by synthesis

### Step 5: Synthesize and Report

After all teammates finish, the lead synthesizes findings into a structured report:

```markdown
# [Topic] — Team Investigation Report

## Executive Summary
[Key findings and recommendations in 2-3 sentences]

## Perspectives

### [Role A]: [Teammate Name]
- Key findings
- Recommendations
- Concerns raised

### [Role B]: [Teammate Name]
- Key findings
- Recommendations
- Concerns raised

### [Role C]: [Teammate Name]
- Key findings
- Challenges to other perspectives
- Alternative approaches suggested

## Points of Agreement
[Where all perspectives aligned]

## Points of Contention
[Where perspectives diverged, with reasoning from each side]

## Recommended Path Forward
[Synthesized recommendation incorporating all perspectives]
```

## Common Team Patterns

### Exploratory Research
```
Create an agent team to explore [topic] from different angles:
- One on user experience and workflows
- One on technical architecture and feasibility
- One playing devil's advocate, challenging assumptions

Have them discuss and challenge each other. Synthesize findings when done.
```

### Competing Hypotheses (Debugging)
```
[Bug description]. Spawn 3-5 teammates to investigate different hypotheses.
Have them talk to each other to try to disprove each other's theories,
like a scientific debate. Update findings with whatever consensus emerges.
```

### Parallel Code Review
```
Create an agent team to review [PR/module]. Spawn three reviewers:
- One focused on security implications
- One checking performance impact
- One validating test coverage
Have them each review and report findings.
```

### Cross-Layer Feature Work
```
Create a team to implement [feature]:
- Frontend teammate owns UI components
- Backend teammate owns API endpoints
- Test teammate owns integration tests
Each owns their files — no overlapping edits.
```

## Interaction During Execution

### Monitor Progress
- **In-process mode**: press `Shift+Down` to cycle through teammates
- **Split-pane mode**: click into a teammate's pane
- Press `Ctrl+T` to toggle the task list

### Redirect a Teammate
Message a teammate directly to course-correct:
```
You're going too deep on [X]. Focus on [Y] instead and share your
findings with the architecture teammate.
```

### Handle Stuck Teammates
If a teammate stops on errors, either give them instructions directly or spawn a replacement to continue the work.

### Wait for Completion
If the lead starts implementing instead of waiting:
```
Wait for your teammates to complete their tasks before proceeding.
```

## Team Management

### Display Modes
- **In-process** (default): all teammates in one terminal, cycle with `Shift+Down`
- **Split panes**: each teammate gets its own pane (requires tmux or iTerm2)

### Shutdown

The lead owns the teardown sequence. Perform these steps in order when all work is complete:

1. **Per-teammate cleanup:** Ask each teammate to clean its own worktree before exiting.
2. **Shut down teammates:** Ask the lead to shut down individual teammates when their teardown is complete.
3. **Worktree cleanup:** After all teammates have exited, run from the main repo root:
   ```bash
   git worktree prune
   ```
4. **Branch cleanup (conditional):** Only delete branches that are merged and safe to remove. Preserve branches that are open for review or have unpushed commits.
   ```bash
   git branch -d <branch-name>
   git push origin --delete <branch-name>
   ```
5. Always clean up via the lead — never from a teammate.

### Permissions
Teammates inherit the lead's permission settings at spawn time. Pre-approve common operations in permission settings before spawning to reduce interruption.

## Constraints and Limitations

- **Experimental feature** — disabled by default, requires env var
- **No session resumption** — `/resume` and `/rewind` don't restore in-process teammates
- **One team per session** — clean up before starting a new team
- **No nested teams** — teammates cannot spawn their own teams
- **Lead is fixed** — cannot transfer leadership
- **File conflicts** — two teammates editing the same file causes overwrites; design tasks to avoid this
- **Token cost** — scales linearly with number of teammates; each has its own context window
