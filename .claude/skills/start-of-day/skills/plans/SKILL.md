---
name: "start-of-day/plans"
id: "start-of-day/plans"
description: "Surface in-progress implementation plans from docs/superpowers/specs/ and docs/superpowers/plans/ so the agent knows what was being designed or built before this session."
default_model: "sonnet"
---

# Start-of-Day Plans

Surface active implementation plans and design specs so the agent understands what's in flight.

## Step 1: Find Recent Specs and Plans

Run from the repo root. If needed: `cd $(git rev-parse --show-toplevel)`

```bash
# Specs modified in the past 7 days
SENTINEL=$(mktemp)
touch -d "7 days ago" "$SENTINEL" 2>/dev/null || touch -A -1680000 "$SENTINEL"

echo "=== Recent specs (past 7 days) ==="
find docs/superpowers/specs -name "*.md" -newer "$SENTINEL" 2>/dev/null | sort -r

echo "=== Recent plans (past 7 days) ==="
find docs/superpowers/plans -name "*.md" -newer "$SENTINEL" 2>/dev/null | sort -r

rm -f "$SENTINEL"

echo "=== All specs ==="
ls -t docs/superpowers/specs/*.md 2>/dev/null

echo "=== All plans ==="
ls -t docs/superpowers/plans/*.md 2>/dev/null
```

## Step 2: Read Recent Files

For each file modified in the past 7 days, read it and extract:
- **Goal** (usually in the first few lines or a "Goal:" field)
- **Status** (look for "Status:" in frontmatter or a status section)
- **Next steps** (look for "What's Next", "Next Steps", "Remaining", or open checkboxes `- [ ]`)

## Step 3: Present

```
## In-Progress Plans

### Recent (past 7 days)
- YYYY-MM-DD-filename.md
  Goal: [one line]
  Status: [Draft | In Progress | Approved | etc.]
  Next: [first unchecked step or next milestone]

### Older Plans & Specs
(files NOT already listed in Recent above — titles only, read on demand)
- YYYY-MM-DD-filename.md
- YYYY-MM-DD-filename.md
```

If no specs or plans exist yet: "No plans found in docs/superpowers/. This project may not have started using specs yet."
