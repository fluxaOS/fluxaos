

# Review Session: Analysis Framework

### Step 0: Check Memory for Previous Session Analyses

Before analyzing, query memory for patterns from past reviews:

```bash
flu memory search "session analysis"
flu memory search "workflow optimization"
```
Look for:
- Previous session analysis findings for this project
- Recurring workflow inefficiencies that were identified before
- Fixes that were implemented — check if they regressed

Use previous findings as a baseline to identify whether known issues have been resolved or if new patterns have emerged.

### Step 1: Read the Session File

```bash
# User should specify the path, or use default
session_file="session.txt"  # or user-provided path
```

Read the entire session file to understand:
- What task was being performed
- What tools were used
- What patterns emerged
- What issues occurred

### Step 2: Analyze for Common Issues

Look for these patterns in the session:

#### A. Tool Misuse
- ❌ `gh` or `tea` commands (should use `flu git`)
- ❌ Multiple `grep` or `find` Bash commands (should use Grep/Glob tools)
- ❌ `cat`, `head`, `tail` for reading (should use Read tool)
- ❌ `sed`, `awk` for editing (should use Edit tool)
- ❌ `echo` or heredoc for creating files (should use Write tool)

**Scoring:**
- Count occurrences of each misused tool
- Flag as HIGH priority if >3 occurrences

#### B. Wasteful Operations
- ❌ Search/Grep patterns returning 0 results
- ❌ Reading same file multiple times
- ❌ Multiple edits to same file (should batch)
- ❌ Sequential tool calls that could run in parallel
- ❌ Broad searches followed by narrow searches (should reverse order)

**Scoring:**
- Count wasteful operations
- Estimate tokens wasted (avg 100-500 per operation)

#### C. Missing Best Practices
- ❌ No TodoWrite usage for multi-step tasks (>3 steps)
- ❌ Editing files without reading them first
- ❌ No pre-implementation validation (no test baseline)
- ❌ Creating files instead of editing existing ones
- ❌ Not using Task tool for complex exploration

**Scoring:**
- Flag each missing practice
- Assess impact (HIGH/MEDIUM/LOW)

