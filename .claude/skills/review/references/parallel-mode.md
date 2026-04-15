

# Parallel Mode Reference

## Determining Agent Count

**If `--parallel N` (number provided):** Use exactly N agents.

**If `--parallel` (no number):** You decide based on context:
1. Query eligible issues using the issue selection step below
2. Consider:
   - Number of eligible issues available
   - Review is moderate-weight — can support 3-5 concurrent agents
   - Diminishing returns beyond 5 agents
3. Announce your decision: "Found X eligible issues. Spawning Y agents — [brief reason]."

If fewer eligible issues than requested agents, reduce to match:
> "Requested N agents but only M eligible issues found. Spawning M."

## Issue Selection

Use the **same filtering and prioritization** as `--next` mode:
- **Filter:** state `review`, exclude EPICs
- **Prioritize:** critical → high → medium → low → none, then oldest first
- **Select** the top N issues (or top Y if LLM-determined)

## Agent Prompt Template

Fill in per issue when spawning parallel review agents:

```
Review issue #<NUMBER> for the fluxaos project.

You are in an isolated worktree. Do NOT create another worktree.

Follow the review skill workflow:
1. Run: flu issue view <NUMBER>
2. Find the branch name from the "Ready for Review" comment
3. Requirements Fulfillment Gate:
   - Read acceptance criteria from the issue
   - Read parent epic if referenced
   - Cross-reference each criterion against: git diff origin/main..origin/<branch>
   - STOP if any criterion is unmet — comment and set state to rework: `flu issue state <NUMBER> rework`
4. Review code:
   - git fetch origin && git diff origin/main..origin/<branch>
   - Check standards, no hardcoded values, canonical helpers used
5. Verify functional verification evidence in implementer's comment
6. Check branch freshness and auto-rebase if stale
7. Run the verify-issue skill with <NUMBER>
8. Verdict:
   - APPROVE: Comment "Approved", set state to deploy: `flu issue state <NUMBER> deploy`
   - REJECT: Comment "Changes Requested", set state to rework: `flu issue state <NUMBER> rework`

FAILURE PATH: If you cannot complete review for any reason (blocked, missing branch, unresolvable state):
- Post a blocker comment explaining what failed and why
- Set state to on-hold: flu issue state <NUMBER> on-hold
- Run fhc git worktree-clean BEFORE exiting (mandatory — unconditional)
- Do NOT leave the worktree unclean
```

## Monitoring and Reporting

After all agents have exited and torn down their own worktrees, summarize results:

```
## Parallel Review Summary
| Issue | Status | Verdict |
|-------|--------|---------|
| #X — title | ✅ Approved | state: deploy |
| #Y — title | ⚠️ Changes Requested | [brief reason] |
| #Z — title | ❌ Failed | state: on-hold, worktree cleaned |

Next: Run the deploy skill with --next to merge approved issues one at a time.
```

Each agent cleans its own worktree before exiting. The final sweep is only a safety net for stragglers, not the primary cleanup owner.

## Mandatory Safety Sweep (post-completion)

After all agents have reported and all agents have already exited, run a final safety sweep to catch any stragglers:
```bash
fhc git worktree-clean
```

This is a **safety net**, not the primary cleanup. Agents are responsible for cleaning their own worktrees before exiting.
