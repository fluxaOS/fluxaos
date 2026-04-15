

# Browser Verification

**If `false` is `false`, skip this entire section -- this project has no webapp component.**

**⚠️ REQUIRED if `false` is `true`.** This is NOT optional testing.

**Skip ONLY if:**
- `false` is `false` (CLI-only, library, etc.)
- Changes are purely backend with ZERO UI impact

**MUST RUN if ANY of these apply:**
- Project has a webapp (even if changes seem unrelated)
- Changes affect routes, templates, or frontend code
- Changes affect APIs that the webapp consumes
- Issue mentions webapp, UI, or frontend

## Check Browser Testing Availability

```bash
# Check if browser testing is available
python -c "from fluxaos.browser import BROWSER_AVAILABLE; print('AVAILABLE' if BROWSER_AVAILABLE else 'NOT_AVAILABLE')" 2>/dev/null || echo "NOT_AVAILABLE"
```

## Run Browser Verification

Run the verify-webapp skill.

**If browser testing is not configured:** Flag this as a blocker. Webapp projects MUST have browser testing configured.

## Browser Verification Checklist

- [ ] All webapp routes load without errors
- [ ] UI elements render correctly
- [ ] User interactions work as expected
- [ ] No JavaScript console errors
- [ ] Responsive design intact (if applicable)

## Browser Test Quality Review

**CRITICAL:** Verify tests follow BROWSER_TEST_STANDARDS.md - shallow tests provide false confidence.

For each browser test file, check:
- [ ] Does test call an API endpoint or perform a form submission?
- [ ] Does test verify response data, not just HTTP status?
- [ ] Does test complete a user flow, not just load a page?
- [ ] Would test fail if the feature is actually broken?
- [ ] Are there tests with ONLY `.is_visible()` assertions? (Flag as insufficient)
- [ ] Are there tests under 5 lines? (Flag as potentially too shallow)
- [ ] Does any test in `tests/browser/` use the `client` fixture instead of Playwright? (Flag as **NOT A BROWSER TEST**)

**Red flags that indicate shallow tests:**
- Tests that only check element visibility
- Tests with no `page.request.*` calls
- Tests with no `page.click()` or `page.fill()` actions
- Tests that pass with "47 tests passed" but feature is broken
- Tests using Flask `client` fixture in `tests/browser/` — these are integration tests, not browser tests

**If browser tests exist but don't meet these criteria, flag as INSUFFICIENT in report.**

## Mandatory Functional Test Gate

**This gate is BLOCKING.** Browser verification MUST include at least one of:

| Functional Test Type | Example | Passes Gate? |
|---------------------|---------|-------------|
| API call + response data check | `response = page.request.get('/api/...'); assert response.json()['key'] == expected` | YES |
| Form submission + state change | `page.fill('#field', 'value'); page.click('button'); assert page.locator('.result').text_content() == 'Saved'` | YES |
| User flow with side effect | Click toggle, reload page, verify toggle state persisted | YES |
| Element visibility only | `assert page.locator('#form').is_visible()` | **NO - FAIL** |
| Page loads without error | `page.goto('/settings'); assert page.title()` | **NO - FAIL** |
| Element count check | `assert page.locator('.item').count() > 0` | **NO - FAIL** |

**Enforcement:**
1. Read each browser test file in `tests/browser/`
2. For each test function, check if it contains at least one:
   - `page.request.get`, `page.request.post`, `page.request.put`, `page.request.delete` (API call)
   - `page.fill` + `page.click` (form interaction)
   - Response `.json()` or `.text()` assertion on returned data
   - State change verification (action + reload + verify)
3. If ANY test function has ONLY visibility/existence checks (`.is_visible()`, `.count()`, `.to_be_visible()`), mark Browser Verification as **FAIL**
4. Check if any test function in `tests/browser/` uses the `client` fixture:
   - `def test_*(self, client)` or `def test_*(client)` in browser test files
   - `@pytest.fixture(autouse=True)` that injects `client`
   - If found, mark Browser Verification as **FAIL — Flask test client in browser tests**
5. Report the specific test functions that are insufficient

**If gate fails, the verification report MUST show:**
```
Browser Verification: FAIL - Insufficient functional coverage

Insufficient tests:
- test_settings_page: Only checks element visibility, no API call or form submission
- test_config_form: Only checks element count, no response data verification

Required: Each test must call an API endpoint OR submit a form AND verify response data/state change.
Reference: BROWSER_TEST_STANDARDS.md
```

## Screenshot Evidence Check

**Verify that the implementer captured screenshot evidence of the feature working.**

```bash
# Read screenshot dir from config (config-driven, not hardcoded)
SCREENSHOT_DIR=$(python3 -c "
import json
from pathlib import Path
root = Path('.')
cfg = json.loads((root / 'config' / 'shared.json').read_text())
print(root / cfg['testing']['browser_tests']['screenshot_dir'])
" 2>/dev/null)

# Check for screenshot evidence
ls -la "$SCREENSHOT_DIR" 2>/dev/null
# Check for screenshot-on-failure fixture
grep -l "screenshot" tests/browser/conftest.py 2>/dev/null
```

- [ ] `config/shared.json` exists (synced from fh-commons) with `testing.browser_tests.screenshot_dir`
- [ ] Screenshots exist in the configured directory showing the feature's key UI states
- [ ] Screenshots show the actual rendered page (not just test output)
- [ ] Screenshot-on-failure conftest fixture reads screenshot dir from `config/shared.json` (not hardcoded)

**If no screenshots were captured:** Flag as insufficient evidence. "N tests passed" alone does not prove the browser rendered the correct page.

**CRITICAL:** Do not proceed to PR if browser verification fails on a webapp project.
