---
model: sonnet
---
# Git Finish Workflow

Complete the current work with a single command - handles commit, push, PR, merge, and cleanup.

## Usage

### Mode 1: Quick Fix (no issue, auto-stage)
```bash
flu git finish -a -t "Fix typo in README"
```
For quick fixes when you're not working on an issue.

### Mode 2: Issue Completion (manual stage)
```bash
git add src/foo.py config/bar.json
flu git finish 433
```
For completing work started with the implement skill.

## Pre-PR Compliance Check

**Before running `flu git finish`, verify ALL architectural standards are met:**

- [ ] **No hardcoded values** - Paths, URLs, file lists all from config
- [ ] **Fail-fast errors** - No silent defaults or fallbacks
- [ ] **DRY** - Used existing helpers, no duplicate code
- [ ] **File sizes** - No file exceeds ~500 lines
- [ ] **Path helpers** - No `__file__` math outside `get_package_root()`

The pre-commit hook will **block commits** containing hardcoded paths, URLs, or DRY violations.

## Instructions

### Mode 1: Quick Fix Mode (`-a -t "title"`)

1. **Run the compliance check above** — fix any violations before proceeding.

2. **Run the CLI command:**

   For code changes (default — runs pre-commit hooks):
   ```bash
   flu git finish -a -t "<title>"
   ```

   For non-code changes (markdown, templates, docs — skips pre-commit hooks):
   ```bash
   flu git finish -a -n -t "<title>"
   ```

   The CLI handles: stash, update main, create branch, stage, commit, push, PR create, merge, and branch cleanup.

