

# Implementation Completeness Check

## Code Changes Verification
For each file mentioned in the issue:
- Verify the file exists and has been modified
- Check that the changes align with requirements
- Validate that new functionality works as described

**IMPORTANT:** "Aligns with requirements" means cross-referencing against the Requirements Fulfillment Gate from Step 1.5. If Step 1.5 found NOT MET criteria, this section MUST flag them as Critical Issues regardless of code quality.

## CLI Test Verification: [PASS|FAIL|NOT_REQUIRED]

**Check for new CLI tests:**
```bash
# Find CLI/E2E tests added or modified in this branch
git diff origin/main --name-only | grep -E 'tests/(cli|e2e|unit.*cli)'

# Find what source files changed
git diff origin/main --name-only | grep -E '^src/.*\.py$'
```

**Verification criteria:**
- [ ] New tests exist for changed functionality
- [ ] Tests use real execution (subprocess.run, real filesystem, real APIs) — no mocks
- [ ] Tests cover direct + adjacent functionality (see Coverage Scope below)
- [ ] No mock patterns (`unittest.mock`, `@patch`, `MagicMock`, `pytest-mock`) — **BANNED**

**Status determination:**

| Condition | Status |
|-----------|--------|
| New tests added, real execution, covers scope | PASS |
| No source code changed (docs-only) | NOT_REQUIRED |
| Source changed but no new tests | **FAIL** |
| Tests use any mock patterns | **FAIL** |

**If FAIL:** Add to Critical Issues: "Missing real tests for [changed files]. See E2E_TEST_STANDARDS.md."

**If tests fail during verification:** NEVER assume failures are pre-existing. Verify by running the same test on `origin/main`. If pre-existing, file an issue immediately (mandatory). See E2E_TEST_STANDARDS.md — "Encountering Test Failures".

## Coverage Scope Verification



**Coverage scope — test all three rings:**

| Scope | What to Test |
|-------|--------------|
| **Direct** | The specific feature/function you changed |
| **Previous** | Existing features in the same module (regression) |
| **Adjacent** | All callers/consumers of your changed code |

Find adjacent code:
```bash
for file in $(git diff origin/main --name-only | grep -E '^src/.*\.py$'); do
  module=$(basename "$file" .py)
  grep -r "from.*${module} import\|import.*${module}" src/ tests/ --include="*.py" | grep -v "__pycache__"
done
```

**If adjacent tests missing:** Add to Warnings: "Missing tests for adjacent functionality: [list consumers without test coverage]"

## Functional Verification Evidence Check

**Check the "Ready for Review" comment for functional verification evidence:**

```bash
review the issue: <issue-number> --comments | grep -A 20 "Functional Verification"
```

**Evaluate evidence quality:**

| Evidence | Assessment |
|----------|------------|
| Specific command + observed output | ADEQUATE |
| Command + "it worked" (no output) | INSUFFICIENT — no proof |
| "Tests pass" or "code looks correct" | MISSING — not functional verification |
| No Functional Verification section | MISSING |

**If MISSING or INSUFFICIENT:**
- Set Implementation Status to **INCOMPLETE**
- Add to Critical Issues: "Functional verification evidence missing or insufficient. Implementer must run the feature with real arguments and document the command + output in the Ready for Review comment."

## Documentation Updates

**Verify all documentation affected by the implementation has been updated.**

**Documentation types to check:**
- [ ] `README.md` — User-facing features, usage, or project description
- [ ] `docs/` directory — Technical documentation
- [ ] CLI help text — Command syntax or flags (`--help` output)
- [ ] `.claude/` workflows — Workflow templates affected by changes
- [ ] `CLAUDE.md` / project instructions — Project standards or conventions
- [ ] Code docstrings — New public functions (only where logic isn't self-evident)
- [ ] Configuration documentation — New config options or env vars

**Check if documentation was included in implementation:**
```bash
# Check if README files were modified in this branch
git diff origin/main --name-only | grep -iE "readme|docs/"

# Check if workflow templates were updated
git diff origin/main --name-only | grep -iE "\.claude/|templates/"

# Check for inline documentation updates
grep -r "Args:\|Returns:\|Examples:\|Usage:" src/ --include="*.py" | head -10
```

**For new features, verify:**
- [ ] README updates explaining the feature
- [ ] Configuration documentation if new configs added
- [ ] API documentation for public interfaces
- [ ] Usage examples and tutorials

**For bug fixes, verify:**
- [ ] Changelog entry (if applicable)
- [ ] Updated troubleshooting docs (if relevant)

**For configuration changes, verify:**
- [ ] Configuration file documentation
- [ ] Migration guides for breaking changes
- [ ] Environment variable documentation

**For CLI changes, verify:**
- [ ] CLI help text updated for changed commands/flags
- [ ] `docs/` command reference reflects new syntax

**If the issue had a "Documentation Updates Required" section, cross-reference each item.**
