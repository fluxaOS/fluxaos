# Architectural Standards for fluxaos

All code in fluxaos must follow these strict architectural principles. These standards ensure maintainability, clarity, and consistency across the codebase.

---

## Non-Negotiable Implementation Rules

1. Max ~500 lines per file. Split files when needed.
2. Use modular, config-driven scripts, menus, modals, and forms.
3. Enforce DRY strictly. No exceptions without prior discussion.
4. Helper usage order: `fh-commons` helper -> existing app helper -> new helper.
5. Fail fast. No fallback behavior.
6. No hardcoded values.
7. Comply with architectural standards in this document.
8. Use true E2E testing (CLI or browser) for new and existing behavior. No mocks.
9. Web apps must complete Playwright E2E coverage for affected behavior.
10. Scripts are Python unless explicitly discussed and approved otherwise.

Reference files:
- `docs/python-functions-reference.md`
- `.claude/ARCHITECTURAL_STANDARDS.md`

---

## 1. No Hardcoded Variables

**All configuration values must come from config files.**

### ❌ Bad (Hardcoded)
```python
# BAD: Magic strings and hardcoded paths
source_dir = ".claude"
config_path = "/home/user/.config/fluxaos"
api_url = "https://example.com/api/v1"
```

### ✅ Good (Config-Driven)
```python
# GOOD: All values from config
source_dir = config['fluxaos']['source_dirs']['claude']
config_path = get_user_config_dir()  # Reads from env or defaults
api_url = config['forgejo']['api_url']
```

### Rules
- ✅ All file paths from config
- ✅ All URLs from config
- ✅ All file lists from config
- ✅ All magic strings from config or constants
- ✅ Use environment variables for overrides
- ⚠️ **Exception:** Package root via `__file__` (acceptable standard)

### Where Config Lives
- **User config:** `~/.config/fluxaos/config.json`, `projects.json`, `deployment.json`
- **Templates:** `templates/config-files/`
- **Environment overrides:** `FHC_CONFIG_DIR`, `XDG_CONFIG_HOME`

---

## 2. No Fallbacks - Fail Fast

**If config is missing, fail immediately with a clear error.**

### ❌ Bad (Silent Fallback)
```python
# BAD: Silent default hides missing config
def get_config():
    if config_file.exists():
        return load_config()
    return {'default': 'values'}  # Silent fallback!
```

### ✅ Good (Fail Fast)
```python
# GOOD: Explicit error with guidance
def get_config():
    if not config_file.exists():
        raise ConfigNotFoundError(
            f"Configuration not found: {config_file}\n"
            f"Run 'flu install' to create configuration."
        )
    return load_config()
```

### Rules
- ❌ No silent defaults
- ❌ No fallback chains (check A, then B, then C...)
- ✅ Fail fast if config missing
- ✅ Clear error messages
- ✅ Provide actionable guidance (how to fix)
- ✅ Config is THE source of truth

### Error Message Format
```python
f"Error: {what_is_wrong}\n"
f"Location: {where_it_should_be}\n"
f"Fix: {how_to_fix}"
```

**Example:**
```
Configuration not found: ~/.config/fluxaos/projects.json
Run 'flu install' to create configuration.
```

---

## 3. Config-Driven & Modular

**Everything must be configurable without code changes.**

### ❌ Bad (Hardcoded Behavior)
```python
# BAD: Adding a new file type requires code changes
def get_files():
    return [
        '.claude/WORKFLOW_GUIDE.md',
        '.claude/TOOL_REFERENCE.md',
        # Must edit code to add files!
    ]
```

### ✅ Good (Config-Driven Discovery)
```python
# GOOD: Adding files = edit config, not code
def get_files():
    config = load_config('deployment')
    pattern = config['files']['docs']  # "*.md"
    return discover_files(pattern)
```

### Rules
- ✅ Add file → update config, not code
- ✅ Change path → update config, not code
- ✅ All behavior configurable
- ✅ Modular design with clear separation
- ✅ Wildcard patterns for discovery
- ✅ Easy to extend without touching code

### Modular Design
- **Separation of concerns:** One module, one responsibility
- **Clear interfaces:** Public functions well-documented
- **Reusable components:** Don't duplicate logic
- **Easy testing:** Each module testable in isolation

---

## 4. Dynamic Path Construction

