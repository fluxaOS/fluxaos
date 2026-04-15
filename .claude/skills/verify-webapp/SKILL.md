---
model: sonnet
---
# Verify Webapp

Run browser-based verification of webapp functionality.

**CRITICAL:** Use `flu git` commands (NOT `gh` or `tea`)

## Usage

```bash
/verify-webapp              # Run basic webapp health check
/verify-webapp --full       # Run full verification including login flow
/verify-webapp --url <url>  # Test specific URL
```

**Arguments:** `$ARGUMENTS`

## Pre-Flight Check

**First, check project capabilities:**

If `false` is `false`:
```
This project (fluxaos) is not a webapp. Skipping browser verification.
```
**STOP — do not proceed.**

If `false` is `true`, check if browser testing is available in this project:

```bash
# Check for browser module
python -c "from fluxaos.browser import BROWSER_AVAILABLE; print('AVAILABLE' if BROWSER_AVAILABLE else 'NOT_AVAILABLE')" 2>/dev/null || echo "NOT_AVAILABLE"
```

**If browser testing is NOT available:**

```
Browser testing is not configured for this project.

To enable browser testing:
1. Add [browser] extra to pyproject.toml dependencies
2. Install with: pip install fluxaos[browser]
3. Install Chromium: playwright install chromium

Skipping browser verification.
```

**If browser testing IS available:** Proceed with verification steps below.

## Verification Steps

### Step 1: Parse Arguments

Parse optional arguments from `$ARGUMENTS`:
- `--full`: Run complete verification including login flow
- `--url <url>`: Override default webapp URL
- No arguments: Run basic health check only

### Step 2: Basic Health Check

Run the webapp health check:

```python
from fluxaos.browser import BROWSER_AVAILABLE

if not BROWSER_AVAILABLE:
    print("Browser testing not available")
    exit(0)

# Check if project has BrowserHealthCheck utility
try:
    from fluxaos.browser import BrowserHealthCheck
    is_healthy, message = BrowserHealthCheck.webapp_is_responding()
    print(f"Health check: {'PASS' if is_healthy else 'FAIL'}")
    print(f"Details: {message}")
except ImportError:
    # Fall back to basic browser check
    from fh_commons.browser import BrowserSession

    try:
        with BrowserSession(timeout=10000) as browser:
            browser.goto("http://localhost:5002")  # Default webapp URL
            title = browser.title()
            print(f"Health check: PASS")
            print(f"Page title: {title}")
    except Exception as e:
        print(f"Health check: FAIL")
        print(f"Error: {e}")
```

### Step 3: Functional Verification (if --full flag)

**CRITICAL:** This step MUST test actual functionality, not just element existence.
Element visibility checks alone are **insufficient** per BROWSER_TEST_STANDARDS.md.

If `--full` argument is provided, run functional verification:

```python
from fluxaos.browser import BROWSER_AVAILABLE

if not BROWSER_AVAILABLE:
    print("Browser testing not available")
    exit(0)

from fh_commons.browser import BrowserSession

with BrowserSession() as browser:
    # Navigate to webapp
    browser.goto("http://localhost:5002")

    # Take screenshot of initial state
    browser.screenshot("/tmp/verify-webapp-01-initial.png")
    print("Screenshot saved: /tmp/verify-webapp-01-initial.png")

    # --- FUNCTIONAL TESTS (not just element existence) ---

    # 1. Test API endpoints return valid data
    response = browser.request.get("http://localhost:5002/api/health")
    assert response.status == 200, f"Health API returned {response.status}"
    data = response.json()
    assert "status" in data, "Health API response missing 'status' field"
    print(f"API health check: PASS (status={data['status']})")

    # 2. Test service-specific APIs if applicable
    # For each registered service, verify its API responds with valid data
    # Example: GET /api/<service>/status should return service state
    # response = browser.request.get("http://localhost:5002/api/<service>/status")
    # assert response.ok, f"Service API returned {response.status}"
    # assert response.json().get("success") is not None

    # 3. Test form submission flow (not just form visibility)
    # Navigate to a settings page, fill a field, submit, verify response
    # page.fill('#setting-field', 'test-value')
    # page.click('button[type="submit"]')
    # Verify the save API returned success:
    # assert page.locator('.success-message').text_content() contains 'saved'
    # OR verify via API: response = browser.request.get('/api/settings')
    # assert response.json()['setting-field'] == 'test-value'

    # 4. Verify no error indicators on key pages
    body_text = browser.text("body")
    if "error" in body_text.lower() or "exception" in body_text.lower():
        print("WARNING: Possible error on page")
        browser.screenshot("/tmp/verify-webapp-error.png")

    print("Functional verification complete")
```

