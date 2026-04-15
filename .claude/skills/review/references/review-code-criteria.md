

# Review Code Criteria

## Requirements Fulfillment Gate (Step 1.5)

**BLOCKING — validate requirements BEFORE reviewing code quality.**

There is no point reviewing code quality for an implementation that does not meet the issue's requirements. Before examining code standards, architecture, or style, the reviewer must confirm the implementation fulfills what was actually requested.

Also fetch the branch diff to cross-reference against criteria:
```bash
git diff origin/main..origin/<branch-name>
```



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

---

## Pre-Existing Issue Reports (Step 2.5)

**Check if the implementer filed issues for pre-existing problems found during implementation.**

1. Read the implementer's "Ready for Review" comment for a **"Pre-Existing Issues Filed"** section
2. **If present**, verify each filed issue:
   ```bash
   review the issue: <number>
   ```
   - [ ] Issue exists and is open
   - [ ] Title is descriptive (not vague like "test fails")
   - [ ] Body contains enough context (what failed, where, error output)
   - [ ] Labels applied (type + priority)
   - [ ] Issue is in the correct repo (matches where the problem lives)
3. **If issues are incomplete** (missing labels, vague title, no body), request the implementer to fix them before proceeding
4. **If no pre-existing issues section**, that's fine -- it means no pre-existing problems were found

---

## 2a. Independent Diff Analysis

**The implementation plan may be incomplete or wrong.** The plan is an input you evaluate, not a spec you verify against. If the plan says "test 4 pages" but the implementation created 7 pages, reject because 3 pages are untested. The standard is "is this work actually complete and correct?" not "did they do what the plan said?"

Read the diff as if you have no idea what the issue asked for. Ask yourself:

- **Does this code make sense on its own?** Would a developer reading this without the issue context understand what it does and why?
- **Are there logic bugs?** Off-by-one errors, missing null checks, race conditions, unhandled edge cases, wrong operator, inverted conditions?
- **Is anything missing?** Files that should have been changed but weren't? Error handling that's absent? Cleanup that was forgotten?
- **Is anything extra?** Changes that don't belong in this diff — debug prints, unrelated refactoring, commented-out code, TODO comments left behind?
- **Is the implementation proportional to the problem?** Over-engineering is as bad as under-engineering. A 200-line change for a 20-line problem needs justification.

## 2b. Project Standards Enforcement

These are non-negotiable regardless of what the plan or issue specified:

- [ ] **No hardcoded values.** All paths, URLs, file lists, magic numbers must come from config. Check string literals in the diff.
- [ ] **No carried-forward debt.** If modifying existing code, pre-existing violations in the touched code are fixed — not just worked around.
- [ ] **Correct imports.** All imports use canonical modules per `docs/python-functions-reference.md`.
- [ ] **File size.** No file exceeds ~500 lines. If the diff pushes a file over, it needs to be split.
- [ ] **No security issues.** No command injection, no secrets in code, no unsafe deserialization.

## 2c. Architecture and Design Quality

Go beyond surface-level standards. Evaluate whether the implementation is well-designed:

- [ ] **Clean boundaries.** Does each changed file have a single clear responsibility? Are new functions/classes well-named and well-scoped?
- [ ] **Error handling.** Are failures handled gracefully? Will the user see a helpful error message, or a stack trace?
- [ ] **Testability.** Is the new code structured so it can be tested? Or is business logic tangled with I/O?
- [ ] **Consistency.** Does the new code follow the patterns established by surrounding code? Or does it introduce a different style?

## 2d. What Good Rejection Looks Like

When you reject, be specific. Don't just say "code quality issues." For each problem:
1. Quote the exact line(s) from the diff
2. Explain what's wrong and why it matters
3. Suggest how to fix it

Bad: "Some hardcoded values found."
Good: "`src/api/routes.py:42` — hardcodes Redis host as `'192.168.54.101'`. This should come from config. See `fh_commons.config.get_redis_config()`."

## 2e. Test Coverage Cross-Reference

**For every new or substantially modified source file in the diff, verify corresponding test coverage exists.**

This is a concrete, enumerated check, not a subjective judgment:

1. List all new or modified source files from `git diff --name-only origin/main..origin/<branch-name>`
2. For each source file, check:
   - **Python module** -> corresponding `tests/unit/test_<module>.py` or `tests/integration/test_<module>.py` exists and covers the new code
   - **React page/component** -> corresponding `tests/browser/test_<page>.py` exists with Playwright tests
   - **CLI command** -> corresponding `tests/e2e/test_<command>.py` exists
   - **API endpoint** -> corresponding test file exercises the endpoint
3. Flag any source file that has no corresponding test file or no test coverage for its new functionality
4. Apply project testing standards from `CLAUDE.md`:
   - **pytest**: Required for all changes, no exceptions
   - **Playwright browser tests**: Required for all webapp changes, no exceptions
   - **No mocks**: All tests must use real resources; banned patterns are in the blocker checklist
5. **The plan does not override these standards.** If the plan specifies tests for 4 of 7 new pages, reject; all 7 need tests.

**If test gaps exist, reject with specifics:**
> "New files `X.py`, `Y.tsx`, `Z.tsx` have no corresponding test coverage. Project standards require tests for all new code."

## Functional Verification Evidence Gate



**Before proceeding, check the implementer's "Ready for Review" comment:**

- [ ] Comment includes a `### Functional Verification` section
- [ ] Section contains a specific command/action (not just "tests pass")
- [ ] Section contains observed output or result
- [ ] Section confirms **outcome verification** — the implementer checked the end state, not just that the command ran
- [ ] Section identifies the **scope of impact** — all systems/repos/services affected
- [ ] Section confirms **all affected systems were verified** — not just one
- [ ] Comment includes a `### Requirements Fulfilled` section listing each acceptance criterion
- [ ] Each listed criterion maps to a specific code change or test


**If the Requirements Fulfilled section is missing:**
```bash
log to docs/superpowers/deferred-fixes.md: "## Changes Requested
Missing requirements fulfillment evidence. The Ready for Review comment must include:
- **### Requirements Fulfilled** section
- Each acceptance criterion from the issue
- The specific code change or test that fulfills each criterion

Listing acceptance criteria without mapping them to code is NOT sufficient."
```
**STOP** — Wait for Implementer to add requirements fulfillment evidence.

**If the Functional Verification section is missing, vague, or lacks outcome verification:**
```bash
log to docs/superpowers/deferred-fixes.md: "## Changes Requested
Missing or incomplete functional verification evidence. The Ready for Review comment must include:
- **Command/Action:** The exact command or action you ran
- **Result:** What happened (paste output or describe behavior)
- **Outcome Confirmed:** What you checked AFTER the command to verify the end state
- **Scope of Impact:** All systems/repos/services affected by this change
- **All Affected Systems Verified:** Yes/no — if no, explain why

'Tests pass', 'command ran without errors', or 'checked one repo' is NOT sufficient.
You must run the feature AND verify the outcome across ALL affected systems.
This is a homelab — dev is production. Every change must be verified end-to-end."
```
**STOP** — Wait for Implementer to add complete functional verification evidence.