**All paths must be built dynamically from config.**

### ❌ Bad (Path Math with __file__)
```python
# BAD: Hardcoded path construction
project_root = Path(__file__).parent.parent.parent
source_dir = project_root / ".claude"
config_dir = Path.home() / ".config" / "fluxaos"
```

### ✅ Good (Helper Functions)
```python
# GOOD: Centralized path construction
from fluxaos.paths import (
    get_package_root,
    get_source_dirs,
    get_user_config_dir
)

project_root = get_package_root()  # Only place using __file__
source_dirs = get_source_dirs(config)
config_dir = get_user_config_dir()  # Respects env overrides
```

### Rules
- ✅ Use path helper functions (in `paths.py`)
- ✅ Support environment variable overrides
- ✅ All paths from config or helpers
- ❌ No direct `__file__` math (except in `get_package_root()`)
- ✅ Absolute paths (not relative)
- ✅ XDG Base Directory Specification compliance

### Available Path Helpers
```python
get_user_config_dir()        # ~/.config/fluxaos (respects overrides)
get_user_bin_dir()           # ~/.local/bin (respects overrides)
get_package_root()           # /mnt/dev/fluxaos (from __file__)
get_source_dirs(config)      # {'claude': Path, 'scripts': Path, ...}
get_target_dirs(project)     # {'claude': Path, 'commands': Path, ...}
get_config_file_path(name)   # ~/.config/fluxaos/config.json
get_template_config_path()   # src/.../templates/config.json.template
get_sync_manifest_path()     # project/.claude/.fhc-sync-manifest.json  <!-- audit-ignore: literal filename -->
```

### Environment Variable Support
```python
FHC_CONFIG_DIR=/custom/path      # Override config location
FHC_BIN_DIR=/usr/local/bin       # Override bin location
XDG_CONFIG_HOME=/custom/config   # Standard XDG override
```

---

## 5. DRY Principles

**Don't Repeat Yourself - Reuse code, don't duplicate.**

### ❌ Bad (Duplicated Logic)
```python
# BAD: Same logic in multiple places
def sync_project_a():
    files = Path('.claude').glob('*.md')
    for f in files:
        shutil.copy(f, target)

def sync_project_b():
    files = Path('.claude').glob('*.md')  # Duplicated!
    for f in files:
        shutil.copy(f, target)  # Duplicated!
```

### ✅ Good (Shared Helper)
```python
# GOOD: Single implementation, reused
def sync_files(source_dir, target_dir, pattern):
    files = source_dir.glob(pattern)
    for f in files:
        shutil.copy(f, target_dir)

# Reuse everywhere
sync_files(source, target_a, '*.md')
sync_files(source, target_b, '*.md')
```

### Rules
- ✅ Use existing helper functions
- ✅ Create new helpers for repeated logic
- ✅ No copy-paste code
- ✅ Extract common patterns
- ✅ Centralize business logic
- ✅ One source of truth

### Where to Put Helpers
- **Path operations:** `src/fluxaos/paths.py`
- **Config loading:** `src/fluxaos/config/config_loader.py`
- **File discovery:** `src/fluxaos/sync/discovery.py`
- **Git operations:** `src/fluxaos/cli/git_utils.py`
- **API calls:** `src/fluxaos/api/forgejo_client.py`

### Signs You're Violating DRY
- Copy-pasting code blocks
- Similar functions with slight differences
- Hardcoded values appearing multiple times
- Same validation logic in different places
- Repeated git/API/file operations

---

## 6. Consistent CLI Output

**Use output helpers for all user-facing messages.**

### ❌ Bad (Direct Print)
```python
# BAD: Inconsistent formatting, scattered symbols
print(f"Error: {msg}")
print(f"✓ Success!")
print(f"⚠ Warning: {msg}")
print("Processing...")
```

### ✅ Good (Output Helpers)
```python
# GOOD: Consistent formatting via helpers
from fluxaos.utils import print_error, print_success, print_warning, print_title

print_title("Processing Results")
print_error(msg)       # ✗ {msg}
print_success(msg)     # ✓ {msg}
print_warning(msg)     # ⚠ {msg}
print_info(msg)        #   {msg}
```

