
# Test Standards

**Run the real command. Verify real output. No mocks. No exceptions.**

---

## Testing Philosophy

| Tool | Purpose | Required |
|------|---------|----------|
| **ruff** | Lint/syntax checking | ALWAYS |
| **pytest** | Run ACTUAL commands with real execution | ALWAYS |
| **Playwright** | Real browser testing for webapps | ALWAYS (webapp) |

### What is BANNED — NO EXCEPTIONS

| Pattern | Why it's banned |
|---------|----------------|
| `unittest.mock` / `@patch` / `MagicMock` | Replaces real behavior with fake behavior |
| `pytest-mock` / `mocker.patch()` | Same — just a different API |
| `Mock()` / `MagicMock()` | Fake objects that hide real failures |
| Dry-run mode as test substitute | Tests must run real commands |
| Any pattern that fakes behavior | If it's not real, it's not a test |

**The pre-commit hook BLOCKS commits containing mock patterns.**

### What to do instead of mocking

| Situation | Wrong (mock) | Right (real) |
|-----------|-------------|--------------|
| Need a git repo | `mock.patch('subprocess.run')` | `tmp_path` + `git init` (real repo) |
| Need config file | `mock.patch('load_config')` | Write real config to `tmp_path` |
| Need API response | `mock.patch('requests.get')` | Call real API (or skip if unavailable) |
| Resource unavailable | Mock it | `pytest.skip("PostgreSQL not available")` |

---

## CLI Test Standards

### Requirements

All CLI tests MUST:
- Run the actual CLI command via `subprocess.run`
- Operate on real filesystem (use `tmp_path` fixture)
- Make real database calls (use test database, or skip)
- Verify real output (stdout, stderr, exit codes)

### CLI Test Template

```python
import subprocess
from pathlib import Path

def test_cli_command(tmp_path):
    """Run real CLI command and verify real output."""
    # Setup: Create real test data
    test_file = tmp_path / "input.txt"
    test_file.write_text("test content")

    # Execute: Run REAL CLI command
    result = subprocess.run(
        ['flu', 'process', str(test_file)],
        capture_output=True,
        text=True,
        cwd=tmp_path
    )

    # Verify: Check REAL results
    assert result.returncode == 0
    assert 'Processed successfully' in result.stdout
    assert (tmp_path / "output.txt").exists()
    assert (tmp_path / "output.txt").read_text() == "expected content"
```

### What Makes a Good CLI Test

| Requirement | Good | Bad |
|-------------|------|-----|
| Real execution | `subprocess.run(['flu', 'cmd'])` | `mock.patch('subprocess.run')` |
| Real filesystem | `Path(tmp_path) / 'test.txt'` | `mock.patch('pathlib.Path')` |
| Real output | `assert 'Success' in result.stdout` | `mock.return_value = 'Success'` |
| Exit codes | `assert result.returncode == 0` | (not checked) |

### Git Command Tests

```python
import subprocess

def test_git_status(tmp_path):
    """Test git status with real git repo."""
    # Create real git repo
    subprocess.run(['git', 'init'], cwd=tmp_path, capture_output=True)
    subprocess.run(['git', 'config', 'user.name', 'Test'], cwd=tmp_path, capture_output=True)
    subprocess.run(['git', 'config', 'user.email', 'test@test.com'], cwd=tmp_path, capture_output=True)

    # Create a file and stage it
    (tmp_path / 'file.txt').write_text('content')
    subprocess.run(['git', 'add', '.'], cwd=tmp_path, capture_output=True)

    # Run real CLI command
    result = subprocess.run(
        ['flu', 'git', 'status'],
        capture_output=True,
        text=True,
        cwd=tmp_path
    )

    assert result.returncode == 0
    assert 'file.txt' in result.stdout
```

---

## Browser Tests vs Integration Tests

### Flask Test Client is NOT a Browser Test

Flask's test client (`app.test_client()`) sends HTTP requests directly to the app without a real browser. It is an **integration test**, NOT a browser test. Tests using the `client` fixture in `tests/browser/` must be moved to `tests/integration/` or rewritten with Playwright.

| Fixture | Type | Runs Real Browser? | Executes JS? | Tests Cache/Cookies? |
|---------|------|-------------------|-------------|---------------------|
| `client` (Flask) | Integration test | NO | NO | NO |
| `browser_page` (Playwright) | Browser test | YES | YES | YES |
| `live_page` (Playwright) | Browser test | YES | YES | YES |
| `page` (Playwright) | Browser test | YES | YES | YES |

**Why this matters:** The Flask test client hides entire categories of bugs:
- JavaScript failures (dropdowns, toggles, dynamic UI)
- Browser cookie/session/cache behavior (logout flows)
- CSS rendering issues (layout, responsive design)
- Real deployment stack issues (static files, CORS, redirects)

### Canonical Test Directory Structure

