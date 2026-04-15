

# Audit Checks Reference

## Check 1: Helper Hierarchy Compliance



Helper hierarchy compliance — use existing helpers before creating new ones.

**Priority order (MANDATORY):**
2. **Existing app helpers second** — check the project's own helper modules

No competing implementations — new code uses canonical helpers, not duplicates.

**Reference:** `docs/python-functions-reference.md` for the full helper inventory.

**Execute with Grep tool** — scan Python files in the audit scope for each reinvention pattern:

| Category | Grep Pattern | Existing Helper | Severity |
|---|---|---|---|
| Config loading | `json\.load\(open\(.*config` or `with open.*config.*json` | `load_config()`, `ConfigAdapter` from `fh_commons.config.config_loader` | HIGH |
| Git operations | `subprocess.*\["git"` or `subprocess.*"git ` | `run_git_command()`, `get_current_branch()` from `fh_commons.git` | HIGH |
| Command execution | `subprocess\.run\(` or `subprocess\.Popen\(` (non-git) | `run_command()` from `fh_commons.cli_args` | HIGH |
| Display/formatting | `\\033\[` or `\\x1b\[` (raw ANSI codes) | `Colors`, `print_error()`, `print_success()` from `fh_commons.display` | MEDIUM |
| Path resolution | `Path\(__file__\)\.parent` or `os\.path\.dirname\(__file__\)` | `get_package_root()`, `get_config_file_path()` from `fh_commons.paths` | MEDIUM |
| Timestamp creation | `datetime\.now\(\)\.strftime` or `datetime\.utcnow\(\)` | `create_timestamp()`, `format_datetime()` from `fh_commons.date_helpers` | MEDIUM |
| System detection | `platform\.system\(\)` or `sys\.platform` | `is_linux()`, `is_macos()`, `get_os_type()` from `fh_commons.system` | MEDIUM |
| Logging setup | `logging\.basicConfig` | `setup_logger()`, `get_console_logger()` from `fh_commons.log` | MEDIUM |
| Path validation | `if not.*\.exists\(\).*raise` (manual patterns) | `validate_file_exists()`, `validate_directory_exists()` from `fh_commons.validation` | MEDIUM |

**Exclusions — do NOT flag these:**
- Files inside the `fh_commons/` package itself (helpers are defined there)
- Lines containing `# audit-ignore:` marker
- Test files (`test_*.py`, `*_test.py`, `conftest.py`)

**Violation Criteria:**
- **HIGH:** Reimplementing config loading, git operations, or command execution
- **MEDIUM:** Reimplementing display, paths, timestamps, system detection, logging, or path validation

**Record format:**
```
HELPER_AVAILABLE | HIGH | src/myapp/deploy.py:23 | Manual config loading — use load_config() from fh_commons.config.config_loader
```

---

## Check 2: File Size Compliance



File size limit — no file may exceed ~500 lines.

- ✅ Files over ~500 lines must be split into logical submodules
- ✅ Files approaching 400-500 lines should be reviewed for split opportunities

**Execute:**
```bash
wc -l scripts/**/*.sh scripts/*.sh 2>/dev/null | sort -rn | head -20
find src -name "*.py" -exec wc -l {} + 2>/dev/null | sort -rn | head -20
```

**Violation Criteria:**
- **HIGH:** Files >500 lines
- **MEDIUM:** Files 400-500 lines (approaching limit)

**Record format:**
```
FILE_SIZE | HIGH | scripts/lib/config_helper.sh | 551 lines (exceeds 500 limit)
```

---

## Check 3: Hardcoded Path Detection



No hardcoded values — all paths, URLs, ports, and file lists must come from config files or helpers.

- ✅ All file paths constructed via path helpers (e.g., `fh_commons.paths`)
- ✅ All URLs loaded from configuration
- ✅ No magic strings or numbers in business logic
- ✅ Environment variables used for dynamic overrides

**Execute with Grep tool:**
```
Pattern: /home/|/Users/|/mnt/|\.claude/[^.]|/etc/|/var/
Files: **/*.sh, **/*.py
```

**Exclude legitimate patterns:**
- Comments containing paths for documentation
- Test fixtures with example paths
- Lines with `# audit-ignore:` marker

**Violation Criteria:**
- **HIGH:** Hardcoded absolute paths in code
- **MEDIUM:** Relative paths that should use helpers

**Record format:**
```
HARDCODED_PATH | HIGH | src/sync/deploy.py:45 | Hardcoded path: /home/user/.config
```

---

## Check 4: Hardcoded URL Detection

**Execute with Grep tool:**
```
Pattern: https?://[^"'\s]+
Files: **/*.sh, **/*.py
Exclude: *.md, comments, # audit-ignore
```

**Violation Criteria:**
- **HIGH:** Hardcoded API endpoints
- **MEDIUM:** Hardcoded documentation URLs
- **LOW:** Example URLs in comments