### Rules
- ✅ Use `print_title()` for section headers
- ✅ Use `print_error()` for error messages
- ✅ Use `print_success()` for success messages
- ✅ Use `print_warning()` for warnings
- ✅ Use `print_info()` for informational output
- ✅ Use `print_table()` for tabular data
- ❌ No direct `print()` for user-facing output

### Available Output Helpers
```python
from fluxaos.utils import (
    print_title,    # Section titles
    print_error,    # ✗ Error messages
    print_success,  # ✓ Success messages
    print_warning,  # ⚠ Warning messages
    print_info,     # Indented info
    print_table,    # Formatted tables
)
```

### Where Helpers Live
- **File:** `src/fluxaos/utils/formatting.py`
- **Import:** `from fluxaos.utils import print_error, print_success, ...`

---

## Examples from the Codebase

### ✅ Good: Config-Driven File Discovery
```python
# From setup_claude_docs.py
config = load_config('config')
deployment = load_config('deployment')

# Discover files dynamically from config
deployable = discover_deployable_files(deployment, config)

# NO hardcoded file lists!
```

### ✅ Good: Fail-Fast Config Loading
```python
# From config_loader.py
def load_config(config_name: str) -> dict:
    config_path = get_config_file_path(config_name)

    if not config_path.exists():
        raise ConfigNotFoundError(
            f"Configuration not found: {config_path}\n"
            f"Run 'flu install' to create configuration."
        )

    return json.loads(config_path.read_text())
```

### ✅ Good: Dynamic Path Construction
```python
# From paths.py
def get_user_config_dir() -> Path:
    if override := os.environ.get('FHC_CONFIG_DIR'):
        return Path(override)
    if xdg_home := os.environ.get('XDG_CONFIG_HOME'):
        return Path(xdg_home) / 'fluxaos'
    return Path.home() / '.config' / 'fluxaos'
```

### ✅ Good: DRY with Helpers
```python
# From git_quick.py - reuses existing functions
def update_main_branch(project_root: Path) -> int:
    run_git_command(['git', 'checkout', 'main'], project_root)
    run_git_command(['git', 'pull', 'origin', 'main'], project_root)
    # NOT duplicating git subprocess logic!
```

---

## Anti-Patterns to Avoid

### ❌ Magic Strings
```python
if environment == "production":  # What if we add "staging"?
```
✅ **Fix:** Use config or enum

### ❌ Hardcoded File Lists
```python
files = ['file1.md', 'file2.md', 'file3.md']
```
✅ **Fix:** Use wildcards and discovery

### ❌ Path Math
```python
parent_dir = Path(__file__).parent.parent.parent
```
✅ **Fix:** Use `get_package_root()` or path helpers

### ❌ Silent Defaults
```python
value = config.get('key', 'default_value')
```
✅ **Fix:** Fail if key missing, or document the default

### ❌ Duplicated Validation
```python
# Same validation in 3 different functions
if not isinstance(value, str):
    raise ValueError("Must be string")
```
✅ **Fix:** Create `validate_string(value)` helper

---

## Checklist for Code Review

Before submitting code, verify:

- [ ] **No hardcoded values** - All config from files
- [ ] **Fail-fast errors** - No silent fallbacks
- [ ] **Config-driven** - Changes need config edits, not code edits
- [ ] **Path helpers used** - No direct `__file__` math
- [ ] **DRY followed** - No duplicate code
- [ ] **Output helpers used** - No direct `print()` for user messages
- [ ] **Clear errors** - Actionable guidance provided
- [ ] **Modular design** - Clear separation of concerns
- [ ] **File size limit** - No files exceed ~500 lines
- [ ] **Environment overrides** - Support `FHC_*` and `XDG_*` vars
- [ ] **Documentation updated** - If adding new config or helpers

---

## 7. File Size Limit (~500 Lines)

**Keep files small and focused - maximum ~500 lines per file.**

### Why This Matters
- **LLM context:** Large files consume token budget and reduce quality
- **Readability:** Smaller files are easier to understand and review
- **Testing:** Modular files are easier to test in isolation
- **Collaboration:** Smaller files reduce merge conflicts

### ❌ Bad (Monolithic)
```python
# BAD: Single 1000+ line file doing everything
# src/service.py (1928 lines)
class Service:
    def handle_issues(self): ...      # 300 lines
    def handle_wikis(self): ...       # 400 lines
    def handle_sync(self): ...        # 350 lines
    def handle_validation(self): ...  # 500 lines
    # Everything in one giant file!
```

