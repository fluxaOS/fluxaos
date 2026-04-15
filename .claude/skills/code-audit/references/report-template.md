

# Compliance Report Template

Use this template to generate the audit report. Post as a comment on the issue.

```markdown
# Code Audit Report

**Date:** [current date]
**Scope:** [directory or "entire codebase"]
**Standards Reference:** .claude/ARCHITECTURAL_STANDARDS.md

---

## Executive Summary

| Category | HIGH | MEDIUM | LOW | Total |
|----------|------|--------|-----|-------|
| Helper Usage | X | X | - | X |
| File Size | X | X | - | X |
| Hardcoded Paths | X | X | - | X |
| Hardcoded URLs | X | X | X | X |
| Fallback Patterns | X | X | - | X |
| Direct Print | - | X | X | X |
| DRY Violations | X | X | X | X |
| Magic Values | - | X | X | X |
| **TOTAL** | **X** | **X** | **X** | **X** |

**Compliance Score:** X% (violations / total checks)

---

## Violations by Priority

### HIGH Priority (Must Fix)

[List all HIGH priority violations]

### MEDIUM Priority (Should Fix)

[List all MEDIUM priority violations]

### LOW Priority (Consider Fixing)

[List all LOW priority violations]

---

## Remediation Guidance

### Helper Usage Violations
- Each violation message includes the specific import path — use it directly
- If no existing helper fits your use case, add one to `fh_commons/` rather than reimplementing inline
- Reference `.claude/ARCHITECTURAL_STANDARDS.md` Helper Hierarchy section

### File Size Violations
- Split large files into logical modules
- Extract related functions into separate files
- See Issue #263 for example refactoring approach

### Hardcoded Values
- Move paths to config files
- Use path helpers from `fh_commons.paths`
- Reference `.claude/ARCHITECTURAL_STANDARDS.md` Section 1

### Fallback Patterns
- Remove `|| true` and fail fast
- Add explicit error messages with guidance
- Reference `.claude/ARCHITECTURAL_STANDARDS.md` Section 2

[Continue for each category...]
```
