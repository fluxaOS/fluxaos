# R-POLISH-DOCS — Cleanup, terminology, ship docs

**Phase:** R-POLISH-DOCS (the "ship docs" half of R-POLISH)
**Status:** SPEC
**Created:** 2026-04-25
**Author:** Claude Opus 4.7 (1M)
**Depends on:** R-POLISH-CORE (Done) — engine-correctness items shipped there.

---

## 1. Problem

The README is the operator's first contact with fluxaOS. Today's README at `/README.md` is significantly stale:

- Tech stack table lists `execa` (R-DAEMON removed it).
- Ports list mentions `IssueProvider` (deleted in R-REM-W3-a).
- Project Structure references `src/cli/` (decoupled per R-INFRA — there is no CLI).
- Quick Start uses `docker compose up -d` (no compose in repo).
- Stage list says "research, implement, review, deploy" (R-POLISH-CORE reduced to 3).
- "4 personas" seeded (verify against current seed; likely 0 in alpha).
- Zero mention of: daemon, systemd unit, mission-control, settings tabs, R-SMOKE journey, sandbox repo, FLUXAOS_* env vars beyond legacy ones.

Plus there are scattered terminology gaps surfaced during recent phases:
- `harness → driver` rename was R-UI-1; remaining stragglers may exist in older docs.
- Archon attribution: prior-art research at `docs/superpowers/research/2026-04-22-archon-prior-art.md` informed several specs (R-RUNTIME, R-ARTIFACTS, etc.). Five specs reference Archon already; verify the broader set is consistent.

R-POLISH-DOCS rewrites the README for the post-alpha-ship operator and runs a single terminology + attribution audit pass.

## 2. Goals

- README is correct, current, and operator-runnable from a fresh clone.
- README references the actual alpha shape: daemon, systemd unit, mission-control, settings tabs, journey tests, sandbox repo.
- Terminology audit removes residual `harness` references in non-historical docs.
- Archon attribution audit lists the specs that lifted patterns; spot-check that each carries its attribution line; add any missing.
- Definition-of-done from `.claude/AGENT_BEHAVIOR.md` no longer references `fhc sync` (fluxaOS is decoupled per project memory).

## 3. Non-goals

- **New tutorials, screenshots, or videos.** Out of scope for an alpha-ship README.
- **Marketing language.** README stays operator-focused.
- **Doc-site / Storybook / generated API docs.** Post-alpha.
- **README translation.** Single English target.
- **Drizzle drift fix.** Already filed as DEF-025 / DEF-019.
- **DEF-016 (verbose-mode noisy logs).** Out of scope.
- **Renaming `harness` in code (`AGENT_BEHAVIOR.md` mentions XCUITest/molecule which are test-runner names, not harness).** Code already uses `driver` per R-UI-1.

## 4. Requirements

### R-POLISH-DOCS.R1 — README rewrite

- Single full pass on `/README.md`. Sections: What is fluxaOS · Quick Start · Architecture · Tech Stack · Project Structure · Configuration · Development · License.
- **What is fluxaOS:** keep concise; call out the alpha-shape ("file an issue → daemon picks up → PR opens").
- **Quick Start:** drop `docker compose up -d` (not present); replace with the actual sequence:
  - clone
  - install (`npm install`)
  - configure `.env.local` (Supabase + AI provider key + GitHub token + cleanup thresholds + daemon grace)
  - migrate (`npm run db:migrate`)
  - seed (`npm run db:seed`)
  - launch dev server + daemon (two terminals OR systemd user-unit)
  - file an issue, click Run Stage
- **Architecture:** keep ASCII block but trim to current layers (UI → tRPC → Core → Daemon → Adapters). Drop OpenAI from the diagram (Anthropic-only per Post-Alpha plan).
- **Tech Stack:** drop `execa`. Confirm `Tailwind 4`, `tRPC v11`, `Drizzle`, `Supabase`. Drop `BullMQ` if unused; keep if still in `package.json`.
- **Project Structure:** delete the `src/cli/` line. Drop `src/adapters/openai/` reference. Drop `src/adapters/node-exec/` (executor lives at `src/adapters/subprocess/` now). Drop `IssueProvider` from ports list.
- **Configuration:** rebuild from `.env.example` + the env-var contract in `CLAUDE.md` (R-RUNTIME env vars block). Include `FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS`, target repo path, GitHub token, cleanup thresholds.
- **Development:** add `npm run daemon`, mention systemd user-unit at `ops/systemd/fluxaos-daemon.service`. Mention `e2e/r-smoke.spec.ts` as the alpha-acceptance gate. Mention `npm run verify` + `verify:seed`.
- **License:** verify the LICENSE file actually says AGPLv3; correct if not.

### R-POLISH-DOCS.R2 — Terminology audit (non-historical docs only)

- Run a `grep -rn "harness\b"` over `docs/` excluding `docs/superpowers/{handoffs,research,rca}/` (those are historical artifacts and should not be edited).
- For every match in current-living docs (specs in active phases, README, CLAUDE.md, session-quick-start, invariants), evaluate: is this term still meaningful, or should it be `driver`?
- For each: edit + commit, OR document why the term is correct in context (rare).

### R-POLISH-DOCS.R3 — Archon attribution audit

- Currently 5 specs reference Archon. Verify the attribution is consistent (a single line near the top citing the prior-art research doc).
- For specs that lifted patterns but DON'T reference Archon (e.g., R-DAEMON's daemon shape, R-RUNTIME's worktree pattern), add the attribution line if applicable.
- Single grep + audit pass; not a deep rewrite.

### R-POLISH-DOCS.R4 — `.claude/AGENT_BEHAVIOR.md` cleanup

- Definition-of-done line currently mentions `fhc sync` for templates/. fluxaOS is decoupled from fh-commons per R-INFRA; that line is stale.
- Edit: remove the `fhc sync` clause. Replace with: "merged branches deleted (locally + origin), worktrees pruned. Open PRs don't count as done."

### R-POLISH-DOCS.R5 — Verification

- `npx tsc --noEmit` clean (no code touched, but sanity-check).
- `npx vitest run` 249/249 (sanity).
- README renders cleanly on GitHub (preview locally with `cat` + visual inspect).
- Every `npm run` command in the new README actually exists in `package.json`.
- Every env var in the new README's Configuration section is consumed by code (grep for it).
- Pre-commit lint + 500-line cap on every commit.

## 5. Risk and edge cases

- **Existing installations.** README changes affect only future operators; no migration concern.
- **License correctness.** If LICENSE file says something other than AGPLv3, that's a small fact-check issue. Resolve in W1.
- **`harness` in code.** R-UI-1 already renamed. If grep finds residue in `src/`, that's out of scope for R-POLISH-DOCS — file as a separate DEF.
- **Archon spec consistency.** If a spec lifted a pattern but no clear attribution exists, the lift may be inadequate; flag in PR description rather than rewrite the spec body.

## 6. What "Done" looks like

- A new operator can clone, configure, run, and watch R-SMOKE green using only the README.
- `harness` exists nowhere in living docs.
- All Archon-influenced specs cite the prior-art doc.
- AGENT_BEHAVIOR.md's DoD line is decoupled-correct.
- Roadmap moves R-POLISH-DOCS to Done; alpha is shipped.
