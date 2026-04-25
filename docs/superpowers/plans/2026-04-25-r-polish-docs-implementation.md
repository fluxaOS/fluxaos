# R-POLISH-DOCS — Implementation plan

**Date:** 2026-04-25
**Spec:** [`../specs/2026-04-25-r-polish-docs-design.md`](../specs/2026-04-25-r-polish-docs-design.md)

---

## Plan-phase reconciliation

1. **License is AGPLv3.** ✅ `cat LICENSE | head -3` confirms.
2. **`src/cli/` does not exist.** ✅ Decoupled per R-INFRA. README's reference is dead.
3. **`execa` removed from deps.** ✅ Per R-DAEMON.
4. **`bullmq` still in package.json.** ✅ Adapter exists but is unused per the R-DAEMON spec deferred-note. Keep mention in tech stack as-is for now (real removal is post-alpha bookkeeping); flag in spec if the audit surfaces it as misleading.
5. **Personas: not seeded in alpha.** ✅ `grep -n "persona" seed.ts` shows zero personas seeded. The current README's "4 personas (Researcher, Implementer, Reviewer, Deployer)" is plain wrong.
6. **`.env.example` exists** — covers Supabase, Redis, plus inferred others. README must point at it.
7. **Archon spec count = 5.** ✅ Per the survey grep.
8. **`fhc sync` line in `.claude/AGENT_BEHAVIOR.md`** — single line, easy edit.

**Plan-phase decisions on open questions (defaulted per AGENT_BEHAVIOR.md):**

- **Quick Start** is two-terminal: dev + daemon. systemd is mentioned as the production path but not the recommended dev setup.
- **Architecture diagram** keeps the ASCII block for vibes but trims to: UI → tRPC → Core → Daemon (separate), all over Supabase. Adapters listed as a footnote.
- **Tech Stack** keeps `bullmq` for now (still in package.json). Notes `Playwright` for journeys + `Vitest` for integration.
- **Project Structure** is rewritten from `ls src/` rather than reused-from-stale.
- **Configuration table** is rebuilt from `.env.example` + the R-RUNTIME env vars block in CLAUDE.md.
- **R3 Archon attribution** is light-touch: skim each spec that should reference Archon, add a `**Prior art:** [archon-prior-art](../research/2026-04-22-archon-prior-art.md)` line if missing. Don't rewrite spec bodies.

---

## Task breakdown

### Wave 1 — README rewrite

**T1.** Rewrite `/README.md`:
- Sections per spec §R1.
- Drop `docker compose up -d` (no compose).
- Drop "4 personas seeded" claim.
- Drop `IssueProvider`, `OpenAI`, `src/cli/`, `src/adapters/node-exec/`, `execa`.
- Add `npm run daemon` + systemd note.
- Add `e2e/r-smoke.spec.ts` reference.
- Add `FLUXAOS_DAEMON_SHUTDOWN_GRACE_SECONDS` and other R-RUNTIME env vars.
- Reduce stage count claim from 4 → 3 (research → implement → review).
- Verify every `npm run X` mentioned exists in `package.json`.
- Verify every env var mentioned has a consumer in code (`grep -rn "process.env.X"`).

**T2.** Verify:
- `cat README.md` reads cleanly top-to-bottom; no broken refs.
- `npm run X` for every X listed; sanity (no execution needed, just spelling check).

**Commit:** `R-POLISH-DOCS W1: README rewrite`.

### Wave 2 — Terminology audit

**T3.** Run audit:
- `grep -rn "harness\b" docs/ --include="*.md" | grep -v "/handoffs/\|/research/\|/rca/" | grep -v "test harness\|XCUITest\|molecule"` (skip historical artifacts and unambiguous test-runner references).
- Inspect each match. Edit if `harness` should be `driver`. Skip if context-correct.
- Pure read-and-edit pass; no logic changes.

**T4.** Edit `.claude/AGENT_BEHAVIOR.md` per spec §R4: drop the `fhc sync` clause from the DoD line.

**Commit:** `R-POLISH-DOCS W2: terminology + AGENT_BEHAVIOR DoD cleanup`.

### Wave 3 — Archon attribution audit

**T5.** Audit:
- `grep -rln "Archon" docs/superpowers/specs/*.md` — current set: r-artifacts, fluxaos-spec-v2, r-polish-core, r-ui-2-disposition, r-runtime.
- For each NOT in the set whose patterns plausibly came from Archon (R-DAEMON, R-EPIC, R-SMOKE), grep the spec's body for any patterns matching the Archon prior-art doc's tablecontents.
- Add `**Prior art:** [archon-prior-art](../research/2026-04-22-archon-prior-art.md)` near the top header of any spec that lifted patterns but has no current attribution.
- If none surface, document the audit pass in the PR description ("verified all Archon-influenced specs cite prior art"); commit nothing in this wave.

**T6.** If anything was edited:
- `npx tsc --noEmit` — sanity.
- Commit: `R-POLISH-DOCS W3: Archon attribution audit pass`.

If no edits: skip the commit; mention in W4 commit body.

### Wave 4 — Roadmap

**T7.** Update `docs/superpowers/roadmap.md`:
- Move R-POLISH-DOCS to Done with spec + plan links.
- Alpha section becomes "Done — Alpha SHIPPED" with no Next.
- Append one sentence to current-engine-state paragraph: "Alpha is shipped — README is operator-runnable from a fresh clone, terminology is consistent, Archon prior art is attributed."

**Commit:** `R-POLISH-DOCS W4: roadmap — alpha shipped`.

---

## Verification matrix per wave

| Gate | W1 | W2 | W3 | W4 |
|---|---|---|---|---|
| `tsc --noEmit` clean | required | required | required | required |
| `vitest run` 249/249 | required | required | required | required |
| README every-`npm-run`-exists | required | n/a | n/a | n/a |
| README env-var consumers exist | required | n/a | n/a | n/a |
| Pre-commit lint + 500-line cap | required | required | required | required |

---

## Rollback strategy

Pure docs delta. `git revert <sha>` per wave is sufficient.

---

## Goal-backward verification

| Goal element | Delivered by |
|---|---|
| README operator-runnable | W1 |
| `harness` removed from living docs | W2 |
| Archon attribution audited | W3 |
| AGENT_BEHAVIOR DoD decoupled | W2 |
| Roadmap reflects alpha shipped | W4 |