### ✅ Good (Modular)
```python
# GOOD: Split into focused modules
# src/service/
#   __init__.py (50 lines) - exports public API
#   issues.py (200 lines) - issue handling
#   wikis.py (180 lines) - wiki handling
#   sync.py (150 lines) - sync operations
#   validation.py (220 lines) - validation logic
```

### Rules
- ✅ Maximum ~500 lines per file (soft limit)
- ✅ One module, one responsibility
- ✅ Split when approaching 400 lines
- ✅ Use `__init__.py` to export public API
- ✅ Group related functionality in directories
- ❌ No "kitchen sink" files with unrelated functions

### How to Split Large Files

1. **Identify responsibility groups:**
   - Data models
   - Business logic
   - I/O operations
   - Validation

2. **Create package directory:**
   ```
   src/module/
   ├── __init__.py     # Public exports
   ├── models.py       # Data structures
   ├── operations.py   # Core logic
   ├── io.py          # File/network I/O
   └── validation.py  # Input validation
   ```

3. **Re-export in `__init__.py`:**
   ```python
   from .models import Config, Project
   from .operations import sync_files, validate_config
   # Users import from package, not submodules
   ```

### Signs You Need to Split

- File exceeds 400 lines
- Multiple unrelated classes in one file
- `import` section is very long
- Hard to find functions by scrolling
- Tests need complex setup to isolate functionality

---

## 8. CLI Help Maintenance

**Manually maintained help text must be kept up-to-date.**

### Passthrough Command Examples

The following git commands use passthrough to native git with manually maintained usage examples in `src/fluxaos/cli/git_parser_commands.py`:

- `stash`, `fetch`, `tag`, `show`, `blame`, `remote`, `reset`, `revert`, `cherry-pick`

These are defined in the `USAGE_EXAMPLES` dict within `register_passthrough_commands()`.

### ⚠️ Maintenance Required

When modifying these commands or if git adds new commonly-used options:

1. **Location:** `src/fluxaos/cli/git_parser_commands.py` → `USAGE_EXAMPLES` dict
2. **Update:** Add/modify examples in the epilog text
3. **Sync:** Run `fhc sync` to push changes to all projects

### Why Manual Maintenance?

These commands use `argparse.REMAINDER` to pass all arguments to native git. This provides flexibility (any git flag works) but means argparse cannot auto-generate help. The examples are manually curated to show common usage patterns.

### Example Entry
```python
USAGE_EXAMPLES = {
    'stash': '''
Examples:
  %(prog)s push -m "WIP"    Stash with message
  %(prog)s list             List all stashes
  %(prog)s pop              Apply and remove latest stash

All native git stash options are supported.''',
}
```

---

## 9. Logging Patterns

**Use project logger helpers, not logging.basicConfig().**

Scripts should not configure logging globally. Let the parent process (CLI, webapp, or test runner) configure logging. Scripts should only create loggers.

### Why This Matters
- **Conflicts:** Multiple `basicConfig()` calls cause unexpected behavior
- **Testing:** Tests need to control logging configuration
- **Consistency:** Central logging setup ensures uniform formatting
- **Deployment:** Different environments need different log handlers

### Bad (Global Configuration)
```python
# BAD: Script configures logging globally
import logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
```

### Good (Just Get Logger)
```python
# GOOD: Let parent process configure logging
import logging
logger = logging.getLogger(__name__)

# Logger will use configuration from CLI, webapp, or test runner
logger.info("Processing started")
```

### Rules
- ✅ Use `logger = logging.getLogger(__name__)`
- ✅ Let CLI/webapp entry point configure logging
- ❌ No `logging.basicConfig()` in library code
- ❌ No `logging.setLevel()` at module level
- ⚠️ **Exception:** Standalone scripts with `if __name__ == '__main__'`

### Where Logging Is Configured
- **CLI:** `src/fluxaos/cli/__init__.py` or entry point
- **Webapp:** `src/fluxaos/webapp/app.py` or factory
- **Tests:** `conftest.py` fixtures

---

## 10. Real-World Testing Only — No Mocks

**All tests must run real commands and verify real output. Mock testing is banned.**

