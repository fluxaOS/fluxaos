

# Blockers Checklist

**STOP IMMEDIATELY if ANY blocker exists. Do NOT approve.**

## Test Verification (SHA-aware)

Before re-running tests, check if the implementer's results are still valid:

1. Read the "Ready for Review" comment's `### Test Results (for downstream phases)` section
2. Get the recorded commit SHA
3. Compare with current branch HEAD: `git rev-parse origin/<branch>`

**If SHAs match (code unchanged since implement):**
- Trust the implementer's test results — DO NOT re-run ruff or pytest
- Still check for mock patterns (static analysis, not execution)
- Still validate requirements fulfillment
- Proceed to the non-test blockers below

**If SHAs do NOT match (code changed since implement, e.g., reviewer rebased):**
- Re-run all tests as before — results are stale

**If no Test Results section found:**
- Re-run all tests — no cached results available

## Blocker Checklist

| Blocker | Check | Action |
|---------|-------|--------|
| ruff failing | `ruff check <changed-files>` shows errors (skip if SHA matches) | STOP - Fix lint errors first |
| pytest failing | `python -m pytest tests/unit/test_<module>.py` has failures (skip if SHA matches) | STOP - Fix tests first |
| CLI E2E tests not run | `tests/e2e/` tests were not executed (skip if SHA matches) | STOP - Run tests first |
| CLI E2E tests failing | Any E2E test failed (skip if SHA matches) | STOP - Report failures to user |
| Browser tests not run (webapp) | `tests/browser/` tests were not executed (skip if SHA matches) | STOP - Run tests first |
| Browser tests failing (webapp) | Any browser test failed (skip if SHA matches) | STOP - Report failures to user |
| Mock patterns detected | See mock-ban rule below | STOP — always checked, SHA irrelevant |
| Requirements not validated | Issue acceptance criteria not cross-referenced against implementation | STOP - Validate requirements first (always check) |

## If ANY blocker exists:
1. **STOP** - Do not proceed with approval
2. **POST** - Comment on the issue listing which blocker(s) exist and what is needed
3. **EXIT** - Use the On-Hold Exit procedure above to signal the manager and end the session

**There are ZERO exceptions to these blockers.**

**Mock patterns** (always check, even if SHA matches):


**Mocks are BANNED. No exceptions.**

| Banned Pattern | Why |
|----------------|-----|
| `unittest.mock` / `@patch` / `MagicMock` | Replaces real behavior with fake behavior |
| `pytest-mock` / `mocker.patch()` | Same — just a different API |
| `Mock()` / `MagicMock()` | Fake objects that hide real failures |
| Dry-run mode as test substitute | Tests must run real commands |

**The pre-commit hook BLOCKS commits containing mock patterns.**

Tests must use:
- Real `subprocess.run()` for CLI commands
- Real filesystem operations (use `tmp_path`)
- Real database/network calls (or `pytest.skip` if genuinely unavailable)