```
tests/
├── conftest.py       # Shared fixtures (temp_git_repo, sample_config, etc.)
├── unit/             # Pure logic tests (no external services)
│   └── conftest.py   # Test-specific fixtures
├── integration/      # Flask test client, API endpoint tests (no real browser)
│   └── conftest.py   # Flask app/client fixtures
└── browser/          # Playwright ONLY — real Chromium browser
    └── conftest.py   # Playwright fixtures (browser_page, live_page, page)
```

| Directory | What Belongs Here | What Does NOT Belong |
|-----------|-------------------|---------------------|
| `tests/unit/` | Pure function tests, real filesystem via `tmp_path` | Flask client tests, Playwright tests |
| `tests/integration/` | Flask test client, real API calls without browser | Playwright tests, mock tests |
| `tests/browser/` | **Playwright only** — every test uses Playwright fixtures | Flask `client` fixture — **BANNED** |

---

## Browser Test Standards

### The Functional Test Gate — NO EXCEPTIONS

Every browser test MUST include at least ONE of:

| Test Type | Required Elements | Example |
|-----------|------------------|---------|
| API verification | `page.request.*` + `.json()` assertion | `assert response.json()['status'] == 'ok'` |
| Form submission | `page.fill` + `page.click` + state assertion | Fill form, submit, verify database |
| State persistence | Action + reload + verify | Toggle setting, refresh, verify persisted |

### Tests That FAIL the Gate

```python
# FAILS - Visibility only
def test_settings_page(page):
    page.goto('/settings')
    assert page.locator('#form').is_visible()  # NOT SUFFICIENT

# FAILS - Element count only
def test_items_exist(page):
    page.goto('/items')
    assert page.locator('.item').count() > 0  # NOT SUFFICIENT

# FAILS - Page loads only
def test_dashboard(page):
    page.goto('/dashboard')
    assert page.title() == 'Dashboard'  # NOT SUFFICIENT
```

### Tests That PASS the Gate

```python
# PASSES - API call with data verification
def test_api_returns_data(page):
    response = page.request.get('/api/items')
    data = response.json()
    assert data['count'] > 0
    assert 'items' in data
    assert data['items'][0]['id'] is not None

# PASSES - Form submission with state change
def test_create_item(page):
    page.goto('/items/new')
    page.fill('#name', 'Test Item')
    page.fill('#description', 'Test Description')
    page.click('button[type="submit"]')

    # Verify state changed
    page.wait_for_url('/items/*')
    assert page.locator('.item-name').text_content() == 'Test Item'

    # Verify in database via API
    response = page.request.get('/api/items')
    items = response.json()['items']
    assert any(i['name'] == 'Test Item' for i in items)

# PASSES - State persistence verification
def test_toggle_persists(page):
    page.goto('/settings')
    initial = page.locator('#dark-mode').is_checked()
    page.click('#dark-mode')
    page.reload()
    assert page.locator('#dark-mode').is_checked() != initial
```

---

## Browser Test Screenshots

### Targeted Test Runs

**Run ONLY the browser test files relevant to your changes — NOT the entire `tests/browser/` suite.**

```bash
# CORRECT: Run targeted tests
python -m pytest tests/browser/test_auth_flow.py -v

# WRONG: Full suite wastes time and obscures results
python -m pytest tests/browser/ -v
```

### Configuration (Synced from fh-commons)

The screenshot directory is defined in `config/shared.json`, which is synced to all projects by `fhc sync`:

```json
{
  "testing": {
    "browser_tests": {
      "screenshot_dir": "tests/browser/screenshots"
    }
  }
}
```

**Do NOT edit `config/shared.json` in your project** — it is managed by fh-commons. If you need to override, use your project's `config/cli.json` as a fallback.

### Screenshot-on-Failure Fixture (REQUIRED)

Every project with browser tests MUST have this in `tests/browser/conftest.py`:

```python
import json
import pytest
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent.parent

def _get_screenshot_dir() -> Path:
    """Read screenshot directory from config/shared.json (synced from fh-commons)."""
    try:
        shared_config = json.loads((PROJECT_ROOT / "config" / "shared.json").read_text())
        rel_path = (
            shared_config.get("testing", {})
            .get("browser_tests", {})
            .get("screenshot_dir", "")
        )
        if rel_path:
            return PROJECT_ROOT / rel_path
    except Exception:
        pass
    raise FileNotFoundError(
        "testing.browser_tests.screenshot_dir not found in config/shared.json. "
        "Run 'fhc sync' to get the shared config from fh-commons."
    )

SCREENSHOT_DIR = _get_screenshot_dir()

@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item, call):
    """Capture screenshot on test failure."""
    outcome = yield
    report = outcome.get_result()

    if report.when == "call" and report.failed:
        page = item.funcargs.get("page") or item.funcargs.get("authenticated_page")
        if page and hasattr(page, "screenshot"):
            SCREENSHOT_DIR.mkdir(exist_ok=True)
            test_name = item.name.replace("/", "_").replace("::", "_")
            screenshot_path = SCREENSHOT_DIR / f"FAILED_{test_name}.png"
            try:
                page.screenshot(path=str(screenshot_path))
                print(f"\nScreenshot saved: {screenshot_path}")
            except Exception as e:
                print(f"\nFailed to capture screenshot: {e}")
```