### Why This Matters
- **Mocks test glue code** between fake interfaces — they don't catch real bugs
- **Real failures** come from unexpected git output, API changes, filesystem state — exactly what mocks hide
- **False confidence:** 1,000 mock tests passing doesn't mean the feature works

### What is BANNED — NO EXCEPTIONS

| Pattern | Banned |
|---------|--------|
| `unittest.mock` / `@patch` / `MagicMock` | Yes — always |
| `pytest-mock` / `mocker.patch()` | Yes — always |
| `Mock()` / `MagicMock()` | Yes — always |
| Dry-run mode as test substitute | Yes — run the real command |

**The pre-commit hook BLOCKS commits containing mock patterns.**

### What to Do Instead

| Situation | Do This |
|-----------|---------|
| Need a git repo | Create real repo with `git init` in `tmp_path` |
| Need a config file | Write real config to `tmp_path` |
| Need an API response | Call the real API |
| Resource unavailable | `pytest.skip("PostgreSQL not available")` |
| Pure logic function | Call it with real inputs, check real outputs |

### Rules
- ✅ Run real CLI commands via `subprocess.run`
- ✅ Use real filesystem (`tmp_path` fixture)
- ✅ Use real database (test instance, or skip)
- ✅ Use Playwright for real browser testing
- ✅ Skip unavailable resources with clear message
- ❌ No `unittest.mock` imports
- ❌ No `@patch` decorators
- ❌ No `MagicMock` or `Mock()` objects
- ❌ No `pytest-mock` library

See `docs/TESTING.md` and `.claude/E2E_TEST_STANDARDS.md` for detailed standards and examples.

---

## 11. Schema-Driven UI (Webapp Projects)

**Settings pages must use dynamic form schemas.**

Avoid hardcoding HTML forms for settings pages. Use JSON schemas and the dynamic form renderer for consistency and maintainability.

### Why This Matters
- **Consistency:** All settings pages look and behave the same
- **Maintainability:** Change schema, not template code
- **Validation:** Schema defines validation rules in one place
- **Reusability:** Same form renderer across all settings

### Bad (Hardcoded Forms)
```html
<!-- BAD: Hardcoded form in template -->
<form action="/settings/telegram" method="POST">
    <input type="text" name="bot_token" required>
    <input type="text" name="chat_id">
    <button type="submit">Save</button>
</form>
```

### Good (Schema-Driven)
```python
# GOOD: Schema in config/schemas/telegram_schema.json
# Template uses DynamicFormHelper
from fluxaos.webapp.helpers import DynamicFormHelper

schema = load_schema('telegram')
form_html = DynamicFormHelper.render(schema, current_values)
```

### Rules
- ✅ Create schema in `config/schemas/{feature}_schema.json`
- ✅ Use `DynamicFormHelper` in templates
- ✅ Use `dynamic-form-renderer.js` for client-side
- ❌ No hardcoded HTML forms for settings
- ❌ No inline validation logic in templates

### Check Before Implementation
1. Does similar UI exist? (e.g., Telegram Bot settings, SMTP settings)
2. Does it use a schema? Copy that pattern.
3. Can existing schema be extended instead of creating new one?

---

## 12. Webapp Response Patterns

**Use shared response helpers in blueprints.**

All API endpoints should return consistent JSON responses using helper functions.

### Why This Matters
- **Consistency:** Uniform response format across all endpoints
- **Error handling:** Centralized error formatting
- **Client code:** Frontend can rely on predictable structure
- **Debugging:** Consistent error responses aid troubleshooting

### Bad (Manual jsonify)
```python
# BAD: Inconsistent response construction
@bp.route('/api/save', methods=['POST'])
def save():
    try:
        do_save()
        return jsonify({'success': True, 'message': 'Saved'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500
```

### Good (Response Helpers)
```python
# GOOD: Use shared response helpers
from fluxaos.webapp.helpers import success_response, error_response

@bp.route('/api/save', methods=['POST'])
def save():
    try:
        result = do_save()
        return success_response('Saved successfully', data=result)
    except ValidationError as e:
        return error_response(str(e), status=400)
    except Exception as e:
        return error_response('Save failed', status=500)
```

### Rules
- ✅ Use `success_response()` for successful operations
- ✅ Use `error_response()` for errors
- ✅ Include appropriate HTTP status codes
- ❌ No manual `jsonify({'success': ...})` construction
- ❌ No inconsistent error response formats

