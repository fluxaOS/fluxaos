# 2026-05-08 fluxaOS fhc sync receipt

Scope: reconcile post-fh-commons #3374 drift for fluxaOS issue templates and root files only. Hippo remains excluded from this sync wave.

## Source state

- fh-commons source: clean `origin/main` at `af2e4bfc` (`fix(sync): validate rendered template drift (#3374)`).
- fluxaOS pre-check: clean `origin/main` worktree at `e927928`.
- fluxaOS target branch: `chore/sync-fhc-templates-2026-05-08`.

## Pre-sync validation receipt

Command:

```bash
FHC_CONFIG_DIR=/tmp/fhc-config-pre ./fhc validate-sync --project fluxaos --verbose
```

Output:

```text

=== Sync Validation Results ===

fluxaos:
✓   skills-claude: in sync
✓   skills-codex: in sync
✓   reference-docs: in sync
✓   hooks: in sync
✓   gitignore: in sync
✗   issue-templates: 5 files out of sync
    outdated: documentation-task.md (Source is newer)
    outdated: new-docker-project.md (Source is newer)
    outdated: bug-report.md (Source is newer)
    outdated: feature-request.md (Source is newer)
    outdated: delegate-command.md (Source is newer)
✗   root-files: 1 files out of sync
    missing: ARCHITECTURAL_STANDARDS.md (File missing in target)
✗
 1 project(s) have drift
ℹ To fix drift, run:
ℹ   fhc sync                    # sync all projects
ℹ   fhc validate-sync --fix     # auto-fix drift
```

## Sync receipt

```text
$ FHC_NONINTERACTIVE=1 ./fhc sync --project fluxaos --target issue-templates --verbose
Result: exit 1 after writing issue-template files; blocked by unrelated verify-rollout drift already routed outside this sync wave.
Changed files observed: documentation-task.md, new-docker-project.md, bug-report.md, quick-bug.md, feature-request.md, delegate-command.md (quick-bug had no git diff).

$ FHC_NONINTERACTIVE=1 ./fhc sync --project fluxaos --target root-files --verbose
Result: root file already present on disk from the same clean fhc origin/main render; it is gitignored, so this PR force-adds ARCHITECTURAL_STANDARDS.md.
Verification: `ARCHITECTURAL_STANDARDS.md` matches `templates/root-files/ARCHITECTURAL_STANDARDS.md` rendered with PROJECT=fluxaos, PACKAGE=fluxaos, CLI=''.
```

## Post-sync validation receipt

Command:

```bash
./fhc validate-sync --project fluxaos --verbose
```

Output:

```text

=== Sync Validation Results ===

fluxaos:
✓   skills-claude: in sync
✓   skills-codex: in sync
✓   reference-docs: in sync
✓   hooks: in sync
✓   gitignore: in sync
✓   issue-templates: in sync
✓   root-files: in sync
✓
 All downstream projects are in sync
```

## Changed files

- `.github/ISSUE_TEMPLATE/bug-report.md`
- `.github/ISSUE_TEMPLATE/delegate-command.md`
- `.github/ISSUE_TEMPLATE/documentation-task.md`
- `.github/ISSUE_TEMPLATE/feature-request.md`
- `.github/ISSUE_TEMPLATE/new-docker-project.md`
- `ARCHITECTURAL_STANDARDS.md`
- `docs/sync-waves/2026-05-08-fhc-sync-fluxaos.md`
