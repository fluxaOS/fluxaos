---
model: sonnet
---
# Start of Day

Orient the agent at the start of a session by gathering recent activity, in-progress plans, and ensuring memory is current.

## Usage

```
/start-of-day              # Run all three: brief → plans → ingest
/start-of-day brief        # 72h git + issues + memory + file mtimes + repo state only
/start-of-day plans        # In-progress specs and plans only
/start-of-day ingest       # Memory doc freshness check only
/start-of-day --repo OWNER/REPO  # Run against a different project's issues/PRs
```

**Arguments:** `$ARGUMENTS`

## Routing

Parse `$ARGUMENTS`:

```
if first word of $ARGUMENTS is "brief"  → invoke start-of-day/brief with remaining args
if first word of $ARGUMENTS is "plans"  → invoke start-of-day/plans with remaining args
if first word of $ARGUMENTS is "ingest" → invoke start-of-day/ingest with remaining args
otherwise                               → run all three in sequence (see below)
```

## Full Run (no arguments)

Run in sequence:

### 1. Brief

Invoke the `start-of-day/brief` sub-skill with any `--repo` flag from `$ARGUMENTS`.

### 2. Plans

Invoke the `start-of-day/plans` sub-skill.

### 3. Ingest

Invoke the `start-of-day/ingest` sub-skill.

### 4. Ready Summary

After all three complete, print a one-line summary:

```
Session oriented. N issues open, repo [clean | dirty: N changes], N plans in flight.
```

Pull the counts from the sub-skill outputs:
- "N issues open" — from brief's Open Issues section
- "repo clean/dirty" — from brief's Repo State section
- "N plans in flight" — count of recent (past 7 days) items from plans output

### 5. Write Session Marker

Record that the session started so `/end-of-day` can calculate the session window:

```bash
flu memory add session "start-of-day" \
  --tags "session-start" \
  --body "Session started at $(date -Iseconds)"
```
