

# Requirements Fulfillment Gate — Reference



**This gate is BLOCKING. Requirements fulfillment must be verified BEFORE architectural standards — there is no point reviewing code quality for an implementation that does not meet requirements.**

### 1. Read the issue acceptance criteria
```bash
review the issue: <issue-number>
```

### 2. Read parent epic (if referenced in issue title, description, or labels)
```bash
review the issue: <parent-epic-number>
```

### 3. Read dependency issues AND their comments
```bash
review the issue: <dependency-number>
```
Dependency issue comments often contain credentials, setup instructions, or constraints that affect whether the implementation is correct.

### 4. Cross-reference each criterion against the branch diff

Build a cross-reference table for EACH acceptance criterion:

| Criterion | Code/Test That Fulfills It | Status |
|-----------|---------------------------|--------|
| [criterion from issue] | [specific file:function or test] | MET / NOT MET |

Checklist:
- [ ] List each acceptance criterion from the issue
- [ ] For each criterion: identify the specific code change in the diff that fulfills it
- [ ] If parent epic exists: does every implementation choice serve the epic's purpose?
- [ ] If dependency issues have credentials/setup: were they used in testing?
- [ ] Are any tests "skipped"? If so: should the required resource be available?

**"Skipped tests are a red flag, not a pass."** If the epic says "PostgreSQL" but tests skip because PostgreSQL is unavailable, the implementation has NOT met requirements — even if the code is structurally perfect.

### 5. BLOCKING Rule

**If ANY acceptance criterion is NOT MET, STOP.** Do not review code quality. Comment on the issue with unmet criteria:

```bash
log to docs/superpowers/deferred-fixes.md: "## Changes Requested — Requirements Not Met
The following acceptance criteria are NOT fulfilled:
1. [criterion]: [why it is not met]

Please address these requirements before code review can proceed."
```

**STOP** — Wait for Implementer to address unmet requirements. Do NOT proceed to code review.

## Verify-Issue Specific: Set Implementation Status

After running the gate above, set the status for the verification report:

**If ANY acceptance criterion is NOT MET:** Set `Implementation Status: INCOMPLETE` in the report regardless of architectural compliance. Requirements fulfillment failures override all other checks.

Do NOT proceed to architectural standards verification with unresolved requirements failures. Flag them as Critical Issues immediately.
