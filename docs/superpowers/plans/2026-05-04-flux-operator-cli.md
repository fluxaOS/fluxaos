# Flux Operator CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a root `flux` operator command for dev web, production web, and daemon lifecycle actions.

**Architecture:** Use one focused Bash script at repo root. Keep dev server PID/log state in `.flux/`, delegate production Docker operations to the existing `/mnt/stacks/docker/fluxaos` stack, and manage daemon services through a small name registry where `orchestrator` maps to the current `fluxaos-daemon` systemd user unit.

**Tech Stack:** Bash, npm, Docker Compose, systemd user units.

---

### Task 1: CLI Dispatch And Tests

**Files:**
- Create: `flux`
- Create: `tests/flux-cli.test.sh`
- Modify: `README.md`

- [ ] Add shell tests for help, daemon aliasing, unknown daemon rejection, and dry-run dispatch.
- [ ] Implement `flux server dev start|stop|restart|status` on port `3004`.
- [ ] Implement `flux server prod start|stop|restart|status|build` against `/mnt/stacks/docker/fluxaos`, targeting `fluxaos-web`.
- [ ] Implement `flux daemon list` and `flux daemon orchestrator start|stop|restart|status|install|uninstall`.
- [ ] Implement `flux orchestrator ...` as an alias for `flux daemon orchestrator ...`.
- [ ] Document the command surface in `README.md`.
- [ ] Verify with `bash tests/flux-cli.test.sh`, `bash -n flux`, and `git diff --check`.