**Record format:**
```
HARDCODED_URL | HIGH | src/api/client.py:23 | Hardcoded URL: https://api.example.com
```

---

## Check 5: Fallback Pattern Detection



Fail fast — no fallbacks, no silent error swallowing.

- ✅ Configuration errors raise exceptions immediately
- ✅ No silent defaults that mask missing config
- ✅ Error messages provide clear, actionable guidance
- ✅ No backwards-compatibility fallbacks

**Execute with Grep tool:**
```
# Shell fallback patterns
Pattern: \|\| true|\|\| :|\|\| exit 0|\$\{[^}]+:-[^}]+\}
Files: **/*.sh

# Python fallback patterns
Pattern: \.get\([^,]+,\s*[^)]+\)|except.*pass|or\s+['"][^'"]+['"]
Files: **/*.py
```

**Violation Criteria:**
- **HIGH:** `|| true` or `|| :` suppressing errors
- **HIGH:** `${VAR:-default}` silent defaults (unless documented)
- **MEDIUM:** `except: pass` silent exception handling
- **MEDIUM:** `.get(key, default)` without clear documentation

**Record format:**
```
FALLBACK | HIGH | scripts/install.sh:45 | Silent fallback: || true
```

---

## Check 6: Direct Print Detection



Consistent CLI output — use output helpers, not raw print/echo.

- ✅ Use `print_error()`, `print_success()`, `print_warning()`, `print_info()` from `fh_commons.display`
- ✅ Consistent error message structure across commands
- ✅ Proper logging levels (`logger.debug/info/warning/error`)
- ✅ No raw `print()` calls for user-facing output

**Execute with Grep tool:**
```
# Python direct prints
Pattern: ^[^#]*print\s*\(
Files: src/**/*.py
Exclude: print_error, print_success, print_warning, print_info, print_title, print_table

# Shell direct echo (user-facing)
Pattern: echo\s+["'][^"']*["']\s*$
Files: scripts/**/*.sh
```

**Violation Criteria:**
- **MEDIUM:** Direct `print()` in Python without helper
- **LOW:** Direct `echo` in shell for user messages

**Record format:**
```
DIRECT_PRINT | MEDIUM | src/cli/commands.py:78 | Direct print() instead of print_success()
```

---

## Check 7: Duplicate Code Detection (DRY Violations)



DRY — no duplicated code blocks; common patterns abstracted into helpers.

- ✅ No identical code blocks appearing in multiple places
- ✅ Common patterns extracted into reusable helpers
- ✅ No copy-paste of logic that could be shared

**Execute:**
```bash
grep -rn "^def \|^function " src/ scripts/ | sort
grep -rn "if not.*exists" src/ scripts/ | wc -l
```

**Violation Criteria:**
- **HIGH:** Identical code blocks >5 lines appearing 2+ times
- **MEDIUM:** Similar validation logic in multiple places
- **LOW:** Similar function signatures

**Record format:**
```
DRY_VIOLATION | MEDIUM | Multiple files | Repeated validation pattern: "if not config_path.exists()"
```

---

## Check 8: Magic Strings/Numbers Detection

**Execute with Grep tool:**
```
Pattern: [^0-9][2-9][0-9]{2,}|[^0-9][1-9][0-9]{3,}
Files: **/*.py, **/*.sh

Pattern: ["']production["']|["']development["']|["']staging["']
Files: **/*.py, **/*.sh
```

**Violation Criteria:**
- **MEDIUM:** Magic numbers (timeouts, limits, etc.)
- **LOW:** Environment name strings

**Record format:**
```
MAGIC_VALUE | MEDIUM | src/config/loader.py:34 | Magic number: 3600 (should be CACHE_TTL constant)
```

---

## Check 9: Runtime Log Audit — MANDATORY (NO EXCEPTIONS)

**Rule:** Every code audit MUST include a runtime log check. Skipping is NOT permitted.

**A. System log check:**
```bash
sudo journalctl -u <service-name> --since "15 minutes ago" --no-pager 2>/dev/null | grep -iE "error|exception|traceback|critical|fatal" | head -20
```

**B. Application log file check:**



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

**Violation Criteria:**
- **HIGH:** Recurring ERROR/EXCEPTION/CRITICAL/FATAL entries
- **MEDIUM:** Repeated warnings indicating degradation
- **LOW:** Occasional transient errors from external dependencies

**Record format:**
```
RUNTIME_LOG | HIGH | Application log | Recurring ImportError: module 'xyz'
```

| Finding | Action |
|---------|--------|
| Active runtime errors | Record as HIGH violation; include in draft issue |
| Repeated warnings | Record as MEDIUM violation |
| No log errors | Record as PASS |
| No log file / not applicable | Record as N/A |