3. **Follow the [Post-Merge Steps](#post-merge-steps)** below (log verification, memory digest, version bump).

### Mode 2: Issue Completion Mode (`finish <issue-number>`)

**Prerequisites:** User should already be on a feature branch with changes staged.

1. **Fetch issue details and post entry comment**
   ```bash
   flu issue view <issue-number>
   ```
   Extract the issue title.

   ```bash
   # Post entry comment (REQUIRED — do this before any other work)
   IMPL_START_TIME=$(date +%s)
   flu issue comment <issue-number> --body "## Pipeline Activity

   | Field | Value |
   |-------|-------|
   | **Action** | Start Finish |
   | **Date/Time** | $(date '+%m/%d/%Y %H:%M %Z') |
   | **Model** | <model name and version> |"
   ```

2. **Stage changes** (always include config files to preserve web UI settings):
   ```bash
   git add config/ 2>/dev/null || true
   git add <other-changed-files>
   ```

3. **Run the CLI command:**

   For code changes (default):
   ```bash
   flu git finish <issue-number>
   ```

   For non-code changes (markdown, templates, docs):
   ```bash
   flu git finish <issue-number> -n
   ```

   The CLI handles: commit, push, PR create, merge, and branch cleanup.

4. **Follow the [Post-Merge Steps](#post-merge-steps)** below (log verification, memory digest, version bump).

5. **Add knowledge base comment to issue**

   Generate a detailed completion comment:
   ```bash
   flu issue comment <issue-number> --body "$(cat <<'EOF'
   Completed via PR #<pr-number>

   ## Changes Made
   [List files modified from git diff --stat]
   - Modified `path/to/file.py` - Brief description
   - Added `path/to/new.py` - Brief description

   ## Root Cause (for bugs)
   [Explain what caused the issue]

   ## Solution Approach
   [LLM-generated summary of what was done and why]

   ## Testing
   [What was verified]

   ## Usage (if applicable)
   [Show how to use the new feature or fix]
   ```bash
   flu command --example
   ```

   ## Files Changed
   - `path/to/file1.py` - Brief description
   - `path/to/file2.py` - Brief description
   EOF
   )"
   ```

6. **Close issue, update state, and post exit comment**
   ```bash
   flu issue close <issue-number>
   flu issue state <issue-number> completed
   ```



### EPIC Auto-Close Check

After closing an issue, the EPIC auto-close check runs automatically as part of `flu issue close`. No manual step needed.

If for any reason you closed an issue without using the CLI (e.g., via direct API call or Forgejo web UI), you can trigger the check by re-closing:

```bash
flu issue close <number>
```

**What this does:**
- Looks for `(EPIC #N)` in the issue title or `Part of EPIC #N` in the body
- If found, checks if all other children of that EPIC are closed
- If all children are closed, posts a summary comment and closes the EPIC
- Handles `wontfix`/closed children equally (both count as resolved)
- Only checks children in the same repository

   ```bash
   # Post exit comment (compute duration from IMPL_START_TIME captured at entry)
   IMPL_END_TIME=$(date +%s); DS=$((IMPL_END_TIME - IMPL_START_TIME))
   flu issue comment <issue-number> --body "## Pipeline Activity

   | Field | Value |
   |-------|-------|
   | **Action** | Stop Finish |
   | **Date/Time** | $(date '+%m/%d/%Y %H:%M %Z') |
   | **Model** | <model name and version> |
   | **Duration** | $((DS/3600)) hours, $(((DS%3600)/60)) mins, $((DS%60)) seconds |
   | **Result** | Completed. PR merged and issue closed. |
   | **Comments** | N/A |"
   ```

---

## Post-Merge Steps

**These steps apply to BOTH modes after a successful PR merge.**

### 1. Memory Digest

```bash
flu memory digest --issue <issue_number>
flu memory digest --pr <pr_number>
```

### 2. Log Verification — MANDATORY (NO EXCEPTIONS)

**You MUST check system and application logs after merge. Skipping is NOT permitted.**

**Project capabilities:** webapp=false, service_name=, has_logs=false

**If `false` is `false` AND `` is empty, skip the service log check — no service to check.**

**A. Service restart (if applicable):**

If `false` is `true`:
```bash
flu service webapp restart 2>/dev/null
sleep 5
```

**B. System log check:**

If `` is not empty:
```bash
sudo journalctl -u  --since "1 minute ago" --no-pager 2>/dev/null | grep -iE "error|exception|traceback|critical|fatal" | head -20
```

**C. Application log check:**

If `false` is `true`:


```bash
LOG_DIR=$(flu logs list 2>&1 | head -1 | sed -n 's/.*(\(.*\)).*/\1/p')
if [ -z "$LOG_DIR" ] || [ ! -d "$LOG_DIR" ]; then
    LOG_DIR="$(git rev-parse --show-toplevel 2>/dev/null || pwd)/logs"
fi
LOG_FILE=""
if [ -d "$LOG_DIR" ]; then
    LOG_FILE=$(ls -t "$LOG_DIR"/*.log 2>/dev/null | head -1)
fi
if [ -n "$LOG_FILE" ] && [ -f "$LOG_FILE" ]; then
    tail -50 "$LOG_FILE" | grep -iE "error|exception|traceback|critical|fatal" | head -20
fi
```

| Finding | Action |
|---------|--------|
| Errors caused by your changes | **FIX before proceeding** — do NOT continue to cleanup |
| Pre-existing errors | **File issue immediately** (`flu issue create --template quick-bug --title "[BUG] <component>: <what failed>" --body "<actual error output, file path, and details>"` then `flu issue update <number> --priority medium`) then proceed |
| No errors | Proceed |
| No log file / service not applicable | Proceed (not applicable) |

### 3. Worktree Cleanup (if applicable)

If working in a worktree, clean it up after merging:
```bash
# Check if in a worktree
WORKTREE_DIR=$(git rev-parse --show-toplevel)
MAIN_DIR=$(git worktree list | head -1 | awk '{print $1}')
if [ "$WORKTREE_DIR" != "$MAIN_DIR" ]; then
    BRANCH=$(git -C "$WORKTREE_DIR" rev-parse --abbrev-ref HEAD)

    # Agents run non-interactively. Always check unpushed commits explicitly first.
    git -C "$WORKTREE_DIR" log --oneline "origin/$BRANCH..$BRANCH"

    # Remove only when unpushed check is empty and the worktree is clean.
    git -C "$WORKTREE_DIR" diff --quiet
    git -C "$WORKTREE_DIR" diff --cached --quiet

    cd "$MAIN_DIR"
    git worktree remove "$WORKTREE_DIR"

    # Delete remote branch only when branch is fully merged.
    if git branch --merged main | grep -q "^[* ]*$BRANCH$"; then
        git push origin --delete "$BRANCH"
    fi
fi
```

### 4. Version Bump (if applicable)

**For projects with version management** — skip if not applicable to fluxaos.

**Version Bump Strategy:**

```bash
# Tag-based version bump — no branch or commit needed
flu release tag --push             # Auto-increment
flu release tag --bump patch --push  # Bug fixes (5.2.0 -> 5.2.1)
flu release tag --bump minor --push  # New features (5.2.0 -> 5.3.0)
flu release tag --bump major --push  # Breaking changes (5.2.0 -> 6.0.0)
```

3. **Verify tag was pushed:**
   ```bash
   git tag -l 'v*' | tail -1
   ```

---

> **Issue Backend:** All `flu issue` commands accept `--backend BACKEND`
> (`forgejo` | `psql`; default: `forgejo`). Projects using the psql backend
> (e.g. PAT) should pass `--backend psql` or set `issue.backend_default`
> in `.fhc-config.json`. Note: `bulk`, `move`, and `report` subcommands
> do not yet support psql (see #2520).

## Flags

| Flag | Description |
|------|-------------|
| `<number>` | Issue number to link, fetch title from, and close |
| `-t, --title <text>` | Commit message title (required if no issue) |
| `-a, --auto-stage` | Quick-fix mode: stash, update main, create branch, auto-stage ALL files |
| `-n, --no-verify` | Skip pre-commit hooks (for non-code changes only) |
| `-f, --force` | Clean up failed state before retrying (drops stash, deletes branch) |

## Examples

### Quick Fix - Typo
```bash
# Make your edit, then:
flu git finish -a -t "Fix typo in README"
```

### Quick Fix - Doc Update (non-code)
```bash
# Edit docs, then:
flu git finish -a -n -t "Update installation instructions"
```

### Issue Completion
```bash
# After running the implement skill with 433 and making changes:
git add config/  # Always stage config first (preserves web UI changes)
git add src/parser.py tests/test_parser.py
flu git finish 433
```

## Error Recovery

If `flu git finish` fails partway through, use the `--force` flag to clean up the failed state and retry:

```bash
# Quick fix retry:
flu git finish -a -t "<title>" -f

# Issue completion retry:
flu git finish <issue-number> -f
```

The `--force` flag drops any leftover stash entries and deletes partially-created branches before retrying from scratch.

**Manual merge fallback** (if the CLI's PR merge step fails):
```bash
git checkout main
git pull origin main
git merge --no-ff <branch-name> -m "Merge pull request #<pr-number>"
git push origin main
```

## Notes

- Pre-commit hooks run during commit step (unless `-n` is used)
- Post-commit hooks run after commit (sync to downstream projects)
- This command replaces the old `quick-fix` and `complete-workflow` commands
- For issue completion, generates detailed knowledge base comment
- Version bump is optional — skip for projects without version management
- Worktree cleanup is automatic when working in a worktree
