

# Verification Report Template — Reference

Use this exact format when generating the verification report. Post it as a comment on the issue.

## Report Format

```
## Issue #<issue-number> Verification Report

📋 Implementation Status: [COMPLETE|INCOMPLETE|PARTIAL]
🏗️ Architectural Compliance: [PASS|FAIL|WARNING]
📚 Documentation: [COMPLETE|INCOMPLETE|NOT_REQUIRED]
🧪 Testing: [ADEQUATE|INSUFFICIENT|NOT_REQUIRED]
🔧 CLI E2E Testing: [PASS|FAIL|NOT_REQUIRED]
📐 Coverage Scope: [PASS|FAIL|WARNING]
🌐 Browser Verification: [PASS|FAIL|BLOCKED]
📊 Log Analysis: [PASS|FAIL|WARNING]

## Issue Summary
Title: [Issue Title]
Type: [enhancement|bug|documentation|refactor]
Status: [OPEN|CLOSED]
Labels: [list of labels]

## Implementation Analysis

### Code Changes Detected
- ✅ Modified files identified: X files
- ✅ New functionality implemented: [description]
- ✅ Requirements from issue addressed: [list key requirements]

### Requirements Fulfillment
- ✅/❌ Parent epic purpose served: [PASS/FAIL]
- ✅/❌ All acceptance criteria met: [X of Y met]
- ✅/❌ Dependency issue context used: [PASS/FAIL/NOT_APPLICABLE]
- ✅/❌ No contradictory implementation choices: [PASS/FAIL]
**Unmet criteria:** [list any NOT MET items from Step 1.5]

### R&P Completeness
- ✅/❌ Issue had numbered implementation steps before work began
- ✅/❌ Issue specified files to modify before work began
- ✅/❌ Implementer did NOT have to make architectural decisions
**Notes:** [Any signs that R&P was incomplete — implementer design decisions, trial-and-error commits, etc.]

### Label Group Verification
- ✅/❌ **Type label** present (exactly one): type:bug, type:enhancement, type:documentation, type:refactor, type:cleanup, type:testing
- ✅/❌ **Priority label** present (exactly one): priority:critical/high/medium/low
- ✅/❌ **State label** present and matches current workflow stage
- ✅/❌ **No conflicting labels** (e.g., NOT both `type:bug` AND `type:enhancement`)
**Missing labels:** [list any missing required groups — add them if missing]

### Verification Results

## Architectural Standards Compliance

### ✅/❌ Standard 1: No Hardcoded Variables
- File path handling: [PASS/FAIL/WARNING]
- URL configuration: [PASS/FAIL/WARNING]
- Magic string usage: [PASS/FAIL/WARNING]
**Issues found:** [list any hardcoded values found]

### ✅/❌ Standard 2: No Fallbacks - Fail Fast
- Exception handling: [PASS/FAIL/WARNING]
- Configuration validation: [PASS/FAIL/WARNING]
- Error message clarity: [PASS/FAIL/WARNING]
**Issues found:** [list any fallback patterns found]

### ✅/❌ Standard 3: Config-Driven/Modular
- Configuration usage: [PASS/FAIL/WARNING]
- Modular design: [PASS/FAIL/WARNING]
- Separation of concerns: [PASS/FAIL/WARNING]
**Issues found:** [list any modularity issues]

### ✅/❌ Standard 4: Dynamic Path Construction
- Path helper usage: [PASS/FAIL/WARNING]
- Cross-platform compatibility: [PASS/FAIL/WARNING]
- Directory separator handling: [PASS/FAIL/WARNING]
**Issues found:** [list any path construction issues]

### ✅/❌ Standard 5: DRY Principles
- Code duplication: [PASS/FAIL/WARNING]
- Helper function usage: [PASS/FAIL/WARNING]
- Pattern abstraction: [PASS/FAIL/WARNING]
**Issues found:** [list any duplication found]

### ✅/❌ Standard 5b: No Competing Implementations
- Canonical module usage: [PASS/FAIL/WARNING]
- No duplicate helpers introduced: [PASS/FAIL/WARNING]
- No non-canonical imports: [PASS/FAIL/WARNING]
**Issues found:** [list any competing implementation issues]

### ✅/❌ Standard 6: Consistent CLI Output
- Output formatting: [PASS/FAIL/WARNING]
- Error message consistency: [PASS/FAIL/WARNING]
- Logging patterns: [PASS/FAIL/WARNING]
**Issues found:** [list any output inconsistencies]

## Documentation Verification

### README Updates: [REQUIRED|NOT_REQUIRED]
- ✅/❌ Feature documentation added
- ✅/❌ Usage examples provided
- ✅/❌ Configuration options documented

### API Documentation: [REQUIRED|NOT_REQUIRED]
- ✅/❌ Public interfaces documented
- ✅/❌ Parameter descriptions complete
- ✅/❌ Return value documentation

### Configuration Documentation: [REQUIRED|NOT_REQUIRED]
- ✅/❌ New config options documented
- ✅/❌ Environment variables listed
- ✅/❌ Migration guide provided (if needed)

## Implementation Verification

### Core Functionality
- ✅/❌ Primary requirements implemented
- ✅/❌ Edge cases handled appropriately
- ✅/❌ Error scenarios covered
- ✅/❌ Performance considerations addressed

### Testing Coverage
- ✅/❌ New tests added for new functionality
- ✅/❌ Existing tests updated appropriately
- ✅/❌ Integration tests cover new features
- ✅/❌ Error case testing included

### CLI E2E Test Verification: [PASS|FAIL|NOT_REQUIRED]
- ✅/❌ New CLI E2E tests added for changed functionality
- ✅/❌ Tests use real execution (no mocks)
- ✅/❌ Coverage scope: direct + previous + adjacent
**Issues found:** [list any missing CLI tests]

### Coverage Scope: [PASS|FAIL|WARNING]
- ✅/❌ Direct functionality tested
- ✅/❌ Previous functionality regression tested
- ✅/❌ Adjacent functionality tested
**Adjacent consumers without tests:** [list or "none"]

### Functional Verification Evidence: [ADEQUATE|INSUFFICIENT|MISSING]
- ✅/❌ Evidence provided in Ready for Review comment
- ✅/❌ Specific command/action documented
- ✅/❌ Observed output included
- ✅/❌ Result is plausible for the feature
**Notes:** [Describe what evidence was found or what is missing]

### Browser Verification: [PASS|FAIL|BLOCKED]

| Status | Meaning | Workflow |
|--------|---------|----------|
| **PASS** | Tests ran and passed | Proceed |
| **FAIL** | Tests ran and failed | **BLOCKER** - Stop and report |
| **BLOCKED** | Tests could not run | **BLOCKER** - Must explain why, stop and report |

**For webapp projects, NOT_APPLICABLE is NOT a valid option.**
**For webapp projects, SKIPPED is NOT a valid option.**

- ✅/❌ Webapp routes load correctly
- ✅/❌ UI elements render as expected
- ✅/❌ User interactions function properly
- ✅/❌ No JavaScript console errors
**Notes:** [Describe browser testing results or explain BLOCKED status]

### Log Analysis: [PASS|FAIL|WARNING]
- ✅/❌ No skipped tests due to missing available resources
- ✅/❌ No runtime errors in test output
- ✅/❌ No service log errors (webapp projects)
- ✅/❌ No unexplained warnings
**Skipped tests:** [count and reasons — "0 skipped" or list each with justification]
**Warnings found:** [count and summary, or "none"]
**Service log errors:** [count and summary, or "none" / "not applicable"]

## Issues and Recommendations

### Critical Issues (Must Fix)
[List any critical violations that must be addressed]

### Warnings (Should Fix)
[List any warnings or improvements recommended]

### Suggestions (Nice to Have)
[List any optional improvements]

## Overall Assessment

**Final Status: [APPROVED|NEEDS_WORK|REJECTED]**

### Summary
[2-3 sentence summary of verification results]

### Next Steps
[Specific actions needed if any issues found]

Report generated: [timestamp]
Verified by: Claude Code Issue Verification v1.0
```

## Report Generation Guidelines

- Use exact formatting shown above for consistency
- Replace bracketed placeholders with actual data
- Include specific file names and line numbers when possible
- Provide actionable recommendations
- Use ✅/❌ symbols consistently for visual clarity
- Keep sections concise but informative
