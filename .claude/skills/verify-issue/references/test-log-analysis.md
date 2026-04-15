

# Test and System Log Analysis

**You MUST analyze test output and system logs for issues that passing tests can hide. This step is NOT conditional — execute it every time. Skipping is NOT permitted under any circumstances.**

## Pre-check: Avoid redundant test runs

If you are running as part of the review skill workflow and the BLOCKERS section already verified tests (or determined them cached via SHA match), **skip re-running tests**. Instead:
1. Reference the BLOCKERS test result: "Tests verified by BLOCKERS check (SHA match) — skipping re-execution"
2. Still perform log analysis (application logs, service logs) below
3. Document: "Tests verified by BLOCKERS check — skipping re-execution"

If running standalone (not as part of the review skill), execute tests as usual below.

## Test Log Analysis

```bash
# Determine which tests to run based on changed files
# Source: src/package/module/file.py → Test: tests/unit/module/test_file.py
# Use: git diff origin/main --name-only | grep -E '^src/.*\.py$'
# Then find matching tests: Glob tests/unit/**/*<keyword>*.py

# Run targeted tests capturing full output
python -m pytest tests/unit/test_<module>.py -v 2>&1 | tee /tmp/verify-test-output.log

# Check for skipped tests
grep -c "SKIPPED" /tmp/verify-test-output.log

# Check skip reasons
grep -iE "SKIPPED" /tmp/verify-test-output.log

# Check for warnings and errors in test output
grep -iE "warning|error|exception|traceback" /tmp/verify-test-output.log | grep -v "PASSED"
```

## Application Log Analysis

**Check the application's own log files for errors written during testing.**



```bash
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

## System Log Analysis (service_name=)

**If `` is empty, skip this step -- no systemd service for this project.**

If `` is not empty:
```bash
# Check recent webapp service logs (last 15 minutes)
sudo journalctl -u  --since "15 minutes ago" --no-pager 2>/dev/null | grep -iE "error|exception|traceback|critical" | head -20
```

## Pass/fail criteria

| Finding | Verdict | Action |
|---------|---------|--------|
| Tests skip due to missing resource that SHOULD be available | **FAIL** | Resource must be configured, not skipped |
| Runtime errors in test stderr despite passing | **FAIL** | Investigate error path |
| Application log errors caused by changes under review | **FAIL** | Implementation issue, block |
| Application log errors pre-existing (not from this branch) | PASS with note | **File issue immediately** (mandatory — do not ask permission), document in report |
| Service log errors after deployment | **FAIL** | Deployment issue, block |
| Only deprecation warnings from third-party libs | PASS with note | Document in report |
| No application log file (file logging disabled) | PASS | Not applicable |
| No issues found | PASS | Proceed |

**Include log analysis results in the verification report (Step 6) under a `### Log Analysis` section.**