### Response Format
```python
# Success response structure
{
    "success": True,
    "message": "Operation completed",
    "data": {...}  # Optional payload
}

# Error response structure
{
    "success": False,
    "error": "Error message",
    "details": {...}  # Optional error details
}
```

---

## 13. Webapp-Managed Service Registration

**Services with webapp settings pages MUST register via their blueprint.**

### Why This Matters
- **Single source of truth:** Blueprint owns the service lifecycle
- **Webapp integration:** Settings pages need access to service instance
- **Consistency:** All webapp-managed services follow the same pattern

### Bad (Direct Service Registration)
```json
{
  "instance_module": "project.services.my_service",
  "instance_getter": "get_my_service"
}
```

### Good (Blueprint Registration)
```json
{
  "instance_module": "blueprints.my_service_api",
  "instance_getter": "get_my_service_instance"
}
```

### Rules
- ✅ Register via blueprint if service has webapp settings page
- ✅ Blueprint provides `get_<service>_instance()` function
- ✅ Blueprint handles service initialization and configuration
- ❌ No direct service module registration for webapp-managed services
- ❌ No duplicate instance getters in service AND blueprint

### Check Before Implementation
1. Does this service have a webapp settings page?
2. If yes, does a blueprint exist for the API?
3. Does the blueprint have a `get_*_instance()` function?
4. Does `services.json` point to the blueprint (not the service module)?

---

## 14. CLI Framework Patterns

**CLI commands must follow the CliApp framework conventions.**

### Why This Matters
- **Config-driven:** Commands declared in `cli.json`, not hardcoded
- **Lazy loading:** Modules imported only on invocation — fast startup
- **Consistent interface:** Every command uses `register_parser()` + `execute()`
- **Clear ownership:** Project, shared, and delegated commands have distinct roles

### Rules
- ✅ Declare commands in `config/cli.json` — not hardcoded in app.py
- ✅ Command modules export `register_parser(subparsers)` and `execute(args) -> int`
- ✅ Use shared commands from fh-commons when available (don't duplicate)
- ✅ Keep command modules under ~500 lines (split business logic into services)
- ✅ Use lazy imports inside `execute()` for heavy dependencies
- ❌ Don't import command modules at the top of app.py
- ❌ Don't add fh-commons commands as project commands (use delegated/shared)
- ❌ Don't bypass the framework routing (all commands go through CliApp)

### Command Categories

| Category | Declared In | Loaded By | Example |
|----------|-------------|-----------|---------|
| Project | `cli.json` → `commands` | `_execute_project_command()` | `flu run`, `flu status` |
| Shared | `cli.json` → `shared_commands` | `_execute_shared_command()` | `flu version`, `flu doctor` |
| Delegated | `registry.py` → `DELEGATED_COMMANDS` | `_delegate_to_fhc()` | `flu git`, `flu issue` |

### Adding a New Command

1. Create module in `src/fluxaos/cli/commands/`
2. Export `register_parser(subparsers)` and `execute(args)`
3. Add entry to `config/cli.json` → `commands` section
4. Add to `src/fluxaos/cli/commands/__init__.py` → `__all__`

See `docs/cli/ADDING_COMMANDS.md` for the full guide with templates.

### See Also
- `docs/cli/ARCHITECTURE.md` — Full CLI architecture documentation
- `docs/cli/ADDING_COMMANDS.md` — Step-by-step guide for new commands

---

## References

- **Issue #27:** Architectural refactor that established these principles
- **PR #29:** Implementation of config-driven architecture
- **Issue #352:** Added usage examples to passthrough commands
- **Issue #427:** Strengthened architectural standards enforcement
- **Issue #689:** Added logging, schema-driven UI, and response helpers standards
- **Issue #692:** Added webapp-managed service registration standard
- **File:** `src/fluxaos/paths.py` - Path construction helpers
- **File:** `src/fluxaos/config/config_loader.py` - Config loading
- **File:** `src/fluxaos/cli/git_parser_commands.py` - CLI command registration
- **Doc:** `docs/INSTALLATION_WORKFLOWS.md` - Config file structure
- **Doc:** `docs/python-functions-reference.md` - Available utility functions