#### What Counts as Functional Verification

| Test Type | Sufficient? | Why |
|-----------|-------------|-----|
| Call API endpoint + check response JSON | YES | Verifies backend logic works |
| Submit form + verify state changed | YES | Verifies end-to-end flow |
| Click action + reload + verify persistence | YES | Verifies side effects |
| Check element `.is_visible()` only | **NO** | Element can exist while feature is broken |
| Check element `.count() > 0` only | **NO** | Elements render from template, not from working logic |
| Check page title only | **NO** | Page loads even with broken services |

**Every functional test MUST:**
1. Perform an action (API call, form submit, button click)
2. Verify the RESULT of that action (response data, state change, side effect)

**A test that only checks "does the page render" is NOT a functional test.**

### Step 4: Generate Report

Output verification results in a structured format:

```
## Webapp Verification Report

### Environment
- Project: fluxaos
- Browser Testing: AVAILABLE/NOT_AVAILABLE
- URL Tested: [url]

### Functional Test Results
- Health API: PASS/FAIL (response data verified)
- Service APIs: PASS/FAIL/NOT_TESTED (response data verified)
- Form Submission: PASS/FAIL/NOT_TESTED (state change verified)
- Error Indicators: NONE/FOUND

### Screenshots
- Initial state: /tmp/verify-webapp-01-initial.png
- [Additional screenshots if applicable]

### Verification Quality
- Functional tests run: [count]
- API endpoints tested: [count]
- Form submissions tested: [count]
- Element-only checks (insufficient): [count - should be 0]

### Recommendations
[Any issues found or next steps]
```

### Step 5: Application Log Check — MANDATORY (NO EXCEPTIONS)

**You MUST check application logs for runtime issues that tests may not catch. This step is NOT conditional — execute it every time. Skipping is NOT permitted under any circumstances.**

```bash
# Check webapp service logs for recent errors (last 15 minutes)
sudo journalctl -u <service-name> --since "15 minutes ago" --no-pager 2>/dev/null | grep -iE "error|exception|traceback|critical" | head -20

# If service name unknown, check common patterns
sudo journalctl -u "*webapp*" --since "15 minutes ago" --no-pager 2>/dev/null | grep -iE "error|exception|traceback" | head -10
```

**B. Application log file check:**



```bash
LOG_DIR=$(flu logs list 2>&1 | head -1 | sed -n 's/.*(\(.*\)).*/\1/p')
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

**Include in the verification report:**

```
### Application Log Check
- **Service logs:** PASS/FAIL [error count and summary]
- **Application log file:** PASS/FAIL [error count and summary]
- **Browser console errors:** [count from functional tests, or N/A]
```

**Pass/fail criteria:**

| Finding | Verdict | Action |
|---------|---------|--------|
| No errors in service or app logs | PASS | Include in report |
| Errors related to the tested feature | **FAIL** | Report as blocking issue |
| Pre-existing errors unrelated to current changes | PASS with note | **File issue immediately** (`flu issue create --template quick-bug --title "[BUG] <component>: <what failed>" --body "<actual error output, file path, and details>"` then `flu issue update <number> --priority medium`) then proceed |
| No log file / service not running | PASS with note | Note unavailability in report |

## Graceful Degradation

This command is designed to gracefully handle projects without browser testing:

1. **No browser module:** Skip verification with informative message
2. **Playwright not installed:** Provide installation instructions
3. **Webapp not running:** Report connection failure, suggest starting webapp
4. **Timeout errors:** Report timeout, suggest checking webapp status

## Error Handling

### Connection Refused

```
ERROR: Could not connect to webapp at [url]

Possible causes:
1. Webapp is not running
2. Wrong URL or port
3. Firewall blocking connection

Try:
- Start the webapp: flu webapp start (if available)
- Check the URL: flu config get webapp.url (if available)
- Test manually: curl [url]
```

### Timeout

```
ERROR: Page load timed out after 30 seconds

Possible causes:
1. Webapp is slow to respond
2. Large page with many resources
3. Network issues

Try:
- Check webapp logs for errors
- Try with --url flag to test specific page
- Increase timeout if needed
```

## Integration Notes

This command integrates with:
- **fh_commons.browser:** Shared BrowserSession for automation
- **Project-specific browser module:** fluxaos.browser if available
- **Claude Code workflows:** Called from the finish skill for webapp projects

The command works across all projects that sync from fh-commons, respecting that browser testing is optional and project-specific.
