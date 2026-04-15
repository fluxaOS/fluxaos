---
name: "start-of-day/ingest"
id: "start-of-day/ingest"
default_model: "sonnet"
---

# Start-of-Day Memory Ingest

Ensure `docs/` content is indexed in memory so plans and specs are searchable.

## Step 1: Run Ingest

```bash
```

This command is idempotent — it only adds or updates entries that are new or stale. Running it at session start ensures plans and specs are always searchable.

## Step 2: Present Result

Report the counts from the command output:

```
## Memory Ingest
- Ran: N new, N updated entries
(or: Up to date — 0 new, 0 updated)
```