### Screenshot Evidence (REQUIRED)

**"N tests passed" is NOT evidence that the browser rendered the correct page.** After browser tests pass, capture screenshots of the key UI states your changes affect.

```bash
# Read screenshot dir from config (config-driven, not hardcoded)
SCREENSHOT_DIR=$(python3 -c "
import json
from pathlib import Path
root = Path('.')
cfg = json.loads((root / 'config' / 'shared.json').read_text())
print(root / cfg['testing']['browser_tests']['screenshot_dir'])
" 2>/dev/null)
mkdir -p "$SCREENSHOT_DIR"

python3 -c "
import json
from pathlib import Path
root = Path('.')
cfg = json.loads((root / 'config' / 'shared.json').read_text())
ss_dir = root / cfg['testing']['browser_tests']['screenshot_dir']

from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    page.goto('http://localhost:5002/<route>')
    page.screenshot(path=str(ss_dir / '<feature>.png'))
    browser.close()
"
```

**What to capture:**

| Scenario | Screenshot |
|----------|-----------|
| New feature | The page showing the feature working |
| Bug fix | The page in the state that was previously broken |
| Login/auth changes | Login page + post-login dashboard |
| Form changes | Form filled + success state after submit |

**Report screenshot file paths in the PR/issue comment.**

---

## Unavailable Resources

When a test needs a resource that isn't always available (PostgreSQL, external API, browser), **skip with a clear message** — never mock it.

```python
import pytest
import os

def require_postgres():
    """Skip if PostgreSQL not available."""
    if not os.environ.get('TEST_POSTGRES_PASS'):
        pytest.skip(
            "PostgreSQL not available.\n"
            "Set: export TEST_POSTGRES_PASS='password'"
        )

def test_database_backup(tmp_path):
    """Test real database backup."""
    require_postgres()

    result = subprocess.run(
        ['flu', 'db', 'backup', '--database', 'test_db'],
        capture_output=True,
        text=True
    )
    assert result.returncode == 0
    # Verify real backup file was created
```

---

## Adjacent Functionality Testing

### Definition

"Adjacent" code is any code that depends on or uses the code you changed.

### Finding Adjacent Code

```bash
# For a changed module
MODULE="file_cleaner"

# Find Python imports
grep -r "from.*$MODULE import" src/
grep -r "import.*$MODULE" src/

# Find CLI commands that use it
grep -r "$MODULE" src/cli/
```

### Testing Adjacent Code

For each adjacent file found:
1. Identify its test file (`src/module/file.py` -> `tests/*/test_file.py`)
2. Add or update tests to cover the integration
3. Verify the integration still works with your changes

---

## Test Review Checklist

| Question | Required Answer |
|----------|-----------------|
| Does test run a real command or call a real API? | Yes |
| Does test verify real output data, not just status? | Yes |
| Would test fail if the feature is broken? | Yes |
| Does test use `unittest.mock`, `@patch`, or `MagicMock`? | **No — BANNED** |
| Does test use `mocker.patch()` (pytest-mock)? | **No — BANNED** |
| For unavailable resources: does it `pytest.skip()`? | Yes |

**If any answer is wrong, the test must be rewritten.**

---

## Encountering Test Failures

**NEVER assume a test failure is pre-existing. ALWAYS investigate.**

When tests fail during your work, follow this exact process:

### Step 1: Determine the cause

```bash
# Switch to the base branch and run the same test
git stash
git checkout origin/main
python -m pytest tests/unit/test_<failing_module>.py -v 2>&1 | tail -20

# Return to your branch
git checkout -
git stash pop
```

| Result on base branch | Conclusion | Action |
|----------------------|------------|--------|
| Test passes on base, fails on yours | **Your changes broke it** | Fix it before proceeding |
| Test fails on both branches | **Pre-existing failure** | File an issue (see Step 2) |
| Cannot test on base (infrastructure) | **Unknown** | State this explicitly — do not guess |

### Step 2: Take mandatory action

- **Your bug:** Fix it. Do not proceed until the test passes.
- **Pre-existing:** File an issue immediately. Do not ask permission.
  ```bash
  flu issue create --template quick-bug --title "[BUG] <test_name> failing: <brief description>"
  ```
- **Unknown origin:** Document what you found and why you cannot determine the cause.

**Anti-patterns — these are NEVER acceptable:**
- "These failures look pre-existing" — without checking the base branch
- "Should I file an issue?" — just file it, no permission needed
- "12 tests fail but they're probably not related" — verify, don't guess

---

## Summary

| Principle | Requirement |
|-----------|-------------|
| Run real commands | `subprocess.run`, not mocked calls |
| Verify real output | Check stdout, files, database state |
| No mocks ever | `unittest.mock` is banned entirely |
| Skip if unavailable | `pytest.skip()` with clear message |
| Test adjacent code | All callers/consumers of changed code |
| Fail when broken | Tests catch real bugs, not fake ones |
| Investigate failures | Never assume — verify cause on base branch |
| File issues | Every pre-existing problem gets an issue filed |