#### D. Workflow Issues
- ❌ Manual PR body construction (should use template)
- ❌ Repetitive git commands (should chain with &&)
- ❌ No error handling (commands failing silently)
- ❌ Unnecessary context switching (cd commands)
- ❌ Missing commit message issue references (#123)

#### E. Context Management
- ❌ Overly verbose tool outputs (need head_limit)
- ❌ Reading entire large files (need offset/limit)
- ❌ Expanding collapsed output when unnecessary
- ❌ Not using background tasks for slow operations

#### F. CLI Usability
- ❌ Non-existent subcommands attempted (should file alias issue)
- ❌ Wrong argument order causing errors (should improve help/validation)
- ❌ Confusing error messages that don't suggest correct usage
- ❌ Repeated verbose flag combinations (should add defaults/shortcuts)

**Scoring:**
- Count CLI usability issues
- Flag as MEDIUM priority per occurrence (LOW if alias-only fix)

### Step 3: Calculate Impact Metrics

For each issue found, calculate:

**Token Waste:**
```
- Tool misuse: 200-500 tokens per occurrence
- Wasteful operations: 100-300 tokens per occurrence
- Missing practices: 500-2000 tokens per task
- Workflow inefficiencies: 300-1000 tokens per task
```

**Time Waste:**
```
- Sequential operations: 2-5 seconds per extra round-trip
- File re-reads: 1-3 seconds per re-read
- Tool misuse: 3-10 seconds for error recovery
```

### Step 4: Generate Specific Recommendations

For each issue category, provide:

1. **What was observed** (specific line numbers from session)
2. **Why it's inefficient** (token cost, time cost)
3. **How to fix it** (specific actionable changes)
4. **What files to update** (slash commands, references, settings)

### Step 5: Prioritize Improvements

Rank recommendations by impact:

**CRITICAL (>2000 tokens saved):**
- Tool misuse at permission level
- Missing TodoWrite for complex tasks
- Major workflow restructuring

**HIGH (500-2000 tokens):**
- Wasteful search patterns
- Multiple file operations
- Context management issues

**MEDIUM (100-500 tokens):**
- Minor workflow improvements
- Template standardization
- Documentation clarity

**LOW (<100 tokens):**
- Style consistency
- Minor optimizations

### Step 6: Provide Implementation Plan

Create actionable checklist:

```markdown
## Recommended Changes

### 1. Update settings.local.json
- [ ] Add deny rule for: [specific tools]
- [ ] Add wildcard pattern for: [repeated permissions]
- [ ] Consolidate permissions: [specific consolidations]

### 2. Update Slash Commands
- [ ] Add warning to: [specific commands]
- [ ] Add checklist to: [specific commands]
- [ ] Create new command: [if needed]

### 3. Update Documentation
- [ ] Add guidance for: [specific pattern]
- [ ] Add error recovery for: [specific error]
- [ ] Add example for: [specific use case]

### 4. Create Templates
- [ ] Template for: [repetitive pattern]
- [ ] Variables: [list variables]

### 5. Add Hooks (if applicable)
- [ ] Pre-tool hook for: [validation]
- [ ] Session start hook for: [context injection]
```

### Step 7: Estimate Improvement Impact

Provide metrics:

```markdown
## Expected Improvements

### Token Savings
- Per conversation: [X,XXX tokens] ([Y]% reduction)
- Per session file size: [before] → [after]

### Time Savings
- Per workflow execution: [X seconds] ([Y]% faster)
- Reduced round-trips: [N fewer tool calls]

### Reliability Improvements
- [Tool misuse]: [N incidents] → 0 incidents
- [Missing practice]: [N occurrences] → [target]%
- [Workflow issue]: [description of improvement]
```

### Step 8: Manage Memory (Automatic)

Memory changes are safe and do not impact code — execute these automatically without asking.

#### 8a. Search for existing entries to update or delete

```bash
flu memory search "<main topic from session>"
```

For each result:
- If the finding **contradicts** a memory entry → delete it: `flu memory delete <ID>`
- If the finding **extends** a memory entry → update it (delete + re-add with merged content)
- If the finding **confirms** a memory entry → rate it: `flu memory rate <ID> useful --query "<topic>"`
- If no relevant entry exists → proceed to 8b

#### 8b. Add new pattern/investigation entries

For each recurring pattern discovered (2+ occurrences across sessions, or user-corrected behavior):

```bash
flu memory add pattern "<brief subject>" --body "<actionable guidance>"
```

For CLI syntax learnings (e.g., correct argument order, required positional args):

```bash
flu memory add pattern "<CLI command syntax>" --body "<correct usage with examples>"
```

For investigation findings worth preserving:

```bash
flu memory add investigation "<what was investigated>" --body "<key findings>"
```

#### 8c. Rate all memory search results from Step 0

Go back to the memory results from Step 0 and rate each one:

```bash
flu memory rate <ID> useful|not_useful|partial --query "<original search query>"
```

### Step 9: Analyze CLI Command Patterns

Review the session for opportunities to improve the project's CLI tool (`flu`).

#### What to Look For

| Pattern | Example | Action |
|---------|---------|--------|
| **Non-existent subcommand attempted** | `pat pipeline eligible` (doesn't exist) | File issue to add subcommand or alias |
| **Wrong argument order** | `flu db query "SELECT..."` (missing db name) | File issue to improve help text or add validation |
| **Repeated long flag combinations** | `--format json --limit 10` used 5+ times | File issue to add shortcut or default |
| **Guessed alias that failed** | `flu issue show` → error | File issue to add alias (argparse `aliases=[]` pattern exists — see `issue_parser.py` lines 128, 149, 216) |
| **Confusing error messages** | Error doesn't suggest the correct command | File issue to improve error output |

#### For Each CLI Issue Found

1. Check if the subcommand/alias already exists: `flu <command> --help`
2. Check existing aliases in the parser code (pattern: `add_parser('name', aliases=['alias'])`)
3. If genuinely missing, file an issue:

```bash
flu issue create --title "CLI: Add '<subcommand>' alias/subcommand to flu <parent>" --body "$(cat <<'EOF'
## Summary
During session review, the LLM attempted \`flu <parent> <subcommand>\` which does not exist.
This is a natural/intuitive command that both LLMs and humans reach for.

## Current Behavior
\`flu <parent> <subcommand>\` fails with: invalid choice

## Expected Behavior
Add as [alias to existing command / new subcommand] that [description].

## Implementation Instructions
**Step 1:** In \`src/fh_commons/cli/<relevant_parser>.py\`, add alias to the existing \`<command>\` parser:
\`\`\`python
parser = subparsers.add_parser('<command>', aliases=['<new_alias>'], ...)
\`\`\`

## Files to Modify
- \`src/fh_commons/cli/<relevant_parser>.py\` — add alias

## Tests to Write
- Test that \`flu <parent> <new_alias>\` works identically to \`flu <parent> <command>\`

## Acceptance Criteria
- [ ] Alias/subcommand works
- [ ] Help text shows the alias
- [ ] Existing command still works
EOF
)"
flu issue update <number> --type enhancement --priority low --state ready-to-implement
```

### Step 10: File Issues for Actionable Recommendations

For each recommendation rated HIGH or CRITICAL that requires code, config, or template changes, automatically file an issue.

**DO NOT file issues for:**
- Memory-only changes (already handled in Step 8)
- Recommendations the user needs to evaluate first (present these in the report)
- Duplicate issues (check `flu issue list` first)

**DO file issues for:**
- Settings changes (deny rules, permission patterns)
- Slash command template updates
- Hook additions/modifications
- Documentation updates to workflow files

#### Issue Filing Process

1. **Check for duplicates:**
```bash
flu issue list --state open 2>&1 | grep -i "<keyword>"
```

2. **Create the issue:**
```bash
flu issue create --template quick-bug --title "<Component>: <brief description>" --body "$(cat <<'EOF'
## Summary
Identified during session review on [date].

## Problem
[What was observed — reference session line numbers]

## Proposed Fix
[Specific change with file paths]

## Files to Modify
- `path/to/file` — [what to change]

## Acceptance Criteria
- [ ] [Measurable criterion]
EOF
)"
flu issue update <number> --type enhancement --priority <level> --state ready-to-implement
```

3. **Track filed issues in the report:**

Add a "Filed Issues" section to the report output:

```markdown
## Filed Issues

| Issue | Title | Priority | Category |
|-------|-------|----------|----------|
| #XXX | CLI: Add 'eligible' alias to pipeline | LOW | CLI Improvement |
| #YYY | Settings: Add deny rule for gh commands | HIGH | Tool Misuse |
```
