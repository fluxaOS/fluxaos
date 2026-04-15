---
model: sonnet
---
# Restore Point

Create, list, restore, or clean git-based restore points (tagged snapshots) for safe rollback.


## Instructions

Use `/restore-point <subcommand>` to manage restore points before starting work on an issue. This provides a safety net to roll back to a known-good state if an implementation goes wrong.

Restore points use lightweight git tags with the `restore/` prefix for namespace isolation.

## Subcommands

### create [label]

Create a restore point at the current HEAD.

```bash
# 1. Check for uncommitted changes
git status --porcelain

# 2. If there are uncommitted changes, stash them with a restore-point message
git stash push -u -m "restore-point: pre-save stash"

# 3. Create a lightweight tag with timestamp and optional label
#    Format: restore/<YYYY-MM-DD>-<label> or restore/<YYYY-MM-DD>-<HH-MM-SS>
#    Example: restore/2026-01-27-issue-728 or restore/2026-01-27-14-30-00
git tag "restore/<date>-<label>"

# 4. Report the restore point details
git log -1 --format="Restore point created: %h %s" HEAD
git branch --show-current
```

**Behavior:**
- Generate a tag name using today's date and the optional label (default: current timestamp)
- If uncommitted changes exist, stash them with message `restore-point: pre-save stash`
- Record the current branch name and commit SHA in the output
- Confirm creation with the tag name, branch, and commit details

### list

List all existing restore points.

```bash
# Show all restore/* tags with dates and commits
git tag -l "restore/*" --sort=-creatordate --format="%(refname:short) %(creatordate:short) %(objectname:short)"
```

**Behavior:**
- Show all tags matching `restore/*` sorted by most recent first
- Display tag name, creation date, and associated commit SHA
- If no restore points exist, inform the user

### restore [label]

Restore the working tree to a previous restore point.

```bash
# 1. Check for uncommitted changes first
git status --porcelain

# 2. If uncommitted changes exist, WARN the user and ask for confirmation
#    These changes will be lost unless stashed first

# 3. Look up the restore point tag
git rev-parse "restore/<label>" --verify

# 4. Reset to the restore point
git checkout "restore/<label>"
# Or if the user wants to stay on the current branch:
git reset --hard "restore/<label>"

# 5. If a restore-point stash exists, offer to pop it
git stash list | grep "restore-point: pre-save stash"
# If found, ask user if they want to restore the stashed changes
git stash pop
```

**Behavior:**
- If no label is provided, show available restore points and ask which to restore
- If there are uncommitted changes, warn the user and ask for confirmation before proceeding
- Reset the working tree to the tagged commit
- Check for an associated `restore-point: pre-save stash` entry and offer to pop it
- **NEVER force-reset without user confirmation if there are uncommitted changes**

### clean [--all]

Remove restore point tags.

```bash
# Remove a specific restore point
git tag -d "restore/<label>"

# Remove ALL restore points
git tag -l "restore/*" | xargs -I {} git tag -d {}
```

**Behavior:**
- Without `--all`: ask which restore point to remove (show list first)
- With `--all`: remove all `restore/*` tags after user confirmation
- Report how many restore points were removed

## Safety Notes

- Restore points are local-only (tags are not pushed to remote)
- Creating a restore point does NOT create a commit
- The `restore` subcommand with `git reset --hard` is destructive - always confirm with the user
- Stash entries created by restore-point use the message `restore-point: pre-save stash` for identification

Now execute the requested restore-point operation.
