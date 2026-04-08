# fluxaOS — Ecosystem Bootstrap Design

**Date:** 2026-04-07
**Status:** Approved
**Author:** Joe Pierce + Claude

## Summary

This document captures the strategic decisions about how fluxaOS separates from the PAT/fhc ecosystem and establishes its own development infrastructure on GitHub. It defines Phase 0 — the bootstrap work that must happen before fluxaOS Phase 1 (Foundation & Skeleton) begins.

## Strategic Decisions

### Platform: GitHub-first, platform-agnostic by design

- fluxaOS is 100% GitHub from day one. Source code, issues, PRs, CI — all on GitHub.
- No Forgejo involvement. No mirrors. Clean break.
- However, all platform interactions are behind adapter interfaces and resolved from config — so switching to GitLab, Gitea, or anything else is a config change, not a rewrite.
- This follows fluxaOS Founding Principle #1: no vendor coupling.

### fhc: Stays around as long as needed

- fh-commons continues to work for existing projects. No formal sunset.
- Existing projects (fileHelper, stacks, homelab, grafana, ansible, mim) stay on fhc/Forgejo as-is.
- fhc#2624 (platform decoupling epic) is deprioritized — closed, not needed for the flux path.
- When fluxaOS is proven and can manage projects, existing projects migrate into it. fhc retires naturally when there's nothing left on it.
- Active development priority is 100% flux. fhc gets fixes only if something breaks.

### PAT: All issues closed

- All open PAT issues are closed with a reference to the fluxaOS rewrite.
- PAT enters archive status. No further development.
- Domain knowledge and proven patterns transfer to fluxaOS as design — not code.

### Repo structure: Two repos

| Repo | Purpose | Platform |
|------|---------|----------|
| `fluxaos-planning` | Specs, roadmaps, brainstorming, design docs | GitHub |
| `fluxaos` | Source code (created at Phase 1 start) | GitHub |

Both repos get their own GitHub Issues. Planning issues track design decisions and open questions. Source repo issues track implementation work, bugs, and features.

### Template & skill strategy: Fork and adapt

The fhc template/sync system is the one piece worth bringing over. The approach:

1. **Fork the sync engine** — the file-copying + placeholder-replacement logic. Small, self-contained.
2. **Adapt placeholders to be config-driven** — `{{CLI}}`, `{{PROJECT}}`, etc. resolve from a project config file, not hardcoded per-project.
3. **Adapt skills for platform-agnostic operation** — skills like `/manager` and `/loop` call through an adapter layer. The adapter reads from config which platform CLI to use (`gh`, `glab`, `tea`, etc.).
4. **No hardcoded platform commands in skills** — instead of `gh issue list`, skills call `flux issue list` which resolves the platform internally.

### Why platform-agnostic matters

> "The AI landscape changes every day. As a solo developer, the ability to shift gears fast is a competitive advantage. Coupling to any single platform eliminates that advantage."

This is a lesson learned from two years of vibe coding. Large companies (Apple, Google) can't pivot quickly. A solo dev + Claude can make decisions in a day that would take them a year. That agility only works if the tooling doesn't fight you when you pivot.

---

## Phase 0: Ecosystem Bootstrap

This phase prepares the development infrastructure. No fluxaOS source code is written — just the environment to build it in.

### 0.1 — Set up fluxaos-planning on GitHub

- Create GitHub repo `fluxaos-planning` (or under an org if decided)
- Push existing planning content (specs, roadmaps, brainstorming)
- Set up GitHub Issues for planning-level tracking
- Create issues for the pre-flight questions from the roadmap

### 0.2 — Close PAT issues

- Close all remaining open PAT issues with comment: "Superseded by fluxaOS rewrite"
- Close FHC issues that are PAT-specific (#2543, #2483, #2482)
- Deprioritize FHC #2624 (add comment: deprioritized, fhc entering maintenance mode)

### 0.3 — Fork template/sync system

- Extract the sync engine from fhc into a standalone module
- Adapt placeholder resolution to read from a config file (not hardcoded per-project)
- Decide: does the sync engine live in `fluxaos-planning`, in the `fluxaos` source repo, or in its own repo?
- Adapt key skills for platform-agnostic operation:
  - `/manager` — issue lifecycle orchestration
  - `/loop` — recurring task execution
  - `/implement` — implementation workflow
  - `/review` — code review workflow
  - `/deploy` — deployment workflow

### 0.4 — Resolve pre-flight questions

From the [roadmap](2026-04-07-fluxaos-roadmap.md):

- [ ] Repo name and GitHub org — `fluxaos/fluxaos`? Personal account?
- [ ] License — AGPLv3 / BSL / MIT
- [ ] Supabase vs raw Postgres for alpha
- [ ] Worker in same process or separate container

### 0.5 — Create Phase 1 issues on GitHub

- Translate the Phase 1 deliverables from the roadmap into GitHub Issues
- Set up project board or milestones for tracking
- Ready to start building

### Exit criteria

- `fluxaos-planning` repo live on GitHub with all existing content
- All PAT issues closed
- Template/sync engine extracted and adapted (or plan for how it integrates into Phase 1)
- Pre-flight questions answered
- Phase 1 issues created on GitHub
- Ready to `mkdir fluxaos && git init`

---

## Transition Timeline

```
NOW         fhc active, PAT active, flux planning
Phase 0     fhc maintenance, PAT archived, flux bootstrap
Phase 1-7   fhc maintenance, flux building
Ship        fhc maintenance, flux live
Migration   existing projects move to flux
End state   fhc retired, flux manages everything
```

## Design Principles for Tooling

These apply to everything built in Phase 0 and carried forward:

1. **Config over convention** — platform, CLI tool, API endpoints, auth method all come from config
2. **Adapter pattern everywhere** — skills call flux, flux resolves the platform adapter from config
3. **One change to switch** — swapping GitHub for GitLab should require changing one config value and writing one adapter module
4. **Skills are platform-blind** — they describe WHAT to do (list issues, create PR), not HOW (which CLI, which API)
5. **Test with real tools** — no mocks, same philosophy as PAT/fhc
