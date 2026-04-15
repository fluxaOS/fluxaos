---
name: "verify-issue"
description: "Issue implementation verification."
---
# Issue Implementation Verification

Systematically verify that an issue has been properly implemented according to architectural standards and completion criteria.

## Usage

```
Run the verify-issue skill with <issue-number>           # Basic verification
Run the verify-issue skill with <issue-number> --verbose # Detailed output
Run the verify-issue skill with <issue-number> --quick   # Skip detailed file analysis
```

**Arguments:** `$ARGUMENTS`

> (`forgejo` | `psql`; default: `forgejo`). Projects using the psql backend
> (e.g. PAT) should pass `--backend psql` or set `issue.backend_default`
> in `.fhc-config.json`. Note: `bulk`, `move`, and `report` subcommands
> do not yet support psql (see #2520).

## Instructions

### Step 1: Parse Arguments and Fetch Issue

Parse the issue number and optional flags:

```bash
# Extract issue number from arguments
issue_number = $ARGUMENTS[0]

# Fetch issue details
review the issue: $issue_number

# Check for existing verification report in comments
review the issue: $issue_number --comments | grep -A 100 "Verification Report"
```

**Required Information to Extract:**
- Issue title and description
- Implementation requirements and acceptance criteria
- Labels (type:enhancement, type:bug, type:documentation, etc.)
- Current status (open/closed) - **NOTE: Status does not affect verification**

**Check for Existing Verification Report:**
1. Fetch issue comments and look for "Verification Report" header
2. **If verification report exists:**
   - Display summary: "Previous verification found from [date]"
   - Show the previous verification status (APPROVED/NEEDS_WORK/REJECTED)
   - **Continue with verification anyway** - do NOT skip verification
3. **If no verification report:**
   - Proceed with full verification

**IMPORTANT:** Always run full verification regardless of:
- Issue status (open or closed)
- Whether previous verification exists
- Any assumptions about implementation completeness

### Step 1.4: Check Memory for Verification Patterns

Before starting verification, query memory for relevant context:

```
Use the mem-search skill to find:
- Common acceptance criteria gaps in this project's issues
- Past verification failures for similar feature types
- Known edge cases for the affected component
```

Use these patterns to inform what to look for during verification. If claude-mem is not available, skip this step.

### Step 1.5: Requirements Fulfillment Gate

**BLOCKING** — read `references/requirements-gate.md` and execute in full before proceeding to architectural checks. Requirements failures override all other checks.

### Step 1.8: R&P Completeness Verification

**Verify that the issue had complete implementation instructions BEFORE work began — not just good code after.**

Check the issue description and comments for:
- [ ] Issue had numbered implementation steps before work began (not just "hints" or "approach")
- [ ] Issue specified files to modify before work began
- [ ] Implementer did NOT have to make architectural decisions (check PR comments/commits for signs of design exploration)
- [ ] No comments from implementer saying "I chose to..." or "I decided to..." (indicates missing R&P)

**Signs that R&P was incomplete (flag as Warning):**
- Implementer's commit messages contain design rationale that should have been in the issue
- Implementer added implementation plan comments that weren't in the original issue
- Multiple approach changes visible in commit history (indicates trial-and-error, not executing a plan)

**If R&P was clearly incomplete:** Add to Warnings: "R&P was incomplete — implementer had to make design decisions. Future issues should include step-by-step implementation instructions."

### Step 2: Analyze Issue Requirements

Parse the issue description to identify:
- **Implementation tasks** (what code changes are needed)
- **Affected components** (services, configs, documentation)
- **Success criteria** (how to verify completion)
- **Type of change** (feature, bug fix, refactoring)

Create a verification checklist based on issue content:
- Extract tasks from checkbox lists `- [ ]` in issue description
- Identify files/directories mentioned in the issue
- Determine if this affects public APIs, configuration, or documentation

### Step 3: Architectural Standards Verification

Read `references/architectural-checks.md` for all 6 checks with grep patterns and criteria. Run each check systematically and record results. Flag any violations as Critical Issues.

### Step 4: Implementation Completeness Check

Read `references/implementation-completeness.md` and execute all checks in full. This covers code changes verification, CLI test verification, coverage scope, functional verification evidence, and documentation updates.

### Step 5: Quality Assurance Checks

#### Error Handling
- Verify proper exception handling
- Check for meaningful error messages
- Ensure graceful degradation where appropriate

#### Performance Considerations
- Check for potential performance impacts
- Verify resource cleanup (file handles, connections)
- Review algorithmic efficiency

#### Security Review
- Validate input sanitization
- Check for potential security vulnerabilities
- Verify proper permission handling

### Step 5.5: Browser Verification (webapp=false, browser_tests=false)

Read `references/browser-verification.md` and execute all checks in full. If `false` is `false`, skip this entire section. Otherwise this step is mandatory and blocking.

### Step 5.6: Test and System Log Analysis — MANDATORY (NO EXCEPTIONS)

Read `references/test-log-analysis.md` and execute all checks in full. This step is NOT conditional — skipping is not permitted under any circumstances.

### Step 6: Generate Comprehensive Verification Report

Build the report using the template and guidelines in `references/report-template.md`.

### Step 7: Final Verification Report

Use the template in `references/report-template.md`. Post as a comment on the issue using:
```bash
log to docs/superpowers/deferred-fixes.md: "$(cat <<'EOF'
[paste report here]
EOF
)"
```

### Step 8: Handle Edge Cases

#### Issue Not Found
```bash
if issue does not exist:
    echo "❌ ERROR: Issue #$issue_number not found"
    echo "Verify the issue number and try again"
    exit 1
```

#### Open vs Closed Issues

**IMPORTANT:** Verify ALL issues the same way regardless of status.

```bash
# Note: Issue status is informational only - it does NOT affect verification
if issue is open:
    echo "ℹ️  Note: Issue #$issue_number is currently open"
if issue is closed:
    echo "ℹ️  Note: Issue #$issue_number is closed"
    echo "ℹ️  Running full verification (closed status does not skip verification)"
```

**Do NOT:**
- Skip verification for closed issues
- Assume closed issues were properly implemented
- Abbreviate verification based on issue status

**Do:**
- Run full verification on ALL issues
- Check for existing verification report comments
- Verify implementation meets all criteria regardless of status

#### No Changes Found
```bash
if no relevant changes detected:
    echo "⚠️  WARNING: No implementation changes found for Issue #$issue_number"
    echo "This may indicate:"
    echo "- Issue was closed without implementation"
    echo "- Changes are in a different branch"
    echo "- Issue number mismatch"
```

#### Existing Verification Report Found
```bash
if verification report comment exists:
    echo "ℹ️  Previous verification report found"
    echo "Previous status: [APPROVED|NEEDS_WORK|REJECTED]"
    echo "Running fresh verification..."
    # Continue with full verification - do NOT skip
```

## Verification Strategies

### For Different Issue Types

#### Bug Fixes
- Verify the specific bug is resolved
- Check that fix doesn't introduce regressions
- Validate error scenarios are handled

#### New Features
- Verify all acceptance criteria are met
- Check integration with existing systems
- Validate configuration options work

#### Refactoring
- Verify functionality is preserved
- Check that code quality improved
- Ensure no new architectural violations

#### Documentation
- Verify docs are accurate and complete
- Check that examples work
- Validate formatting and structure

### Performance Considerations

- Use targeted file scanning based on issue scope
- Cache issue details to avoid repeated API calls
- Skip verification steps that don't apply to issue type
- Provide progress indicators for long-running verifications

## Error Handling

Handle common error scenarios:
- Invalid issue numbers
- Network connectivity issues
- File system permission problems
- Git repository inconsistencies

Provide clear, actionable error messages that guide the user toward resolution.

## Handling Verification Results

After generating the verification report, interpret the results and determine next steps.

### Pass/Fail Criteria

**For a PR to proceed, the following must be met:**

| Metric | Required Status |
|--------|-----------------|
| Requirements Fulfillment | ALL criteria MET |
| Implementation Status | COMPLETE |
| Architectural Compliance | PASS |
| Documentation | COMPLETE or NOT_REQUIRED |
| Testing | ADEQUATE or NOT_REQUIRED |
| CLI E2E Testing | PASS or NOT_REQUIRED |
| Coverage Scope | PASS or WARNING |
| Browser Verification | PASS (webapp projects) |
| Log Analysis | PASS or WARNING |

**⚠️ Browser Verification for Webapp Projects:**
- **PASS** is the ONLY acceptable status for proceeding
- **FAIL** is a BLOCKER - Stop and report failures
- **BLOCKED** is a BLOCKER - Must explain why tests could not run, stop and report
- **NOT_APPLICABLE** is NOT a valid option for webapp projects
- **SKIPPED** is NOT a valid option for webapp projects

### Based on Final Status

#### APPROVED - Ready to Proceed

All criteria met. The implementation can proceed to:
- PR creation and merge
- Version bump (if applicable)
- Issue closure

#### NEEDS_WORK - Issues Must Be Resolved

Issues were found that must be addressed before proceeding.

**Critical Issues (Must Fix):**
- Architectural violations (hardcoded values, fallbacks, etc.)
- Missing tests for new functionality
- Security vulnerabilities
- Broken existing tests

**Warnings (Should Fix):**
- Documentation gaps
- Code style issues
- Minor DRY violations

**Action Required:**
1. Return to the implementer with specific issues to fix
2. Provide file names, line numbers, and clear guidance
3. Wait for fixes to be pushed
4. Re-run the verify-issue skill to confirm resolution

#### REJECTED - Significant Problems

Serious issues that may require architectural changes or reimplementation.

**Action Required:**
1. Document all critical issues
2. Discuss with implementer/team
3. May need to reopen issue with new requirements
4. Do not proceed until resolved

### Re-verification

After issues are fixed, always re-run the verify-issue skill with <issue-number>.

**Only proceed to PR creation when Final Status shows:** ✅ **APPROVED**

## Integration Notes

This command integrates with:
- **Git repository** for file change analysis
- **File system** for code and documentation scanning
- **Configuration files** for architectural verification

